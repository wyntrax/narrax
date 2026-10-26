import type { PrismaClient } from '@narra/database';
import { TOKEN_DISCOVERY_KEY_PREFIX, type InvestigationDiscoveryStatus } from '@narra/shared';
import { SwapEventSchema } from '@narra/queue';
import { parseHeliusSwaps } from '@narra/solana';
import { collectWalletHistory } from './walletHistory';
import { makeWalletEventStore } from './prismaStores';

/** Bounded provider work per token scan. These are collection limits, not evidence thresholds. */
export const TOKEN_DISCOVERY_LIMITS = {
  pageSize: 100, maxPages: 3, minSwapsPerWallet: 2, maxWalletsPerScan: 10,
  maxHistoryPages: 2, maxDiscoveredWallets: 200, requestTimeoutMs: 20_000,
} as const;

export type DiscoveryParticipant = {
  address: string; swaps: number; buys: number; sells: number;
  firstAt: string; lastAt: string; signatures: string[];
};

export type TokenSwapSample = {
  pagesRead: number; transactionsRead: number; swapsRead: number; capped: boolean;
  participants: DiscoveryParticipant[];
};

export type TokenDiscoverySummary = InvestigationDiscoveryStatus & { version: 1; requestedAt: string; startedAt: string };

type Fetch = typeof fetch;
type Collect = typeof collectWalletHistory;

const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Signer-capable infrastructure is not a research wallet. This is a safety net, not an exhaustive service registry. */
export const DISCOVERY_EXCLUDED_ADDRESSES = new Set([
  '11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'ComputeBudget111111111111111111111111111111',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'So11111111111111111111111111111111111111112',
]);
const newer = (left: string, right: string) => Date.parse(left) > Date.parse(right) ? left : right;
const older = (left: string, right: string) => Date.parse(left) < Date.parse(right) ? left : right;

/** Extracts supported SOL-quoted swaps for one token from an enhanced-transaction page. */
export function tokenParticipants(items: unknown, mint: string): { participants: DiscoveryParticipant[]; swaps: number } {
  const parsed = parseHeliusSwaps(items), seen = new Map<string, DiscoveryParticipant>(), signatures = new Set<string>();
  let swaps = 0;
  for (const candidate of parsed.events) {
    const event = SwapEventSchema.safeParse(candidate);
    if (!event.success || event.data.mint !== mint || event.data.wallet === mint || DISCOVERY_EXCLUDED_ADDRESSES.has(event.data.wallet) || event.data.amountSol <= 0 || signatures.has(event.data.signature)) continue;
    signatures.add(event.data.signature); swaps++;
    const current = seen.get(event.data.wallet);
    if (!current) {
      seen.set(event.data.wallet, { address: event.data.wallet, swaps: 1, buys: event.data.side === 'BUY' ? 1 : 0, sells: event.data.side === 'SELL' ? 1 : 0,
        firstAt: event.data.at, lastAt: event.data.at, signatures: [event.data.signature] });
      continue;
    }
    current.swaps++;
    if (event.data.side === 'BUY') current.buys++; else current.sells++;
    current.firstAt = older(current.firstAt, event.data.at);
    current.lastAt = newer(current.lastAt, event.data.at);
    if (current.signatures.length < 5) current.signatures.push(event.data.signature);
  }
  return { participants: [...seen.values()].sort((a, b) => b.swaps - a.swaps || b.lastAt.localeCompare(a.lastAt) || a.address.localeCompare(b.address)), swaps };
}

/** New participants with enough recorded swaps, newest activity first. Existing tracked addresses are never re-added. */
export function selectDiscoveryCandidates(
  participants: readonly DiscoveryParticipant[], existing: ReadonlySet<string>,
  options: { minSwaps?: number; maxWallets?: number } = {},
): DiscoveryParticipant[] {
  return participants
    .filter(p => addressPattern.test(p.address) && !DISCOVERY_EXCLUDED_ADDRESSES.has(p.address) && p.swaps >= (options.minSwaps ?? TOKEN_DISCOVERY_LIMITS.minSwapsPerWallet) && !existing.has(p.address))
    .sort((a, b) => b.swaps - a.swaps || Date.parse(b.lastAt) - Date.parse(a.lastAt) || a.address.localeCompare(b.address))
    .slice(0, options.maxWallets ?? TOKEN_DISCOVERY_LIMITS.maxWalletsPerScan);
}

