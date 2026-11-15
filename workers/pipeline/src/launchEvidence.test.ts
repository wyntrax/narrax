import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { RpcError, type ParsedTx, type SolanaRpc } from '@narra/solana';
import { initialIssuingWallet } from './developerHoldings';
import { deployerHistory, launchMetrics, makeLaunchEvidenceSource, tokenDelta, type LaunchBuy } from './launchEvidence';

const MINT = 'Mint1111111111111111111111111111111111111111';
const DEPLOYER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const FUNDER = 'Funder11111111111111111111111111111111111111';
const BUYER_A = 'BuyerA11111111111111111111111111111111111111';
const BUYER_B = 'BuyerB11111111111111111111111111111111111111';
const NOW = new Date('2026-11-13T12:00:00Z');

const balance = (owner: string, amount: string) => ({ owner, mint: MINT, uiTokenAmount: { amount } });

function tx(over: {
  payer: string;
  slot: number;
  blockTime: number;
  pre?: unknown[];
  post?: unknown[];
  instructions?: unknown[];
}): ParsedTx {
  return {
    slot: over.slot,
    blockTime: over.blockTime,
    transaction: { message: { accountKeys: [{ pubkey: over.payer, signer: true }], instructions: over.instructions ?? [] } },
    meta: { err: null, innerInstructions: [], preTokenBalances: over.pre ?? [], postTokenBalances: over.post ?? [] },
  } as unknown as ParsedTx;
}

const buy = (payer: string, slot: number, blockTime: number, amount: string) =>
  tx({ payer, slot, blockTime, pre: [balance(payer, '0')], post: [balance(payer, amount)] });

const funding = (wallet: string, blockTime = 900) => tx({
  payer: FUNDER,
  slot: 90,
  blockTime,
  instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: FUNDER, destination: wallet, lamports: 1_000_000_000 } } }],
});

const creation = tx({
  payer: DEPLOYER,
  slot: 99,
  blockTime: 999,
  instructions: [{
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    parsed: { type: 'initializeMint', info: { mint: MINT, mintAuthority: DEPLOYER } },
  }],
});

describe('launch metrics', () => {
  it('keeps bundle and sniper shares disjoint and measures the first-slot cluster', () => {
    const buys: LaunchBuy[] = [
      { wallet: 'a', signature: 'a', slot: 10, at: 1_000, amountRaw: 100_000n },
      { wallet: 'b', signature: 'b', slot: 10, at: 1_000, amountRaw: 50_000n },
      { wallet: 'c', signature: 'c', slot: 12, at: 1_001, amountRaw: 30_000n },
      { wallet: 'd', signature: 'd', slot: 15, at: 1_010, amountRaw: 5_000n },
      { wallet: 'e', signature: 'e', slot: 20, at: 1_100, amountRaw: 20_000n },
    ];
    const r = launchMetrics(buys, 1_000_000n);
    expect(r.sameSlotBuyers).toBe(2);
    expect(r.bundlePct).toBe(18);
    expect(r.sniperPct).toBe(0.5);
    expect(r.firstBuyersPct).toBe(20.5);
    expect([...r.bundleWallets].sort()).toEqual(['a', 'b', 'c']);
    expect([...r.sniperWallets]).toEqual(['d']);
  });

  it('clamps launch share percentages at 100 when current post-burn supply is smaller than launch buys', () => {
    const buys: LaunchBuy[] = [
      { wallet: 'a', signature: 'a', slot: 10, at: 1_000, amountRaw: 500_000n },
      { wallet: 'b', signature: 'b', slot: 15, at: 1_010, amountRaw: 250_000n },
    ];
    const r = launchMetrics(buys, 5_000n);
    expect(r.bundlePct).toBe(100);
    expect(r.sniperPct).toBe(100);
    expect(r.firstBuyersPct).toBe(100);
  });

  it('returns nulls rather than a clean result without buys or supply', () => {
    expect(launchMetrics([], 1_000_000n)).toMatchObject({ bundlePct: null, sniperPct: null, sameSlotBuyers: null, firstBuyersPct: null });
    expect(launchMetrics([{ wallet: 'a', signature: 'a', slot: 1, at: 1, amountRaw: 1n }], 0n)).toMatchObject({ bundlePct: null, sameSlotBuyers: null });
  });

  it('reads the buyer token delta from pre/post balances', () => {
    const t = tx({ payer: BUYER_A, slot: 1, blockTime: 1, pre: [balance(BUYER_A, '40')], post: [balance(BUYER_A, '140')] });
    expect(tokenDelta(t, MINT, BUYER_A)).toBe(100n);
  });
});

