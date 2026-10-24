import type { FastifyInstance } from 'fastify';
import { marketTokenImages } from './marketEvidence';
import { z } from 'zod';
import type { PrismaClient } from '@narra/database';
import {
  DEFAULT_ROUND_TRIP_COST_PCT, GATES, calibrateByBucket, calibrateBySignal, dedupeEvents, describeReturns, insufficiencyNote, quantile, type Item,
} from '@narra/analytics';
import { AgentDecisionSchema } from '@narra/shared';
import { makeAuthenticate, type AccountDeps } from './account';
import { makeRequireAdmin } from './admin';
import { IdCursor, Limit, decodeCursor, encodeCursor } from './paging';

const DAY = 86_400_000;
/** Most outcomes one request will read. A bigger range is cut and says so (`truncated`). Starting value. */
const MAX_OUTCOME_ROWS = 5000;
const MAX_TRADE_ROWS = 10_000;
const MAX_EQUITY_POINTS = 500;

const Range = z.object({ days: z.coerce.number().int().min(1).max(365).default(30), costPct: z.coerce.number().min(0).max(20).default(DEFAULT_ROUND_TRIP_COST_PCT) });
const SummaryQuery = Range.extend({ action: z.enum(['BUY', 'WATCH', 'AVOID', 'SELL', 'REDUCE', 'HOLD']).default('BUY') });
const OutcomesQuery = z.object({ limit: Limit, cursor: z.string().max(300).optional(), final: z.enum(['true', 'false']).optional() });
const CursorShape = z.tuple([z.string().datetime(), IdCursor]);
const IdParam = z.object({ id: IdCursor });

const num = (d: { toString(): string } | null | undefined) => (d == null ? null : Number(d.toString()));
const iso = (d: Date) => d.toISOString();

export const ANALYTICS_CAVEATS = [
  'Outcomes are price moves from stored readings. They are not fills: real trades cost more (fees, price impact) and can fail.',
  `A number is only called reliable with at least ${GATES.minSample} independent events across ${GATES.minDistinctTokens} tokens. Below that it is shown and marked insufficient.`,
  'Tokens that rug often stop being tracked, so missing 24h prices are not random. The unknown rate is shown beside every result.',
  'Everything comes from the period the system has been running, usually a single market regime.',
] as const;

/**
 * Read-only views of what B6 measures: how decisions turned out, how reasons and confidence line up with outcomes,
 * the signed-in user's own results, and saved backtests. Nothing here writes, and nothing here changes a limit or a threshold.
 * Token symbols are untrusted text: clients must render them as plain text.
 */
