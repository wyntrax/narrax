import type { Prisma, PrismaClient } from '@narra/database';
import { earlyBuyer, firstFunding, RpcHttpError, type ParsedTx, type SolanaRpc } from '@narra/solana';
import { isSolanaAddress } from '@narra/shared';
import { initialIssuingWallet } from './developerHoldings';
import { oldestSignatures } from './walletFunding';

/**
 * Launch-window evidence for the early-radar safety gate.
 *
 * The current holder list cannot tell a bundled launch from an organic one: supply can be spread across many fresh
 * wallets, and the meaningful first buyers are often far outside the newest RPC page. This scans the mint's history
 * back to its first transactions, so the gate can answer bundle/sniper/insider questions with observed evidence
 * instead of `UNKNOWN`.
 *
 * The scan is deliberately bounded. If it cannot reach the start of the mint's history, the result is `UNKNOWN`;
 * it never reports a partial launch as clean.
 */

export const LAUNCH_EVIDENCE_LIMITS = {
  pageSize: 1_000,
  /** Enough pages to reach the launch of a busy new token. A longer history stays UNKNOWN. */
  maxPages: 50,
  /** Oldest signatures parsed for buyers and the issuing wallet. */
  maxTransactions: 160,
  maxBuyers: 40,
  /** Buyers whose funder is resolved for the insider cluster. */
  maxFundingWallets: 5,
  fundingPages: 5,
  fundingTransactions: 25,
  cacheTtlMs: 6 * 3_600_000,
  unknownTtlMs: 10 * 60_000,
  /** Candidate scans per resolution run. The rest are left for the next run. */
  maxPerRun: 2,
  /** Mirrors RADAR_SAFETY_POLICY.maxDeployerPriorTokens in @narra/token-intel. */
  maxDeployerPriorTokens: 3,
} as const;

export interface LaunchBuy {
  wallet: string;
  signature: string;
  slot: number | null;
  /** Unix seconds. */
  at: number;
  amountRaw: bigint;
}

export interface LaunchEvidence {
  mint: string;
  status: 'CLEAN' | 'FLAGGED' | 'UNKNOWN';
  bundlePct: number | null;
  sniperPct: number | null;
  insiderPct: number | null;
  sameSlotBuyers: number | null;
  firstBuyers: number;
  firstBuyersPct: number | null;
  historyComplete: boolean;
  deployer: string | null;
  deployerSource: 'MINT_AUTHORITY' | 'FIRST_FEE_PAYER' | null;
  deployerPriorTokens: number | null;
  deployerPriorRugs: number | null;
  source: 'helius-rpc';
  observedAt: string;
  detail: string;
}

export interface LaunchEvidenceSource {
  /** Reset the per-run scan budget. Call once at the start of each resolution/social scan. */
  begin(): void;
  get(mint: string, now?: Date): Promise<LaunchEvidence | null>;
}

export interface LaunchEvidenceOptions {
  now?: () => Date;
  maxPerRun?: number;
  cacheTtlMs?: number;
  unknownTtlMs?: number;
  /** Injectable for tests. */
  scan?: (mint: string, now: Date) => Promise<LaunchEvidence>;
}

const SETTING_PREFIX = 'research.launchEvidence.';
const FUNDER_PREFIX = 'research.walletFunder.';
const cacheKey = (mint: string): string => `${SETTING_PREFIX}${mint}`;

const pct = (amount: bigint, supply: bigint): number =>
  supply > 0n ? Number((amount * 1_000_000n) / supply) / 10_000 : 0;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A burst of launch reads can exhaust one Helius key. Retry the same call while the pool cools down. */
