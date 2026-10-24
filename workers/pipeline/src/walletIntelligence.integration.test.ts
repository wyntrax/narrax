import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { recomputeWalletIntelligence } from './walletIntelligence';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "User" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('wallet intelligence on a real Postgres', () => {
  const db = createPrisma(url);
  const tag = `wi${Date.now()}`;
  const NOW = new Date('2026-09-30T12:00:00Z');
  const addr = (s: string) => `${s}${tag}`.padEnd(40, '1');
  const ids: Record<string, string> = {};
  const tokenIds: string[] = [];
  let tx = '';
  let n = 0;

  const trade = (wallet: string, token: string, side: 'BUY' | 'SELL', sol: number, qty: number, at: Date) =>
    db.walletTrade.create({ data: { walletId: ids[wallet]!, tokenId: token, side, amountSol: sol, tokenAmount: qty, signature: `${tag}-${++n}`, at } });

  beforeAll(async () => {
    for (const w of ['A', 'B', 'C', 'D']) ids[w] = (await db.trackedWallet.create({ data: { address: addr(w) } })).id;
    for (let i = 0; i < 20; i++) tokenIds.push((await db.token.create({ data: { mint: addr(`T${i}`), symbol: `T${i}`, name: 'x' } })).id);
    tx = (await db.token.create({ data: { mint: addr('TX'), symbol: 'TX', name: 'x' } })).id;

    for (let i = 0; i < 20; i++) {
      const base = new Date(NOW.getTime() - (25 - i) * 86_400_000 / 2); // spread over ~12 days
      const sell = i === 19 ? 0.5 : 2; // one loser out of twenty
      const t = tokenIds[i]!;
      const min = (m: number, s = 0) => new Date(base.getTime() + m * 60_000 + s * 1000);
      await trade('A', t, 'BUY', 1, 100, min(0)); await trade('A', t, 'SELL', sell, 100, min(30));
      await trade('B', t, 'BUY', 1, 100, min(5)); await trade('B', t, 'SELL', sell, 100, min(35));
      await trade('C', t, 'BUY', 1, 100, min(5, 20)); await trade('C', t, 'SELL', sell, 100, min(36));
    }
    await trade('D', tokenIds[0]!, 'BUY', 1, 100, new Date(NOW.getTime() - 3 * 86_400_000));
    await trade('D', tokenIds[0]!, 'SELL', 2, 100, new Date(NOW.getTime() - 3 * 86_400_000 + 600_000));
    // Recent buys of one token by A, B and C, inside the consensus window.
    await trade('A', tx, 'BUY', 2, 50, new Date(NOW.getTime() - 10 * 60_000));
    await trade('B', tx, 'BUY', 1, 50, new Date(NOW.getTime() - 9 * 60_000));
    await trade('C', tx, 'BUY', 1, 50, new Date(NOW.getTime() - 9 * 60_000 + 15_000));
  });
  afterAll(async () => { await db.$disconnect(); });

  it('scores, labels and links the wallets from their trades', async () => {
    const r = await recomputeWalletIntelligence(db, NOW);
    expect(r.walletsScored).toBeGreaterThanOrEqual(3);

    const prof = async (w: string) => db.walletProfile.findUnique({ where: { walletId: ids[w]! } });
    const [a, b, c, d] = [await prof('A'), await prof('B'), await prof('C'), await prof('D')];
    expect(a!.score).toBeGreaterThan(60);
    expect(a!.leaderScore).toBeGreaterThan(75);
    expect(a!.style).toBe('NARRATIVE_LEADER');
    expect(b!.style).toBe('FOLLOWER');
    expect(c!.style).toBe('FOLLOWER');
    expect(d).toBeNull(); // one closed trade is not enough to score
    const progress = await db.systemSetting.findUniqueOrThrow({ where: { key: `wallet.intelligence.${ids.D}` } });
    expect(progress.value).toMatchObject({ status: 'INSUFFICIENT_HISTORY', closedTrades: 1, requiredClosedTrades: 5 });

    const m = await db.walletMetric.findFirst({ where: { walletId: ids.A! }, orderBy: { computedAt: 'desc' } });
    expect(m).toMatchObject({ window: '30D', closedTrades: 20 });
    expect(m!.winRate).toBeCloseTo(0.95);
    expect(Number(m!.pnlSol)).toBeCloseTo(19 * 1 - 0.5);
  });

  it('puts B and C in one timing cluster with MEDIUM confidence and a stored relationship', async () => {
    const load = (w: string) => db.trackedWallet.findUniqueOrThrow({ where: { id: ids[w]! }, include: { cluster: true } });
    const b = await load('B');
    const c = await load('C');
    const a = await load('A');
    expect(b.clusterId).toBeTruthy();
    expect(b.clusterId).toBe(c.clusterId);
    expect(b.cluster).toMatchObject({ label: 'timing', confidence: 'MEDIUM' });
    expect(a.clusterId).toBeNull();
    const rel = await db.walletRelationship.findMany({ where: { kind: 'TIMING', fromId: { in: [ids.B!, ids.C!] } } });
    expect(rel).toHaveLength(1);
    expect(rel[0]).toMatchObject({ confidence: 'MEDIUM' });
  });

  it('writes a consensus signal that counts the cluster once', async () => {
    const s = await db.consensusSignal.findFirst({ where: { tokenId: tx }, orderBy: { at: 'desc' } });
    expect(s).toMatchObject({ walletCount: 3, independentEntities: 2, leaderCount: 1 });
    expect(Number(s!.netFlowSol)).toBeCloseTo(4);
    expect(s!.score).toBeGreaterThan(30);
  });

  it('is repeatable: running again replaces clusters instead of duplicating them', async () => {
    await recomputeWalletIntelligence(db, NOW);
    const clusters = await db.walletCluster.findMany({ where: { label: 'timing', wallets: { some: { id: ids.B! } } } });
    expect(clusters).toHaveLength(1);
    expect(await db.walletRelationship.count({ where: { kind: 'TIMING', fromId: { in: [ids.B!, ids.C!] } } })).toBe(1);
  });

  it('drops the profile of a wallet that no longer has enough trades', async () => {
    await recomputeWalletIntelligence(db, new Date(NOW.getTime() + 60 * 86_400_000)); // everything is now outside the 30-day window
    expect(await db.walletProfile.findUnique({ where: { walletId: ids.A! } })).toBeNull();
  });
});
