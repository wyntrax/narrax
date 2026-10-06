import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PrismaClient } from '@narra/database';
import { makeAuthenticate, type AccountDeps } from './account';
import { IdCursor, Limit, likeEscape } from './paging';

const n = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const AddressParam = z.object({ address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) });
const LAMPORTS = 1_000_000_000;
const DAY = 86_400_000;

/** Starting values, not tuned. */
const WALLET_DETAIL = { recentTrades: 20, narrativeLookbackDays: 90, narrativeTradeScan: 500, clusterMembers: 20, relationships: 20 } as const;

/** Tracked-wallet detail and global search. Both read shared market data. Search also looks at the caller's own trades by signature. */
export function registerIntelRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier' | 'now'>): void {
  const db: PrismaClient = deps.db;
  const now = deps.now ?? (() => new Date());
  const opts = { preHandler: makeAuthenticate(deps), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const bad = { error: 'INVALID_INPUT' } as const;

  app.get('/v1/wallets/:address', opts, async (req, reply) => {
    const p = AddressParam.safeParse(req.params);
    if (!p.success) return reply.code(400).send(bad);
    // Deactivated wallets are no longer tracked, so they are not shown (their history is kept in the database).
    const w = await db.trackedWallet.findFirst({
      where: { address: p.data.address, active: true },
      include: {
        profile: true, funding: true,
        cluster: { select: { id: true, label: true, confidence: true, _count: { select: { wallets: true } }, wallets: { where: { active: true }, take: WALLET_DETAIL.clusterMembers, orderBy: { id: 'asc' }, select: { address: true, label: true } } } },
        outgoing: { take: WALLET_DETAIL.relationships, include: { to: { select: { address: true, label: true, active: true } } } },
        incoming: { take: WALLET_DETAIL.relationships, include: { from: { select: { address: true, label: true, active: true } } } },
      },
    });
    if (!w) return reply.code(404).send({ error: 'NOT_FOUND' });

    const [metricRows, trades, scan] = await Promise.all([
      db.walletMetric.findMany({ where: { walletId: w.id }, orderBy: { computedAt: 'desc' }, take: 40 }),
      db.walletTrade.findMany({ where: { walletId: w.id }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: WALLET_DETAIL.recentTrades, include: { token: { select: { mint: true, symbol: true } } } }),
      db.walletTrade.findMany({ where: { walletId: w.id, at: { gte: new Date(now().getTime() - WALLET_DETAIL.narrativeLookbackDays * DAY) } }, orderBy: { at: 'desc' }, take: WALLET_DETAIL.narrativeTradeScan, select: { tokenId: true, side: true, amountSol: true, at: true } }),
    ]);

    // Newest reading per window.
    const performance: Record<string, unknown> = {};
    for (const m of metricRows) {
      if (performance[m.window]) continue;
      performance[m.window] = { winRate: m.winRate, pnlSol: n(m.pnlSol), closedTrades: m.closedTrades, avgRoi: m.avgRoi, medianRoi: m.medianRoi, maxDrawdown: m.maxDrawdown, computedAt: m.computedAt };
    }

    // Which narratives the wallet has traded into, by way of the tokens' narrative links. Only recent trades are scanned, and
    // the counts say so (scannedTrades, lookbackDays), because a busy wallet can exceed the scan cap.
    const tokenIds = [...new Set(scan.map((t) => t.tokenId))];
    const links = tokenIds.length ? await db.narrativeTokenRelation.findMany({ where: { tokenId: { in: tokenIds }, relation: { notIn: ['UNRELATED', 'SUSPICIOUS'] } }, select: { tokenId: true, narrative: { select: { slug: true, name: true, stage: true } } } }) : [];
    const byToken = new Map<string, { slug: string; name: string; stage: string }[]>();
    for (const l of links) byToken.set(l.tokenId, [...(byToken.get(l.tokenId) ?? []), l.narrative]);
    const hist = new Map<string, { slug: string; name: string; stage: string; buys: number; sells: number; netSol: number; lastAt: Date }>();
    for (const t of scan) {
      for (const nar of byToken.get(t.tokenId) ?? []) {
        const h = hist.get(nar.slug) ?? { ...nar, buys: 0, sells: 0, netSol: 0, lastAt: t.at };
        const sol = n(t.amountSol) ?? 0;
        if (t.side === 'BUY') { h.buys++; h.netSol -= sol; } else { h.sells++; h.netSol += sol; }
        if (t.at > h.lastAt) h.lastAt = t.at;
        hist.set(nar.slug, h);
      }
    }

    const f = w.funding;
    return {
      address: w.address, label: w.label, source: w.source, trackedSince: w.createdAt,
      profile: w.profile ? { score: w.profile.score, leaderScore: w.profile.leaderScore, style: w.profile.style, medianHoldSeconds: w.profile.medianHoldSeconds, strongestNarrative: w.profile.strongestNarrative, bestPattern: w.profile.bestPattern, weakPattern: w.profile.weakPattern, typicalEntryMarketCapUsd: { min: n(w.profile.typicalEntryMcMin), max: n(w.profile.typicalEntryMcMax) }, updatedAt: w.profile.updatedAt } : null,
      performance,
      // Cluster and relationship links are inferred from timing and funding, so confidence always comes with them.
      cluster: w.cluster ? { id: w.cluster.id, label: w.cluster.label, confidence: w.cluster.confidence, size: w.cluster._count.wallets, members: w.cluster.wallets.filter((m) => m.address !== w.address) } : null,
      relationships: [
        ...w.outgoing.filter((r) => r.to.active).map((r) => ({ direction: 'OUT' as const, kind: r.kind, confidence: r.confidence, wallet: { address: r.to.address, label: r.to.label } })),
        ...w.incoming.filter((r) => r.from.active).map((r) => ({ direction: 'IN' as const, kind: r.kind, confidence: r.confidence, wallet: { address: r.from.address, label: r.from.label } })),
      ],
      funding: f ? { status: f.status, funder: f.funder, fundedAt: f.fundedAt, amountSol: f.lamports != null ? Number(f.lamports) / LAMPORTS : null, checkedAt: f.checkedAt } : null,
      recentTrades: trades.map((t) => ({ id: t.id, at: t.at, side: t.side, amountSol: n(t.amountSol), marketCapUsd: n(t.marketCapUsd), signature: t.signature, token: t.token })),
      narrativeHistory: { lookbackDays: WALLET_DETAIL.narrativeLookbackDays, scannedTrades: scan.length, scanCapped: scan.length === WALLET_DETAIL.narrativeTradeScan, items: [...hist.values()].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime()).map((h) => ({ ...h, netSol: Math.round(h.netSol * 1e6) / 1e6 })) },
    };
  });

  app.get('/v1/wallets/:address/trades', opts, async (req, reply) => {
    const p = AddressParam.safeParse(req.params);
    const q = z.object({ limit: Limit, cursor: IdCursor.optional(), side: z.enum(['BUY', 'SELL']).optional() }).safeParse(req.query);
    if (!p.success || !q.success) return reply.code(400).send(bad);
    const w = await db.trackedWallet.findFirst({ where: { address: p.data.address, active: true }, select: { id: true } });
    if (!w) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (q.data.cursor && !(await db.walletTrade.count({ where: { id: q.data.cursor, walletId: w.id } }))) return reply.code(400).send(bad);
    const rows = await db.walletTrade.findMany({
      where: { walletId: w.id, ...(q.data.side ? { side: q.data.side } : {}) }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: q.data.limit + 1,
      ...(q.data.cursor ? { cursor: { id: q.data.cursor }, skip: 1 } : {}), include: { token: { select: { mint: true, symbol: true } } },
    });
    const page = rows.slice(0, q.data.limit);
    return { items: page.map((t) => ({ id: t.id, at: t.at, side: t.side, amountSol: n(t.amountSol), marketCapUsd: n(t.marketCapUsd), signature: t.signature, token: t.token })), nextCursor: rows.length > q.data.limit ? page[page.length - 1]!.id : null };
  });

  // Search across tokens, narratives, tracked wallets, creators and transaction signatures. A query is matched the way it looks:
  // a full address finds the exact token or wallet, a signature finds the exact transaction, anything else is a text match.
  // User text is escaped with likeEscape before it reaches contains or startsWith, so % and _ are plain characters.
  app.get('/v1/search', { ...opts, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = z.object({ q: z.string().min(2).max(100), limit: z.coerce.number().int().min(1).max(10).default(5) }).safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const term = q.data.q.trim().replace(/\s+/g, ' ');
    if (term.length < 2) return reply.code(400).send(bad);
    const like = likeEscape(term);
    const take = q.data.limit;
    const userId = req.userId!;
    const looksBase58 = BASE58.test(term);
    const isAddress = looksBase58 && term.length >= 32 && term.length <= 44;
    const isSignature = looksBase58 && term.length >= 80 && term.length <= 90;
    const addressPrefix = looksBase58 && term.length >= 4;

    const [tokens, narratives, wallets, creators, walletTx, myTx] = await Promise.all([
      db.token.findMany({
        where: { OR: [{ symbol: { contains: like, mode: 'insensitive' } }, { name: { contains: like, mode: 'insensitive' } }, ...(addressPrefix ? [{ mint: { startsWith: like } }] : [])] },
        take, orderBy: [{ symbol: 'asc' }, { id: 'asc' }], select: { mint: true, symbol: true, name: true, blacklisted: true },
      }),
      db.narrative.findMany({ where: { stage: { not: 'DEAD' }, OR: [{ name: { contains: like, mode: 'insensitive' } }, { slug: { contains: likeEscape(term.toLowerCase().replace(/\s+/g, '-')) } }] }, take, orderBy: [{ score: 'desc' }, { id: 'asc' }], select: { slug: true, name: true, stage: true, score: true } }),
      db.trackedWallet.findMany({ where: { active: true, OR: [{ label: { contains: like, mode: 'insensitive' } }, ...(addressPrefix ? [{ address: { startsWith: like } }] : [])] }, take, orderBy: [{ id: 'asc' }], select: { address: true, label: true, profile: { select: { score: true } } } }),
      db.creator.findMany({ where: { handle: { contains: likeEscape(term.replace(/^@/, '').toLowerCase()), mode: 'insensitive' } }, take, orderBy: [{ id: 'asc' }], select: { platform: true, handle: true } }),
      isSignature ? db.walletTrade.findMany({ where: { signature: term, wallet: { active: true } }, take: 1, select: { signature: true, side: true, at: true, token: { select: { mint: true, symbol: true } }, wallet: { select: { address: true } } } }) : Promise.resolve([]),
      isSignature ? db.trade.findMany({ where: { signature: term, userId }, take: 1, select: { signature: true, side: true, executedAt: true, simulated: true, order: { select: { token: { select: { mint: true, symbol: true } } } } } }) : Promise.resolve([]),
    ]);

    return {
      query: term,
      // An exact address is listed first, so pasting a mint or wallet lands on it.
      kind: isSignature ? 'SIGNATURE' : isAddress ? 'ADDRESS' : 'TEXT',
      results: {
        tokens: tokens.sort((a, b) => Number(b.mint === term) - Number(a.mint === term)),
        narratives,
        wallets: wallets.map((w) => ({ address: w.address, label: w.label, score: w.profile?.score ?? null })).sort((a, b) => Number(b.address === term) - Number(a.address === term)),
        creators,
        transactions: [
          ...walletTx.map((t) => ({ source: 'TRACKED_WALLET' as const, signature: t.signature, at: t.at, side: t.side, token: t.token, wallet: t.wallet.address })),
          ...myTx.map((t) => ({ source: 'MY_TRADE' as const, signature: t.signature, at: t.executedAt, side: t.side, simulated: t.simulated, token: t.order?.token ?? null })),
        ],
      },
    };
  });
}
