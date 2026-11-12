import { it, expect } from 'vitest';
import { RpcHttpError } from '@narra/solana';
import { makeFailoverRpc } from './rpcFailover';

it('fails over on a provider rejection and returns to the primary after the cooldown', async () => {
  let now = 0;
  const calls: string[] = [];
  const primary = { async getSignaturesForAddress() { calls.push('primary'); throw new RpcHttpError('getSignaturesForAddress', 429); } };
  const fallback = { async getSignaturesForAddress() { calls.push('fallback'); return ['ok']; } };
  const rpc = makeFailoverRpc(primary, fallback, { cooldownMs: 100, now: () => now });

  expect(await rpc.getSignaturesForAddress()).toEqual(['ok']);
  expect(await rpc.getSignaturesForAddress()).toEqual(['ok']);
  expect(calls).toEqual(['primary', 'fallback', 'fallback']);

  now = 101;
  expect(await rpc.getSignaturesForAddress()).toEqual(['ok']);
  expect(calls).toEqual(['primary', 'fallback', 'fallback', 'primary', 'fallback']);
});

it('does not hide a data error behind the fallback', async () => {
  const calls: string[] = [];
  const primary = { async getParsedTransaction() { calls.push('primary'); throw new Error('unexpected response shape'); } };
  const fallback = { async getParsedTransaction() { calls.push('fallback'); return null; } };
  await expect(makeFailoverRpc(primary, fallback).getParsedTransaction()).rejects.toThrow('unexpected response shape');
  expect(calls).toEqual(['primary']);
});

it('keeps non-function properties readable through the wrapper', () => {
  const primary = { label: 'primary', async getTokenSupplyRaw() { return 1n; } };
  const fallback = { label: 'fallback', async getTokenSupplyRaw() { return 2n; } };
  expect(makeFailoverRpc(primary, fallback).label).toBe('primary');
});
