import type { PrismaClient } from '@narra/database';
import { DISCOVERY, rankCandidates, type TokenScan } from '@narra/smart-money';
import { earlyBuyer, WSOL_MINT, discoverySpendEvidence, type DiscoverySpendEvidence } from '@narra/solana';
import { oldestSignatures, type HistoryPort } from './walletFunding';
import { summarizeDiscoverySpend, type DiscoverySpendObservation } from './walletDiscoverySpend';

/** Starting values, not validated against outcomes. */
export const DISCOVERY_LIMITS = {
  maxTokensPerRun: 5,
  pageSize: 1000,
  /** Two pages: a token with more than about 2,000 transactions is no longer scanned, because its first buyers are out of reach. */
  maxPages: 2,
  maxTxsPerToken: 40,
  /** Only tokens created this recently are scanned, while their history is still short. */
  scanWindowMs: 6 * 3_600_000,
  /** A token is judged (winner or not) only after it has had this long. */
  minAgeMs: 3_600_000,
  lookbackMs: 48 * 3_600_000,
  /** Latest price at least this multiple of the first recorded price. */
  winnerGrowth: 3,
  minLiquidityUsd: 20_000,
  /** Latest price row must be this fresh, or the token is left undecided. */
  maxMetricAgeMs: 3 * 3_600_000,
  minCandidateScore: 20,
  maxCandidates: 50,
} as const;

export interface ScanSummary { scanned: number; complete: number; tooLong: number; buyersFound: number; errors: string[] }

/**
 * Captures the first buyers of young tokens. The first buyers of an old, busy token cannot be reached with ordinary RPC
 * history calls, so this must run while a token is young. A token whose history is too long is recorded as incomplete
 * and never used. It looks for transactions that mention the mint, which is an assumption: swaps that do not list
 * the mint account are missed. The fee payer is treated as the buyer, like the webhook parser.
 */
export async function scanEarlyBuyers(db: PrismaClient, rpc: HistoryPort, now: Date = new Date(), opts: { maxTokens?: number; /** Only scan these tokens, if they are still inside the scan window. */ tokenIds?: string[] } = {}): Promise<ScanSummary> {
  const L = DISCOVERY_LIMITS;
  const out: ScanSummary = { scanned: 0, complete: 0, tooLong: 0, buyersFound: 0, errors: [] };
  const tokens = await db.token.findMany({
    where: { blacklisted: false, earlyBuyers: null, ...(opts.tokenIds ? { id: { in: opts.tokenIds } } : {}), createdOnChainAt: { gte: new Date(now.getTime() - L.scanWindowMs), lte: now } },
    orderBy: { createdOnChainAt: 'desc' }, take: opts.maxTokens ?? L.maxTokensPerRun, select: { id: true, mint: true },
  });
  for (const t of tokens) {
    try {
      const { oldestFirst, complete } = await oldestSignatures(rpc, t.mint, L.maxPages, L.pageSize);
        const buyers: { wallet: string; rank: number; signature: string; at: string | null; spendEvidence: DiscoverySpendEvidence }[] = [];
      if (complete) {
        const seen = new Set<string>();
        for (const sig of oldestFirst.slice(0, L.maxTxsPerToken)) {
          if (buyers.length >= DISCOVERY.maxRank) break;
          const tx = await rpc.getParsedTransaction(sig);
          const buyer = tx ? earlyBuyer(tx, t.mint) : null;
          if (buyer && tx && !seen.has(buyer)) { seen.add(buyer); buyers.push({ wallet: buyer, rank: buyers.length + 1, signature: sig, at: typeof tx.blockTime === 'number' ? new Date(tx.blockTime * 1000).toISOString() : null, spendEvidence: discoverySpendEvidence(tx,t.mint) }); }
        }
      }
      const data = { complete, buyers, scannedAt: now };
      await db.tokenEarlyBuyers.upsert({ where: { tokenId: t.id }, create: { tokenId: t.id, ...data }, update: data });
      out.scanned++; out.buyersFound += buyers.length;
      if (complete) out.complete++; else out.tooLong++;
    } catch (e) {
      out.errors.push(`${t.mint.slice(0, 6)}: ${(e as Error).message}`);
    }
  }
  return out;
}

