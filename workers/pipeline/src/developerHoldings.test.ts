import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import type { ParsedTx } from '@narra/solana';
import { initialIssuingWallet, makeDeveloperHoldingSource } from './developerHoldings';

const MINT = 'So11111111111111111111111111111111111111112';
const WALLET = '11111111111111111111111111111111';
const transaction = (signer = true, err: unknown = null): ParsedTx => ({
  transaction: { message: { accountKeys: [{ pubkey: WALLET, signer }], instructions: [{ programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: { type: 'initializeMint2', info: { mint: MINT, mintAuthority: WALLET } } }] } },
  meta: { err },
});
function fixture(cache: unknown = null) {
  const db = { systemSetting: { findUnique: vi.fn(async () => cache ? { value: cache } : null), upsert: vi.fn(async () => ({})) } };
  const rpc = { getSignaturesForAddress: vi.fn(async () => [{ signature: 'creation', failed: false, blockTime: 1 }]), getParsedTransaction: vi.fn(async () => transaction()), getTokenBaseUnits: vi.fn(async () => 250n), getTokenSupplyRaw: vi.fn(async () => 1000n) };
  return { db, rpc, source: makeDeveloperHoldingSource(db as unknown as PrismaClient, rpc) };
}
describe('original issuing wallet holdings', () => {
  it('requires successful mint initialization and a signing authority, never just a fee payer', () => {
    expect(initialIssuingWallet(transaction(), MINT)).toBe(WALLET);
    expect(initialIssuingWallet(transaction(false), MINT)).toBeNull();
    expect(initialIssuingWallet(transaction(true, { failed: true }), MINT)).toBeNull();
    expect(initialIssuingWallet(transaction(), WALLET)).toBeNull();
    const tx = transaction();
    (tx.transaction.message.instructions[0] as { programId: string }).programId = 'untrusted';
    expect(initialIssuingWallet(tx, MINT)).toBeNull();
  });
  it('records evidence and measures the current share of raw supply', async () => {
    const { source, db } = fixture();
    expect(await source.getHolding(MINT)).toMatchObject({ wallet: WALLET, holdingPct: 25, signature: 'creation' });
    expect(db.systemSetting.upsert).toHaveBeenCalledOnce();
  });
  it('refreshes balances for cached identity; a real zero is retained', async () => {
    const { source, rpc } = fixture({ wallet: WALLET, signature: 'creation' });
    rpc.getTokenBaseUnits.mockResolvedValue(0n);
    expect((await source.getHolding(MINT))?.holdingPct).toBe(0);
    expect(rpc.getSignaturesForAddress).not.toHaveBeenCalled();
  });
  it('never assumes incomplete history is mint creation', async () => {
    const { source, rpc } = fixture();
    rpc.getSignaturesForAddress.mockResolvedValue(Array.from({ length: 1000 }, (_, i) => ({ signature: String(i), failed: false, blockTime: 1 })));
    expect(await source.getHolding(MINT)).toBeNull();
    expect(rpc.getParsedTransaction).not.toHaveBeenCalled();
  });
  it('caches unknown identities and rejects impossible supply measurements', async () => {
    const negative = fixture({ checkedAt: new Date().toISOString() });
    expect(await negative.source.getHolding(MINT)).toBeNull();
    expect(negative.rpc.getSignaturesForAddress).not.toHaveBeenCalled();
    const { source, rpc } = fixture({ wallet: WALLET, signature: 'creation' });
    rpc.getTokenSupplyRaw.mockResolvedValue(0n);
    expect(await source.getHolding(MINT)).toBeNull();
    rpc.getTokenSupplyRaw.mockResolvedValue(100n);
    expect(await source.getHolding(MINT)).toBeNull();
  });
});
