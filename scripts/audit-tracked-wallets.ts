/**
 * Read-only audit of the tracked wallet list behind Smart Money. Prints what is in the table and which rows cannot
 * be real (not a 32-byte key) or look like leftover test data. It changes nothing: the connection is forced
 * read-only, and clean-up is a separate, deliberate step (deactivate in the admin wallet screen).
 *
 *   npm run wallets:audit                      summary + the first 50 suspect rows
 *   npm run wallets:audit -- --all             every suspect row
 *   npm run wallets:audit -- --rpc             also ask the Solana RPC whether valid-but-untraded wallets have ever had activity
 *
 * Needs DATABASE_URL (this script does not read .env files). --rpc needs HELIUS_RPC_URL or SOLANA_RPC_URL in the
 * environment. The URL is never printed because it can contain an API key.
 */
import { parseArgs } from 'node:util';
import { createPrisma } from '@narra/database';
import { classifyWallet, summarizeWallets, type WalletClass } from './audit-tracked-wallets-core';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function hasOnChainActivity(rpcUrl: string, address: string): Promise<'FOUND' | 'NONE' | 'ERROR'> {
  try {
    const res = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [address, { limit: 1 }] }), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return 'ERROR';
    const body = (await res.json()) as { result?: unknown[]; error?: unknown };
    if (body.error || !Array.isArray(body.result)) return 'ERROR';
    return body.result.length > 0 ? 'FOUND' : 'NONE';
  } catch { return 'ERROR'; }
}

async function main() {
  const { values } = parseArgs({ options: { all: { type: 'boolean' }, rpc: { type: 'boolean' }, 'rpc-max': { type: 'string' }, inactive: { type: 'boolean' } } });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const url = new URL(process.env.DATABASE_URL);
  // Applied to every connection, so PostgreSQL itself rejects any write.
  url.searchParams.set('options', '-c default_transaction_read_only=on');
  const db = createPrisma(url.toString());
  try {
    const mode = await db.$queryRaw<{ default_transaction_read_only: string }[]>`SHOW default_transaction_read_only`;
    if (mode[0]?.default_transaction_read_only !== 'on') throw new Error('Read-only connection required');

    const rows: { address: string; label: string | null; source: string; active: boolean; researchReview: string; createdAt: Date; trades: number; lastTradeAt: Date | null; hasProfile: boolean; class: WalletClass; reasons: string[] }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await db.trackedWallet.findMany({
        where: values.inactive ? {} : { active: true }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, address: true, label: true, source: true, active: true, researchReview: true, createdAt: true, profile: { select: { id: true } }, trades: { orderBy: { at: 'desc' }, take: 1, select: { at: true } }, _count: { select: { trades: true } } },
      });
      if (!page.length) break;
      for (const w of page) {
        const c = classifyWallet({ address: w.address, label: w.label, source: w.source, createdAt: w.createdAt, trades: w._count.trades });
        rows.push({ address: w.address, label: w.label, source: w.source, active: w.active, researchReview: w.researchReview, createdAt: w.createdAt, trades: w._count.trades, lastTradeAt: w.trades[0]?.at ?? null, hasProfile: !!w.profile, class: c.class, reasons: c.reasons });
      }
      cursor = page[page.length - 1]!.id;
    }

    const summary = summarizeWallets(rows);
    const suspect = rows.filter((r) => r.class !== 'ACTIVE_TRADES');
    console.log(JSON.stringify({ readOnly: true, scope: values.inactive ? 'all wallets' : 'active wallets', ...summary, withProfile: rows.filter((r) => r.hasProfile).length, researchReview: { approved: rows.filter((r) => r.researchReview === 'APPROVED').length, provisional: rows.filter((r) => r.researchReview === 'PROVISIONAL').length, rejected: rows.filter((r) => r.researchReview === 'REJECTED').length } }, null, 2));

    const rpcUrl = process.env.HELIUS_RPC_URL || process.env.SOLANA_RPC_URL;
    const rpcResults = new Map<string, string>();
    if (values.rpc) {
      if (!rpcUrl) console.error('--rpc needs HELIUS_RPC_URL or SOLANA_RPC_URL in the environment; skipped.');
      else {
        const max = Math.max(1, Math.min(500, Number(values['rpc-max'] ?? 100) || 100));
        for (const r of suspect.filter((x) => x.class === 'NO_TRADES_RECORDED').slice(0, max)) { rpcResults.set(r.address, await hasOnChainActivity(rpcUrl, r.address)); await sleep(150); }
      }
    }

    const limit = values.all ? Infinity : 50;
    console.log(`\nSuspect rows (${suspect.length}${suspect.length > limit ? `, showing ${limit}` : ''}). NOT_A_SOLANA_ADDRESS can never appear on Solscan. LOOKS_LIKE_TEST_DATA is a heuristic. NO_TRADES_RECORDED only means this system has seen no trades.`);
    for (const r of suspect.slice(0, limit)) console.log(JSON.stringify({ class: r.class, address: r.address, label: r.label, source: r.source, active: r.active, researchReview: r.researchReview, createdAt: r.createdAt.toISOString(), trades: r.trades, ...(rpcResults.has(r.address) ? { onChain: rpcResults.get(r.address) } : {}), reasons: r.reasons }));
    console.log('\nNothing was changed. To remove a row from Smart Money, deactivate it in the admin wallet screen (PATCH /v1/admin/wallets/:address with active:false). History is kept.');
  } finally { await db.$disconnect(); }
}
main().catch((e) => { console.error(`Wallet audit failed: ${(e as Error).message}`.slice(0, 200)); process.exitCode = 1; });
