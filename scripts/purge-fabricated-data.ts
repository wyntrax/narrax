/**
 * Removes fabricated rows that integration tests wrote into the application database before the vitest isolation guard
 * existed. A row is fabricated when an address cannot be a real Solana key: a mint or wallet address that does not
 * decode to exactly 32 bytes can never exist on chain, so only test fixtures produce one. Real tokens, narratives,
 * creators and mention rows are never touched.
 *
 * This is destructive, so it is a deliberate, separate step. It prints the plan and changes nothing by default.
 *
 *   npm run data:purge-fabricated            report only (no writes)
 *   npm run data:purge-fabricated -- --apply write a JSON backup, then delete
 *
 * Needs DATABASE_URL. The backup is written next to the repo under backups/ before any delete runs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createPrisma } from '@narra/database';
import { isSolanaAddress } from '@narra/shared';

async function main() {
  const { values } = parseArgs({ options: { apply: { type: 'boolean' }, out: { type: 'string' } } });
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const db = createPrisma();
  try {
    const tokens = await db.token.findMany({ select: { id: true, mint: true, symbol: true, name: true } });
    const wallets = await db.trackedWallet.findMany({ select: { id: true, address: true, label: true, source: true } });
    const fabricatedTokens = tokens.filter((t) => !isSolanaAddress(t.mint));
    const fabricatedWallets = wallets.filter((w) => !isSolanaAddress(w.address));
    const badTokenIds = fabricatedTokens.map((t) => t.id);
    const badTokenMints = fabricatedTokens.map((t) => t.mint);
    const badWalletIds = fabricatedWallets.map((w) => w.id);
    const badWalletAddresses = fabricatedWallets.map((w) => w.address);
    // Alerts are not foreign-keyed, so a token removed by an earlier clean-up can leave an alert pointing at nothing.
    const allTokenIds = tokens.map((t) => t.id);
    const danglingTokenAlerts = await db.alert.count({ where: { refType: 'TOKEN', refId: { notIn: allTokenIds } } });

    const counts = {
      tokens: fabricatedTokens.length,
      tokensKept: tokens.length - fabricatedTokens.length,
      trackedWallets: fabricatedWallets.length,
      trackedWalletsKept: wallets.length - fabricatedWallets.length,
      opportunities: badTokenIds.length ? await db.opportunity.count({ where: { tokenId: { in: badTokenIds } } }) : 0,
      walletTrades: badTokenIds.length || badWalletIds.length ? await db.walletTrade.count({ where: { OR: [{ walletId: { in: badWalletIds } }, { tokenId: { in: badTokenIds } }] } }) : 0,
      orders: badTokenIds.length ? await db.order.count({ where: { tokenId: { in: badTokenIds } } }) : 0,
      walletProfiles: badWalletIds.length ? await db.walletProfile.count({ where: { walletId: { in: badWalletIds } } }) : 0,
      walletMetrics: badWalletIds.length ? await db.walletMetric.count({ where: { walletId: { in: badWalletIds } } }) : 0,
      tokenMetrics: badTokenIds.length ? await db.tokenMetric.count({ where: { tokenId: { in: badTokenIds } } }) : 0,
      consensusSignals: badTokenIds.length ? await db.consensusSignal.count({ where: { tokenId: { in: badTokenIds } } }) : 0,
      danglingTokenAlerts,
    };
    console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'report', fabricated: { tokens: fabricatedTokens.slice(0, 10).map((t) => `${t.symbol} ${t.mint}`), wallets: fabricatedWallets.slice(0, 10).map((w) => w.address) }, counts }, null, 2));

    const total = counts.opportunities + counts.walletTrades + counts.orders + counts.walletProfiles + counts.walletMetrics + counts.tokenMetrics + counts.consensusSignals + counts.tokens + counts.trackedWallets + counts.danglingTokenAlerts;
    if (!total) { console.log('\nNothing to remove. The database has no fabricated rows.'); return; }
    if (!values.apply) { console.log('\nReport only. Re-run with --apply to back up and delete these rows.'); return; }

    // 1. Back up everything that is about to be removed. A partial backup is worse than none, so it is written before any delete.
    const opportunityIds = badTokenIds.length ? (await db.opportunity.findMany({ where: { tokenId: { in: badTokenIds } }, select: { id: true } })).map((o) => o.id) : [];
    const orderIds = badTokenIds.length ? (await db.order.findMany({ where: { tokenId: { in: badTokenIds } }, select: { id: true } })).map((o) => o.id) : [];
    const analysisIds = opportunityIds.length ? (await db.agentAnalysis.findMany({ where: { opportunityId: { in: opportunityIds } }, select: { id: true } })).map((a) => a.id) : [];
    const backup = {
      generatedAt: new Date().toISOString(),
      database: new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ''),
      fabricatedTokens, fabricatedWallets,
      token: fabricatedTokens,
      trackedWallet: fabricatedWallets,
      opportunity: opportunityIds.length ? await db.opportunity.findMany({ where: { id: { in: opportunityIds } } }) : [],
      agentAnalysis: analysisIds.length ? await db.agentAnalysis.findMany({ where: { id: { in: analysisIds } } }) : [],
      agentDecision: analysisIds.length ? await db.agentDecision.findMany({ where: { analysisId: { in: analysisIds } } }) : [],
      order: orderIds.length ? await db.order.findMany({ where: { id: { in: orderIds } } }) : [],
      trade: orderIds.length ? await db.trade.findMany({ where: { orderId: { in: orderIds } } }) : [],
      walletTrade: badWalletIds.length ? await db.walletTrade.findMany({ where: { walletId: { in: badWalletIds } } }) : [],
      walletProfile: badWalletIds.length ? await db.walletProfile.findMany({ where: { walletId: { in: badWalletIds } } }) : [],
      walletMetric: badWalletIds.length ? await db.walletMetric.findMany({ where: { walletId: { in: badWalletIds } } }) : [],
      walletRelationship: badWalletIds.length ? await db.walletRelationship.findMany({ where: { OR: [{ fromId: { in: badWalletIds } }, { toId: { in: badWalletIds } }] } }) : [],
      tokenMetric: badTokenIds.length ? await db.tokenMetric.findMany({ where: { tokenId: { in: badTokenIds } } }) : [],
      tokenHolderMetric: badTokenIds.length ? await db.tokenHolderMetric.findMany({ where: { tokenId: { in: badTokenIds } } }) : [],
      tokenRiskMetric: badTokenIds.length ? await db.tokenRiskMetric.findMany({ where: { tokenId: { in: badTokenIds } } }) : [],
      consensusSignal: badTokenIds.length ? await db.consensusSignal.findMany({ where: { tokenId: { in: badTokenIds } } }) : [],
      narrativeTokenRelation: badTokenIds.length ? await db.narrativeTokenRelation.findMany({ where: { tokenId: { in: badTokenIds } } }) : [],
      alert: await db.alert.findMany({ where: { OR: [{ refType: 'TOKEN', refId: { in: badTokenIds } }, { refType: 'TOKEN', refId: { notIn: allTokenIds } }] } }),
    };
    const dir = resolve(values.out ?? join(process.cwd(), 'backups'));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `fabricated-data-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(backup, null, 1));
    console.log(`\nBacked up to ${file}`);

    // 2. Delete children before parents, so the RESTRICT edges (Order/Trade, WalletTrade, Position) never block a delete.
    await db.$transaction([
      db.trade.deleteMany({ where: { orderId: { in: orderIds } } }),
      db.walletTrade.deleteMany({ where: { OR: [{ walletId: { in: badWalletIds } }, { tokenId: { in: badTokenIds } }] } }),
      db.smartMoneySignal.deleteMany({ where: { OR: [{ walletId: { in: badWalletIds } }, { tokenId: { in: badTokenIds } }] } }),
      db.order.deleteMany({ where: { tokenId: { in: badTokenIds } } }),
      db.position.deleteMany({ where: { tokenId: { in: badTokenIds } } }),
      db.opportunity.deleteMany({ where: { tokenId: { in: badTokenIds } } }),
      db.tokenEarlyBuyers.deleteMany({ where: { tokenId: { in: badTokenIds } } }),
      db.narrativeTokenRelation.deleteMany({ where: { tokenId: { in: badTokenIds } } }),
      db.tokenMetric.deleteMany({ where: { tokenId: { in: badTokenIds } } }),
      db.tokenHolderMetric.deleteMany({ where: { tokenId: { in: badTokenIds } } }),
      db.tokenRiskMetric.deleteMany({ where: { tokenId: { in: badTokenIds } } }),
      db.consensusSignal.deleteMany({ where: { tokenId: { in: badTokenIds } } }),
      db.trackedWallet.deleteMany({ where: { id: { in: badWalletIds } } }),
      db.token.deleteMany({ where: { id: { in: badTokenIds } } }),
      db.walletCandidate.deleteMany({ where: { address: { in: badWalletAddresses } } }),
      db.tokenMention.deleteMany({ where: { ref: { in: badTokenMints } } }),
      // Alerts are not foreign-keyed, so remove the ones for the tokens just deleted and any left dangling by an earlier clean-up.
      db.$executeRawUnsafe(`delete from "Alert" where "refType" = 'TOKEN' and "refId" not in (select id from "Token")`),
    ], { timeout: 120_000 });
    console.log(JSON.stringify({ removed: counts }, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch((e) => { console.error(`Fabricated-data purge failed: ${(e as Error).message}`.slice(0, 300)); process.exitCode = 1; });