export function registerAnalyticsRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier' | 'now'>): void {
  const db: PrismaClient = deps.db;
  const now = deps.now ?? (() => new Date());
  const rl = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const user = { preHandler: makeAuthenticate(deps), ...rl };
  const admin = { preHandler: makeRequireAdmin(deps), ...rl };
  const bad = { error: 'INVALID_INPUT' } as const;

  /** Final, known 24h outcomes of global decisions in range, one per token per 24h, newest first. */
  async function loadOutcomes(days: number, action: string) {
    const to = now(), from = new Date(to.getTime() - days * DAY);
    const rows = await db.decisionOutcome.findMany({
      where: { decision: { userId: null, action: action as 'BUY', createdAt: { gte: from, lte: to } } },
      orderBy: [{ decision: { createdAt: 'desc' } }, { id: 'desc' }], take: MAX_OUTCOME_ROWS,
      include: { decision: { select: { createdAt: true, confidence: true, payload: true, analysis: { select: { opportunity: { select: { tokenId: true } } } } } } },
    });
    const events = rows.map((r) => ({ tokenId: r.decision.analysis.opportunity.tokenId, at: r.decision.createdAt, r }));
    return { from, to, truncated: rows.length === MAX_OUTCOME_ROWS, raw: rows.length, events: dedupeEvents(events) };
  }

  app.get('/v1/analytics/decisions/summary', user, async (req, reply) => {
    const q = SummaryQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const { from, to, truncated, raw, events } = await loadOutcomes(q.data.days, q.data.action);
    const final = events.filter((e) => e.r.isFinal), known = final.filter((e) => e.r.returnPct24h != null && e.r.label !== 'UNKNOWN');
    const unknown = final.length - known.length;
    const items = known.map((e): Item => ({ tokenId: e.tokenId, ret: (e.r.returnPct24h as number) - q.data.costPct }));
    const labels = { WIN: 0, LOSS: 0, FLAT: 0 };
    for (const e of known) labels[e.r.label as keyof typeof labels]++;
    const leads = known.map((e) => e.r.leadTimeSeconds).filter((x): x is number => x != null).sort((a, b) => a - b);
    const withConf = known.map((e): Item & { key: number } => ({ tokenId: e.tokenId, ret: (e.r.returnPct24h as number) - q.data.costPct, key: e.r.decision.confidence }));
    const described = describeReturns(items);
    return {
      range: { from: iso(from), to: iso(to), days: q.data.days }, action: q.data.action, costPct: q.data.costPct,
      decisions: { read: raw, independent: events.length, pending: events.length - final.length, final: final.length, unknown, unknownRate: final.length ? unknown / final.length : null, truncated },
      labels, returns: described, medianLeadTimeSeconds: quantile(leads, 0.5),
      byConfidence: calibrateByBucket(withConf, [0.6, 0.7, 0.8, 0.9, 1]),
      evidence: { sufficient: described.sufficient, note: described.note },
      caveats: ANALYTICS_CAVEATS,
    };
  });

  app.get('/v1/analytics/signals', user, async (req, reply) => {
    const q = Range.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const { events, truncated } = await loadOutcomes(q.data.days, 'BUY');
    const known = events.filter((e) => e.r.isFinal && e.r.returnPct24h != null && e.r.label !== 'UNKNOWN');
    const items = known.map((e) => {
      const p = AgentDecisionSchema.safeParse(e.r.decision.payload);
      return { tokenId: e.tokenId, ret: (e.r.returnPct24h as number) - q.data.costPct, codes: p.success ? p.data.reasonCodes : [] };
    });
    return { costPct: q.data.costPct, truncated, byReasonCode: calibrateBySignal(items), caveats: ANALYTICS_CAVEATS };
  });

  app.get('/v1/analytics/decisions/outcomes', user, async (req, reply) => {
    const q = OutcomesQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    let cur: z.infer<typeof CursorShape> | null = null;
    if (q.data.cursor) { cur = decodeCursor(q.data.cursor, CursorShape); if (!cur) return reply.code(400).send(bad); }
    const rows = await db.decisionOutcome.findMany({
      where: {
        decision: { userId: null, ...(cur ? { OR: [{ createdAt: { lt: new Date(cur[0]) } }, { createdAt: new Date(cur[0]), id: { lt: cur[1] } }] } : {}) },
        ...(q.data.final ? { isFinal: q.data.final === 'true' } : {}),
      },
      orderBy: [{ decision: { createdAt: 'desc' } }, { decisionId: 'desc' }], take: q.data.limit + 1,
      include: { decision: { select: { id: true, action: true, confidence: true, createdAt: true, analysis: { select: { opportunity: { select: { token: { select: { id: true, mint: true, symbol: true, name:true } } } } } } } } },
    });
    const page = rows.slice(0, q.data.limit), last = page[page.length - 1];
    const images=await marketTokenImages(db,page.map(r=>r.decision.analysis.opportunity.token));
    return {
      items: page.map((r) => ({
        decisionId: r.decisionId, action: r.decision.action, confidence: r.decision.confidence, decidedAt: r.decision.createdAt,
        token: { mint: r.decision.analysis.opportunity.token.mint, symbol: r.decision.analysis.opportunity.token.symbol, name:r.decision.analysis.opportunity.token.name, imageUrl:images.get(r.decision.analysis.opportunity.token.id)??null }, // symbol is untrusted text
        label: r.label, return1hPct: r.returnPct1h, return24hPct: r.returnPct24h, maxGainPct: r.maxGainPct, maxDrawdownPct: r.maxDrawdownPct,
        leadTimeSeconds: r.leadTimeSeconds, isFinal: r.isFinal, unknownReason: r.unknownReason, measuredAt: r.measuredAt,
      })),
      nextCursor: rows.length > q.data.limit && last ? encodeCursor([last.decision.createdAt.toISOString(), last.decisionId]) : null,
    };
  });

  /** The signed-in user's own results. Paper and real are never mixed in one number. */
  app.get('/v1/analytics/me/performance', user, async (req, reply) => {
    const q = Range.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const userId = req.userId!, to = now(), from = new Date(to.getTime() - q.data.days * DAY);
    const trades = await db.trade.findMany({ where: { userId, executedAt: { gte: from, lte: to } }, orderBy: [{ executedAt: 'desc' }, { id: 'desc' }], take: MAX_TRADE_ROWS, select: { positionId: true, side: true, realizedPnlSol: true, feeSol: true, executedAt: true, simulated: true, position: { select: { status: true, tokenId: true } } } });
    const section = (simulated: boolean) => {
      const rows = trades.filter((t) => t.simulated === simulated);
      const byDay = new Map<string, number>(), byPosition = new Map<string, { pnl: number; closed: boolean; tokenId: string }>();
      let realized = 0, fees = 0;
      for (const t of rows) {
        const pnl = num(t.realizedPnlSol) ?? 0;
        realized += pnl; fees += num(t.feeSol) ?? 0;
        const day = t.executedAt.toISOString().slice(0, 10);
        byDay.set(day, (byDay.get(day) ?? 0) + pnl);
        if (t.positionId && t.position) { const p = byPosition.get(t.positionId) ?? { pnl: 0, closed: t.position.status === 'CLOSED', tokenId: t.position.tokenId }; p.pnl += pnl; byPosition.set(t.positionId, p); }
      }
      const closed = [...byPosition.values()].filter((p) => p.closed);
      const described = describeReturns(closed.map((p) => ({ tokenId: p.tokenId, ret: p.pnl })), 0);
      return {
        trades: rows.length, realizedPnlSol: realized, feesSol: fees,
        daily: [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, pnlSol]) => ({ day, pnlSol })),
        closedPositions: { count: closed.length, wins: closed.filter((p) => p.pnl > 0).length, winRate: described.winRate, winRateCi: described.winRateCi, meanPnlSol: described.mean, sufficient: described.sufficient, note: described.note },
      };
    };
    return { range: { from: iso(from), to: iso(to), days: q.data.days }, truncated: trades.length === MAX_TRADE_ROWS, paper: section(true), real: section(false), caveats: ['Realized profit and loss includes fees. A buy books its fee as a loss, so a position that has not been sold shows a small negative number.', ...ANALYTICS_CAVEATS] };
  });

  app.get('/v1/analytics/me/equity', user, async (req, reply) => {
    const q = Range.extend({ simulated: z.enum(['true', 'false']).default('true') }).safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const userId = req.userId!, to = now(), from = new Date(to.getTime() - q.data.days * DAY), simulated = q.data.simulated === 'true';
    const rows = await db.portfolioSnapshot.findMany({ where: { userId, simulated, at: { gte: from, lte: to } }, orderBy: [{ at: 'asc' }, { id: 'asc' }], take: 20_000 });
    const step = Math.max(1, Math.ceil(rows.length / MAX_EQUITY_POINTS));
    const points = rows.filter((_, i) => i % step === 0 || i === rows.length - 1).map((r) => ({ at: iso(r.at), valueSol: num(r.totalValueSol) as number }));
    const values = rows.map((r) => num(r.totalValueSol) as number), peak = values.length ? Math.max(...values) : null, latest = values.length ? values[values.length - 1]! : null;
    return { simulated, range: { from: iso(from), to: iso(to), days: q.data.days }, points, peakSol: peak, latestSol: latest, drawdownPct: peak && latest != null && peak > 0 ? ((peak - latest) / peak) * 100 : null, downsampled: step > 1 };
  });

  /** The headline of the newest saved backtest, for any signed-in user. The full report is admin-only. */
  app.get('/v1/analytics/backtest-summary', user, async () => {
    const r = await db.backtestRun.findFirst({ where: { kind: 'FULL' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (!r) return { available: false as const };
    const rep = r.report as { generatedAt?: string; coverage?: unknown; findings?: unknown; noConclusion?: unknown };
    const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 400)) : []);
    return { available: true as const, id: r.id, createdAt: r.createdAt, generatedAt: rep.generatedAt ?? null, coverage: rep.coverage ?? null, findings: strs(rep.findings), noConclusion: strs(rep.noConclusion), caveats: ANALYTICS_CAVEATS };
  });

  app.get('/v1/analytics/backtests', admin, async (req, reply) => {
    const q = z.object({ limit: Limit }).safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const rows = await db.backtestRun.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.data.limit });
    return { items: rows.map((r) => { const rep = r.report as { findings?: unknown[]; noConclusion?: unknown[]; coverage?: unknown }; return { id: r.id, kind: r.kind, createdAt: r.createdAt, params: r.params, coverage: rep.coverage ?? null, findings: rep.findings?.length ?? 0, noConclusion: rep.noConclusion?.length ?? 0 }; }) };
  });

  app.get('/v1/analytics/backtests/:id', admin, async (req, reply) => {
    const p = IdParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send(bad);
    const r = await db.backtestRun.findUnique({ where: { id: p.data.id } });
    if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
    const rep = JSON.parse(JSON.stringify(r.report)) as { strategies?: Record<string, unknown>[] };
    // The per-event arrays are working data for the comparison, and can be large. The summaries stay.
    for (const s of rep.strategies ?? []) { delete s.holdItems; delete s.ruleItems; }
    return { id: r.id, kind: r.kind, createdAt: r.createdAt, params: r.params, report: rep, gates: { minSample: GATES.minSample, minDistinctTokens: GATES.minDistinctTokens }, note: insufficiencyNote(0, 0) ? 'See each group for its own evidence note.' : null };
  });
}
