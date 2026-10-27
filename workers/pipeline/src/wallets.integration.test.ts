import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import type { ParsedTx, SignatureInfo } from '@narra/solana';
import { DISCOVERY_LIMITS, discoverCandidates, scanEarlyBuyers } from './walletDiscovery';
import { FUNDING_LIMITS, ingestWalletFunding, rebuildFundingGraph, type HistoryPort } from './walletFunding';
import { SYNC_STATUS_SETTING, WEBHOOK_SETTING, syncWalletWebhook, type WebhookPort } from './walletSync';
import { makeWalletEventStore } from './prismaStores';
import { recomputeWalletIntelligence } from './walletIntelligence';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "WalletFunding" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('tracked wallets on a real Postgres', () => {
  const db = createPrisma(url);
  const tag = `tw${Date.now()}`;
  const NOW = new Date('2026-09-30T12:00:00Z');
  const H = 3_600_000;
  const addr = (s: string) => `${s}${tag}`.padEnd(40, '1');
  const ids: Record<string, string> = {};
  const WEBHOOK_URL = `https://api.example/${tag}/webhooks/helius`;
  const CFG = { webhookUrl: WEBHOOK_URL, authHeader: 'secret' };

  afterAll(async () => {
    // Shared tables: remove what this file created so later runs and other files see no leftovers.
    await db.tokenEarlyBuyers.deleteMany({ where: { token: { mint: { contains: tag } } } });
    await db.walletCandidate.deleteMany({ where: { address: { contains: tag } } });
    await db.trackedWallet.deleteMany({ where: { address: { contains: tag } } }); // cascades trades, funding and relationships
    await db.walletCluster.deleteMany({ where: { label: 'funding', wallets: { none: {} } } });
    await db.$disconnect();
  });

  // ---------- webhook sync ----------
  describe('webhook sync', () => {
    const hook = (over: Record<string, unknown> = {}) => ({ webhookID: `hook-${tag}`, webhookURL: WEBHOOK_URL, transactionTypes: ['SWAP'], accountAddresses: [] as string[], active: true, ...over });
    const port = (existing: ReturnType<typeof hook>[], calls: string[] = []) => {
      const p: WebhookPort & { sent: unknown[] } = {
        sent: [],
        list: async () => { calls.push('list'); return existing; },
        create: async (spec) => { calls.push('create'); p.sent.push(spec); return hook({ accountAddresses: spec.accountAddresses }); },
        update: async (id, spec) => { calls.push(`update:${id}`); p.sent.push(spec); return hook({ accountAddresses: spec.accountAddresses }); },
      };
      return p;
    };
    const mine = async () => (await db.trackedWallet.findMany({ where: { active: true }, select: { address: true } })).map((w) => w.address);

    beforeAll(async () => {
      await db.trackedWallet.create({ data: { address: addr('S1') } });
      await db.trackedWallet.create({ data: { address: addr('S2'), active: false } });
    });

    it('creates the webhook with exactly the active wallets and remembers its id', async () => {
      const calls: string[] = [];
      const p = port([], calls);
      const r = await syncWalletWebhook(db, p, CFG, NOW);
      expect(r).toMatchObject({ action: 'created', webhookId: `hook-${tag}` });
      expect(calls).toEqual(['list', 'create']);
      const spec = p.sent[0] as { accountAddresses: string[]; transactionTypes: string[]; authHeader: string };
      expect(spec.accountAddresses).toContain(addr('S1'));
      expect(spec.accountAddresses).not.toContain(addr('S2'));
      expect(spec).toMatchObject({ transactionTypes: ['SWAP'], authHeader: 'secret' });
      expect((await db.systemSetting.findUnique({ where: { key: WEBHOOK_SETTING } }))!.value).toEqual({ id: `hook-${tag}` });
    });

    it('does nothing when the webhook already matches', async () => {
      const calls: string[] = [];
      const r = await syncWalletWebhook(db, port([hook({ accountAddresses: await mine() })], calls), CFG, NOW);
      expect(r).toMatchObject({ action: 'in_sync', added: 0, removed: 0 });
      expect(calls).toEqual(['list']);
    });

    it('edits only when addresses differ, and reports what changed', async () => {
      const calls: string[] = [];
      const current = (await mine()).filter((a) => a !== addr('S1')).concat(['StaleWallet'.padEnd(40, '9')]);
      const p = port([hook({ accountAddresses: current })], calls);
      const r = await syncWalletWebhook(db, p, CFG, NOW);
      expect(r).toMatchObject({ action: 'updated', added: 1, removed: 1 });
      expect(calls).toEqual(['list', `update:hook-${tag}`]);
      expect((p.sent[0] as { accountAddresses: string[] }).accountAddresses).toContain(addr('S1'));
    });

    it('adopts an existing webhook with the same URL, and reports one that Helius has disabled without toggling it', async () => {
      await db.systemSetting.delete({ where: { key: WEBHOOK_SETTING } });
      const calls: string[] = [];
      const r = await syncWalletWebhook(db, port([hook({ webhookID: 'other-id', accountAddresses: await mine(), active: false })], calls), CFG, NOW);
      expect(r).toMatchObject({ action: 'in_sync', webhookId: 'other-id', webhookActive: false });
      expect(r.reason).toMatch(/disabled/);
      expect(calls).toEqual(['list']);
      expect((await db.systemSetting.findUnique({ where: { key: WEBHOOK_SETTING } }))!.value).toEqual({ id: 'other-id' });
    });

    it('records a provider error without throwing, and stores the last result for the admin endpoint', async () => {
      const broken: WebhookPort = { list: async () => { throw new Error('HTTP 500'); }, create: async () => { throw new Error('x'); }, update: async () => { throw new Error('x'); } };
      const r = await syncWalletWebhook(db, broken, CFG, NOW);
      expect(r).toMatchObject({ action: 'skipped', error: 'HTTP 500' });
      expect((await db.systemSetting.findUnique({ where: { key: SYNC_STATUS_SETTING } }))!.value).toMatchObject({ error: 'HTTP 500', at: NOW.toISOString() });
    });

    it('stops accepting swaps from a deactivated wallet', async () => {
      const store = makeWalletEventStore(db);
      expect(await store.isTracked(addr('S1'))).toBe(true);
      expect(await store.isTracked(addr('S2'))).toBe(false);
      const ev = { signature: `${tag}-sig`.padEnd(64, 'x'), wallet: addr('S2'), mint: addr('MINTX'), side: 'BUY' as const, amountSol: 1, tokenAmount: 5, at: NOW.toISOString() };
      expect(await store.saveWalletTrade(ev)).toBe('untracked');
    });
    it('keeps concurrent deliveries for a newly seen mint and deduplicates retries', async () => {
      const store = makeWalletEventStore(db);
      const events = Array.from({ length: 8 }, (_, i) => ({ signature: `${tag}-concurrent-${i}`.padEnd(64, 'x'), wallet: addr('S1'), mint: addr('RACE'), side: 'BUY' as const, amountSol: 1, tokenAmount: 5, at: NOW.toISOString() }));
      expect(await Promise.all(events.map(e => store.saveWalletTrade(e)))).toEqual(Array(8).fill('created'));
      expect(await Promise.all(events.map(e => store.saveWalletTrade(e)))).toEqual(Array(8).fill('duplicate'));
      expect(await db.walletTrade.count({ where: { signature: { in: events.map(e => e.signature) } } })).toBe(8);
    });
  });

  // ---------- funding graph and consensus ----------
  describe('funding', () => {
    const OUT = (s: string) => `Outside${s}${tag}`.padEnd(40, '8');
    const funders: Record<string, { from: string; lamports: number } | { dust: true } | 'never-ends'> = {};
    const tx = (wallet: string, from: string, lamports: number): ParsedTx => ({
      blockTime: 1_760_000_000,
      transaction: { message: { accountKeys: [{ pubkey: from }], instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: from, destination: wallet, lamports } } }] } },
      meta: { err: null, innerInstructions: [], preTokenBalances: [], postTokenBalances: [] },
    } as unknown as ParsedTx);
    let paged = 0;
    const rpc: HistoryPort = {
      getSignaturesForAddress: async (a): Promise<SignatureInfo[]> => {
        const f = funders[a];
        if (f === 'never-ends') return Array.from({ length: FUNDING_LIMITS.pageSize }, (_, i) => ({ signature: `${a}-p${paged++}-${i}`, blockTime: 1, failed: false }));
        return f ? [{ signature: `sig-${a}`, blockTime: 1_760_000_000, failed: false }] : [];
      },
      getParsedTransaction: async (sig) => {
        const a = sig.replace(/^sig-/, '');
        const f = funders[a];
        if (!f || f === 'never-ends') return null;
        return 'dust' in f ? tx(a, OUT('dust'), 5_000) : tx(a, f.from, f.lamports);
      },
    };

    beforeAll(async () => {
      for (const w of ['F1', 'F2', 'F3', 'G1', 'G2', 'H1', 'I1']) ids[w] = (await db.trackedWallet.create({ data: { address: addr(w) } })).id;
      funders[addr('F1')] = { from: OUT('x'), lamports: 2e9 };
      funders[addr('F2')] = { from: addr('F1'), lamports: 1e9 };       // funded by tracked F1: HIGH link
      funders[addr('F3')] = { from: OUT('y'), lamports: 1e9 };
      funders[addr('G1')] = { from: OUT('shared'), lamports: 1e9 };    // same outside funder: MEDIUM link
      funders[addr('G2')] = { from: OUT('shared'), lamports: 3e9 };
      funders[addr('H1')] = { dust: true };                            // dust only: not a funder
      funders[addr('I1')] = 'never-ends';                              // history too long to reach
    });

    it('records found, not-found and incomplete honestly', async () => {
      const walletIds = ['F1', 'F2', 'F3', 'G1', 'G2', 'H1', 'I1'].map((k) => ids[k]!);
      const r = await ingestWalletFunding(db, rpc, NOW, { walletIds, maxWallets: 100 });
      expect(r).toMatchObject({ checked: 7, found: 5, notFound: 1, incomplete: 1, errors: [] });
      const get = (k: string) => db.walletFunding.findUniqueOrThrow({ where: { walletId: ids[k]! } });
      expect(await get('F2')).toMatchObject({ status: 'FOUND', funder: addr('F1'), lamports: 1_000_000_000n });
      expect(await get('H1')).toMatchObject({ status: 'NOT_FOUND', funder: null });
      expect(await get('I1')).toMatchObject({ status: 'INCOMPLETE', funder: null });
    });

    it('does not re-check a wallet that already has a result, until the retry delay passes', async () => {
      const walletIds = ['F1', 'H1', 'I1'].map((k) => ids[k]!);
      expect((await ingestWalletFunding(db, rpc, NOW, { walletIds })).checked).toBe(0);
      expect((await ingestWalletFunding(db, rpc, new Date(NOW.getTime() + FUNDING_LIMITS.retryAfterMs + 1000), { walletIds })).checked).toBe(2); // H1 and I1, not the FOUND F1
    });

    it('builds a HIGH direct cluster and a MEDIUM shared-funder cluster, and replaces them on rebuild', async () => {
      const g = await rebuildFundingGraph(db);
      expect(g.clusters).toBeGreaterThanOrEqual(2);
      const load = (k: string) => db.trackedWallet.findUniqueOrThrow({ where: { id: ids[k]! }, include: { cluster: true } });
      const [f1, f2, f3, g1, g2, h1] = [await load('F1'), await load('F2'), await load('F3'), await load('G1'), await load('G2'), await load('H1')];
      expect(f1.clusterId).toBe(f2.clusterId);
      expect(f1.cluster).toMatchObject({ label: 'funding', confidence: 'HIGH' });
      expect(g1.clusterId).toBe(g2.clusterId);
      expect(g1.cluster).toMatchObject({ label: 'funding', confidence: 'MEDIUM' });
      expect(f3.clusterId).toBeNull();
      expect(h1.clusterId).toBeNull();
      const rel = await db.walletRelationship.findMany({ where: { kind: 'FUNDING', fromId: { in: [ids.F1!, ids.G1!, ids.G2!] } } });
      expect(rel.map((r) => [r.confidence, (r.evidence as { type: string }).type]).sort()).toEqual([['HIGH', 'direct'], ['MEDIUM', 'shared_funder']]);
      const before = await db.walletCluster.count({ where: { label: 'funding' } });
      await rebuildFundingGraph(db);
      expect(await db.walletCluster.count({ where: { label: 'funding' } })).toBe(before); // replaced, not duplicated
    });

    it('treats a service funder as noise: more wallets than the fan-out limit, or an ignored address', async () => {
      await db.systemSetting.upsert({ where: { key: 'wallets.funderIgnore' }, create: { key: 'wallets.funderIgnore', value: [OUT('shared')] }, update: { value: [OUT('shared')] } });
      await rebuildFundingGraph(db);
      expect((await db.trackedWallet.findUniqueOrThrow({ where: { id: ids.G1! } })).clusterId).toBeNull();
      await db.systemSetting.delete({ where: { key: 'wallets.funderIgnore' } });
      await rebuildFundingGraph(db);
      expect((await db.trackedWallet.findUniqueOrThrow({ where: { id: ids.G1! } })).clusterId).not.toBeNull();
    });

    it('counts wallets in a funding cluster once in smart money consensus', async () => {
      // Three equally strong wallets that never trade within a minute of each other, so timing finds no link.
      const tokenIds: string[] = [];
      for (let i = 0; i < 20; i++) tokenIds.push((await db.token.create({ data: { mint: addr(`CT${i}`), symbol: `C${i}`, name: 'x' } })).id);
      const live = (await db.token.create({ data: { mint: addr('CLIVE'), symbol: 'LIVE', name: 'x' } })).id;
      let n = 0;
      const trade = (w: string, token: string, side: 'BUY' | 'SELL', sol: number, at: Date) =>
        db.walletTrade.create({ data: { walletId: ids[w]!, tokenId: token, side, amountSol: sol, tokenAmount: 100, signature: `${tag}-c${++n}`, at } });
      for (let i = 0; i < 20; i++) {
        const base = new Date(NOW.getTime() - (25 - i) * 43_200_000);
        for (const [w, offset] of [['F1', 0], ['F2', 10], ['F3', 20]] as const) {
          await trade(w, tokenIds[i]!, 'BUY', 1, new Date(base.getTime() + offset * 60_000));
          await trade(w, tokenIds[i]!, 'SELL', i === 19 ? 0.5 : 2, new Date(base.getTime() + (offset + 30) * 60_000));
        }
      }
      await trade('F1', live, 'BUY', 2, new Date(NOW.getTime() - 10 * 60_000));
      await trade('F2', live, 'BUY', 2, new Date(NOW.getTime() - 9 * 60_000));
      await trade('F3', live, 'BUY', 2, new Date(NOW.getTime() - 8 * 60_000));

      await recomputeWalletIntelligence(db, NOW);
      const sig = await db.consensusSignal.findFirstOrThrow({ where: { tokenId: live }, orderBy: { at: 'desc' } });
      expect(sig.walletCount).toBe(3);
      expect(sig.independentEntities).toBe(2); // F1 and F2 share a funding cluster; F3 stands alone
      // The funding cluster survived the timing recompute.
      expect((await db.trackedWallet.findUniqueOrThrow({ where: { id: ids.F1! }, include: { cluster: true } })).cluster?.label).toBe('funding');
    });

    it('leaves a deactivated wallet out of scores and clusters but keeps its history', async () => {
      await db.trackedWallet.update({ where: { id: ids.F3! }, data: { active: false } });
      // One minute later, so this run's signal is unambiguously the newest (two signals stamped the same instant would tie).
      const later = new Date(NOW.getTime() + 60_000);
      await recomputeWalletIntelligence(db, later);
      const live = (await db.token.findUniqueOrThrow({ where: { mint: addr('CLIVE') } })).id;
      const sig = await db.consensusSignal.findFirstOrThrow({ where: { tokenId: live }, orderBy: { at: 'desc' } });
      expect(sig.at.getTime()).toBe(later.getTime());
      expect(sig.walletCount).toBe(2);
      expect(await db.walletTrade.count({ where: { walletId: ids.F3! } })).toBeGreaterThan(0);
      await db.trackedWallet.update({ where: { id: ids.F3! }, data: { active: true } });
    });
  });

  // ---------- discovery ----------
  describe('discovery', () => {
    const tokenId: Record<string, string> = {};
    const W = (s: string) => addr(`W${s}`);
    const buyer = (wallet: string, rank: number) => ({ wallet, rank });
    const metric = (tokenId: string, price: number, liquidity: number, at: Date) => db.tokenMetric.create({ data: { tokenId, priceUsd: price, marketCapUsd: 1e6, liquidityUsd: liquidity, volume24hUsd: 1e5, at } });

    beforeAll(async () => {
      await db.trackedWallet.create({ data: { address: W('TRACKED') } });
      const mk = async (key: string, ageHours: number, first: number, last: number, extra: { honeypot?: boolean } = {}) => {
        const t = await db.token.create({ data: { mint: addr(`D${key}`), symbol: key, name: key, createdOnChainAt: new Date(NOW.getTime() - ageHours * H) } });
        tokenId[key] = t.id;
        await metric(t.id, first, 100_000, new Date(NOW.getTime() - 6 * H));
        await metric(t.id, last, 100_000, new Date(NOW.getTime() - 10 * 60_000));
        if (extra.honeypot) await db.tokenRiskMetric.create({ data: { tokenId: t.id, riskScore: 100, flags: ['HONEYPOT'], at: NOW } });
        return t;
      };
      const buyersOf: Record<string, string[]> = {
        // winners
        W1: [W('SKILLED'), W('BOT'), W('ONCE'), W('TRACKED')], W2: [W('SKILLED'), W('BOT'), W('TRACKED')], W3: [W('SKILLED'), W('BOT')],
        // losers the bot also bought
        ...Object.fromEntries(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'].map((k) => [k, [W('BOT')]])),
        // a honeypot that "ran", and a token too young to judge
        HP: [W('HPONLY'), W('SKILLED')], YOUNG: [W('YOUNGONLY'), W('SKILLED')],
      };
      for (const [key, buyers] of Object.entries(buyersOf)) {
        const winner = key.startsWith('W');
        const t = await mk(key, key === 'YOUNG' ? 0.2 : 10, 1, winner || key === 'HP' ? 5 : 0.5, { honeypot: key === 'HP' });
        await db.tokenEarlyBuyers.create({ data: { tokenId: t.id, complete: true, buyers: buyers.map((w, i) => buyer(w, i + 1)), scannedAt: NOW } });
      }
    });

    it('suggests the wallet that was early in several winners, marks down the bot, and skips tracked wallets', async () => {
      const r = await discoverCandidates(db, NOW);
      expect(r.winners).toBeGreaterThanOrEqual(3);
      const get = (k: string) => db.walletCandidate.findUnique({ where: { address: W(k) } });
      const skilled = (await get('SKILLED'))!, bot = (await get('BOT'))!;
      expect(skilled).toMatchObject({ status: 'PENDING', winnerTokens: 3 });
      expect(bot.winnerTokens).toBe(3);
      expect((bot.evidence as { hitRate: number }).hitRate).toBeCloseTo(3 / 9);
      expect(skilled.score).toBeGreaterThan(bot.score);
      expect(await get('ONCE')).toBeNull();      // one winner is not enough
      expect(await get('TRACKED')).toBeNull();   // already tracked
      expect(await get('HPONLY')).toBeNull();    // a flagged honeypot is never a winner
      expect(await get('YOUNGONLY')).toBeNull(); // too young to judge
    });

    it('never touches a reviewed suggestion', async () => {
      await db.walletCandidate.update({ where: { address: W('BOT') }, data: { status: 'REJECTED', score: 1 } });
      await discoverCandidates(db, NOW);
      expect(await db.walletCandidate.findUniqueOrThrow({ where: { address: W('BOT') } })).toMatchObject({ status: 'REJECTED', score: 1 });
    });

    it('scans a young token for first buyers, and records a token it cannot reach the start of as incomplete', async () => {
      const young = await db.token.create({ data: { mint: addr('SCAN1'), symbol: 'S1', name: 'x', createdOnChainAt: new Date(NOW.getTime() - 30 * 60_000) } });
      const busy = await db.token.create({ data: { mint: addr('SCAN2'), symbol: 'S2', name: 'x', createdOnChainAt: new Date(NOW.getTime() - 20 * 60_000) } });
      const old = await db.token.create({ data: { mint: addr('SCAN3'), symbol: 'S3', name: 'x', createdOnChainAt: new Date(NOW.getTime() - 10 * H) } });
      const bal = (owner: string, amount: string, mint: string) => ({ owner, mint, uiTokenAmount: { amount } });
      const parsed = (payer: string, pre: string, post: string, mint: string, err: unknown = null): ParsedTx => ({
        blockTime: 1, transaction: { message: { accountKeys: [{ pubkey: payer }], instructions: [] } },
        meta: { err, innerInstructions: [], preTokenBalances: [bal(payer, pre, mint)], postTokenBalances: [bal(payer, post, mint)] },
      } as unknown as ParsedTx);
      const A = addr('BUYA'), B = addr('BUYB');
      const purchase=parsed(A,'0','100',addr('SCAN1'));
      purchase.transaction.message.accountKeys=[A,'pool-token','buyer-token'];
      purchase.transaction.message.instructions=[{programId:'swap-program'}];
      purchase.meta!.preTokenBalances=[{...bal('pool','1000',addr('SCAN1')),accountIndex:1},{...bal(A,'0',addr('SCAN1')),accountIndex:2}];
      purchase.meta!.postTokenBalances=[{...bal('pool','900',addr('SCAN1')),accountIndex:1},{...bal(A,'100',addr('SCAN1')),accountIndex:2}];
      purchase.meta!.innerInstructions=[{index:0,instructions:[
        {programId:'11111111111111111111111111111111',parsed:{type:'transfer',info:{source:A,destination:'pool',lamports:30000}}},
        {programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',parsed:{type:'transfer',info:{source:'pool-token',destination:'buyer-token',amount:'100'}}},
      ]}];
      const calls: string[] = [];
      const transactions: string[] = [];
      const rpc: HistoryPort = {
        getSignaturesForAddress: async (a) => {
          calls.push(a);
          if (a === addr('SCAN2')) return Array.from({ length: DISCOVERY_LIMITS.pageSize }, (_, i) => ({ signature: `busy-${calls.length}-${i}`, blockTime: 1, failed: false }));
          return [{ signature: 'x4', blockTime: 4, failed: false }, { signature: 'x3', blockTime: 3, failed: false }, { signature: 'x2', blockTime: 2, failed: true }, { signature: 'x1', blockTime: 1, failed: false }];
        },
        getParsedTransaction: async (sig) => {transactions.push(sig);return ({ x1: purchase, x3: parsed(B, '0', '50', addr('SCAN1')), x4: parsed(A, '100', '300', addr('SCAN1')) } as Record<string, ParsedTx>)[sig] ?? null;},
      };
      const r = await scanEarlyBuyers(db, rpc, NOW, { tokenIds: [young.id, busy.id, old.id] });
      expect(r).toMatchObject({ scanned: 2, complete: 1, tooLong: 1, errors: [] });
      const row1 = await db.tokenEarlyBuyers.findUniqueOrThrow({ where: { tokenId: young.id } });
      expect(row1.complete).toBe(true);
      const spendEvidence={version:1,status:'UNKNOWN',reason:'NO_MATCHED_QUOTE_TRANSFER'};
      expect(row1.buyers).toEqual([{ wallet: A, rank: 1, signature:'x1', at:'1970-01-01T00:00:01.000Z',spendEvidence:{version:1,status:'MATCHED_TRANSFERS',source:'RPC_PARSED_INNER_TRANSFERS',quoteAsset:'SOL',quoteLamports:'30000',tokenAmountRaw:'100',outerInstructionIndex:0,counterparty:'pool',programId:'swap-program'} }, { wallet: B, rank: 2, signature:'x3', at:'1970-01-01T00:00:01.000Z',spendEvidence }]);
      expect(transactions).toEqual(['x1','x3','x4']);
      expect(await db.tokenEarlyBuyers.findUniqueOrThrow({ where: { tokenId: busy.id } })).toMatchObject({ complete: false, buyers: [] });
      expect(await db.tokenEarlyBuyers.findUnique({ where: { tokenId: old.id } })).toBeNull(); // outside the scan window
      const callsBefore = calls.length;
      expect((await scanEarlyBuyers(db, rpc, NOW, { tokenIds: [young.id, busy.id] })).scanned).toBe(0); // never rescanned
      expect(calls.length).toBe(callsBefore);
    });
  });
});
