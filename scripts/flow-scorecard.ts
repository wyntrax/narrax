import { createPrisma } from '@narra/database';
import { summarizeWalletResearch } from '@narra/analytics';
import { FLOW_SUITABILITY_LIMITS, parseFlowSuitability } from '@narra/shared';

/**
 * Read-only flow research scorecard.
 *
 * Prints aggregate forward returns by side, entity count, net-flow, liquidity and holder
 * buckets, the latest publication-health snapshot, recent signals, and a ranked list of
 * flow-suitable tracked wallets. It never approves a wallet, changes a threshold or writes data.
 */
const db = createPrisma();
const obj = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

async function main() {
  const now = new Date();
  const signalSelect = {
    id: true, tokenId: true, side: true, createdAt: true, walletCount: true, independentEntities: true, netFlowSol: true,
    evidence: true, token: { select: { mint: true, symbol: true } },
    measurements: { select: { horizonHours: true, status: true, returnPct: true } },
  } as const;
  const signals = await db.walletResearchSignal.findMany({
    where: { createdAt: { lte: now }, token: { blacklisted: false } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 10_001, select: signalSelect,
  });
  const recentSignals = await db.walletResearchSignal.findMany({
    where: { createdAt: { lte: now }, token: { blacklisted: false } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: signalSelect,
  });
  const rows = signals.slice(0, 10_000);
  type Signal = typeof rows[number];
  const outcome = (s: Signal) => ({
    id: s.id, tokenId: s.tokenId, side: s.side, createdAt: s.createdAt,
    measurements: s.measurements.map(m => ({ horizonHours: m.horizonHours, status: m.status, returnPct: m.returnPct == null ? null : Number(m.returnPct) })),
  });
  const by = (key: (s: Signal) => string) => {
    const groups = new Map<string, Signal[]>();
    for (const s of rows) {
      const bucket = key(s);
      const group = groups.get(bucket);
      if (group) group.push(s); else groups.set(bucket, [s]);
    }
    return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([bucket, group]) => [bucket, summarizeWalletResearch(group.map(outcome))]));
  };
  const market = (s: Signal) => obj(obj(s.evidence).market);
  const holder = (s: Signal) => obj(obj(s.evidence).holder);
  const liquidity = (s: Signal) => {
    const value = market(s).liquidityUsd;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const holders = (s: Signal) => {
    const value = holder(s).holders;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const breakdowns = {
    bySide: by(s => s.side),
    byEntities: by(s => s.independentEntities >= 3 ? '3+' : String(s.independentEntities)),
    byNetSol: by(s => {
      const n = Number(s.netFlowSol);
      return n < 1 ? '<1' : n < 5 ? '1-5' : '5+';
    }),
    byLiquidity: by(s => {
      const n = liquidity(s);
      return n == null ? 'unknown' : n < 50_000 ? '<50k' : n < 100_000 ? '50k-100k' : '100k+';
    }),
    byHolders: by(s => {
      const n = holders(s);
      return n == null ? 'unknown' : n < 100 ? '<100' : n < 500 ? '100-500' : '500+';
    }),
  };

  const wallets = await db.trackedWallet.findMany({
    where: { active: true, researchReview: { not: 'REJECTED' } }, orderBy: { id: 'asc' }, take: 500,
    select: { id: true, address: true, label: true, researchReview: true, profile: { select: { score: true, style: true } } },
  });
  const settings = wallets.length ? await db.systemSetting.findMany({
    where: { key: { in: wallets.flatMap(w => [`wallet.performance.${w.id}`, `wallet.history.${w.id}`]) } },
  }) : [];
  const values = new Map(settings.map(s => [s.key, s.value]));
  const candidates = wallets.map(w => {
    const flow = parseFlowSuitability(values.get(`wallet.performance.${w.id}`), values.get(`wallet.history.${w.id}`), now);
    return {
      address: w.address, label: w.label, review: w.researchReview, score: w.profile?.score ?? null, style: w.profile?.style ?? null,
      suitable: flow.suitable, reasons: flow.reasons, metrics: flow.metrics,
    };
  });
  const suitable = candidates.filter(c => c.suitable).sort((a, b) =>
    (b.metrics?.medianHoldSeconds ?? 0) - (a.metrics?.medianHoldSeconds ?? 0) ||
    Number(b.metrics?.medianClosedPositionSol ?? '0') - Number(a.metrics?.medianClosedPositionSol ?? '0') ||
    (b.score ?? -1) - (a.score ?? -1) ||
    a.address.localeCompare(b.address),
  );
  const health = await db.systemSetting.findUnique({ where: { key: 'wallet.research.flowHealth' } });

  console.log(JSON.stringify({
    asOf: now.toISOString(),
    note: 'Read-only. Returns are gross token-price changes from the frozen flow observation, not wallet PnL. Missing and pending horizons stay in the denominator. Flow suitability is behavioural evidence, not approval or profitability.',
    criteria: FLOW_SUITABILITY_LIMITS,
    flowHealth: health?.value ?? null,
    signals: {
      read: rows.length, truncated: signals.length > 10_000,
      window: { from: rows[0]?.createdAt.toISOString() ?? null, to: rows.at(-1)?.createdAt.toISOString() ?? null },
      cohorts: summarizeWalletResearch(rows.map(outcome)),
      breakdowns,
      recent: recentSignals.map(s => ({
        at: s.createdAt.toISOString(), side: s.side, token: s.token, wallets: s.walletCount, entities: s.independentEntities,
        netSol: Number(s.netFlowSol), liquidityUsd: liquidity(s), holders: holders(s),
        measurements: s.measurements.map(m => ({ hours: m.horizonHours, status: m.status, returnPct: m.returnPct == null ? null : Number(m.returnPct) })),
      })),
    },
    wallets: {
      read: wallets.length, suitable: suitable.length, blocked: candidates.length - suitable.length,
      items: suitable.slice(0, 50),
    },
  }, null, 2));
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => db.$disconnect());