describe('deployer history', () => {
  it('counts prior tokens and prior rugs from stored outcomes', async () => {
    const day = 86_400_000;
    const db = { token: { findMany: async () => [
      { id: '1', mint: 'm1', createdOnChainAt: new Date(+NOW - 2 * day), marketQuoteFailures: 0, metrics: [{ marketCapUsd: 500, at: new Date(+NOW - day) }] },
      { id: '2', mint: 'm2', createdOnChainAt: new Date(+NOW - 5 * day), marketQuoteFailures: 0, metrics: [] },
      { id: '3', mint: 'm3', createdOnChainAt: new Date(+NOW - 2 * 3_600_000), marketQuoteFailures: 0, metrics: [{ marketCapUsd: 50_000, at: NOW }] },
    ] } } as unknown as PrismaClient;
    const r = await deployerHistory(db, DEPLOYER, 'current', NOW);
    expect(r.priorTokens).toBe(3);
    expect(r.priorRugs).toBe(2);
    expect(r.mints).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('launch evidence source', () => {
  const settings = new Map<string, unknown>();
  const db = {
    systemSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null,
      upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => { settings.set(where.key, create.value); return {}; },
    },
    token: {
      findMany: async () => [],
      updateMany: async () => ({ count: 1 }),
    },
  } as unknown as PrismaClient;

  const rpc = {
    getSignaturesForAddress: async (address: string) => {
      if (address === MINT) {
        return [
          { signature: 'buy-b', blockTime: 1_000, failed: false },
          { signature: 'buy-a', blockTime: 1_000, failed: false },
          { signature: 'creation', blockTime: 999, failed: false },
        ];
      }
      if (address === BUYER_A) return [{ signature: 'fund-a', blockTime: 900, failed: false }];
      if (address === BUYER_B) return [{ signature: 'fund-b', blockTime: 900, failed: false }];
      return [];
    },
    getParsedTransaction: async (signature: string) => {
      if (signature === 'buy-a') return buy(BUYER_A, 100, 1_000, '100000');
      if (signature === 'buy-b') return buy(BUYER_B, 100, 1_000, '50000');
      if (signature === 'creation') return creation;
      if (signature === 'fund-a') return funding(BUYER_A);
      if (signature === 'fund-b') return funding(BUYER_B);
      return null;
    },
    getTokenSupplyRaw: async () => 1_000_000n,
  } as unknown as SolanaRpc;

  it('flags a same-slot cluster with a shared funder, and resolves the deployer', async () => {
    expect(initialIssuingWallet(creation, MINT)).toBe(DEPLOYER);
    settings.clear();
    const source = makeLaunchEvidenceSource(db, rpc, { cacheTtlMs: 0, unknownTtlMs: 0 })!;
    source.begin();
    const evidence = await source.get(MINT, NOW);
    expect(evidence).toMatchObject({
      status: 'FLAGGED',
      bundlePct: 15,
      sniperPct: 0,
      insiderPct: 15,
      sameSlotBuyers: 2,
      firstBuyers: 2,
      historyComplete: true,
      deployer: DEPLOYER,
      deployerPriorTokens: 0,
      deployerPriorRugs: 0,
    });
    expect(evidence!.detail).toContain('bundle 15.00%');
    expect(evidence!.detail).toContain('insider 15.00%');
  });

  it('returns UNKNOWN instead of a partial clean result when history is out of reach', async () => {
    settings.clear();
    const longRpc = {
      ...rpc,
      getSignaturesForAddress: async (address: string) => address === MINT
        ? Array.from({ length: 1_000 }, (_, i) => ({ signature: `sig-${i}`, blockTime: 1_000 - i, failed: false }))
        : [],
    } as unknown as SolanaRpc;
    const source = makeLaunchEvidenceSource(db, longRpc, { cacheTtlMs: 0, unknownTtlMs: 0 })!;
    source.begin();
    const evidence = await source.get(MINT, NOW);
    expect(evidence).toMatchObject({ status: 'UNKNOWN', historyComplete: false, bundlePct: null, sameSlotBuyers: null });
  });

  it('uses getTransactionsForAddress to reach launch on busy mints, detect recent serial deployers, and retain partial insider resolution', async () => {
    settings.clear();
    const priorMint1 = 'Prior111111111111111111111111111111111111111';
    const priorMint2 = 'Prior222222222222222222222222222222222222222';
    const priorMint3 = 'Prior333333333333333333333333333333333333333';
    const indexedRpc = {
      getTokenSupplyRaw: async () => 1_000_000n,
      getTransactionsForAddress: async (address: string, opts: { sortOrder?: 'asc' | 'desc'; limit?: number; paginationToken?: string } = {}) => {
        if (address === MINT && opts.sortOrder === 'asc') {
          if (!opts.paginationToken) {
            return {
              data: [creation, buy(BUYER_A, 100, 1_000, '100000')],
              paginationToken: '100:1',
            };
          }
          return {
            data: [buy(BUYER_B, 100, 1_000, '50000')],
            paginationToken: null,
          };
        }
        if (address === DEPLOYER && opts.sortOrder === 'desc' && !opts.paginationToken) {
          return {
            data: [priorMint1, priorMint2, priorMint3].map((m, idx) => tx({
              payer: DEPLOYER,
              slot: 200 + idx,
              blockTime: 1_100 + idx,
              instructions: [{ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: { type: 'initializeMint2', info: { mint: m } } }],
            })),
            paginationToken: '200:1',
          };
        }
        if (address === DEPLOYER && opts.sortOrder === 'asc') {
          return { data: [creation], paginationToken: null };
        }
        if (address === BUYER_A) return { data: [funding(BUYER_A)], paginationToken: null };
        if (address === BUYER_B) {
          // Simulates a bot buyer whose first 25 txs contain no qualifying SOL transfer and has more pages.
          return { data: [buy(BUYER_B, 90, 900, '1')], paginationToken: '90:1' };
        }
        return { data: [], paginationToken: null };
      },
      getSignaturesForAddress: async () => { throw new Error('fallback should not be called'); },
      getParsedTransaction: async () => { throw new Error('fallback should not be called'); },
    } as unknown as SolanaRpc;

    const source = makeLaunchEvidenceSource(db, indexedRpc, { cacheTtlMs: 0, unknownTtlMs: 0 })!;
    source.begin();
    const evidence = await source.get(MINT, NOW);
    expect(evidence).toMatchObject({
      status: 'FLAGGED',
      historyComplete: true,
      bundlePct: 15,
      sameSlotBuyers: 2,
      deployer: DEPLOYER,
      deployerPriorTokens: 3,
      deployerPriorRugs: null,
    });
    expect(evidence!.detail).toContain('insider sample 1/2 incomplete');
  });

  it('computes insiderPct from resolved sample buyers even when one buyer history is incomplete', async () => {
    settings.clear();
    const BUYER_C = 'BuyerC11111111111111111111111111111111111111';
    const partialRpc = {
      getTokenSupplyRaw: async () => 1_000_000n,
      getTransactionsForAddress: async (address: string, opts: { sortOrder?: 'asc' | 'desc' } = {}) => {
        if (address === MINT && opts.sortOrder === 'asc') {
          return {
            data: [
              creation,
              buy(BUYER_A, 100, 1_000, '40000'),
              buy(BUYER_B, 101, 1_001, '40000'),
              buy(BUYER_C, 105, 1_010, '20000'),
            ],
            paginationToken: null,
          };
        }
        if (address === DEPLOYER) return { data: [creation], paginationToken: null };
        if (address === BUYER_A) return { data: [funding(BUYER_A)], paginationToken: null };
        if (address === BUYER_B) return { data: [funding(BUYER_B)], paginationToken: null };
        if (address === BUYER_C) return { data: [buy(BUYER_C, 90, 900, '1')], paginationToken: '90:1' };
        return { data: [], paginationToken: null };
      },
    } as unknown as SolanaRpc;

    const source = makeLaunchEvidenceSource(db, partialRpc, { cacheTtlMs: 0, unknownTtlMs: 0 })!;
    source.begin();
    const evidence = await source.get(MINT, NOW);
    expect(evidence).toMatchObject({
      status: 'CLEAN',
      insiderPct: 8,
      deployerPriorTokens: 0,
      deployerPriorRugs: 0,
    });
    expect(evidence!.detail).toContain('insider sample 2/3');
  });

  it('falls back to getSignaturesForAddress when getTransactionsForAddress is unsupported', async () => {
    settings.clear();
    const fallbackRpc = {
      ...rpc,
      getTransactionsForAddress: async () => { throw new RpcError('getTransactionsForAddress error: Method not found'); },
    } as unknown as SolanaRpc;
    const source = makeLaunchEvidenceSource(db, fallbackRpc, { cacheTtlMs: 0, unknownTtlMs: 0 })!;
    source.begin();
    const evidence = await source.get(MINT, NOW);
    expect(evidence).toMatchObject({ status: 'FLAGGED', bundlePct: 15, insiderPct: 15, deployer: DEPLOYER });
  });

  it('preserves known prior rugs even when another on-chain mint is untracked', async () => {
    settings.clear();
    const day = 86_400_000;
    const rugDb = {
      ...db,
      token: {
        ...db.token,
        findMany: async () => [
          { id: '1', mint: 'KnownRug111111111111111111111111111111111111', createdOnChainAt: new Date(+NOW - 2 * day), marketQuoteFailures: 0, metrics: [{ marketCapUsd: 500, at: new Date(+NOW - day) }] },
        ],
      },
    } as unknown as PrismaClient;
    const priorRugMint = 'KnownRug111111111111111111111111111111111111';
    const untrackedMint = 'Untracked11111111111111111111111111111111111';
    const mixedRpc = {
      getTokenSupplyRaw: async () => 1_000_000n,
      getTransactionsForAddress: async (address: string, opts: { sortOrder?: 'asc' | 'desc' } = {}) => {
        if (address === MINT && opts.sortOrder === 'asc') {
          return { data: [creation, buy(BUYER_A, 100, 1_000, '10000')], paginationToken: null };
        }
        if (address === DEPLOYER && opts.sortOrder === 'desc') {
          return {
            data: [priorRugMint, untrackedMint].map((m, idx) => tx({
              payer: DEPLOYER,
              slot: 200 + idx,
              blockTime: 1_100 + idx,
              instructions: [{ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: { type: 'initializeMint2', info: { mint: m } } }],
            })),
            paginationToken: null,
          };
        }
        if (address === DEPLOYER) return { data: [creation], paginationToken: null };
        if (address === BUYER_A) return { data: [funding(BUYER_A)], paginationToken: null };
        return { data: [], paginationToken: null };
      },
    } as unknown as SolanaRpc;
    const source = makeLaunchEvidenceSource(rugDb, mixedRpc, { cacheTtlMs: 0, unknownTtlMs: 0 })!;
    source.begin();
    const evidence = await source.get(MINT, NOW);
    expect(evidence).toMatchObject({ deployerPriorTokens: 2, deployerPriorRugs: 1 });
  });
});
