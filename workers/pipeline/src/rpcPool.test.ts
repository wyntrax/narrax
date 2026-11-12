import { it, expect } from 'vitest';
import { RpcHttpError } from '@narra/solana';
import { makePooledRpc } from './rpcPool';

it('round-robins across every primary before using a fallback', async () => {
  const calls: string[] = [];
  const endpoint = (name: string) => ({ async getBalance() { calls.push(name); return name; } });
  const rpc = makePooledRpc([
    { tier: 'primary', client: endpoint('p1') },
    { tier: 'primary', client: endpoint('p2') },
    { tier: 'primary', client: endpoint('p3') },
    { tier: 'primary', client: endpoint('p4') },
    { tier: 'fallback', client: endpoint('f1') },
    { tier: 'fallback', client: endpoint('f2') },
  ]);
  for (let i = 0; i < 6; i++) await rpc.getBalance();
  expect(calls).toEqual(['p1', 'p2', 'p3', 'p4', 'p1', 'p2']);
});

it('routes around an exhausted primary within the same call and cools it down', async () => {
  let now = 0;
  const calls: string[] = [];
  const primary = (name: string, fail = false) => ({ async getBalance() { calls.push(name); if (fail) throw new RpcHttpError('getBalance', 429); return name; } });
  const rpc = makePooledRpc([
    { tier: 'primary', client: primary('p1', true) },
    { tier: 'primary', client: primary('p2') },
    { tier: 'fallback', client: primary('f1') },
  ], { cooldownMs: 100, now: () => now });
  expect(await rpc.getBalance()).toBe('p2');
  expect(calls).toEqual(['p1', 'p2']);
  // The exhausted primary is skipped during its cooldown, not probed again.
  expect(await rpc.getBalance()).toBe('p2');
  expect(calls).toEqual(['p1', 'p2', 'p2']);
  now = 101;
  expect(await rpc.getBalance()).toBe('p2');
  expect(calls).toEqual(['p1', 'p2', 'p2', 'p1', 'p2']);
});

it('uses fallbacks only when every primary is cooling down or failing', async () => {
  let now = 0;
  const calls: string[] = [];
  const endpoint = (name: string, fail = false) => ({ async getBalance() { calls.push(name); if (fail) throw new RpcHttpError('getBalance', 503); return name; } });
  const rpc = makePooledRpc([
    { tier: 'primary', client: endpoint('p1', true) },
    { tier: 'primary', client: endpoint('p2', true) },
    { tier: 'fallback', client: endpoint('f1') },
    { tier: 'fallback', client: endpoint('f2') },
  ], { cooldownMs: 100, now: () => now });
  expect(await rpc.getBalance()).toBe('f1');
  expect(calls).toEqual(['p1', 'p2', 'f1']);
  expect(await rpc.getBalance()).toBe('f2');
  expect(calls).toEqual(['p1', 'p2', 'f1', 'f2']);
});

it('does not hide a data error behind another endpoint', async () => {
  const calls: string[] = [];
  const rpc = makePooledRpc([
    { tier: 'primary', client: { async getParsedTransaction() { calls.push('p1'); throw new Error('unexpected response shape'); } } },
    { tier: 'fallback', client: { async getParsedTransaction() { calls.push('f1'); return null; } } },
  ]);
  await expect(rpc.getParsedTransaction()).rejects.toThrow('unexpected response shape');
  expect(calls).toEqual(['p1']);
});

it('keeps non-function properties readable through the wrapper', () => {
  const rpc = makePooledRpc([
    { tier: 'primary', client: { label: 'primary', async getTokenSupplyRaw() { return 1n; } } },
    { tier: 'fallback', client: { label: 'fallback', async getTokenSupplyRaw() { return 2n; } } },
  ]);
  expect(rpc.label).toBe('primary');
});
