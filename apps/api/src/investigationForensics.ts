import { Prisma } from '@narra/database';
import type { InvestigationForensicsData, SmartMoneyInvestigation, SmartMoneyInvestigationTotals } from '@narra/shared';

const D = Prisma.Decimal.clone({ precision: 80 });
type Decimal = Prisma.Decimal;

type RawTrade = {
  id: string;
  walletId: string;
  signature: string;
  side: 'BUY' | 'SELL';
  amountSol: Prisma.Decimal;
  tokenAmount: Prisma.Decimal | null;
  at: Date;
};

const validSol = (n: Prisma.Decimal | null): n is Prisma.Decimal =>
  n !== null && n.isFinite() && !n.isNegative();

export type GroupPosture = 'ACCUMULATING' | 'DISTRIBUTING' | 'ROTATING' | 'UNPRICED';

/** Classifies a group's observed swap totals within the window without claiming off-window inventory. */
export function classifyGroupPosture(totals: SmartMoneyInvestigationTotals): GroupPosture {
  if (totals.tradeCount === 0 || (totals.buySol === null && totals.sellSol === null)) return 'UNPRICED';
  const buy = new D(totals.buySol ?? '0');
  const sell = new D(totals.sellSol ?? '0');
  if (buy.lte(0) && sell.lte(0)) return 'UNPRICED';
  if (sell.eq(0) || buy.gte(sell.mul(2))) return 'ACCUMULATING';
  if (buy.eq(0) || sell.gte(buy.mul(2))) return 'DISTRIBUTING';
  return 'ROTATING';
}

export const FORENSICS_BUCKET_COUNT = 12;
export const CO_ENTRY_BURST_WINDOW_MS = 5 * 60_000;

/**
 * Deterministic forensic analytics over the observed investigation sample:
 * - Group posture regime breakdown (accumulating vs distributing vs two-way rotating)
 * - Gross SOL flow concentration (Top-1, Top-3, HHI 0..10000) & qualified-wallet share of buys
 * - 12 chronological net-flow & active-group buckets across [from, asOf]
 * - Non-overlapping 5-minute coordinated multi-wallet co-entry bursts
 * - Round-trip rapid-flip wallets that both bought and sold inside the window
 */