async function parsedTransaction(rpc: SolanaRpc, signature: string): Promise<ParsedTx | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await rpc.getParsedTransaction(signature);
    } catch (error) {
      if (error instanceof RpcHttpError && (error.status === 429 || error.status >= 500)) {
        await sleep(Math.min(2_000, error.retryAfterMs ?? 500 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new RpcHttpError('getTransaction', 429);
}

const sum = (rows: readonly LaunchBuy[]): bigint => rows.reduce((total, row) => total + row.amountRaw, 0n);

/** Token balance change for one owner in one parsed transaction. */
export function tokenDelta(tx: ParsedTx, mint: string, owner: string): bigint {
  const balances = (list: NonNullable<ParsedTx['meta']>['preTokenBalances']) => (list ?? [])
    .filter((b) => b.mint === mint && b.owner === owner)
    .reduce((total, b) => total + BigInt(b.uiTokenAmount.amount), 0n);
  return balances(tx.meta?.postTokenBalances) - balances(tx.meta?.preTokenBalances);
}

export interface LaunchMetrics {
  bundlePct: number | null;
  sniperPct: number | null;
  sameSlotBuyers: number | null;
  firstBuyersPct: number | null;
  bundleWallets: Set<string>;
  sniperWallets: Set<string>;
}

/**
 * Bundle and sniper shares are disjoint. Bundle is the first slot (or first second when slots are unavailable) plus
 * the next two; sniper is the first 60 seconds excluding bundle wallets. This keeps the combined cap meaningful.
 */
export function launchMetrics(buys: readonly LaunchBuy[], supplyRaw: bigint): LaunchMetrics {
  if (buys.length === 0 || supplyRaw <= 0n) return { bundlePct: null, sniperPct: null, sameSlotBuyers: null, firstBuyersPct: null, bundleWallets: new Set(), sniperWallets: new Set() };
  const first = buys.reduce((oldest, row) => (row.at < oldest.at || (row.at === oldest.at && (row.slot ?? 0) < (oldest.slot ?? 0)) ? row : oldest));
  const firstSlot = buys.reduce<number | null>((min, row) => (row.slot == null ? min : min == null ? row.slot : Math.min(min, row.slot)), null);

  const bundle = firstSlot != null
    ? buys.filter((b) => b.slot != null && b.slot <= firstSlot + 2)
    : buys.filter((b) => b.at <= first.at + 2);
  const bundleWallets = new Set(bundle.map((b) => b.wallet));

  const sniper = buys.filter((b) => b.at <= first.at + 60 && !bundleWallets.has(b.wallet));
  const sniperWallets = new Set(sniper.map((b) => b.wallet));

  const sameSlotBuyers = firstSlot != null
    ? new Set(buys.filter((b) => b.slot === firstSlot).map((b) => b.wallet)).size
    : new Set(buys.filter((b) => b.at === first.at).map((b) => b.wallet)).size;

  return {
    bundlePct: pct(sum(bundle), supplyRaw),
    sniperPct: pct(sum(sniper), supplyRaw),
    sameSlotBuyers,
    firstBuyersPct: pct(sum(buys), supplyRaw),
    bundleWallets,
    sniperWallets,
  };
}

interface FunderResult {
  status: 'FOUND' | 'NOT_FOUND' | 'INCOMPLETE';
  funder: string | null;
}

/** One-hop funding source for a launch buyer, cached for a week. */
async function funderOf(db: PrismaClient, rpc: SolanaRpc, wallet: string, now: Date): Promise<FunderResult> {
  const key = `${FUNDER_PREFIX}${wallet}`;
  const row = await db.systemSetting.findUnique({ where: { key } });
  const cached = row?.value as { status?: unknown; funder?: unknown; checkedAt?: unknown } | null;
  if (cached && typeof cached.status === 'string' && typeof cached.checkedAt === 'string' && Date.now() - Date.parse(cached.checkedAt) < 7 * 86_400_000) {
    return { status: cached.status as FunderResult['status'], funder: typeof cached.funder === 'string' ? cached.funder : null };
  }

  let result: FunderResult;
  try {
    const { oldestFirst, complete } = await oldestSignatures(rpc, wallet, LAUNCH_EVIDENCE_LIMITS.fundingPages, LAUNCH_EVIDENCE_LIMITS.pageSize);
    const txs: { signature: string; tx: ParsedTx | null }[] = [];
    for (const signature of oldestFirst.slice(0, LAUNCH_EVIDENCE_LIMITS.fundingTransactions)) {
      txs.push({ signature, tx: await parsedTransaction(rpc, signature) });
      await sleep(10);
    }
    const found = firstFunding(txs, wallet);
    // A short, complete history with no qualifying transfer is a known "no funder", not missing evidence.
    const status: FunderResult['status'] = found ? 'FOUND' : complete && oldestFirst.length <= LAUNCH_EVIDENCE_LIMITS.fundingTransactions ? 'NOT_FOUND' : 'INCOMPLETE';
    result = { status, funder: found?.funder ?? null };
  } catch {
    result = { status: 'INCOMPLETE', funder: null };
  }

  await db.systemSetting.upsert({
    where: { key },
    create: { key, value: { ...result, checkedAt: now.toISOString() } },
    update: { value: { ...result, checkedAt: now.toISOString() } },
  }).catch(() => undefined);
  return result;
}

/** Prior tokens and prior rugs for the issuing wallet, from our own stored token history. */
export async function deployerHistory(
  db: PrismaClient,
  deployer: string | null,
  tokenId: string,
  now: Date,
): Promise<{ priorTokens: number | null; priorRugs: number | null; mints: string[] }> {
  if (!deployer) return { priorTokens: null, priorRugs: null, mints: [] };
  const rows = await db.token.findMany({
    where: { deployer, id: { not: tokenId } },
    select: {
      id: true,
      mint: true,
      createdOnChainAt: true,
      marketQuoteFailures: true,
      metrics: { orderBy: { at: 'desc' }, take: 1, select: { marketCapUsd: true, at: true } },
    },
  });
  let priorRugs = 0;
  for (const row of rows) {
    const metric = row.metrics[0];
    const ageMs = row.createdOnChainAt ? +now - +row.createdOnChainAt : null;
    const latestAt = metric?.at ?? null;
    const deadMarket = row.marketQuoteFailures >= 2 && (!latestAt || +now - +latestAt > 3 * 86_400_000);
    const neverPricedOld = !latestAt && ageMs != null && ageMs > 3 * 86_400_000;
    const collapsedAfterLaunch = !!metric && Number(metric.marketCapUsd) < 1_000 && ageMs != null && ageMs > 3_600_000;
    if (deadMarket || neverPricedOld || collapsedAfterLaunch) priorRugs++;
  }
  return { priorTokens: rows.length, priorRugs, mints: rows.map((row) => row.mint) };
}

interface DeployerEvidence {
  address: string;
  source: 'MINT_AUTHORITY' | 'FIRST_FEE_PAYER';
}

/**
 * The issuing wallet is the mint-authority signer when the mint exposes one. Launchpads often use a program or PDA
 * authority, so fall back to the fee payer of the oldest transaction; that is the wallet that paid to create the mint.
 */
/** Prior mints paid for by the deployer, from a bounded walk to the start of its history. */
async function deployerMints(rpc: SolanaRpc, deployer: string | null, now: Date): Promise<Set<string> | null> {
  if (!deployer) return null;
  try {
    const { oldestFirst, complete } = await oldestSignatures(rpc, deployer, 5, LAUNCH_EVIDENCE_LIMITS.pageSize);
    if (!complete) return null;
    const mints = new Set<string>();
    for (const signature of oldestFirst.slice(0, 50)) {
      const tx = await parsedTransaction(rpc, signature);
      await sleep(10);
      if (!tx || tx.meta?.err != null) continue;
      const first = tx.transaction.message.accountKeys[0];
      const payer = typeof first === 'string' ? first : first?.pubkey;
      if (payer !== deployer) continue;
      const instructions = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions)];
      for (const item of instructions) {
        const parsed = (item as { parsed?: { type?: string; info?: { mint?: string } } } | null)?.parsed;
        if ((parsed?.type === 'initializeMint' || parsed?.type === 'initializeMint2') && parsed.info?.mint) mints.add(parsed.info.mint);
      }
    }
    return mints;
  } catch {
    return null;
  }
}

function findDeployer(txs: readonly ParsedTx[], mint: string): DeployerEvidence | null {
  for (const tx of txs) {
    const deployer = initialIssuingWallet(tx, mint);
    if (deployer) return { address: deployer, source: 'MINT_AUTHORITY' };
  }
  for (const tx of txs) {
    const first = tx.transaction.message.accountKeys[0];
    const address = typeof first === 'string' ? first : first?.pubkey;
    if (address && isSolanaAddress(address)) return { address, source: 'FIRST_FEE_PAYER' };
  }
  return null;
}

/** Full bounded scan. Returns UNKNOWN rather than a partial clean result when the start of history is out of reach. */
export async function scanLaunch(db: PrismaClient, rpc: SolanaRpc, mint: string, now: Date): Promise<LaunchEvidence> {
  const L = LAUNCH_EVIDENCE_LIMITS;
  const signatures: { signature: string; failed: boolean; blockTime: number | null }[] = [];
  let before: string | undefined;
  let complete = false;
  for (let page = 0; page < L.maxPages; page++) {
    const rows = await rpc.getSignaturesForAddress(mint, { limit: L.pageSize, ...(before ? { before } : {}) });
    signatures.push(...rows);
    if (rows.length < L.pageSize) { complete = true; break; }
    before = rows[rows.length - 1]!.signature;
    await sleep(10);
  }

  const base = {
    mint, source: 'helius-rpc' as const, observedAt: now.toISOString(),
    historyComplete: complete, deployer: null, deployerSource: null, deployerPriorTokens: null, deployerPriorRugs: null,
  };
  if (!complete) {
    return { ...base, status: 'UNKNOWN', bundlePct: null, sniperPct: null, insiderPct: null, sameSlotBuyers: null, firstBuyers: 0, firstBuyersPct: null,
      detail: `history did not reach the launch within ${L.maxPages * L.pageSize} signatures` };
  }

  const oldest = signatures.filter((s) => !s.failed).slice(-L.maxTransactions).reverse();
  const buys: LaunchBuy[] = [];
  const oldestTxs: ParsedTx[] = [];
  for (const signature of oldest) {
    const tx = await parsedTransaction(rpc, signature.signature);
    await sleep(10);
    if (!tx) continue;
    oldestTxs.push(tx);
    const buyer = earlyBuyer(tx, mint);
    if (!buyer) continue;
    const amountRaw = tokenDelta(tx, mint, buyer);
    const at = tx.blockTime ?? signature.blockTime;
    if (amountRaw <= 0n || at == null) continue;
    buys.push({ wallet: buyer, signature: signature.signature, slot: tx.slot ?? null, at, amountRaw });
    if (buys.length >= L.maxBuyers) break;
  }

  const deployer = findDeployer(oldestTxs, mint);
  const [supplyRaw, history, onChainMints] = await Promise.all([
    rpc.getTokenSupplyRaw(mint),
    deployerHistory(db, deployer?.address ?? null, mint, now),
    deployerMints(rpc, deployer?.address ?? null, now),
  ]);
  if (deployer) await db.token.updateMany({ where: { mint, deployer: null }, data: { deployer: deployer.address } });
  const priorMints = onChainMints ? [...onChainMints].filter((prior) => prior !== mint) : [];
  // On-chain mints we have never stored cannot be judged for a rug, so the deployer verdict stays UNKNOWN.
  const unknownPriorMints = onChainMints ? priorMints.filter((prior) => !history.mints.includes(prior)) : [];
  const deployerPriorTokens = onChainMints ? Math.max(history.priorTokens ?? 0, priorMints.length) : history.priorTokens;
  const deployerPriorRugs = onChainMints && unknownPriorMints.length === 0 ? history.priorRugs : null;

  const metrics = launchMetrics(buys, supplyRaw);
  let insiderPct: number | null = null;
  let insiderDetail = 'insider funding evidence unavailable';
  if (deployer?.address) {
    const sample = buys.slice(0, L.maxFundingWallets);
    const funders = await Promise.all(sample.map((b) => funderOf(db, rpc, b.wallet, now)));
    if (funders.some((f) => f.status === 'INCOMPLETE')) {
      insiderPct = null;
    } else {
      const groups = new Map<string, bigint>();
      for (let i = 0; i < sample.length; i++) {
        const funder = funders[i]!.funder;
        if (funder) groups.set(funder, (groups.get(funder) ?? 0n) + sample[i]!.amountRaw);
      }
      const perFunder = new Map<string, number>();
      for (const funder of funders) if (funder.funder) perFunder.set(funder.funder, (perFunder.get(funder.funder) ?? 0) + 1);
      let insiderRaw = 0n;
      for (const [funder, amount] of groups) {
        if (funder === deployer?.address || (perFunder.get(funder) ?? 0) >= 2) insiderRaw += amount;
      }
      insiderPct = pct(insiderRaw, supplyRaw);
      insiderDetail = `insider sample ${sample.length}/${L.maxFundingWallets}`;
    }
  }

  const combined = (metrics.bundlePct ?? 0) + (metrics.sniperPct ?? 0) + (insiderPct ?? 0);
  const flagged = combined > 20 || (metrics.sameSlotBuyers != null && metrics.sameSlotBuyers > 2)
    || (deployerPriorRugs ?? 0) > 0 || (deployerPriorTokens ?? 0) > LAUNCH_EVIDENCE_LIMITS.maxDeployerPriorTokens;
  const unknown = buys.length === 0 || insiderPct == null || deployerPriorRugs == null;
  const status: LaunchEvidence['status'] = flagged ? 'FLAGGED' : unknown ? 'UNKNOWN' : 'CLEAN';
  const detail = [
    `first ${buys.length} buyers ${(metrics.firstBuyersPct ?? 0).toFixed(2)}% of supply`,
    `first-slot buyers ${metrics.sameSlotBuyers ?? 'unknown'}`,
    `bundle ${metrics.bundlePct?.toFixed(2) ?? 'unknown'}%`,
    `sniper ${metrics.sniperPct?.toFixed(2) ?? 'unknown'}%`,
    `insider ${insiderPct == null ? 'unknown' : `${insiderPct.toFixed(2)}%`}`,
    insiderDetail,
    `deployer prior tokens ${deployerPriorTokens ?? 'unknown'}, prior rugs ${deployerPriorRugs ?? 'unknown'}`,
  ].join('; ');

  return {
    ...base, status, bundlePct: metrics.bundlePct, sniperPct: metrics.sniperPct, insiderPct,
    sameSlotBuyers: metrics.sameSlotBuyers, firstBuyers: buys.length, firstBuyersPct: metrics.firstBuyersPct,
    deployer: deployer?.address ?? null, deployerSource: deployer?.source ?? null,
    deployerPriorTokens, deployerPriorRugs, detail,
  };
}

export function makeLaunchEvidenceSource(db: PrismaClient, rpc: SolanaRpc | null, opts: LaunchEvidenceOptions = {}): LaunchEvidenceSource | null {
  if (!rpc) return null;
  const nowOf = opts.now ?? (() => new Date());
  const maxPerRun = Math.max(1, Math.min(10, opts.maxPerRun ?? LAUNCH_EVIDENCE_LIMITS.maxPerRun));
  const cacheTtlMs = opts.cacheTtlMs ?? LAUNCH_EVIDENCE_LIMITS.cacheTtlMs;
  const unknownTtlMs = opts.unknownTtlMs ?? LAUNCH_EVIDENCE_LIMITS.unknownTtlMs;
  const scan = opts.scan ?? ((mint: string, now: Date) => scanLaunch(db, rpc, mint, now));
  let used = 0;

  return {
    begin() { used = 0; },
    async get(mint, at) {
      const now = at ?? nowOf();
      const key = cacheKey(mint);
      const row = await db.systemSetting.findUnique({ where: { key } });
      const cached = row?.value as { observedAt?: unknown; status?: unknown } | null;
      if (cached && typeof cached.observedAt === 'string') {
        const age = +now - Date.parse(cached.observedAt);
        const ttl = cached.status === 'UNKNOWN' ? unknownTtlMs : cacheTtlMs;
        if (Number.isFinite(age) && age >= 0 && age <= ttl) return cached as unknown as LaunchEvidence;
      }
      if (used >= maxPerRun) return null;
      used++;
      try {
        const evidence = await scan(mint, now);
        await db.systemSetting.upsert({ where: { key }, create: { key, value: evidence as unknown as Prisma.InputJsonValue }, update: { value: evidence as unknown as Prisma.InputJsonValue } });
        return evidence;
      } catch {
        return null;
      }
    },
  };
}
