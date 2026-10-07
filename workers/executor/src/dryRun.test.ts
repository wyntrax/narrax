import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import { ExecutionJobSchema } from '@narra/queue';
import type { Quote } from '@narra/solana';
import { TOKEN_PROGRAM } from '@narra/tx-verify';
import { capturedLookupFixture as capture } from '@narra/tx-verify/src/captured-fixtures';
import { capturedSimulationFixtures } from '@narra/tx-verify/src/captured-simulation-fixtures';
import { honestBuy, toBase64 } from '@narra/tx-verify/src/fixtures';
import { makeDryRunner, type DryRunDeps } from './dryRun';
import { loadExecutorConfig } from './config';

// Entire persistence boundary is a fake. No Prisma construction, Postgres, Redis or network.
function setup(transactionBase64 = capture.transactionBase64 as string) {
  const real = capturedSimulationFixtures[0];
  const now = new Date('2026-10-07T01:00:00Z');
  const create = vi.fn(async ({ data }: { data: any }) => ({ id: 'dry-run', ...data }));
  const db = {
    dryRun: { findUnique: vi.fn(async () => null), create, aggregate: vi.fn(async () => ({ _sum: { sizeSol: null } })) },
    auditLog: { create: vi.fn(async () => ({})) },
    order: { aggregate: vi.fn(async () => ({ _sum: { sizeSol: null } })) },
    systemSetting: { findUnique: vi.fn(async () => null) },
    tradingPermission: { findUnique: vi.fn(async () => ({ aiTradingEnabled: true, agentPaused: false, revokedAt: null, delegatedUntil: null })) },
    user: { findUnique: vi.fn(async () => ({ mode: 'AUTO' })) },
    wallet: { findFirst: vi.fn(async () => ({ address: capture.expectations.userWallet })) },
  };
  const getAccountsWithContext = vi.fn<DryRunDeps['rpc']['getAccountsWithContext']>(async (addresses: string[]) => addresses[0] === capture.lookupAddresses[0]
    ? { slot: 123, accounts: capture.accounts.map(a => ({ ...a })) }
    : { slot: 125, accounts: real.capture.before.map(a => a && { ...a }) });
  const simulateTransaction = vi.fn(async () => ({ err: null, unitsConsumed: real.simulation.unitsConsumed, logs: [], accounts: real.capture.after.map(a => ({ ...a })), slot: 124 }));
  const rpc: DryRunDeps['rpc'] = { getAccountsWithContext, simulateTransaction, getAccounts: vi.fn(async () => []), getMintInfo: vi.fn(async () => ({ program: TOKEN_PROGRAM, decimals: 5, freezeAuthority: null, mintAuthority: null, hasExtensions: false })) };
  const jupiter = { buildSwap: vi.fn(async () => ({ transactionBase64, lastValidBlockHeight: 1 })) };
  const job = ExecutionJobSchema.parse({ userId: 'unit-user', idempotencyKey: 'unit-key', mint: capture.expectations.outputMint, decision: { action: 'BUY', confidence: 0.9, reasonCodes: ['SMART_MONEY'], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 5, entry: { maxSlippageBps: 100, maxPriceImpactPct: 1 }, exit: { stopLossPct: 30, takeProfitPct: 100, trailingStopPct: null }, invalidationConditions: [], summary: 'unit test' } });
  const quote: Quote = { inputMint: capture.expectations.inputMint, outputMint: job.mint, inAmount: '6325000', outAmount: real.quote.out, otherAmountThreshold: real.quote.minOut, priceImpactPct: 0, slippageBps: 100, fetchedAt: now, raw: {} };
  const runner = makeDryRunner({ db: db as unknown as PrismaClient, rpc, jupiter, config: loadExecutorConfig({ EXECUTOR_ALLOWLIST_USER_IDS: job.userId }), now: () => now });
  const run = () => runner.run({ job, sizeSol: 0.006325, exitFraction: 0, quote, result: { approved: true, route: 'EXECUTE', sizeSol: 0.006325, exitFraction: 0, maxSlippageBps: 100, maxPriceImpactPct: 1, violations: [], adjustments: [] } });
  return { run, rpc, getAccountsWithContext, simulateTransaction, create, quote };
}

describe('lookup resolution wiring with fake persistence, Jupiter and RPC', () => {
  it('passes resolved tables into verification, records slots, and accepts closed-wSOL effects', async () => {
    const t = setup();
    expect(await t.run()).toMatchObject({ outcome: 'ACCEPTED', codes: [] });
    expect(t.getAccountsWithContext).toHaveBeenCalledTimes(2);
    expect(t.getAccountsWithContext.mock.calls[0]![0]).toEqual([...capture.lookupAddresses]);
    const data = t.create.mock.calls[0]![0].data;
    expect(data.summary.transaction.lookupTableDetails.map((a: { address: string }) => a.address)).toEqual([...capture.lookupAddresses]);
    expect(data.summary.slots).toEqual({ lookupResolution: 123, preSimulation: 125, simulation: 124 });
    expect(data.simulation).toMatchObject({ walletLamportsSpent: '7822178', inputTokensSpent: '0', outputTokensGained: '20827134548' });
  });
  it.each(['missing', 'wrong-owner', 'rpc-failure'])('records resolver %s as REJECTED without simulation or balance reads', async kind => {
    const t = setup();
    if (kind === 'rpc-failure') t.getAccountsWithContext.mockRejectedValueOnce(new Error('private RPC error must not escape'));
    else if (kind === 'missing') t.getAccountsWithContext.mockResolvedValueOnce({ slot: 123, accounts: [null, null] });
    else t.getAccountsWithContext.mockResolvedValueOnce({ slot: 123, accounts: capture.accounts.map(a => ({ ...a, owner: 'wrong' })) });
    const result = await t.run();
    expect(result?.outcome).toBe('REJECTED');
    expect(result?.codes).toContain(kind === 'wrong-owner' ? 'LOOKUP_TABLE_INVALID' : 'LOOKUP_TABLE_UNRESOLVED');
    expect(t.simulateTransaction).not.toHaveBeenCalled();
    expect(t.getAccountsWithContext).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('leaves the table-free legacy=%s path unchanged, without a lookup RPC read', async legacy => {
    const tx = toBase64(capture.expectations.userWallet, honestBuy(capture.expectations.userWallet, capture.expectations.outputMint, 6325000n).instructions, { legacy });
    const t = setup(tx);
    expect(await t.run()).toMatchObject({ outcome: 'ACCEPTED', codes: [] });
    expect(t.getAccountsWithContext).toHaveBeenCalledTimes(1);
    expect(t.getAccountsWithContext.mock.calls[0]![0][0]).toBe(capture.expectations.userWallet);
    expect(t.create.mock.calls[0]![0].data.summary.slots.lookupResolution).toBeNull();
  });
  it('keeps the original quote-to-simulation window rejection', async () => {
    const t = setup(); t.quote.fetchedAt = new Date(t.quote.fetchedAt.getTime() - 10001);
    expect((await t.run())?.codes).toContain('QUOTE_TO_SIMULATION_WINDOW');
  });
});