export function computeInvestigationForensics(
  trades: readonly RawTrade[],
  participants: SmartMoneyInvestigation['participants'],
  groups: SmartMoneyInvestigation['groups'],
  from: Date,
  asOf: Date,
): InvestigationForensicsData {
  let accumulatingGroups = 0;
  let distributingGroups = 0;
  let rotatingGroups = 0;
  let unpricedGroups = 0;
  let accNet = new D(0);
  let distNet = new D(0);
  let hasAccNet = false;
  let hasDistNet = false;

  const groupVolumes: Decimal[] = [];
  for (const g of groups) {
    const posture = g.posture ?? classifyGroupPosture(g.totals);
    if (posture === 'ACCUMULATING') {
      accumulatingGroups++;
      if (g.totals.netSolSpent !== null) { accNet = accNet.plus(g.totals.netSolSpent); hasAccNet = true; }
    } else if (posture === 'DISTRIBUTING') {
      distributingGroups++;
      if (g.totals.netSolSpent !== null) { distNet = distNet.plus(g.totals.netSolSpent); hasDistNet = true; }
    } else if (posture === 'ROTATING') {
      rotatingGroups++;
    } else {
      unpricedGroups++;
    }

    if (g.totals.buySol !== null && g.totals.sellSol !== null) {
      const gross = new D(g.totals.buySol).plus(g.totals.sellSol);
      if (gross.gt(0)) groupVolumes.push(gross);
    }
  }

  groupVolumes.sort((a, b) => b.cmp(a));
  const totalGross = groupVolumes.reduce((s, v) => s.plus(v), new D(0));
  let top1GroupSharePct: number | null = null;
  let top3GroupSharePct: number | null = null;
  let groupHhi: number | null = null;
  if (totalGross.gt(0)) {
    top1GroupSharePct = Math.round(groupVolumes[0]!.div(totalGross).toNumber() * 10_000) / 100;
    const top3 = groupVolumes.slice(0, 3).reduce((s, v) => s.plus(v), new D(0));
    top3GroupSharePct = Math.round(top3.div(totalGross).toNumber() * 10_000) / 100;
    let hhi = 0;
    for (const v of groupVolumes) {
      const share = v.div(totalGross).toNumber();
      hhi += share * share * 10_000;
    }
    groupHhi = Math.min(10_000, Math.max(0, Math.round(hhi)));
  }

  const participantById = new Map(participants.map((p) => [p.id, p]));
  let totalBuySol = new D(0);
  let qualifiedBuySol = new D(0);
  const seenSig = new Set<string>();
  const uniqueTrades: RawTrade[] = [];
  for (const t of [...trades].sort((a, b) => +a.at - +b.at || a.id.localeCompare(b.id))) {
    if (!Number.isFinite(+t.at) || seenSig.has(t.signature)) continue;
    seenSig.add(t.signature);
    uniqueTrades.push(t);
    if (t.side === 'BUY' && validSol(t.amountSol) && t.amountSol.gt(0)) {
      totalBuySol = totalBuySol.plus(t.amountSol);
      if (participantById.get(t.walletId)?.currentQualification.eligible) {
        qualifiedBuySol = qualifiedBuySol.plus(t.amountSol);
      }
    }
  }
  const qualifiedBuySharePct = totalBuySol.gt(0)
    ? Math.round(qualifiedBuySol.div(totalBuySol).toNumber() * 10_000) / 100
    : null;
  const automatedParticipantCount = participants.filter((p) => p.automated === true).length;

  // 12 chronological buckets over [from, asOf]
  const startMs = +from;
  const endMs = Math.max(startMs + FORENSICS_BUCKET_COUNT, +asOf);
  const bucketMs = (endMs - startMs) / FORENSICS_BUCKET_COUNT;
  const buckets = Array.from({ length: FORENSICS_BUCKET_COUNT }, (_, i) => ({
    startAt: new Date(Math.round(startMs + i * bucketMs)).toISOString(),
    endAt: new Date(i === FORENSICS_BUCKET_COUNT - 1 ? +asOf : Math.round(startMs + (i + 1) * bucketMs)).toISOString(),
    buy: new D(0),
    sell: new D(0),
    tradeCount: 0,
    groups: new Set<string>(),
  }));
  for (const t of uniqueTrades) {
    const rawIdx = Math.floor((+t.at - startMs) / bucketMs);
    const idx = Math.min(FORENSICS_BUCKET_COUNT - 1, Math.max(0, rawIdx));
    const b = buckets[idx]!;
    b.tradeCount++;
    const p = participantById.get(t.walletId);
    if (p) b.groups.add(p.groupId);
    if (validSol(t.amountSol)) {
      if (t.side === 'BUY') b.buy = b.buy.plus(t.amountSol);
      else b.sell = b.sell.plus(t.amountSol);
    }
  }
  const flowSeries = buckets.map((b) => ({
    startAt: b.startAt,
    endAt: b.endAt,
    buySol: b.buy.toFixed(),
    sellSol: b.sell.toFixed(),
    netSol: b.buy.minus(b.sell).toFixed(),
    tradeCount: b.tradeCount,
    activeGroups: b.groups.size,
  }));

  // Non-overlapping 5-minute multi-wallet co-entry bursts
  const validBuys = uniqueTrades.filter((t) => t.side === 'BUY' && validSol(t.amountSol) && t.amountSol.gt(0));
  const rawBursts: {
    startIdx: number;
    endIdx: number;
    startAt: Date;
    endAt: Date;
    participantIds: string[];
    independentGroupCount: number;
    totalBuySol: Decimal;
    sampleSignatures: string[];
  }[] = [];
  for (let i = 0; i < validBuys.length; i++) {
    const t0 = +validBuys[i]!.at;
    let j = i;
    while (j + 1 < validBuys.length && +validBuys[j + 1]!.at - t0 <= CO_ENTRY_BURST_WINDOW_MS) j++;
    const slice = validBuys.slice(i, j + 1);
    const walletSet = [...new Set(slice.map((s) => s.walletId))];
    if (walletSet.length < 2) continue;
    const groupSet = new Set(walletSet.map((wId) => participantById.get(wId)?.groupId ?? `wallet:${wId}`));
    const sumSol = slice.reduce((s, r) => s.plus(r.amountSol), new D(0));
    rawBursts.push({
      startIdx: i,
      endIdx: j,
      startAt: slice[0]!.at,
      endAt: slice.at(-1)!.at,
      participantIds: walletSet.slice(0, 10),
      independentGroupCount: groupSet.size,
      totalBuySol: sumSol,
      sampleSignatures: slice.slice(0, 5).map((s) => s.signature),
    });
  }
  rawBursts.sort(
    (a, b) =>
      b.independentGroupCount - a.independentGroupCount ||
      b.participantIds.length - a.participantIds.length ||
      b.totalBuySol.cmp(a.totalBuySol) ||
      +b.startAt - +a.startAt,
  );
  const chosenBursts: typeof rawBursts = [];
  for (const cand of rawBursts) {
    if (chosenBursts.length >= 6) break;
    const overlaps = chosenBursts.some((c) => cand.startIdx <= c.endIdx && cand.endIdx >= c.startIdx);
    if (!overlaps) chosenBursts.push(cand);
  }
  const coEntryBursts = chosenBursts.map((b) => ({
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    spanSeconds: Math.max(0, Math.round((+b.endAt - +b.startAt) / 1000)),
    participantCount: b.participantIds.length,
    independentGroupCount: b.independentGroupCount,
    totalBuySol: b.totalBuySol.toFixed(),
    participantIds: b.participantIds,
    sampleSignatures: b.sampleSignatures,
  }));

  // Round-trip / rapid-flip wallets (both BUY and SELL inside window)
  const byWallet = new Map<string, RawTrade[]>();
  for (const t of uniqueTrades) {
    if (!validSol(t.amountSol) || t.amountSol.lte(0)) continue;
    const list = byWallet.get(t.walletId) ?? [];
    list.push(t);
    byWallet.set(t.walletId, list);
  }
  const rapidFlips: {
    walletId: string;
    buySol: Decimal;
    sellSol: Decimal;
    netExtracted: Decimal;
    buyCount: number;
    sellCount: number;
    spanSeconds: number;
  }[] = [];
  for (const [walletId, wTrades] of byWallet) {
    let buy = new D(0);
    let sell = new D(0);
    let buyCount = 0;
    let sellCount = 0;
    for (const t of wTrades) {
      if (t.side === 'BUY') { buy = buy.plus(t.amountSol); buyCount++; }
      else { sell = sell.plus(t.amountSol); sellCount++; }
    }
    if (buyCount === 0 || sellCount === 0) continue;
    const spanSeconds = Math.max(0, Math.round((+wTrades.at(-1)!.at - +wTrades[0]!.at) / 1000));
    rapidFlips.push({ walletId, buySol: buy, sellSol: sell, netExtracted: sell.minus(buy), buyCount, sellCount, spanSeconds });
  }
  rapidFlips.sort((a, b) => b.sellSol.cmp(a.sellSol) || a.walletId.localeCompare(b.walletId));

  return {
    postures: {
      accumulatingGroups,
      distributingGroups,
      rotatingGroups,
      unpricedGroups,
      accumulatingNetSol: hasAccNet ? accNet.toFixed() : null,
      distributingNetSol: hasDistNet ? distNet.toFixed() : null,
    },
    concentration: {
      top1GroupSharePct,
      top3GroupSharePct,
      groupHhi,
      qualifiedBuySharePct,
      automatedParticipantCount,
    },
    flowSeries,
    coEntryBursts,
    rapidFlips: rapidFlips.slice(0, 8).map((f) => ({
      walletId: f.walletId,
      buySol: f.buySol.toFixed(),
      sellSol: f.sellSol.toFixed(),
      netExtractedSol: f.netExtracted.toFixed(),
      buyCount: f.buyCount,
      sellCount: f.sellCount,
      spanSeconds: f.spanSeconds,
    })),
  };
}