export interface DiscoverySummary { tokensJudged: number; winners: number; candidates: number; completeScans: number; noPrice: number; stalePrice: number; insufficientObservations: number; invalidPrice: number; emerging: number }
export const DISCOVERY_HEALTH_KEY = 'wallet.discovery.health';
export const DISCOVERY_EMERGING_KEY = 'wallet.discovery.emerging';

/** Price completed discovery scans repeatedly while they can still be judged. Rotate
 * by token id so missing provider coverage cannot permanently occupy the budget. */
export async function discoveryPriceCandidates(db: PrismaClient, now: Date, limit: number, excluded: string[], after: string | null): Promise<string[]> {
  if (limit <= 0) return [];
  const where = { blacklisted: false, mint: { not: WSOL_MINT }, earlyBuyers: { is: { complete: true } }, createdOnChainAt: { gte: new Date(+now - DISCOVERY_LIMITS.lookbackMs), lte: now } };
  // Half the existing quota targets first observations; the rest guarantees repeat observations.
  const initialLimit = Math.floor(limit / 2);
  const firstWhere = { ...where, metrics: { none: {} } };
  const initial = initialLimit ? await db.token.findMany({ where: { ...firstWhere, id: { notIn: excluded, ...(after ? { gt: after } : {}) } }, orderBy: { id: 'asc' }, take: initialLimit, select: { id: true } }) : [];
  if (after && initial.length < initialLimit) initial.push(...await db.token.findMany({ where: { ...firstWhere, id: { notIn: excluded, lte: after } }, orderBy: { id: 'asc' }, take: initialLimit - initial.length, select: { id: true } }));
  const omit = [...excluded, ...initial.map(t => t.id)], remaining = limit - initial.length;
  const first = await db.token.findMany({ where: { ...where, id: { notIn: omit, ...(after ? { gt: after } : {}) } }, orderBy: { id: 'asc' }, take: remaining, select: { id: true } });
  const wrap = after && first.length < remaining ? await db.token.findMany({ where: { ...where, id: { notIn: omit, lte: after } }, orderBy: { id: 'asc' }, take: remaining - first.length, select: { id: true } }) : [];
  // Keep cursor advancement in traversal order even when a first-price slot is reserved.
  return [...initial, ...first, ...wrap].map(t => t.id).sort((a,b) => Number(!!after && a <= after) - Number(!!after && b <= after) || a.localeCompare(b));
}

/**
 * Turns scanned tokens into wallet suggestions. A token is a winner when its latest price is at least 3x its first
 * recorded price, it still has real liquidity, and it was not flagged a honeypot. Tokens too young or without fresh
 * prices are left out, not counted as losers. A flagged honeypot is judged as a non-winner, so a wallet that bought one is marked down. Suggestions are stored PENDING for an admin. Nothing is tracked here.
 */
