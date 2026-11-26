import { Prisma } from '@narra/database';
import { WalletEntryBand, type WalletBandPerformance, type WalletOpenPositions, type WalletPerformance } from '@narra/shared';
import { median } from '@narra/smart-money';

const D = Prisma.Decimal.clone({ precision: 80 });
type Decimal = Prisma.Decimal;
export interface PerformanceTrade {
  id: string; tokenId: string; side: 'BUY' | 'SELL'; amountSol: { toString(): string };
  tokenAmount: { toString(): string } | null; marketCapUsd: { toString(): string } | null; evidence: unknown; at: Date;
}
type Position = { entryTradeId: string; token: string; band: WalletEntryBand; start: number; last: number; firstSell: number | null;
  close: number | null; qty: Decimal; boughtQty: Decimal; cost: Decimal; invested: Decimal; entry: Decimal; pnl: Decimal; sold: boolean };
const decimalMedian = (xs: Decimal[]) => {
  const s = [...xs].sort((a,b) => a.cmp(b)), mid = Math.floor(s.length / 2);
  return !s.length ? null : s.length % 2 ? s[mid]!.toFixed() : s[mid-1]!.plus(s[mid]!).div(2).toFixed();
};
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

export interface TokenSpotPrice {
  priceUsd: number;
  liquidityUsd: number | null;
}

export interface MarkToMarketContext {
  solUsd: number;
  prices: ReadonlyMap<string, TokenSpotPrice>;
}

/** Dead-bag survivorship thresholds: an open position held ≥ 24h that has lost ≥ 90% or sits in < $1K liquidity. */
export const DEAD_BAG_RULES = {
  minAgeMs: 24 * 3_600_000,
  maxRemainingValueRatio: 0.1,
  minLiquidityUsd: 1_000,
} as const;

/** Dust-close thresholds: after replaying all swaps, a sold position with ≤ 1% tokens left (or ≤ 5% tokens AND ≤ 0.005 SOL remaining cost) is treated as closed. */
export const DUST_CLOSE_RULES = {
  maxRemainingQtyRatio: 0.01,
  maxRemainingCostSol: '0.005',
  maxRemainingCostQtyRatio: 0.05,
} as const;

const ENTRY_CAP_SOURCES = new Set(['dexscreener', 'swap_implied']);

/** Entry classification uses frozen pre-trade or swap-implied evidence only. FDV and later market caps never substitute. */
function entryBand(t: PerformanceTrade): WalletEntryBand {
  const evidence = object(t.evidence), market = object(evidence.market), at = typeof market.at === 'string' ? Date.parse(market.at) : NaN;
  if (evidence.eventAt !== t.at.toISOString() || typeof market.source !== 'string' || !ENTRY_CAP_SOURCES.has(market.source) || market.marketCapIsFdv !== false ||
      !Number.isFinite(at) || at > +t.at || +t.at - at > 900_000 || t.marketCapUsd == null) return 'UNKNOWN';
  const cap = new D(t.marketCapUsd.toString());
  if (!cap.isFinite() || cap.lte(0)) return 'UNKNOWN';
  return cap.lt(100_000) ? 'UNDER_100K' : cap.lt(500_000) ? '100K_500K' : cap.lt(1_000_000) ? '500K_1M' : 'OVER_1M';
}

/** Swap-only average-cost accounting. One observed flat-to-flat position is one trial,
 * not one sell leg. Transfers, fees, live balances and open-position mark-to-market are unknown. */
