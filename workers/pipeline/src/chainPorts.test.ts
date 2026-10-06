import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { WSOL_MINT, type Quote } from '@narra/solana';
import { makeChainPorts } from './chainPorts';
import { MissingInputError } from './prismaStores';

const A = 'A'.padEnd(40, '1');
const B = 'B'.padEnd(40, '1');
const quote = (out: string): Quote => ({ inputMint: A, outputMint: WSOL_MINT, inAmount: '1', outAmount: out, priceImpactPct: 0.1, slippageBps: 100, fetchedAt: new Date(), raw: {} });

const mk = (over: { wallet?: unknown; positions?: string[]; held?: Record<string, bigint>; balance?: bigint; quotes?: Record<string, string | Error> } = {}) => {
  const getQuote = vi.fn(async ({ inputMint }: { inputMint: string }) => {
    const q = (over.quotes ?? {})[inputMint];
    if (q instanceof Error) throw q;
    return quote(q ?? '0');
  });
  const db = {
    wallet: { findFirst: vi.fn(async () => ('wallet' in over ? over.wallet : { address: 'TradingWallet' })) },
    position: { findMany: vi.fn(async () => (over.positions ?? []).map((mint) => ({ token: { mint } }))) },
  } as unknown as PrismaClient;
  const rpc = { getBalanceLamports: vi.fn(async () => over.balance ?? 2_000_000_000n), getTokenBaseUnits: vi.fn(async (_o: string, m: string) => (over.held ?? {})[m] ?? 0n) };
  return { ports: makeChainPorts({ db, rpc, jupiter: { getQuote } }), getQuote, rpc };
};

describe('chain ports', () => {
  it('converts lamports to SOL and reports token holdings as strings or null', async () => {
    const { ports } = mk({ held: { [A]: 123n } });
    expect(await ports.getSolBalance('w')).toBe(2);
    expect(await ports.getTokenBaseUnits('w', A)).toBe('123');
    expect(await ports.getTokenBaseUnits('w', B)).toBeNull();
  });
  it('values the portfolio as balance plus what each open position would sell for', async () => {
    const { ports, getQuote } = mk({ positions: [A, B, A], held: { [A]: 1000n, [B]: 500n }, quotes: { [A]: '300000000', [B]: '100000000' } });
    expect(await ports.getPortfolioValueSol('u1')).toBeCloseTo(2.4); // 2 + 0.3 + 0.1, duplicate mint counted once
    expect(getQuote).toHaveBeenCalledTimes(2);
    expect(getQuote).toHaveBeenCalledWith({ inputMint: A, outputMint: WSOL_MINT, amount: 1000n, slippageBps: 100 });
  });
  it('skips quotes for positions that are no longer held', async () => {
    const { ports, getQuote } = mk({ positions: [A], held: {} });
    expect(await ports.getPortfolioValueSol('u1')).toBe(2);
    expect(getQuote).not.toHaveBeenCalled();
  });
  it('fails closed when a quote or the wallet is unavailable', async () => {
    const { ports } = mk({ positions: [A], held: { [A]: 10n }, quotes: { [A]: new Error('quote down') } });
    await expect(ports.getPortfolioValueSol('u1')).rejects.toThrow('quote down');
    await expect(mk({ wallet: null }).ports.getPortfolioValueSol('u1')).rejects.toThrow(MissingInputError);
  });
});