async function tokenPage(mint: string, apiKey: string, before: string | undefined, fetcher: Fetch): Promise<unknown[]> {
  const url = new URL(`https://api-mainnet.helius-rpc.com/v0/addresses/${encodeURIComponent(mint)}/transactions`);
  url.searchParams.set('api-key', apiKey);
  url.searchParams.set('type', 'SWAP');
  url.searchParams.set('limit', String(TOKEN_DISCOVERY_LIMITS.pageSize));
  if (before) url.searchParams.set('before', before);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(TOKEN_DISCOVERY_LIMITS.requestTimeoutMs) });
    if (response.status === 429 && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 1_000 * 2 ** attempt)); continue; }
    if (!response.ok) throw new Error(`Token history returned HTTP ${response.status}`);
    const value: unknown = await response.json();
    if (!Array.isArray(value)) throw new Error('Token history returned an invalid payload');
    return value;
  }
  throw new Error('Token history remained rate limited');
}

/**
 * Reads recent supported swaps for a mint. The mint is not a tracked wallet, so this is discovery only: it never writes
 * trades, and a capped page count is reported rather than treated as complete token participation.
 */
export async function scanTokenSwaps(
  mint: string, options: { apiKey: string; fetch?: Fetch; maxPages?: number },
): Promise<TokenSwapSample> {
  const fetcher = options.fetch ?? fetch, maxPages = Math.min(TOKEN_DISCOVERY_LIMITS.maxPages, Math.max(1, options.maxPages ?? TOKEN_DISCOVERY_LIMITS.maxPages));
  const participants = new Map<string, DiscoveryParticipant>(), signatures = new Set<string>();
  let pagesRead = 0, transactionsRead = 0, swapsRead = 0, capped = false, before: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const items = await tokenPage(mint, options.apiKey, before, fetcher);
    pagesRead++; transactionsRead += items.length;
    const sample = tokenParticipants(items, mint);
    swapsRead += sample.swaps;
    for (const candidate of sample.participants) {
      const current = participants.get(candidate.address);
      if (!current) { participants.set(candidate.address, { ...candidate, signatures: [...candidate.signatures] }); continue; }
      current.swaps += candidate.swaps; current.buys += candidate.buys; current.sells += candidate.sells;
      current.firstAt = older(current.firstAt, candidate.firstAt); current.lastAt = newer(current.lastAt, candidate.lastAt);
      for (const signature of candidate.signatures) if (current.signatures.length < 5 && !current.signatures.includes(signature)) current.signatures.push(signature);
    }
    for (const item of items) {
      if (!item || typeof item !== 'object' || !('signature' in item) || typeof item.signature !== 'string') continue;
      if (signatures.has(item.signature)) throw new Error('Token history pagination repeated a transaction');
      signatures.add(item.signature);
    }
    const last = items.at(-1) as { signature?: unknown } | undefined;
    if (items.length < TOKEN_DISCOVERY_LIMITS.pageSize) break;
    if (!last || typeof last.signature !== 'string' || last.signature === before) throw new Error('Token history pagination did not advance');
    before = last.signature;
    capped = page === maxPages - 1;
  }
  const ordered = [...participants.values()].sort((a, b) => b.swaps - a.swaps || b.lastAt.localeCompare(a.lastAt) || a.address.localeCompare(b.address));
  return { pagesRead, transactionsRead, swapsRead, capped, participants: ordered };
}

