import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@narra/database';
import { INVESTIGATION_LIMITS as L, InvestigationDiscovery, InvestigationParams, InvestigationQuery, InvestigationQualification, TOKEN_DISCOVERY_KEY_PREFIX, type SmartMoneyInvestigation } from '@narra/shared';
import { qualifyWallet } from '@narra/smart-money';
import { makeAuthenticate, type AccountDeps } from './account';
import { decimalAmount, investigationHistory, investigationTotals } from './smartMoneyInvestigationSummary';
import { INVESTIGATION_STRATEGY_RULES } from '@narra/shared';
import { investigationStrategies } from './investigationStrategies';
import { investigationPublications } from './investigationPublications';

const Cursor = z.object({ version: z.literal(1), mint: z.string(), window: z.enum(['24h', '7d']), asOf: z.string().datetime(), id: z.string().min(1).max(128) }).strict();
function decodeCursor(raw: string) {
  try { return Cursor.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))); } catch { return null; }
}

/** A displayed scan must be a well-formed, non-future record. A malformed row is omitted, never guessed. */
function discoveryStatus(value: unknown, now: Date) {
  const parsed = InvestigationDiscovery.safeParse(value);
  // Small future tolerance covers clock skew between the API and a worker container; the key is worker-written only.
  return parsed.success && (!parsed.data.checkedAt || Date.parse(parsed.data.checkedAt) <= +now + 5 * 60_000) ? parsed.data : undefined;
}

export function registerSmartMoneyInvestigationRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier' | 'now' | 'requestTokenDiscovery'>) {
  const clock = deps.now ?? (() => new Date());
  app.post('/v1/smart-money/investigations/:mint/discover', {
    preHandler: makeAuthenticate(deps), config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const params = InvestigationParams.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const token = await deps.db.token.findUnique({ where: { mint: params.data.mint }, select: { blacklisted: true } });
    if (!token || token.blacklisted) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (!deps.requestTokenDiscovery) return reply.code(503).send({ error: 'DISCOVERY_UNAVAILABLE' });
    await deps.requestTokenDiscovery(params.data.mint);
    return reply.code(202).send({ status: 'QUEUED' });
  });
  app.get('/v1/smart-money/investigations/:mint', {
    preHandler: makeAuthenticate(deps), config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const params = InvestigationParams.safeParse(req.params), query = InvestigationQuery.safeParse(req.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const q = query.data, mint = params.data.mint, now = clock(), asOf = q.asOf ? new Date(q.asOf) : now;
    if (+asOf < 0 || +asOf > +now) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const from = new Date(+asOf - (q.window === '7d' ? 7 : 1) * 86_400_000);
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && (!cursor || cursor.mint !== mint || cursor.window !== q.window || cursor.asOf !== asOf.toISOString())) return reply.code(400).send({ error: 'INVALID_INPUT' });

    // One response sees a consistent DB snapshot. Later pages are live re-queries,
    // including any backfills and current qualification/group changes.
    const result = await deps.db.$transaction(async tx => {
      const token = await tx.token.findUnique({ where: { mint }, select: { id: true, mint: true, symbol: true, name: true, blacklisted: true } });
      if (!token || token.blacklisted) return { kind: 'missing' as const };
      const rows = await tx.walletTrade.findMany({
        where: { tokenId: token.id, wallet: { active: true }, at: { gte: from, lte: asOf } },
        orderBy: [{ at: 'desc' }, { id: 'desc' }], take: L.trades + 1,
        select: { id: true, walletId: true, side: true, amountSol: true, tokenAmount: true, signature: true, at: true, evidence: true,
          wallet: { select: { id: true, address: true, active: true, researchReview: true, cluster: { select: { id: true, label: true, confidence: true, createdAt: true } } } } },
      });
      const truncated = rows.length > L.trades, trades = rows.slice(0, L.trades);
      const index = cursor ? trades.findIndex(t => t.id === cursor.id) : -1;
      if (cursor && index < 0) return { kind: 'cursor' as const };
      const [activeTrackedWallets, latestTrade] = await Promise.all([
        tx.trackedWallet.count({ where: { active: true } }),
        trades.length ? Promise.resolve({ at: trades[0]!.at }) : tx.walletTrade.findFirst({ where: { tokenId: token.id, wallet: { active: true }, at: { lte: asOf } }, orderBy: [{ at: 'desc' }, { id: 'desc' }], select: { at: true } }),
      ]);
      const wallets = [...new Map(trades.map(t => [t.walletId, t.wallet])).values()];
      const ids = wallets.map(w => w.id);
      const [settings, edges, publications, discoveryRow] = await Promise.all([
        tx.systemSetting.findMany({ where: { key: { in: ids.flatMap(id => [`wallet.research.${id}`, `wallet.history.${id}`]) } }, select: { key: true, value: true } }),
        tx.walletRelationship.findMany({ where: { fromId: { in: ids }, toId: { in: ids } }, orderBy: { id: 'asc' }, take: L.relationships + 1,
          select: { id: true, fromId: true, toId: true, kind: true, confidence: true, evidence: true } }),
        tx.walletResearchSignal.findMany({ where: { tokenId: token.id, createdAt: { gte: from, lte: asOf } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: INVESTIGATION_STRATEGY_RULES.maxPublications + 1, include: { measurements: { orderBy: { horizonHours: 'asc' } } } }),
        tx.systemSetting.findUnique({ where: { key: `${TOKEN_DISCOVERY_KEY_PREFIX}${token.id}` }, select: { value: true } }),
      ]);
      const byKey = new Map(settings.map(s => [s.key, s.value])), discovery = discoveryStatus(discoveryRow?.value, now);
      const participants = wallets.map(w => ({
        id: w.id, address: w.address, groupId: w.cluster ? `cluster:${w.cluster.id}` : `wallet:${w.id}`,
        currentQualification: InvestigationQualification.parse(qualifyWallet(w.researchReview, w.active, byKey.get(`wallet.research.${w.id}`), byKey.get(`wallet.history.${w.id}`), now)),
        history: investigationHistory(byKey.get(`wallet.history.${w.id}`), from, asOf, now),
        totals: investigationTotals(trades.filter(t => t.walletId === w.id)),
      }));
      const groups = [...new Set(participants.map(p => p.groupId))].map(id => {
        const members = participants.filter(p => p.groupId === id), memberIds = new Set(members.map(p => p.id));
        const cluster = wallets.find(w => memberIds.has(w.id))!.cluster;
        const basis = !cluster ? 'UNGROUPED' as const : cluster.label === 'funding' ? 'FUNDING' as const : cluster.label === 'timing' ? 'TIMING' as const : 'UNKNOWN' as const;
        return { id, basis, confidence: cluster?.confidence ?? null, clusterCreatedAt: cluster?.createdAt.toISOString() ?? null,
          participantIds: [...memberIds], totals: investigationTotals(trades.filter(t => memberIds.has(t.walletId))) };
      });
      const page = trades.slice(index + 1, index + 1 + q.limit), totals = investigationTotals(trades);
      const limitations = ['SUPPORTED_SWAPS_ONLY', 'ACTIVE_TRACKED_POPULATION_ONLY', 'TRANSFERS_AND_BALANCES_NOT_RECONCILED', 'CURRENT_CONTEXT_NOT_HISTORICAL', 'GROUPS_ARE_INFERRED_NOT_OWNERS', 'RELATIONSHIPS_BETWEEN_RETURNED_PARTICIPANTS_ONLY', 'AS_OF_IS_EVENT_BOUND_NOT_SNAPSHOT'];
      if (truncated) limitations.push('TRADE_QUERY_CAPPED');
      if (edges.length > L.relationships) limitations.push('RELATIONSHIP_QUERY_CAPPED');
      if (totals.unknownQuantityCount) limitations.push('TOKEN_QUANTITIES_INCOMPLETE');
      if (totals.unknownSolCount) limitations.push('SOL_AMOUNTS_INVALID');
      if (!participants.length || participants.some(p => p.history.status !== 'COVERED')) limitations.push('HISTORY_COVERAGE_NOT_ESTABLISHED');
      const body: SmartMoneyInvestigation = {
        methodologyVersion: 1, token: { mint: token.mint, symbol: token.symbol, name: token.name },
        window: q.window, from: from.toISOString(), asOf: asOf.toISOString(), readAt: now.toISOString(), contextMode: 'CURRENT', consistency: 'LIVE_REQUERY',
        coverage: { population: 'ACTIVE_TRACKED_WALLETS', activity: trades.length ? 'OBSERVED_TRADES' : 'NO_OBSERVED_TRADES',
          aggregationScope: truncated ? 'LATEST_CAPPED_SAMPLE' : 'RECORDED_WINDOW', tradeLimit: L.trades, tradesRead: trades.length, tradesTruncated: truncated,
          relationshipLimit: L.relationships, relationshipsTruncated: edges.length > L.relationships,
          participantCount: participants.length, groupCount: groups.length, currentlyQualifiedCount: participants.filter(p => p.currentQualification.eligible).length,
          historyCoveredCount: participants.filter(p => p.history.status === 'COVERED').length, limitations },
        totals, participants, groups, relationships: edges.slice(0, L.relationships),
        availability: { activeTrackedWallets, lastRecordedTradeAt: latestTrade?.at.toISOString() ?? null, hasTradesIn7d: !!latestTrade && +latestTrade.at >= +asOf - 7 * 86_400_000 },
        strategies: investigationStrategies(trades, participants, truncated),
        publications: investigationPublications(publications, now),
        ...(discovery ? { discovery } : {}),
        trades: page.map(t => ({ id: t.id, walletId: t.walletId, signature: t.signature, side: t.side, at: t.at.toISOString(),
          amountSol: decimalAmount(t.amountSol), tokenAmount: t.tokenAmount?.isZero() ? null : decimalAmount(t.tokenAmount), evidence: t.evidence })),
        nextCursor: index + 1 + page.length < trades.length ? Buffer.from(JSON.stringify({ version: 1, mint, window: q.window, asOf: asOf.toISOString(), id: page.at(-1)!.id })).toString('base64url') : null,
      };
      return { kind: 'ok' as const, body };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
    if (result.kind === 'missing') return reply.code(404).send({ error: 'NOT_FOUND' });
    if (result.kind === 'cursor') return reply.code(400).send({ error: 'INVALID_CURSOR', restartRequired: true });
    return result.body;
  });
}