function accountPositions(rows: PerformanceTrade[], now: Date) {
  const since = +now - 30 * 86_400_000, positions: Position[] = [], active = new Map<string, Position>();
  const contaminated = new Set<string>();
  let unmatchedSells = 0, invalidTrades = 0;
  const trades = rows.filter(t => +t.at >= since && +t.at <= +now).sort((a,b) => +a.at - +b.at || a.id.localeCompare(b.id));
  for (const t of trades) {
    const qty = t.tokenAmount == null ? null : new D(t.tokenAmount.toString()), sol = new D(t.amountSol.toString());
    if (!qty?.isFinite() || qty.lte(0) || !sol.isFinite() || sol.lt(0) || (t.side === 'BUY' && sol.eq(0))) {
      invalidTrades++; contaminated.add(t.tokenId); continue;
    }
    let p = active.get(t.tokenId);
    if (t.side === 'BUY') {
      if (!p) { p = { entryTradeId: t.id, token: t.tokenId, band: entryBand(t), start: +t.at, last: +t.at, firstSell: null, close: null,
        qty: new D(0), boughtQty: new D(0), cost: new D(0), invested: new D(0), entry: sol, pnl: new D(0), sold: false }; positions.push(p); active.set(t.tokenId,p); }
      p.qty = p.qty.plus(qty); p.boughtQty = p.boughtQty.plus(qty); p.cost = p.cost.plus(sol); p.invested = p.invested.plus(sol); p.last = +t.at;
    } else {
      const eps = p ? D.max(new D('1e-9'), p.qty.mul('1e-9')) : null;
      if (!p || qty.gt(p.qty.plus(eps!))) { unmatchedSells++; contaminated.add(t.tokenId); active.delete(t.tokenId); continue; }
      const fullClose = p.qty.minus(qty).lte(eps!);
      const soldQty = fullClose ? p.qty : qty;
      const cost = fullClose ? p.cost : p.cost.mul(soldQty).div(p.qty);
      p.pnl = p.pnl.plus(sol.minus(cost)); p.qty = fullClose ? new D(0) : p.qty.minus(soldQty); p.cost = fullClose ? new D(0) : p.cost.minus(cost); p.last = +t.at;
      p.firstSell ??= +t.at; p.sold = true;
      if (fullClose) { p.close = +t.at; active.delete(t.tokenId); }
    }
  }
  // Incomplete basis can distort even earlier positions for that token; exclude all of them.
  const valid = positions.filter(p => !contaminated.has(p.token));
  // Post-replay dust-close: settles sold positions that only left negligible dust/moonbag
  // without causing false unmatchedSells if the trader later sells that residual within the window.
  for (const p of valid) {
    if (p.close !== null || !p.sold || !p.boughtQty.gt(0)) continue;
    const dustByQty = p.qty.lte(p.boughtQty.mul(DUST_CLOSE_RULES.maxRemainingQtyRatio));
    const dustByCost = p.cost.lte(DUST_CLOSE_RULES.maxRemainingCostSol) && p.qty.lte(p.boughtQty.mul(DUST_CLOSE_RULES.maxRemainingCostQtyRatio));
    if (dustByQty || dustByCost) {
      p.close = p.last;
      p.qty = new D(0);
      p.cost = new D(0);
    }
  }
  return { valid, trades, invalidTrades, unmatchedSells };
}

/** Same observed, uncontaminated flat-to-flat positions as performance reporting.
 * An add or partial exit is not a new entry. The caller supplies the same row cap. */
export function walletEntryCapPositions(rows: PerformanceTrade[], now: Date) {
  return accountPositions(rows,now).valid.map(p=>({ entryTradeId:p.entryTradeId,tokenId:p.token,band:p.band,closed:p.close!==null }));
}

export function computeWalletOpenPositions(rows: PerformanceTrade[], now: Date, capped = false): WalletOpenPositions {
  const { valid, trades, invalidTrades, unmatchedSells } = accountPositions(rows, now);
  return {
    version: 1,
    checkedAt: now.toISOString(),
    windowDays: 30,
    observedTrades: trades.length,
    capped,
    invalidTrades,
    unmatchedSells,
    positions: valid.filter(p => p.close === null)
      .sort((a, b) => b.last - a.last || a.entryTradeId.localeCompare(b.entryTradeId))
      .map(p => ({
        tokenId: p.token,
        entryTradeId: p.entryTradeId,
        band: p.band,
        quantity: p.qty.toString(),
        remainingCostSol: p.cost.toString(),
        investedSol: p.invested.toString(),
        entrySol: p.entry.toString(),
        openedAt: new Date(p.start).toISOString(),
        lastTradeAt: new Date(p.last).toISOString(),
        partiallySold: p.sold,
      })),
  };
}

export interface ClosedTokenHighlight {
  tokenId: string;
  pnlSol: number;
  investedSol: number;
  roi: number;
  holdSeconds: number;
  band: WalletEntryBand;
  closedAt: string;
}

export interface WalletClosedSummary {
  equityCurve: { at: string; cumulativePnlSol: number }[];
  topWinners: ClosedTokenHighlight[];
  topLosers: ClosedTokenHighlight[];
}