/** Runs one bounded token scan, adds untracked participants as provisional wallets, then backfills their recent swaps. */
export async function discoverTokenWallets(db: PrismaClient, input: {
  tokenId: string; mint: string; symbol: string; apiKey?: string; now?: Date; fetch?: Fetch; collect?: Collect;
}): Promise<TokenDiscoverySummary> {
  const now = input.now ?? new Date(), key = `${TOKEN_DISCOVERY_KEY_PREFIX}${input.tokenId}`;
  const base = { version: 1 as const, requestedAt: now.toISOString(), startedAt: now.toISOString(), checkedAt: now.toISOString(), pagesRead: 0, transactionsRead: 0,
    swapsRead: 0, participantsSeen: 0, candidates: 0, newWallets: 0, backfilledWallets: 0, createdTrades: 0, capped: false };
  const save = (value: TokenDiscoverySummary) => db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  const apiKey = input.apiKey;
  if (!apiKey) {
    // An operator can tell this apart from a provider outage, and the UI stops waiting instead of polling a no-op.
    const failed: TokenDiscoverySummary = { ...base, status: 'FAILED', error: 'NOT_CONFIGURED' };
    await save(failed);
    return failed;
  }
  await save({ ...base, status: 'RUNNING', error: null });
  try {
    const sample = await scanTokenSwaps(input.mint, { apiKey, fetch: input.fetch });
    const [tracked, discoveredCount] = await Promise.all([
      db.trackedWallet.findMany({ where: { address: { in: sample.participants.map(p => p.address) } }, select: { address: true } }),
      db.trackedWallet.count({ where: { source: 'DISCOVERED', active: true, researchReview: { not: 'REJECTED' } } }),
    ]);
    const eligible = selectDiscoveryCandidates(sample.participants, new Set(tracked.map(w => w.address)), { maxWallets: TOKEN_DISCOVERY_LIMITS.maxWalletsPerScan });
    const selected = eligible.slice(0, Math.max(0, TOKEN_DISCOVERY_LIMITS.maxDiscoveredWallets - discoveredCount));
    const created: { id: string; address: string }[] = [];
    for (const candidate of selected) {
      try {
        const wallet = await db.trackedWallet.create({ data: { address: candidate.address, source: 'DISCOVERED', active: true, researchReview: 'PROVISIONAL' }, select: { id: true, address: true } });
        created.push(wallet);
      } catch (error) {
        // A concurrent scan may have added the same address. That is not a failure for this scan.
        if ((error as { code?: string } | null)?.code !== 'P2002') throw error;
      }
    }
    const store = makeWalletEventStore(db), collect = input.collect ?? collectWalletHistory;
    let backfilledWallets = 0, createdTrades = 0, failures = 0;
    for (const wallet of created) {
      try {
        const history = await collect(wallet.address, { apiKey, now, maxPages: TOKEN_DISCOVERY_LIMITS.maxHistoryPages });
        for (const event of history.events) if (await store.saveWalletTrade(event) === 'created') createdTrades++;
        const value = { checkedAt: now.toISOString(), scanned: history.scanned, accepted: history.events.length, skipped: history.skipped,
          capped: history.capped, coveredFrom: history.coveredFrom, coveredTo: history.coveredTo, windowDays: 30 };
        await db.systemSetting.upsert({ where: { key: `wallet.history.${wallet.id}` }, create: { key: `wallet.history.${wallet.id}`, value }, update: { value } });
        backfilledWallets++;
      } catch (error) {
        console.error('token discovery backfill failed', { wallet: wallet.address, error: error instanceof Error ? error.message : 'unknown' });
        failures++;
      }
    }
    const summary: TokenDiscoverySummary = { ...base, status: sample.capped || failures > 0 ? 'PARTIAL' : 'COMPLETE', checkedAt: now.toISOString(),
      pagesRead: sample.pagesRead, transactionsRead: sample.transactionsRead, swapsRead: sample.swapsRead,
      participantsSeen: sample.participants.length, candidates: eligible.length, newWallets: created.length,
      backfilledWallets, createdTrades, capped: sample.capped, error: failures > 0 ? 'PROVIDER_FAILED' : null };
    // A failed backfill still leaves the scan's discovery result useful. The status says partial, not complete.
    await save(summary);
    return summary;
  } catch (error) {
    console.error('token discovery failed', { tokenId: input.tokenId, mint: input.mint, error: error instanceof Error ? error.message : 'unknown' });
    const failed: TokenDiscoverySummary = { ...base, status: 'FAILED', checkedAt: now.toISOString(), error: 'PROVIDER_FAILED' };
    await save(failed);
    return failed;
  }
}
