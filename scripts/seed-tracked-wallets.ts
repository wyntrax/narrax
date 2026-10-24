/**
 * Seeds the tracked-wallet set from early buyers this system already captured on-chain. This exists because discovery
 * cannot emit its first candidate until a wallet has been early in 2+ *winner* tokens (DISCOVERY.minWinnerTokens), and
 * the Helius webhook is not created at all while the tracked set is empty. Discovery can bootstrap later, but this
 * provides an explicit operator-selected starting set. These are observed buyers, NOT proven smart money.
 * They are created PROVISIONAL and are never eligible for research flow signals until an operator reviews them
 * and their current history/activity evidence independently qualifies (see packages/smart-money/src/qualification.ts).
 *
 *   npm run wallets:seed                          report only: what would be added
 *   npm run wallets:seed -- --apply               create/reactivate the selected wallets
 *   npm run wallets:seed -- --apply --limit 8     pick how many (default 10)
 *   npm run wallets:seed -- --min-tokens 3        require early in this many scanned tokens (default 2)
 *
 * Wallets are never deleted, only deactivated, so trade history is kept. Needs DATABASE_URL in the environment
 * (this script does not read .env files).
 */
import { parseArgs } from 'node:util';
import { createPrisma } from '@narra/database';
import { isSolanaAddress } from '@narra/shared';

const LABEL = 'early-buyer seed';

async function main() {
  const { values } = parseArgs({ options: { apply: { type: 'boolean' }, limit: { type: 'string' }, 'min-tokens': { type: 'string' } } });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const limit = Math.max(1, Math.min(100, Number(values.limit ?? 10) || 10));
  const minTokens = Math.max(1, Number(values['min-tokens'] ?? 2) || 2);
  const db = createPrisma();

  try {
    const rows = await db.tokenEarlyBuyers.findMany({ where: { complete: true, token: { blacklisted: false } }, select: { buyers: true, token: { select: { symbol: true } } } });
    const agg = new Map<string, { tokens: number; bestRank: number; symbols: Set<string> }>();
    for (const r of rows) {
      const buyers = Array.isArray(r.buyers) ? r.buyers : [];
      const seen = new Set<string>();
      for (const b of buyers) {
        const w = b as { wallet?: unknown; rank?: unknown };
        if (typeof w.wallet !== 'string' || !isSolanaAddress(w.wallet) || typeof w.rank !== 'number' || !Number.isInteger(w.rank) || w.rank < 1 || seen.has(w.wallet)) continue;
        seen.add(w.wallet);
        const cur = agg.get(w.wallet) ?? { tokens: 0, bestRank: Number.POSITIVE_INFINITY, symbols: new Set<string>() };
        cur.tokens += 1;
        cur.bestRank = Math.min(cur.bestRank, w.rank);
        if (r.token.symbol) cur.symbols.add(r.token.symbol);
        agg.set(w.wallet, cur);
      }
    }

    const selected = [...agg]
      .map(([address, v]) => ({ address, tokens: v.tokens, bestRank: v.bestRank, symbols: [...v.symbols] }))
      .filter((c) => c.tokens >= minTokens)
      .sort((a, b) => b.tokens - a.tokens || a.bestRank - b.bestRank)
      .slice(0, limit);

    if (!selected.length) {
      console.log(JSON.stringify({ scannedTokens: rows.length, selected: 0, message: `no wallet was early in ${minTokens}+ scanned tokens yet; let the worker run longer` }, null, 2));
      return;
    }

    console.log(JSON.stringify({ apply: !!values.apply, scannedTokens: rows.length, minTokens, limit, selected }, null, 2));
    if (!values.apply) {
      console.log(`\nReport only. Re-run with --apply to track these ${selected.length} wallets.`);
      return;
    }

    const addresses = selected.map((s) => s.address);
    const existing = await db.trackedWallet.findMany({ where: { address: { in: addresses } }, select: { id: true, address: true, active: true } });
    const known = new Set(existing.map((e) => e.address));
    const fresh = selected.filter((s) => !known.has(s.address));
    const revive = existing.filter((e) => !e.active);
    await db.$transaction([
      ...(fresh.length ? [db.trackedWallet.createMany({ data: fresh.map((s) => ({ address: s.address, label: LABEL, source: 'MANUAL' as const })) })] : []),
      ...(revive.length ? [db.trackedWallet.updateMany({ where: { id: { in: revive.map((r) => r.id) } }, data: { active: true } })] : []),
    ]);

    const active = await db.trackedWallet.count({ where: { active: true } });
    console.log(JSON.stringify({ added: fresh.length, reactivated: revive.length, alreadyTracked: existing.length - revive.length, activeNow: active }, null, 2));
    console.log('The wallet-sync job creates the Helius webhook from the active set on its next run (or POST /v1/admin/wallets/sync).');
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(`Wallet seed failed: ${(e as Error).message}`.slice(0, 200)); process.exitCode = 1; });