/** Chronological realised equity curve (downsampled to <= 60 points) plus top 5 winners & losers from closed positions. */
export function computeWalletClosedSummary(rows: PerformanceTrade[], now: Date): WalletClosedSummary {
  const { valid } = accountPositions(rows, now);
  const closed = valid.filter((p) => p.close !== null).sort((a, b) => a.close! - b.close! || a.entryTradeId.localeCompare(b.entryTradeId));
  let cum = new D(0);
  const rawCurve = closed.map((p) => {
    cum = cum.plus(p.pnl);
    return { at: new Date(p.close!).toISOString(), cumulativePnlSol: Math.round(cum.toNumber() * 1e6) / 1e6 };
  });
  let equityCurve = rawCurve;
  if (rawCurve.length > 60) {
    const step = (rawCurve.length - 1) / 59;
    equityCurve = Array.from({ length: 60 }, (_, i) => rawCurve[Math.round(i * step)]!);
  }
  const toHighlight = (p: Position): ClosedTokenHighlight => ({
    tokenId: p.token,
    pnlSol: Math.round(p.pnl.toNumber() * 1e6) / 1e6,
    investedSol: Math.round(p.invested.toNumber() * 1e6) / 1e6,
    roi: p.invested.gt(0) ? Math.round(p.pnl.div(p.invested).toNumber() * 1e4) / 1e4 : 0,
    holdSeconds: Math.max(0, Math.round((p.close! - p.start) / 1000)),
    band: p.band,
    closedAt: new Date(p.close!).toISOString(),
  });
  const topWinners = closed.filter((p) => p.pnl.gt(0)).sort((a, b) => b.pnl.cmp(a.pnl)).slice(0, 5).map(toHighlight);
  const topLosers = closed.filter((p) => p.pnl.lt(0)).sort((a, b) => a.pnl.cmp(b.pnl)).slice(0, 5).map(toHighlight);
  return { equityCurve, topWinners, topLosers };
}

export interface CopyTradeScenario {
  delaySeconds: number;
  feePct: number;
  eligiblePositions: number;
  skippedTooFast: number;
  winRate: number | null;
  /** Net cumulative SOL return per 1 SOL fixed size per copied trade after round-trip friction. */
  netPnlPerSol: number;
  medianRoi: number | null;
}

const COPY_SIM_PRESETS = [
  { delaySeconds: 30, minHoldSeconds: 60, feePct: 0.015 },
  { delaySeconds: 120, minHoldSeconds: 240, feePct: 0.025 },
  { delaySeconds: 600, minHoldSeconds: 1200, feePct: 0.04 },
] as const;

/**
 * Fixed-size copy-trade friction simulation across 30s / 2m / 10m entry delays.
 * Skips closed positions exited faster than 2x the delay (un-copyable) and deducts an explicit
 * round-trip fee/slippage estimate. Descriptive stress-test only—not a guaranteed live fill.
 */
export function computeCopyTradeSimulation(rows: PerformanceTrade[], now: Date): CopyTradeScenario[] {
  const { valid } = accountPositions(rows, now);
  const closed = valid.filter((p) => p.close !== null && p.invested.gt(0));
  return COPY_SIM_PRESETS.map(({ delaySeconds, minHoldSeconds, feePct }) => {
    const eligible: number[] = [];
    let skippedTooFast = 0;
    for (const p of closed) {
      const holdSeconds = (p.close! - p.start) / 1000;
      if (holdSeconds < minHoldSeconds) { skippedTooFast++; continue; }
      const rawRoi = p.pnl.div(p.invested).toNumber();
      if (!Number.isFinite(rawRoi)) continue;
      // Floor at -1 (-100% max loss on spot) after round-trip fee/slippage friction.
      eligible.push(Math.max(-1, rawRoi - feePct));
    }
    const wins = eligible.filter((r) => r > 0).length;
    const netPnlPerSol = Math.round(eligible.reduce((s, r) => s + r, 0) * 1e4) / 1e4;
    const med = median(eligible);
    return {
      delaySeconds,
      feePct,
      eligiblePositions: eligible.length,
      skippedTooFast,
      winRate: eligible.length ? wins / eligible.length : null,
      netPnlPerSol,
      medianRoi: med != null ? Math.round(med * 1e4) / 1e4 : null,
    };
  });
}

