import type { PrismaClient } from '@narra/database';
import { buildFundingGraph } from '@narra/smart-money';
import { firstFunding, type SolanaRpc } from '@narra/solana';

export type HistoryPort = Pick<SolanaRpc, 'getSignaturesForAddress' | 'getParsedTransaction'>;

/** Starting values. RPC calls per run are at most maxWalletsPerRun x (maxPages + maxTxsPerWallet). */
export const FUNDING_LIMITS = {
  maxWalletsPerRun: 10,
  pageSize: 1000,
  /** Pages of 1,000 signatures walked back to reach a wallet's first transaction. A longer history is reported INCOMPLETE. */
  maxPages: 5,
  /** Oldest transactions examined per wallet. */
  maxTxsPerWallet: 25,
  /** A wallet with no found funder is looked at again after this long. */
  retryAfterMs: 7 * 86_400_000,
  /** Stop the run after this many wallets in a row fail, so a down provider is not hammered. */
  maxConsecutiveErrors: 3,
} as const;
export const FUNDER_IGNORE_SETTING = 'wallets.funderIgnore';

export interface FundingIngestSummary { checked: number; found: number; notFound: number; incomplete: number; errors: string[] }

/** Walks signatures back from newest until a short page shows the start of history. Returns oldest-first successful signatures, and whether the start was reached. */
export async function oldestSignatures(rpc: HistoryPort, address: string, maxPages: number, pageSize: number): Promise<{ oldestFirst: string[]; complete: boolean }> {
  const all: { signature: string; failed: boolean }[] = [];
  let before: string | undefined;
  let complete = false;
  for (let page = 0; page < maxPages; page++) {
    const sigs = await rpc.getSignaturesForAddress(address, { limit: pageSize, before });
    all.push(...sigs);
    if (sigs.length < pageSize) { complete = true; break; }
    before = sigs[sigs.length - 1]!.signature;
  }
  return { oldestFirst: all.filter((s) => !s.failed).map((s) => s.signature).reverse(), complete };
}

/**
 * Finds the first meaningful SOL funder of tracked wallets that have not been checked. A funder is only claimed when
 * the start of the wallet's history was reached. A history too long to reach is INCOMPLETE and claims nothing.
 * Results are research data only, so a wrong or missing answer cannot reach a trade.
 */
export async function ingestWalletFunding(db: PrismaClient, rpc: HistoryPort, now: Date = new Date(), opts: { maxWallets?: number; /** Only check these wallets, for example an admin re-check. */ walletIds?: string[] } = {}): Promise<FundingIngestSummary> {
  const L = FUNDING_LIMITS;
  const out: FundingIngestSummary = { checked: 0, found: 0, notFound: 0, incomplete: 0, errors: [] };
  const due = await db.trackedWallet.findMany({
    where: { active: true, ...(opts.walletIds ? { id: { in: opts.walletIds } } : {}), OR: [{ funding: null }, { funding: { status: { in: ['NOT_FOUND', 'INCOMPLETE'] }, checkedAt: { lt: new Date(now.getTime() - L.retryAfterMs) } } }] },
    orderBy: { createdAt: 'asc' }, take: opts.maxWallets ?? L.maxWalletsPerRun, select: { id: true, address: true },
  });
  let streak = 0;
  for (const w of due) {
    try {
      const { oldestFirst, complete } = await oldestSignatures(rpc, w.address, L.maxPages, L.pageSize);
      const examine = oldestFirst.slice(0, L.maxTxsPerWallet);
      const txs: { signature: string; tx: Awaited<ReturnType<HistoryPort['getParsedTransaction']>> }[] = [];
      for (const signature of examine) txs.push({ signature, tx: await rpc.getParsedTransaction(signature) });
      const f = firstFunding(txs, w.address);
      const examinedAll = complete && oldestFirst.length <= L.maxTxsPerWallet;
      const status = f ? 'FOUND' : examinedAll ? 'NOT_FOUND' : 'INCOMPLETE';
      const data = { funder: f?.funder ?? null, lamports: f?.lamports ?? null, signature: f?.signature ?? null, fundedAt: f?.at ?? null, status, checkedAt: now };
      await db.walletFunding.upsert({ where: { walletId: w.id }, create: { walletId: w.id, ...data }, update: data });
      out.checked++; streak = 0;
      if (status === 'FOUND') out.found++; else if (status === 'NOT_FOUND') out.notFound++; else out.incomplete++;
    } catch (e) {
      out.errors.push(`${w.address.slice(0, 6)}: ${(e as Error).message}`);
      if (++streak >= L.maxConsecutiveErrors) break;
    }
  }
  return out;
}

export interface FundingGraphSummary { edges: number; clusters: number; skippedFunders: { funder: string; wallets: number }[] }

/**
 * Rebuilds funding relationships and 'funding' clusters from stored funders, in one transaction. Funding is stronger
 * evidence than timing, so a wallet in both ends up in its funding cluster. Timing clusters are left to their own job.
 */
export async function rebuildFundingGraph(db: PrismaClient): Promise<FundingGraphSummary> {
  const [wallets, ignoreRow] = await Promise.all([
    db.trackedWallet.findMany({ where: { active: true }, select: { id: true, address: true, funding: { select: { funder: true, status: true } } } }),
    db.systemSetting.findUnique({ where: { key: FUNDER_IGNORE_SETTING } }),
  ]);
  const ignored = new Set(Array.isArray(ignoreRow?.value) ? (ignoreRow!.value as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  const addressToId = new Map(wallets.map((w) => [w.address, w.id]));
  const rows = wallets.flatMap((w) => (w.funding?.status === 'FOUND' && w.funding.funder ? [{ walletId: w.id, funder: w.funding.funder }] : []));
  const g = buildFundingGraph(rows, addressToId, { ignoredFunders: ignored });

  await db.$transaction([
    db.trackedWallet.updateMany({ where: { cluster: { label: 'funding' } }, data: { clusterId: null } }),
    db.walletRelationship.deleteMany({ where: { kind: 'FUNDING' } }),
    db.walletCluster.deleteMany({ where: { label: 'funding' } }),
    ...g.clusters.map((c) => db.walletCluster.create({ data: { label: 'funding', confidence: c.confidence, wallets: { connect: c.walletIds.map((id) => ({ id })) } } })),
    ...(g.edges.length ? [db.walletRelationship.createMany({ skipDuplicates: true, data: g.edges.map((e) => ({ fromId: e.fromId, toId: e.toId, kind: 'FUNDING', confidence: e.confidence, evidence: { type: e.type, funder: e.funder } })) })] : []),
  ]);
  return { edges: g.edges.length, clusters: g.clusters.length, skippedFunders: g.skippedFunders };
}
