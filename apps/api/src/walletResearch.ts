import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { makeAuthenticate, type AccountDeps } from './account';
import { makeRequireAdmin } from './admin';
import { WALLET_FLOW_LIMITS, walletQualifications } from '@narra/worker-pipeline';
import { InvestigationDiscovery, TOKEN_DISCOVERY_KEY_PREFIX, sanitizeUntrusted } from '@narra/shared';
import { RESEARCH_QUALIFICATION } from '@narra/smart-money';
import { marketTokenImages } from './marketEvidence';
import { walletRanking } from './walletRanking';
import { WalletEntryBand } from '@narra/shared';

export function registerWalletResearchRoutes(app: FastifyInstance, deps: Pick<AccountDeps, 'db' | 'verifier' | 'now'>) {
  const { db } = deps, clock = deps.now ?? (() => new Date());
  const opts = { preHandler: makeAuthenticate(deps), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const admin = { ...opts, preHandler: makeRequireAdmin(deps) };
  const paging = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(128).optional(), side: z.enum(['BUY','SELL']).optional() });
  const flowQuery = paging.extend({ includeFiltered: z.enum(['true','false']).default('false') });
  const entryTop10 = (evidence: unknown): number | null => {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
    const holder = (evidence as { holder?: unknown }).holder;
    if (!holder || typeof holder !== 'object' || Array.isArray(holder)) return null;
    const top10Pct = (holder as { top10Pct?: unknown }).top10Pct;
    return typeof top10Pct === 'number' && Number.isFinite(top10Pct) ? top10Pct : null;
  };
  const isLowQualityFlow = (s: { evidence: unknown; token: { metrics: { liquidityUsd: { toString(): string } }[] }; measurements: { status: string; reason: string | null }[] }) => {
    const currentLiq = s.token.metrics[0]?.liquidityUsd;
    if (currentLiq !== undefined && Number(currentLiq.toString()) < WALLET_FLOW_LIMITS.minLiquidityUsd) return true;
    const top10 = entryTop10(s.evidence);
    if (top10 !== null && top10 > WALLET_FLOW_LIMITS.maxTop10Pct) return true;
    const settled = s.measurements.filter(m => m.status !== 'PENDING');
    return settled.length > 0 && settled.every(m => m.status === 'UNKNOWN' && m.reason === 'THIN_LIQUIDITY');
  };

  app.get('/v1/smart-money/rankings', opts, async (req, reply) => {
    const query = z.object({ band: WalletEntryBand.default('SMALL_CAP'), limit: z.coerce.number().int().min(1).max(100).default(50),
      status: z.enum(['ALL','REVIEW_READY','OBSERVING']).default('ALL'),
      minMedianPositionSol: z.coerce.number().finite().min(0).max(1000).default(0.01),
      flowOnly: z.enum(['true','false']).default('false'),
      excludeAutomated: z.enum(['true','false']).default('false'),
      sort: z.enum(['default','pnl','profitFactor','size']).default('default'),
    }).strict().safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    return walletRanking(db,clock(),query.data.band,query.data.limit,query.data.status,query.data.minMedianPositionSol,query.data.flowOnly==='true',query.data.excludeAutomated==='true',query.data.sort);
  });

  app.get('/v1/smart-money/flows', opts, async (req, reply) => {
    const q = flowQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const now = clock();
    if (q.data.cursor && !await db.walletResearchSignal.count({ where: { id: q.data.cursor, ...(q.data.side ? { side: q.data.side } : {}), token: { blacklisted: false }, createdAt: { lte: now } } })) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const includeFiltered = q.data.includeFiltered === 'true';
    const scanLimit = includeFiltered ? q.data.limit + 1 : Math.min(200, Math.max(q.data.limit * 4, 50));
    const rows = await db.walletResearchSignal.findMany({ where: { token: { blacklisted: false }, createdAt: { lte: now }, ...(q.data.side ? { side: q.data.side } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: scanLimit, ...(q.data.cursor ? { cursor: { id: q.data.cursor }, skip: 1 } : {}), include: { token: { select: { mint: true, symbol: true, name: true, metrics: { orderBy: { at: 'desc' }, take: 1, select: { liquidityUsd: true, at: true } } } }, measurements: { orderBy: { horizonHours: 'asc' } } } });
    const filteredCount = rows.filter(isLowQualityFlow).length;
    const eligible = includeFiltered ? rows : rows.filter(s => !isLowQualityFlow(s));
    const page = eligible.slice(0,q.data.limit);
    const images=await marketTokenImages(db,page.map(s=>({id:s.tokenId,mint:s.token.mint})));
    const flowAddresses = [...new Set(page.flatMap(s => {
      const trades = (s.evidence as { trades?: { wallet?: unknown }[] } | null)?.trades;
      return Array.isArray(trades) ? trades.map(t => typeof t.wallet === 'string' ? t.wallet : '').filter(Boolean) : [];
    }))];
    const [walletRows, measurementRows] = await Promise.all([
      flowAddresses.length && typeof db.trackedWallet?.findMany === 'function'
        ? db.trackedWallet.findMany({ where: { address: { in: flowAddresses } }, select: { address: true, label: true, profile: { select: { score: true, style: true } } } })
        : Promise.resolve([]),
      typeof db.walletResearchMeasurement?.findMany === 'function'
        ? db.walletResearchMeasurement.findMany({ orderBy: { dueAt: 'desc' }, take: 500, select: { horizonHours: true, status: true, returnPct: true } })
        : Promise.resolve([]),
    ]);
    const walletMeta: Record<string, { label: string | null; score: number | null; style: string | null }> = {};
    for (const w of walletRows) walletMeta[w.address] = { label: w.label, score: w.profile?.score ?? null, style: w.profile?.style ?? null };
    const byHorizon = new Map<number, { total: number; measured: number; unknown: number; pending: number; returns: number[] }>();
    for (const m of measurementRows) {
      const bucket = byHorizon.get(m.horizonHours) ?? { total: 0, measured: 0, unknown: 0, pending: 0, returns: [] };
      bucket.total++;
      if (m.status === 'MEASURED' && m.returnPct != null && Number.isFinite(m.returnPct)) { bucket.measured++; bucket.returns.push(m.returnPct); }
      else if (m.status === 'UNKNOWN') bucket.unknown++;
      else bucket.pending++;
      byHorizon.set(m.horizonHours, bucket);
    }
    const trackRecord = [...byHorizon.entries()].sort((a, b) => a[0] - b[0]).map(([horizonHours, b]) => {
      const sorted = [...b.returns].sort((x, y) => x - y);
      const mid = Math.floor(sorted.length / 2);
      const medianReturnPct = !sorted.length ? null : sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
      const hitRate = b.measured ? b.returns.filter(r => r > 0).length / b.measured : null;
      return { horizonHours, total: b.total, measured: b.measured, unknown: b.unknown, pending: b.pending, hitRate, medianReturnPct };
    });
    return { asOf: now, filteredCount, nextCursor: eligible.length > page.length ? page.at(-1)!.id : null, walletMeta, trackRecord, items: page.map(s => ({ id: s.id, token: { mint: s.token.mint, symbol: s.token.symbol, name: s.token.name, imageUrl: images.get(s.tokenId) ?? null }, side: s.side, createdAt: s.createdAt,
      stale: +now - +s.createdAt > 15 * 60_000, walletCount: s.walletCount, independentEntities: s.independentEntities, netFlowSol: Number(s.netFlowSol),
      entryPriceUsd: Number(s.entryPriceUsd), entryAt: s.entryAt, entryTop10Pct: entryTop10(s.evidence), evidence: s.evidence,
      currentLiquidityUsd: s.token.metrics[0]?.liquidityUsd?.toString() ?? null, currentMarketAt: s.token.metrics[0]?.at ?? null,
      measurements: s.measurements.map(m => ({ horizonHours: m.horizonHours, status: m.status, dueAt: m.dueAt, returnPct: m.returnPct, priceAt: m.priceAt, reason: m.reason })) })) };
  });

  app.get('/v1/smart-money/emerging', opts, async (req,reply) => {
    const q=paging.safeParse(req.query);
    if(!q.success)return reply.code(400).send({error:'INVALID_INPUT'});
    const row = await db.systemSetting.findUnique({ where: { key: 'wallet.discovery.emerging' } });
    const schema = z.object({ checkedAt: z.string().datetime(), total: z.number().int().nonnegative(), capped: z.boolean(), items: z.array(z.object({ address: z.string(), scannedTokens: z.number().int().positive() })).max(50) });
    const parsed = schema.safeParse(row?.value);
    const limit = Math.min(50,q.data.limit);
    return { snapshot: parsed.success ? { ...parsed.data, items: parsed.data.items.slice(0,limit), capped: parsed.data.total > limit, stale: Date.parse(parsed.data.checkedAt) > +clock() || +clock() - Date.parse(parsed.data.checkedAt) > 30 * 60_000 } : null };
  });

  app.get('/v1/admin/wallet-research/health', admin, async () => {
    const now = clock();
    const [settings, scans, active, discovered, approved] = await Promise.all([
      db.systemSetting.findMany({ where: { key: { in: ['wallet.discovery.health', 'wallet.research.flowHealth'] } } }),
      db.systemSetting.findMany({ where: { key: { startsWith: TOKEN_DISCOVERY_KEY_PREFIX } }, orderBy: [{ updatedAt: 'desc' }, { key: 'asc' }], take: 10, select: { key: true, value: true, updatedAt: true } }),
      db.trackedWallet.count({ where: { active: true } }), db.trackedWallet.count({ where: { source: 'DISCOVERED' } }), db.trackedWallet.count({ where: { researchReview: 'APPROVED' } }),
    ]);
    const byKey = new Map(settings.map(s => [s.key,s.value]));
    return { checkedAt: now, enabled: process.env.SMART_MONEY_RESEARCH_ENABLED === 'true', rules: RESEARCH_QUALIFICATION,
      wallets: { active, discovered, approved },
      discovery: byKey.get('wallet.discovery.health') ?? null, flow: byKey.get('wallet.research.flowHealth') ?? null,
      tokenScans: scans.flatMap(row => { const parsed = InvestigationDiscovery.safeParse(row.value); return parsed.success ? [{ tokenId: row.key.slice(TOKEN_DISCOVERY_KEY_PREFIX.length), updatedAt: row.updatedAt, ...parsed.data }] : []; }) };
  });

  app.post('/v1/admin/wallets/:address/research-review', admin, async (req, reply) => {
    const body = z.object({ status: z.enum(['APPROVED','REJECTED','PROVISIONAL']), reason: z.string().trim().min(1).max(300).transform(s => sanitizeUntrusted(s,300)).refine(s => s.trim().length > 0) }).strict().safeParse(req.body);
    const params = z.object({ address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/) }).safeParse(req.params);
    if (!body.success || !params.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet-review:${params.data.address}`}))`;
      const wallet = await tx.trackedWallet.findUnique({ where: { address: params.data.address } });
      if (!wallet) return null;
      const now = clock();
      // Approval records an operator review, never overrides computed eligibility.
      const updated = await tx.trackedWallet.update({ where: { id: wallet.id }, data: { researchReview: body.data.status, researchReviewedAt: now, researchReviewedBy: req.userId!, researchReviewReason: body.data.reason } });
      const qualification = (await walletQualifications(tx,[updated],now)).get(wallet.id)!;
      await tx.auditLog.create({ data: { userId: req.userId!, action: 'wallet.research_review', detail: { address: wallet.address, status: body.data.status, reason: body.data.reason, qualification } } });
      return { ok: true, review: body.data.status, qualification };
    });
    return result ?? reply.code(404).send({ error: 'NOT_FOUND' });
  });
}
