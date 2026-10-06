import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '@narra/database';
import { makeAuthenticate, type AccountDeps } from './account';
import { IdCursor, Limit, decodeCursor, encodeCursor, likeEscape } from './paging';
import { ScreenerQuery, isScreenerRequest, runScreener } from './screener';

const n = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const Paging = z.object({ limit: Limit, cursor: IdCursor.optional() });
const OppCursor = z.tuple([z.number().finite(), z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)]);

/** Read-only endpoints that feed the UI. Market data is shared; positions and trades are scoped to the signed-in user. */
export function registerReadRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier'>): void {
  const db: PrismaClient = deps.db;
  const opts = { preHandler: makeAuthenticate(deps), config: { rateLimit: { max: 120, timeWindow: '1 minute' } } };
  const bad = { error: 'INVALID_INPUT' } as const;

  app.get('/v1/narratives', opts, async (req, reply) => {
    const q = z.object({ limit: Limit, cursor: IdCursor.optional(), stage: z.enum(['SEED', 'EMERGING', 'ACCELERATING', 'MAINSTREAM', 'SATURATED', 'DECAYING', 'DEAD']).optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    if (q.data.cursor && !(await db.narrative.count({ where: { id: q.data.cursor } }))) return reply.code(400).send(bad);
    const rows = await db.narrative.findMany({
      where: q.data.stage ? { stage: q.data.stage } : {}, orderBy: [{ score: 'desc' }, { id: 'asc' }], take: q.data.limit + 1,
      ...(q.data.cursor ? { cursor: { id: q.data.cursor }, skip: 1 } : {}),
      include: { _count: { select: { tokens: true } } },
    });
    const page = rows.slice(0, q.data.limit);
    return {
      items: page.map(({ _count, summary: _s, ...r }) => ({ ...r, tokenCount: _count.tokens })),
      nextCursor: rows.length > q.data.limit ? page[page.length - 1]!.id : null,
    };
  });

  app.get('/v1/narratives/:slug', opts, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const r = await db.narrative.findUnique({
      where: { slug },
      include: {
        metrics: { orderBy: { at: 'desc' }, take: 1 },
        creators: { include: { creator: { select: { platform: true, handle: true } } } },
        tokens: { orderBy: { ogScore: 'desc' }, take: 20, include: { token: { select: { mint: true, symbol: true, name: true, metrics: { orderBy: { at: 'desc' }, take: 1 } } } } },
      },
    });
    if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
    const { metrics, creators, tokens, ...narrative } = r;
    return {
      ...narrative, latestMetric: metrics[0] ?? null,
      creators: creators.map((c) => ({ platform: c.creator.platform, handle: c.creator.handle, role: c.role })),
      tokens: tokens.map((t) => {
        const m = t.token.metrics[0];
        return { mint: t.token.mint, symbol: t.token.symbol, name: t.token.name, relation: t.relation, ogScore: t.ogScore, confidence: t.confidence, marketCapUsd: n(m?.marketCapUsd), liquidityUsd: n(m?.liquidityUsd) };
      }),
    };
  });

  app.get('/v1/opportunities', opts, async (req, reply) => {
    const q = z.object({ limit: Limit, cursor: z.string().max(300).optional() }).safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const after = q.data.cursor ? decodeCursor(q.data.cursor, OppCursor) : null;
    if (q.data.cursor && !after) return reply.code(400).send(bad);
    const me = req.userId!;
    // Newest 500, then the latest per token, then best score first (ties by id). Pages are cut from that list, so the list is
    // limited to the newest 500 opportunities however far a client pages.
    const rows = await db.opportunity.findMany({
      orderBy: { createdAt: 'desc' }, take: 500,
      include: {
        token: { select: { mint: true, symbol: true, name: true, metrics: { orderBy: { at: 'desc' }, take: 1 } } },
        narrative: { select: { name: true, slug: true, stage: true } },
        analyses: { orderBy: { createdAt: 'desc' }, take: 1, include: { decisions: { where: { OR: [{ userId: null }, { userId: me }] }, orderBy: { createdAt: 'desc' }, take: 1 } } },
      },
    });
    const seen = new Set<string>();
    const latest = rows.filter((r) => (seen.has(r.tokenId) ? false : (seen.add(r.tokenId), true)));
    latest.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const rest = after ? latest.filter((o) => o.score < after[0] || (o.score === after[0] && o.id > after[1])) : latest;
    const page = rest.slice(0, q.data.limit);
    const lastRow = page[page.length - 1];
    return {
      nextCursor: rest.length > q.data.limit && lastRow ? encodeCursor([lastRow.score, lastRow.id]) : null,
      items: page.map((o) => {
        const m = o.token.metrics[0];
        const d = o.analyses[0]?.decisions[0];
        return {
          id: o.id, createdAt: o.createdAt, score: o.score,
          scores: { narrative: o.narrativeScore, smartMoney: o.smartMoneyScore, liquidity: o.liquidityScore, momentum: o.momentumScore, og: o.ogScore, risk: o.riskScore },
          attentionGrowth: o.attentionGrowth, priceGrowth: o.priceGrowth,
          token: { mint: o.token.mint, symbol: o.token.symbol, name: o.token.name, priceUsd: n(m?.priceUsd), marketCapUsd: n(m?.marketCapUsd), liquidityUsd: n(m?.liquidityUsd) },
          narrative: o.narrative, decision: d ? { action: d.action, confidence: d.confidence } : null,
        };
      }),
    };
  });

  // The explainable view: why the AI decided what it did, with the bull, bear and risk arguments and the rules that limited it.
  app.get('/v1/opportunities/:id/analysis', opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = req.userId!;
    const a = await db.agentAnalysis.findFirst({
      where: { opportunityId: id }, orderBy: { createdAt: 'desc' },
      include: { decisions: { where: { OR: [{ userId: null }, { userId: me }] }, orderBy: [{ userId: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 1 } },
    });
    const d = a?.decisions[0];
    if (!a || !d) return reply.code(404).send({ error: 'NOT_FOUND' });
    const p = d.payload as { decision: Record<string, unknown>; guardrails: string[]; judge: unknown };
    return {
      opportunityId: id, analyzedAt: a.createdAt, model: a.model,
      fast: a.fastClassification ? { classification: a.fastClassification, score: a.fastScore } : null,
      bull: a.bullCase, bear: a.bearCase, risk: a.riskCase, judge: p.judge ?? null,
      decision: p.decision, guardrails: p.guardrails,
    };
  });

  // The list, text search and the screener share one route. Without screener filters or a sort it is the simple alphabetical
  // list; with them it filters and sorts on each token's latest readings (see screener.ts).
  app.get('/v1/tokens', opts, async (req, reply) => {
    const q = ScreenerQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ ...bad, fields: [...new Set(q.error.issues.map((i) => i.path.join('.')))] });
    if (isScreenerRequest(q.data)) {
      const r = await runScreener(db, q.data, new Date());
      if (!r) return reply.code(400).send(bad);
      return {
        items: r.rows.map((t) => ({
          mint: t.mint, symbol: t.symbol, name: t.name, blacklisted: t.blacklisted, createdOnChainAt: t.createdOnChainAt,
          priceUsd: n(t.priceUsd as never), marketCapUsd: n(t.marketCapUsd as never), liquidityUsd: n(t.liquidityUsd as never), volume24hUsd: n(t.volume24hUsd as never),
          holders: t.holders, top10Pct: t.top10Pct, riskScore: t.riskScore, ogScore: t.ogScore,
        })),
        nextCursor: r.nextCursor,
      };
    }
    const term = q.data.q ? likeEscape(q.data.q) : undefined;
    const cursor = q.data.cursor;
    if (cursor && (!IdCursor.safeParse(cursor).success || !(await db.token.count({ where: { id: cursor } })))) return reply.code(400).send(bad);
    const rows = await db.token.findMany({
      where: term ? { OR: [{ symbol: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }, { mint: { startsWith: term } }] } : {},
      take: q.data.limit + 1, orderBy: [{ symbol: 'asc' }, { id: 'asc' }], ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { metrics: { orderBy: { at: 'desc' }, take: 1 } },
    });
    const page = rows.slice(0, q.data.limit);
    return {
      items: page.map((t) => ({ mint: t.mint, symbol: t.symbol, name: t.name, priceUsd: n(t.metrics[0]?.priceUsd), marketCapUsd: n(t.metrics[0]?.marketCapUsd), liquidityUsd: n(t.metrics[0]?.liquidityUsd) })),
      nextCursor: rows.length > q.data.limit ? page[page.length - 1]!.id : null,
    };
  });

  app.get('/v1/tokens/:mint', opts, async (req, reply) => {
    const { mint } = req.params as { mint: string };
    const t = await db.token.findUnique({
      where: { mint },
      include: {
        metrics: { orderBy: { at: 'desc' }, take: 1 }, holders: { orderBy: { at: 'desc' }, take: 1 }, risk: { orderBy: { at: 'desc' }, take: 1 },
        consensus: { orderBy: { at: 'desc' }, take: 1 }, narratives: { include: { narrative: { select: { name: true, slug: true, stage: true } } } },
      },
    });
    if (!t) return reply.code(404).send({ error: 'NOT_FOUND' });
    const m = t.metrics[0];
    const c = t.consensus[0];
    return {
      mint: t.mint, symbol: t.symbol, name: t.name, blacklisted: t.blacklisted, createdOnChainAt: t.createdOnChainAt,
      metrics: m ? { priceUsd: n(m.priceUsd), marketCapUsd: n(m.marketCapUsd), liquidityUsd: n(m.liquidityUsd), volume24hUsd: n(m.volume24hUsd), at: m.at } : null,
      holders: t.holders[0] ?? null, risk: t.risk[0] ?? null,
      consensus: c ? { score: c.score, walletCount: c.walletCount, independentEntities: c.independentEntities, leaderCount: c.leaderCount, netFlowSol: n(c.netFlowSol), timingConcentration: c.timingConcentration } : null,
      narratives: t.narratives.map((r) => ({ ...r.narrative, relation: r.relation, ogScore: r.ogScore })),
    };
  });

  app.get('/v1/smart-money/wallets', opts, async (req, reply) => {
    const q = Paging.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    if (q.data.cursor && !(await db.trackedWallet.count({ where: { id: q.data.cursor, active: true } }))) return reply.code(400).send(bad);
    const rows = await db.trackedWallet.findMany({
      where: { active: true, profile: { isNot: null } }, orderBy: [{ profile: { score: 'desc' } }, { id: 'asc' }], take: q.data.limit + 1,
      ...(q.data.cursor ? { cursor: { id: q.data.cursor }, skip: 1 } : {}),
      include: { profile: true, metrics: { where: { window: '30D' }, orderBy: { computedAt: 'desc' }, take: 1 }, cluster: { select: { id: true, confidence: true } } },
    });
    const page = rows.slice(0, q.data.limit);
    return {
      nextCursor: rows.length > q.data.limit ? page[page.length - 1]!.id : null,
      items: page.map((w) => ({
        address: w.address, label: w.label, score: w.profile!.score, leaderScore: w.profile!.leaderScore, style: w.profile!.style,
        medianHoldSeconds: w.profile!.medianHoldSeconds, bestPattern: w.profile!.bestPattern, weakPattern: w.profile!.weakPattern,
        winRate: w.metrics[0]?.winRate ?? null, pnl30dSol: n(w.metrics[0]?.pnlSol), closedTrades: w.metrics[0]?.closedTrades ?? null, avgRoi: w.metrics[0]?.avgRoi ?? null,
        // Cluster links are inferred, so confidence is always returned with them.
        cluster: w.cluster,
      })),
    };
  });

  app.get('/v1/positions', opts, async (req) => {
    const rows = await db.position.findMany({
      where: { userId: req.userId!, status: 'OPEN' }, orderBy: { openedAt: 'desc' },
      include: { token: { select: { mint: true, symbol: true, metrics: { orderBy: { at: 'desc' }, take: 1 } } }, evaluations: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return {
      items: rows.map((p) => {
        const ev = p.evaluations[0];
        const entry = n(p.entryPriceUsd)!;
        const current = n(p.token.metrics[0]?.priceUsd);
        return { id: p.id, mode: p.mode, openedAt: p.openedAt, sizeSol: n(p.sizeSol), entryPriceUsd: entry, currentPriceUsd: current,
          pnlPct: current != null && entry > 0 ? (current / entry - 1) * 100 : null, entryContext: p.entryContext, token: { mint: p.token.mint, symbol: p.token.symbol },
          // The monitor's latest reading. A recommendation from fixed rules, not an order. Null until the monitor has looked.
          evaluation: ev ? { action: ev.action, fractionPct: ev.fractionPct, signals: ev.signals, unavailable: ev.unavailable, blind: ev.blind, pnlPct: ev.pnlPct, at: ev.createdAt } : null };
      }),
    };
  });

  app.get('/v1/trades', opts, async (req, reply) => {
    const q = Paging.safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const rows = await db.trade.findMany({
      where: { userId: req.userId! }, orderBy: [{ executedAt: 'desc' }, { id: 'desc' }], take: q.data.limit + 1,
      ...(q.data.cursor ? { cursor: { id: q.data.cursor }, skip: 1 } : {}),
      include: { order: { select: { sizeSol: true, token: { select: { mint: true, symbol: true } } } } },
    });
    const page = rows.slice(0, q.data.limit);
    return {
      items: page.map((t) => ({ id: t.id, executedAt: t.executedAt, side: t.side, mode: t.mode, reason: t.reason, sizeSol: n(t.order.sizeSol), expectedPriceUsd: n(t.expectedPriceUsd), actualPriceUsd: n(t.actualPriceUsd), slippageBps: t.slippageBps, signature: t.signature, token: t.order.token })),
      nextCursor: rows.length > q.data.limit ? page[page.length - 1]!.id : null,
    };
  });
}