export async function discoverCandidates(db: PrismaClient, now: Date = new Date()): Promise<DiscoverySummary> {
  const L = DISCOVERY_LIMITS;
  const rows = await db.tokenEarlyBuyers.findMany({
    where: { complete: true, token: { blacklisted: false, createdOnChainAt: { gte: new Date(now.getTime() - L.lookbackMs), lte: new Date(now.getTime() - L.minAgeMs) } } },
    select: { buyers: true, token: { select: { id: true, mint: true, risk: { orderBy: { at: 'desc' }, take: 1, select: { flags: true } } } } },
  });
  const scans: TokenScan[] = [];
  const mintOf = new Map<string, string>();
  let winners = 0;
  const out: DiscoverySummary = { tokensJudged: 0, winners: 0, candidates: 0, completeScans: rows.length, noPrice: 0, stalePrice: 0, insufficientObservations: 0, invalidPrice: 0, emerging: 0 };
  const repeat = new Map<string, Set<string>>();
  const spend = new Map<string, DiscoverySpendObservation[]>();
  for (const r of rows) {
    for (const b of Array.isArray(r.buyers) ? r.buyers : []) {
      if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.wallet !== 'string' || typeof b.rank !== 'number' || b.rank < 1 || b.rank > DISCOVERY.maxRank) continue;
      const ids = repeat.get(b.wallet) ?? new Set<string>(); ids.add(r.token.id); repeat.set(b.wallet, ids);
      const observations = spend.get(b.wallet) ?? [];
      observations.push({ tokenId:r.token.id,signature:b.signature,at:b.at,spendEvidence:b.spendEvidence });spend.set(b.wallet,observations);
    }
    const [first, last] = await Promise.all([
      db.tokenMetric.findFirst({ where: { tokenId: r.token.id }, orderBy: { at: 'asc' }, select: { id: true, at: true, priceUsd: true } }),
      db.tokenMetric.findFirst({ where: { tokenId: r.token.id }, orderBy: { at: 'desc' }, select: { priceUsd: true, liquidityUsd: true, at: true } }),
    ]);
    if (!first || !last) { out.noPrice++; continue; }
    if (+last.at > +now || +first.at > +now || now.getTime() - last.at.getTime() > L.maxMetricAgeMs) { out.stalePrice++; continue; }
    if (+first.at >= +last.at) { out.insufficientObservations++; continue; }
    const p0 = Number(first.priceUsd.toString()), p1 = Number(last.priceUsd.toString());
    if (!(p0 > 0) || !(p1 > 0)) { out.invalidPrice++; continue; }
    const honeypot = r.token.risk[0]?.flags.includes('HONEYPOT') ?? false;
    const winner = !honeypot && p1 / p0 >= L.winnerGrowth && Number(last.liquidityUsd.toString()) >= L.minLiquidityUsd;
    const buyers = Array.isArray(r.buyers) ? (r.buyers as unknown[]).filter((b): b is { wallet: string; rank: number } => typeof (b as { wallet?: unknown })?.wallet === 'string' && typeof (b as { rank?: unknown })?.rank === 'number') : [];
    scans.push({ tokenId: r.token.id, buyers, winner });
    mintOf.set(r.token.id, r.token.mint);
    if (winner) winners++;
  }

  const [tracked, reviewed] = await Promise.all([
    db.trackedWallet.findMany({ select: { address: true } }),
    db.walletCandidate.findMany({ where: { status: { not: 'PENDING' } }, select: { address: true } }),
  ]);
  const exclude = new Set([...tracked, ...reviewed].map((x) => x.address));
  const ranked = rankCandidates(scans, exclude).filter((c) => c.score >= L.minCandidateScore).slice(0, L.maxCandidates);
  for (const c of ranked) {
    const data = { score: c.score, winnerTokens: c.winnerTokens, evidence: { checkedAt: now.toISOString(), scannedTokens: c.scannedTokens, hitRate: c.hitRate, avgRank: c.avgRank, winnerMints: c.winners.slice(0, 10).map((id) => mintOf.get(id) ?? id) } };
    // Existing PENDING suggestions are re-scored. A reviewed address is excluded above, so its status is never touched.
    await db.walletCandidate.upsert({ where: { address: c.address }, create: { address: c.address, ...data }, update: data });
  }
  const emerging = [...repeat].filter(([address, ids]) => ids.size >= 2 && !exclude.has(address)).map(([address, ids]) => ({ address, scannedTokens: ids.size, spend: summarizeDiscoverySpend(spend.get(address)??[],now) })).sort((a,b) => b.scannedTokens - a.scannedTokens || a.address.localeCompare(b.address));
  Object.assign(out, { tokensJudged: scans.length, winners, candidates: ranked.length, emerging: emerging.length });
  const health = { ...out, checkedAt: now.toISOString(), lookbackHours: 48 };
  const candidates = { checkedAt: now.toISOString(), total: emerging.length, capped: emerging.length > 50, items: emerging.slice(0,50) };
  await db.$transaction([
    db.systemSetting.upsert({ where: { key: DISCOVERY_HEALTH_KEY }, create: { key: DISCOVERY_HEALTH_KEY, value: health }, update: { value: health } }),
    db.systemSetting.upsert({ where: { key: DISCOVERY_EMERGING_KEY }, create: { key: DISCOVERY_EMERGING_KEY, value: candidates }, update: { value: candidates } }),
  ]);
  return out;
}
