import { Prisma } from '@narra/database';
import { WalletEntryBand, type WalletBandPerformance, type WalletPerformance } from '@narra/shared';
import { median } from '@narra/smart-money';

const D = Prisma.Decimal.clone({ precision: 80 });
type Decimal = Prisma.Decimal;
export interface PerformanceTrade {
  id: string; tokenId: string; side: 'BUY' | 'SELL'; amountSol: { toString(): string };
  tokenAmount: { toString(): string } | null; marketCapUsd: { toString(): string } | null; evidence: unknown; at: Date;
}
type Position = { token: string; band: WalletEntryBand; start: number; last: number; firstSell: number | null;
  close: number | null; qty: Decimal; cost: Decimal; invested: Decimal; pnl: Decimal; sold: boolean };
const decimalMedian = (xs: Decimal[]) => {
  const s = [...xs].sort((a,b) => a.cmp(b)), mid = Math.floor(s.length / 2);
  return !s.length ? null : s.length % 2 ? s[mid]!.toFixed() : s[mid-1]!.plus(s[mid]!).div(2).toFixed();
};
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Entry classification uses frozen pre-trade evidence only. FDV and later market caps never substitute. */
function entryBand(t: PerformanceTrade): WalletEntryBand {
  const evidence = object(t.evidence), market = object(evidence.market), at = typeof market.at === 'string' ? Date.parse(market.at) : NaN;
  if (evidence.eventAt !== t.at.toISOString() || market.source !== 'dexscreener' || market.marketCapIsFdv !== false ||
      !Number.isFinite(at) || at > +t.at || +t.at - at > 900_000 || t.marketCapUsd == null) return 'UNKNOWN';
  const cap = new D(t.marketCapUsd.toString());
  if (!cap.isFinite() || cap.lte(0)) return 'UNKNOWN';
  return cap.lt(100_000) ? 'UNDER_100K' : cap.lt(500_000) ? '100K_500K' : cap.lt(1_000_000) ? '500K_1M' : 'OVER_1M';
}

/** Swap-only average-cost accounting. One observed flat-to-flat position is one trial,
 * not one sell leg. Transfers, fees, live balances and open-position mark-to-market are unknown. */
export function computeWalletPerformance(rows: PerformanceTrade[], now: Date, capped = false): WalletPerformance {
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
      if (!p) { p = { token: t.tokenId, band: entryBand(t), start: +t.at, last: +t.at, firstSell: null, close: null,
        qty: new D(0), cost: new D(0), invested: new D(0), pnl: new D(0), sold: false }; positions.push(p); active.set(t.tokenId,p); }
      p.qty = p.qty.plus(qty); p.cost = p.cost.plus(sol); p.invested = p.invested.plus(sol); p.last = +t.at;
    } else {
      if (!p || qty.gt(p.qty)) { unmatchedSells++; contaminated.add(t.tokenId); active.delete(t.tokenId); continue; }
      const cost = p.cost.mul(qty).div(p.qty);
      p.pnl = p.pnl.plus(sol.minus(cost)); p.qty = p.qty.minus(qty); p.cost = p.cost.minus(cost); p.last = +t.at;
      p.firstSell ??= +t.at; p.sold = true;
      if (p.qty.eq(0)) { p.close = +t.at; active.delete(t.tokenId); }
    }
  }
  // Incomplete basis can distort even earlier positions for that token; exclude all of them.
  const valid = positions.filter(p => !contaminated.has(p.token));
  const bands = WalletEntryBand.options.map(band => {
    const mine = valid.filter(p => band === 'ALL' || p.band === band || band === 'SMALL_CAP' && ['UNDER_100K','100K_500K','500K_1M'].includes(p.band));
    const closed = mine.filter(p => p.close !== null), sold = mine.filter(p => p.sold);
    const wins = closed.filter(p => p.pnl.gt(0)), losses = closed.filter(p => p.pnl.lt(0)), n = closed.length, rate = n ? wins.length/n : null;
    const sum = (xs: Position[], f: (p: Position) => Decimal) => xs.reduce((a,p) => a.plus(f(p)),new D(0));
    const grossWin = sum(wins,p=>p.pnl), grossLoss = sum(losses,p=>p.pnl.abs());
    let equity = new D(0), peak = new D(0), drawdown = new D(0);
    for (const p of [...closed].sort((a,b)=>a.close!-b.close!)) { equity=equity.plus(p.pnl); peak=D.max(peak,equity); drawdown=D.max(drawdown,peak.minus(equity)); }
    // 95% Wilson lower bound penalises tiny samples; this is descriptive, not a future-win probability.
    const z2 = 1.96 ** 2;
    const lower = rate === null ? null : (rate+z2/(2*n)-1.96*Math.sqrt(rate*(1-rate)/n+z2/(4*n*n)))/(1+z2/n);
    return { band, positions: mine.length, closedPositions: n, closedTokens: new Set(closed.map(p=>p.token)).size,
      wins: wins.length, losses: losses.length, breakeven: n-wins.length-losses.length, openPositions: mine.length-n,
      winRate: rate, winRateLowerBound: lower, realisedPnlSol: sold.length ? sum(sold,p=>p.pnl).toFixed() : null,
      openCostSol: sum(mine.filter(p=>p.close===null),p=>p.cost).toFixed(), medianRoi: median(closed.map(p=>p.pnl.div(p.invested).toNumber())),
      medianWinSol: decimalMedian(wins.map(p=>p.pnl)), medianLossSol: decimalMedian(losses.map(p=>p.pnl)),
      profitFactor: grossLoss.gt(0) ? grossWin.div(grossLoss).toNumber() : null,
      medianFirstSellSeconds: median(sold.map(p=>(p.firstSell!-p.start)/1000)), medianCloseSeconds: median(closed.map(p=>(p.close!-p.start)/1000)),
      realisedDrawdownSol: drawdown.toFixed(), observedDays: mine.length ? (Math.max(...mine.map(p=>p.last))-Math.min(...mine.map(p=>p.start)))/86_400_000 : 0,
      fastCloseRate: n ? closed.filter(p=>p.close!-p.start<60_000).length/n : null,
    } satisfies WalletBandPerformance;
  });
  return { version: 1, checkedAt: now.toISOString(), windowDays: 30, observedTrades: trades.length, invalidTrades, unmatchedSells, capped,
    lastTradeAt: trades.at(-1)?.at.toISOString() ?? null, bands };
}