export function computeWalletPerformance(rows: PerformanceTrade[], now: Date, capped = false, markToMarket?: MarkToMarketContext | null): WalletPerformance {
  const { valid, trades, invalidTrades, unmatchedSells } = accountPositions(rows,now);
  const validMtm = markToMarket && Number.isFinite(markToMarket.solUsd) && markToMarket.solUsd > 0 ? markToMarket : null;
  const bands = WalletEntryBand.options.map(band => {
    const mine = valid.filter(p => band === 'ALL' || p.band === band || band === 'SMALL_CAP' && ['UNDER_100K','100K_500K','500K_1M'].includes(p.band));
    const closed = mine.filter(p => p.close !== null), sold = mine.filter(p => p.sold), open = mine.filter(p => p.close === null);
    const wins = closed.filter(p => p.pnl.gt(0)), losses = closed.filter(p => p.pnl.lt(0)), n = closed.length, rate = n ? wins.length/n : null;
    const sum = (xs: Position[], f: (p: Position) => Decimal) => xs.reduce((a,p) => a.plus(f(p)),new D(0));
    const grossWin = sum(wins,p=>p.pnl), grossLoss = sum(losses,p=>p.pnl.abs());
    let equity = new D(0), peak = new D(0), drawdown = new D(0);
    for (const p of [...closed].sort((a,b)=>a.close!-b.close!)) { equity=equity.plus(p.pnl); peak=D.max(peak,equity); drawdown=D.max(drawdown,peak.minus(equity)); }
    // Mark-to-market open positions when latest spot prices are supplied.
    let pricedOpen = 0, openValue = new D(0), pricedCost = new D(0), deadBagPositions = 0, deadBagCost = new D(0);
    if (validMtm && open.length) {
      for (const p of open) {
        const spot = validMtm.prices.get(p.token);
        if (!spot || !Number.isFinite(spot.priceUsd) || spot.priceUsd < 0) continue;
        const valueSol = p.qty.mul(spot.priceUsd).div(validMtm.solUsd);
        pricedOpen++;
        openValue = openValue.plus(valueSol);
        pricedCost = pricedCost.plus(p.cost);
        const ageMs = +now - p.start;
        const illiquid = spot.liquidityUsd !== null && Number.isFinite(spot.liquidityUsd) && spot.liquidityUsd < DEAD_BAG_RULES.minLiquidityUsd;
        const wiped = p.cost.gt(0) && valueSol.lte(p.cost.mul(DEAD_BAG_RULES.maxRemainingValueRatio));
        if (ageMs >= DEAD_BAG_RULES.minAgeMs && (wiped || illiquid)) {
          deadBagPositions++;
          deadBagCost = deadBagCost.plus(p.cost);
        }
      }
    }
    // 95% Wilson lower bound penalises tiny samples; this is descriptive, not a future-win probability.
    const z2 = 1.96 ** 2;
    const lower = rate === null ? null : (rate+z2/(2*n)-1.96*Math.sqrt(rate*(1-rate)/n+z2/(4*n*n)))/(1+z2/n);
    return { band, positions: mine.length, closedPositions: n, closedTokens: new Set(closed.map(p=>p.token)).size,
      wins: wins.length, losses: losses.length, breakeven: n-wins.length-losses.length, openPositions: open.length,
      winRate: rate, winRateLowerBound: lower, realisedPnlSol: sold.length ? sum(sold,p=>p.pnl).toFixed() : null,
      openCostSol: sum(open,p=>p.cost).toFixed(), medianRoi: median(closed.map(p=>p.pnl.div(p.invested).toNumber())),
      medianWinSol: decimalMedian(wins.map(p=>p.pnl)), medianLossSol: decimalMedian(losses.map(p=>p.pnl)),
      profitFactor: grossLoss.gt(0) ? grossWin.div(grossLoss).toNumber() : null,
      medianFirstSellSeconds: median(sold.map(p=>(p.firstSell!-p.start)/1000)), medianCloseSeconds: median(closed.map(p=>(p.close!-p.start)/1000)),
      realisedDrawdownSol: drawdown.toFixed(), observedDays: mine.length ? (Math.max(...mine.map(p=>p.last))-Math.min(...mine.map(p=>p.start)))/86_400_000 : 0,
      fastCloseRate: n ? closed.filter(p=>p.close!-p.start<60_000).length/n : null,
      medianEntrySol: decimalMedian(mine.map(p=>p.entry)), deployedSol: sum(mine,p=>p.invested).toFixed(),
      medianClosedPositionSol: decimalMedian(closed.map(p=>p.invested)),
      entryCapKnownPositions: valid.filter(p=>p.band!=='UNKNOWN').length, entryCapTotalPositions: valid.length,
      ...(pricedOpen > 0 ? { openValueSol: openValue.toFixed(), unrealisedPnlSol: openValue.minus(pricedCost).toFixed() } : {}),
      ...(validMtm ? { deadBagPositions, deadBagCostSol: deadBagCost.toFixed() } : {}),
    } satisfies WalletBandPerformance;
  });
  return { version: 1, checkedAt: now.toISOString(), windowDays: 30, observedTrades: trades.length, invalidTrades, unmatchedSells, capped,
    lastTradeAt: trades.at(-1)?.at.toISOString() ?? null, bands };
}
