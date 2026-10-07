import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { ExecutionJobSchema, type ExecutionJob } from '@narra/queue';
import { WSOL_MINT, QuoteError, RpcError, type Quote } from '@narra/solana';
import { KILL_SWITCH_KEY } from '@narra/trading';
import { TOKEN_PROGRAM, associatedTokenAddress, type RawAccount } from '@narra/tx-verify';
import { honestBuy, honestSell, ix, newAddress, toBase64, transfer } from '@narra/tx-verify/src/fixtures';
import { makeDryRunner, type DryRunDeps } from './dryRun';
import { loadExecutorConfig, type ExecutorConfig } from './config';
import { runExecution } from '../../pipeline/src/outcomes';
import type { ExecutionDeps } from '../../pipeline/src/execution';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "DryRun" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

const tokenAcct = (amount: bigint): RawAccount => { const b = Buffer.alloc(165); b.writeBigUInt64LE(amount, 64); return { lamports: 2_039_280, owner: TOKEN_PROGRAM, data: b.toString('base64') }; };
const sys = (lamports: number): RawAccount => ({ lamports, owner: '11111111111111111111111111111111', data: '' });

describe.skipIf(!up)('B5a dry-run executor on a real Postgres (Jupiter and the RPC are fakes)', () => {
  const db = createPrisma(url);
  const tag = `b5a${Date.now()}`;
  const userIds: string[] = [];
  const mint = newAddress();
  const T0 = new Date();
  let clock = T0;
  let seq = 0;

  // ---- fakes -------------------------------------------------------------------------------------------------
  const world = {
    mintInfo: { program: TOKEN_PROGRAM, decimals: 6, freezeAuthority: null as string | null, mintAuthority: null as string | null, hasExtensions: false },
    txFor: (_side: string, _wallet: string) => '',
    simulate: { err: null as unknown, units: 150_000, walletSpent: 10_100_000, outGained: 1000n, inSpent: 0n, walletGained: 0 },
    calls: { buildSwap: 0, simulate: 0, getMintInfo: 0, getAccounts: 0 },
    failBuild: false, failRpc: false,
  };
  const jupiter: DryRunDeps['jupiter'] = {
    async buildSwap({ userPublicKey }) {
      world.calls.buildSwap++;
      if (world.failBuild) throw new QuoteError('Swap build request returned HTTP 500');
      return { transactionBase64: world.txFor('', userPublicKey), lastValidBlockHeight: 1000 };
    },
  };
  const PRE_SOL = 1_000_000_000;
  const rpc: DryRunDeps['rpc'] = {
    async getMintInfo() { world.calls.getMintInfo++; if (world.failRpc) throw new RpcError('getAccountInfo failed'); return world.mintInfo; },
    async getAccounts() { world.calls.getAccounts++; return [sys(PRE_SOL), tokenAcct(5000n), null]; },
    async getAccountsWithContext(addresses) { return { slot: 1, accounts: await rpc.getAccounts(addresses) }; },
    async simulateTransaction() {
      world.calls.simulate++;
      const s = world.simulate;
      return { err: s.err, logs: ['Program log: \u202Eswap\u0000 ok'], unitsConsumed: s.units, accounts: [sys(PRE_SOL - s.walletSpent + s.walletGained), tokenAcct(5000n - s.inSpent), tokenAcct(s.outGained)] };
    },
  };

  const cfgFor = (userIds_: string[], env: Record<string, string> = {}): ExecutorConfig => loadExecutorConfig({ EXECUTOR_ALLOWLIST_USER_IDS: userIds_.join(','), ...env });
  const payload = (action: 'BUY' | 'SELL' | 'REDUCE' = 'BUY') => ({
    action, confidence: 0.9, reasonCodes: ['SMART_MONEY'], positiveSignals: [], negativeSignals: [], risks: [], suggestedPositionSizePct: 2,
    entry: { maxSlippageBps: 100, maxPriceImpactPct: 1.5 }, exit: { stopLossPct: 30, takeProfitPct: 100, trailingStopPct: null }, invalidationConditions: [], summary: 'test',
  });
  const quoteFor = (side: 'BUY' | 'SELL', inAmount: string, over: Partial<Quote> = {}): Quote => ({
    inputMint: side === 'BUY' ? WSOL_MINT : mint, outputMint: side === 'BUY' ? mint : WSOL_MINT, inAmount, outAmount: side === 'BUY' ? '1000' : '9500000', otherAmountThreshold: side === 'BUY' ? '900' : '9000000',
    priceImpactPct: 0.5, slippageBps: 100, fetchedAt: clock, raw: {}, ...over,
  });
  const resultOf = (sizeSol: number, exitFraction = 0) => ({ approved: true, route: 'EXECUTE' as const, sizeSol, exitFraction, maxSlippageBps: 100, maxPriceImpactPct: 1.5, violations: [], adjustments: [] });
  const mkJob = (userId: string, o: { action?: 'BUY' | 'SELL'; confirmationId?: string } = {}): ExecutionJob =>
    ExecutionJobSchema.parse({ userId, idempotencyKey: `job-${tag}-${++seq}`, mint, decision: payload(o.action ?? 'BUY'), ...(o.confirmationId ? { confirmationId: o.confirmationId } : {}) });

  async function mkUser(o: { mode?: 'AUTO' | 'SEMI_AUTO' | 'PAPER'; perm?: Partial<{ aiTradingEnabled: boolean; agentPaused: boolean; revokedAt: Date | null; delegatedUntil: Date | null }> | null; wallet?: boolean } = {}) {
    const u = await db.user.create({ data: { privyUserId: `did:privy:${tag}-${++seq}`, mode: o.mode ?? 'AUTO' } });
    userIds.push(u.id);
    if (o.perm !== null) await db.tradingPermission.create({ data: { userId: u.id, aiTradingEnabled: true, ...o.perm } });
    let wallet = '';
    if (o.wallet !== false) { wallet = newAddress(); await db.wallet.create({ data: { userId: u.id, address: wallet, kind: 'TRADING' } }); }
    return { id: u.id, wallet };
  }
  const setKill = (value: unknown) => db.systemSetting.upsert({ where: { key: KILL_SWITCH_KEY }, create: { key: KILL_SWITCH_KEY, value: value as object }, update: { value: value as object } });
  const clearKill = () => db.systemSetting.deleteMany({ where: { key: KILL_SWITCH_KEY } });
  const runner = (cfg: ExecutorConfig, d: Partial<DryRunDeps> = {}) => makeDryRunner({ db, jupiter, rpc, config: cfg, now: () => clock, ...d });
  const buyTx = (wallet: string, lamports = 10_000_000n) => toBase64(wallet, honestBuy(wallet, mint, lamports).instructions);
  const sellTx = (wallet: string) => toBase64(wallet, honestSell(wallet, mint).instructions);
  const row = (key: string) => db.dryRun.findUniqueOrThrow({ where: { idempotencyKey: key } });
  const tradeRows = async (userId: string) => ({ orders: await db.order.count({ where: { userId } }), trades: await db.trade.count({ where: { userId } }), positions: await db.position.count({ where: { userId } }), attempts: await db.executionAttempt.count({ where: { order: { userId } } }) });

  const reset = () => {
    clock = new Date();
    world.mintInfo = { program: TOKEN_PROGRAM, decimals: 6, freezeAuthority: null, mintAuthority: null, hasExtensions: false };
    world.simulate = { err: null, units: 150_000, walletSpent: 10_100_000, outGained: 1000n, inSpent: 0n, walletGained: 0 };
    world.calls = { buildSwap: 0, simulate: 0, getMintInfo: 0, getAccounts: 0 };
    world.failBuild = false; world.failRpc = false;
    world.txFor = (_s, wallet) => buyTx(wallet);
  };
  afterEach(async () => { await clearKill(); reset(); });
  beforeAll(reset);
  afterAll(async () => { await clearKill(); await db.user.deleteMany({ where: { id: { in: userIds } } }); await db.$disconnect(); });

  const entry = (r: ReturnType<typeof runner>, userId: string, sizeSol = 0.01, over: Partial<Quote> = {}, job = mkJob(userId)) =>
    r.run({ job, sizeSol, exitFraction: 0, quote: quoteFor('BUY', String(Math.floor(sizeSol * 1e9)), over), result: resultOf(sizeSol) }).then((s) => ({ s, job }));

  describe('a good order', () => {
    it('is accepted and recorded with a full decoded summary, and writes no order, trade or position', async () => {
      const u = await mkUser();
      const before = await tradeRows(u.id);
      const { s, job } = await entry(runner(cfgFor([u.id])), u.id);
      expect(s).toMatchObject({ outcome: 'ACCEPTED', codes: [] });
      const r = await row(job.idempotencyKey);
      expect(r).toMatchObject({ userId: u.id, side: 'BUY', mint, outcome: 'ACCEPTED' });
      expect(Number(r.sizeSol)).toBeCloseTo(0.01);
      expect(r.messageHash).toMatch(/^[0-9a-f]{64}$/);
      const summary = r.summary as { transaction: { feePayer: string; instructions: { program: string; kind: string }[] }; policy: { appliedTo: string }; lastValidBlockHeight: number };
      expect(summary.transaction.feePayer).toBe(u.wallet);
      expect(summary.transaction.instructions.map((i) => `${i.program}:${i.kind}`)).toContain('jupiter-v6:swap');
      expect(summary.policy.appliedTo).toBe('entry');
      expect(summary.lastValidBlockHeight).toBe(1000);
      expect(r.simulation).toMatchObject({ err: null, walletLamportsSpent: '10100000', outputTokensGained: '1000' });
      expect(await tradeRows(u.id)).toEqual(before); // the point of a dry run
      expect(await db.auditLog.count({ where: { userId: u.id, action: 'executor.dry_run' } })).toBe(1);
    });

    it('cleans untrusted program log text before storing it', async () => {
      const u = await mkUser();
      const { job } = await entry(runner(cfgFor([u.id])), u.id);
      const logs = ((await row(job.idempotencyKey)).simulation as { logs: string[] }).logs;
      expect(logs).toEqual(['Program log: swap ok']);
    });

    it('accepts a sell, and does not apply the token policy to it (an exit is never refused for the token\'s authorities)', async () => {
      const u = await mkUser();
      world.mintInfo = { ...world.mintInfo, freezeAuthority: 'SomeFreezeAuthority', hasExtensions: true };
      world.txFor = (_s, wallet) => sellTx(wallet);
      world.simulate = { ...world.simulate, walletSpent: 0, walletGained: 9_600_000, inSpent: 1000n, outGained: 0n };
      const job = mkJob(u.id, { action: 'SELL' });
      const s = await runner(cfgFor([u.id])).run({ job, sizeSol: 0, exitFraction: 1, quote: quoteFor('SELL', '1000'), result: resultOf(0, 1) });
      expect(s).toMatchObject({ outcome: 'ACCEPTED' });
      const r = await row(job.idempotencyKey);
      expect(r.side).toBe('SELL');
      expect(Number(r.sizeSol)).toBeCloseTo(0.0095);
      expect((r.summary as { policy: { freezeAuthority: boolean; appliedTo: string } }).policy).toMatchObject({ freezeAuthority: true, appliedTo: 'recorded only (exit)' });
    });
  });

  describe('who it applies to', () => {
    it('returns null for a user who is not on the allow list, and records nothing', async () => {
      const u = await mkUser(); const other = await mkUser();
      const job = mkJob(other.id);
      const r = await runner(cfgFor([u.id])).run({ job, sizeSol: 0.01, exitFraction: 0, quote: quoteFor('BUY', '10000000'), result: resultOf(0.01) });
      expect(r).toBeNull();
      expect(await db.dryRun.count({ where: { userId: other.id } })).toBe(0);
      expect(world.calls).toEqual({ buildSwap: 0, simulate: 0, getMintInfo: 0, getAccounts: 0 });
    });
    it('does nothing at all when the allow list is empty', async () => {
      const u = await mkUser();
      expect(await runner(cfgFor([])).run({ job: mkJob(u.id), sizeSol: 0.01, exitFraction: 0, quote: quoteFor('BUY', '10000000'), result: resultOf(0.01) })).toBeNull();
    });
  });

  describe('step 1: everything is read again at the last moment', () => {
    it.each([
      ['the kill switch is on', async () => { await setKill({ enabled: true, reason: 'test' }); }, 'KILL_SWITCH', {}],
      ['the kill switch value is unreadable', async () => { await setKill({ enabled: 'maybe' }); }, 'KILL_SWITCH', {}],
      ['AI access was turned off', null, 'AI_ACCESS_DISABLED', { perm: { aiTradingEnabled: false } }],
      ['access was revoked', null, 'ACCESS_REVOKED', { perm: { revokedAt: new Date() } }],
      ['the agent is paused', null, 'AGENT_PAUSED', { perm: { agentPaused: true } }],
      ['the delegation expired', null, 'DELEGATION_EXPIRED', { perm: { delegatedUntil: new Date(Date.now() - 1000) } }],
      ['there is no permission record', null, 'NO_PERMISSION_RECORD', { perm: null }],
      ['the account is now in PAPER mode', null, 'MODE_NOT_EXECUTABLE', { mode: 'PAPER' as const }],
      ['an unconfirmed order meets SEMI_AUTO mode', null, 'MODE_NOT_EXECUTABLE', { mode: 'SEMI_AUTO' as const }],
      ['there is no trading wallet', null, 'NO_TRADING_WALLET', { wallet: false }],
    ])('rejects, and makes no network call, when %s', async (_name, arrange, code, userOpts) => {
      const u = await mkUser(userOpts as Parameters<typeof mkUser>[0]);
      if (arrange) await arrange();
      const { s, job } = await entry(runner(cfgFor([u.id])), u.id);
      expect(s).toMatchObject({ outcome: 'REJECTED' });
      expect(s!.codes).toContain(code);
      expect((await row(job.idempotencyKey)).outcome).toBe('REJECTED');
      expect(world.calls.buildSwap).toBe(0);
      expect(world.calls.simulate).toBe(0);
    });

    it('allows a SEMI_AUTO user\'s order once the user has confirmed it, and a future delegation expiry', async () => {
      const u = await mkUser({ mode: 'SEMI_AUTO', perm: { delegatedUntil: new Date(Date.now() + 3_600_000) } });
      const { s } = await entry(runner(cfgFor([u.id])), u.id, 0.01, {}, mkJob(u.id, { confirmationId: 'conf-1' }));
      expect(s).toMatchObject({ outcome: 'ACCEPTED' });
    });

    it('reports every failed check together, not only the first', async () => {
      const u = await mkUser({ perm: { agentPaused: true, revokedAt: new Date() }, wallet: false });
      await setKill({ enabled: true });
      const { s } = await entry(runner(cfgFor([u.id])), u.id);
      expect(s!.codes).toEqual(expect.arrayContaining(['KILL_SWITCH', 'AGENT_PAUSED', 'ACCESS_REVOKED', 'NO_TRADING_WALLET']));
    });
  });

  describe('caps (approved defaults: 0.01 SOL per transaction, 0.05 SOL per day)', () => {
    it('refuses an order above the per-transaction cap, even though the Risk Governor approved it', async () => {
      const u = await mkUser();
      const { s } = await entry(runner(cfgFor([u.id])), u.id, 0.02);
      expect(s!.codes).toContain('HARD_CAP_EXCEEDED');
      expect(world.calls.buildSwap).toBe(0);
    });
    it('counts accepted dry runs toward the daily cap, and stops at it', async () => {
      const u = await mkUser();
      const r = runner(cfgFor([u.id], { EXECUTOR_HARD_CAP_SOL: '0.02', EXECUTOR_DAILY_CAP_SOL: '0.05' }));
      world.txFor = (_s, w) => buyTx(w, 20_000_000n);
      world.simulate = { ...world.simulate, walletSpent: 20_100_000 };
      const accepted: string[] = [];
      for (let i = 0; i < 3; i++) accepted.push((await entry(r, u.id, 0.02, { otherAmountThreshold: '900' })).s!.outcome);
      expect(accepted).toEqual(['ACCEPTED', 'ACCEPTED', 'REJECTED']); // 0.02 + 0.02 = 0.04, a third makes 0.06
      const third = await db.dryRun.findFirstOrThrow({ where: { userId: u.id, outcome: 'REJECTED' } });
      expect((third.reasons as { code: string }[]).map((x) => x.code)).toContain('DAILY_CAP_EXCEEDED');
    });
    it('does not count rejected dry runs, and never applies the entry caps to an exit', async () => {
      const u = await mkUser();
      await db.dryRun.create({ data: { userId: u.id, idempotencyKey: `old-${tag}`, side: 'BUY', mint, sizeSol: 0.049, outcome: 'REJECTED', reasons: [], summary: {} } });
      const { s } = await entry(runner(cfgFor([u.id])), u.id, 0.01);
      expect(s).toMatchObject({ outcome: 'ACCEPTED' });
      world.txFor = (_s, w) => sellTx(w);
      world.simulate = { ...world.simulate, walletSpent: 0, walletGained: 9_600_000, inSpent: 1000n, outGained: 0n };
      const exit = await runner(cfgFor([u.id])).run({ job: mkJob(u.id, { action: 'SELL' }), sizeSol: 0, exitFraction: 1, quote: quoteFor('SELL', '1000'), result: resultOf(0, 1) });
      expect(exit).toMatchObject({ outcome: 'ACCEPTED' });
    });
    it('counts real (non-simulated) orders too, so the cap keeps applying after B5b', async () => {
      const u = await mkUser();
      const tok = await db.token.create({ data: { mint: newAddress(), symbol: 'CAPTEST', name: 'cap' } });
      await db.order.create({ data: { userId: u.id, tokenId: tok.id, idempotencyKey: `real-${tag}`, side: 'BUY', mode: 'AI_AUTO', status: 'CONFIRMED', sizeSol: 0.045, simulated: false } });
      const { s } = await entry(runner(cfgFor([u.id])), u.id, 0.01);
      expect(s!.codes).toContain('DAILY_CAP_EXCEEDED');
      await db.order.deleteMany({ where: { userId: u.id } }); await db.token.delete({ where: { id: tok.id } });
    });
  });

  describe('token policy (approved decision D6), for entries', () => {
    it.each([
      ['a freeze authority', { freezeAuthority: 'Frz' }, 'TOKEN_HAS_FREEZE_AUTHORITY'],
      ['mint extensions', { hasExtensions: true }, 'TOKEN_HAS_EXTENSIONS'],
      ['a Token-2022 mint', { program: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' }, 'TOKEN_PROGRAM_NOT_CLASSIC'],
    ])('refuses %s before building anything', async (_n, patch, code) => {
      const u = await mkUser();
      world.mintInfo = { ...world.mintInfo, ...patch };
      const { s } = await entry(runner(cfgFor([u.id])), u.id);
      expect(s!.codes).toContain(code);
      expect(world.calls.buildSwap).toBe(0);
    });
    it('does not refuse a token only because it has a mint authority (the existing risk flags cover that)', async () => {
      const u = await mkUser();
      world.mintInfo = { ...world.mintInfo, mintAuthority: 'Mnt' };
      expect((await entry(runner(cfgFor([u.id])), u.id)).s!.outcome).toBe('ACCEPTED');
    });
  });

  describe('the quote is checked against the order', () => {
    it('rejects a quote for the wrong mints, the wrong amount, or with no minimum output', async () => {
      const u = await mkUser();
      const r = runner(cfgFor([u.id]));
      expect((await entry(r, u.id, 0.01, { outputMint: newAddress() })).s!.codes).toContain('QUOTE_MINT_MISMATCH');
      expect((await entry(r, u.id, 0.01, { inAmount: '10000001' })).s!.codes).toContain('QUOTE_AMOUNT_MISMATCH');
      expect((await entry(r, u.id, 0.01, { otherAmountThreshold: null })).s!.codes).toContain('NO_QUOTE_MINIMUM');
      expect((await entry(r, u.id, 0.01, { otherAmountThreshold: '0' })).s!.codes).toContain('NO_QUOTE_MINIMUM');
      expect(world.calls.buildSwap).toBe(0);
    });
  });

  describe('the transaction and its simulation are checked', () => {
    it('rejects a hostile transaction (an extra transfer to an attacker) and never simulates it', async () => {
      const u = await mkUser();
      world.txFor = (_s, w) => toBase64(w, [...honestBuy(w, mint).instructions, transfer(w, newAddress(), 5_000_000)]);
      const { s, job } = await entry(runner(cfgFor([u.id])), u.id);
      expect(s).toMatchObject({ outcome: 'REJECTED' });
      expect(s!.codes).toContain('SYSTEM_TRANSFER_TO_OTHER');
      expect(world.calls.simulate).toBe(0);
      const r = await row(job.idempotencyKey);
      expect(r.messageHash).toMatch(/^[0-9a-f]{64}$/); // a reviewer can still see what was refused
      expect((r.summary as { transaction: { instructions: unknown[] } }).transaction.instructions.length).toBeGreaterThan(0);
    });
    it('rejects a transaction built for a different wallet', async () => {
      const u = await mkUser();
      world.txFor = () => buyTx(newAddress());
      expect((await entry(runner(cfgFor([u.id])), u.id)).s!.codes).toContain('WRONG_FEE_PAYER');
    });
    it('rejects a program that is not on the allow list, so a change by Jupiter shows up as a refusal and not a surprise', async () => {
      const u = await mkUser();
      world.txFor = (_s, w) => toBase64(w, [...honestBuy(w, mint).instructions, ix('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', [{ pubkey: w, signer: true }], [1])]);
      expect((await entry(runner(cfgFor([u.id])), u.id)).s!.codes).toContain('PROGRAM_NOT_ALLOWED');
    });
    it('rejects when the simulation fails, or the wallet would lose too much SOL, or the output is below the minimum', async () => {
      const u = await mkUser(); const r = runner(cfgFor([u.id]));
      world.simulate = { ...world.simulate, err: { InstructionError: [4, { Custom: 6001 }] } };
      expect((await entry(r, u.id)).s!.codes).toContain('SIMULATION_FAILED');
      world.simulate = { ...world.simulate, err: null, walletSpent: 30_000_000 };
      expect((await entry(r, u.id)).s!.codes).toEqual(expect.arrayContaining(['WALLET_LOSES_TOO_MUCH_SOL', 'HARD_CAP_EXCEEDED_BY_SIMULATION']));
      world.simulate = { ...world.simulate, walletSpent: 10_100_000, outGained: 100n };
      expect((await entry(r, u.id)).s!.codes).toContain('OUTPUT_BELOW_MINIMUM');
    });
    it('rejects an order whose quote was too old by the time the simulation finished', async () => {
      const u = await mkUser();
      const fetchedAt = new Date(clock.getTime() - 60_000);
      expect((await entry(runner(cfgFor([u.id])), u.id, 0.01, { fetchedAt })).s!.codes).toContain('QUOTE_TO_SIMULATION_WINDOW');
    });
  });

  describe('failures are recorded as ERROR, never as an acceptance, and never thrown', () => {
    it('a failed swap build', async () => {
      const u = await mkUser(); world.failBuild = true;
      const { s, job } = await entry(runner(cfgFor([u.id])), u.id);
      expect(s).toMatchObject({ outcome: 'ERROR', codes: ['SWAP_BUILD_FAILED'] });
      expect((await row(job.idempotencyKey)).outcome).toBe('ERROR');
    });
    it('a failed node call', async () => {
      const u = await mkUser(); world.failRpc = true;
      expect((await entry(runner(cfgFor([u.id])), u.id)).s).toMatchObject({ outcome: 'ERROR', codes: ['RPC_FAILED'] });
    });
    it('an unexpected error', async () => {
      const u = await mkUser();
      const boom = runner(cfgFor([u.id]), { jupiter: { buildSwap: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:443 token=abc'); } } });
      const { s } = await entry(boom, u.id);
      expect(s).toMatchObject({ outcome: 'ERROR', codes: ['UNEXPECTED'] });
    });
  });

  describe('idempotency', () => {
    it('records a job once, returns the same verdict on a redelivery, and makes no second round of calls', async () => {
      const u = await mkUser(); const r = runner(cfgFor([u.id]));
      const job = mkJob(u.id);
      const first = await entry(r, u.id, 0.01, {}, job);
      const calls = { ...world.calls };
      const second = await entry(r, u.id, 0.01, {}, job);
      expect(second.s).toEqual(first.s);
      expect(world.calls).toEqual(calls);
      expect(await db.dryRun.count({ where: { idempotencyKey: job.idempotencyKey } })).toBe(1);
      expect(await db.auditLog.count({ where: { userId: u.id, action: 'executor.dry_run' } })).toBe(1);
    });
    it('two simultaneous deliveries of one job end with one row and the same verdict', async () => {
      const u = await mkUser(); const r = runner(cfgFor([u.id]));
      const job = mkJob(u.id);
      const [a, b] = await Promise.all([entry(r, u.id, 0.01, {}, job), entry(r, u.id, 0.01, {}, job)]);
      expect(a.s!.id).toBe(b.s!.id);
      expect(await db.dryRun.count({ where: { idempotencyKey: job.idempotencyKey } })).toBe(1);
    });
  });

  describe('through the real execution path', () => {
    const deps = (userId: string, allow: string[], mode: 'AUTO' | 'SEMI_AUTO' = 'AUTO'): ExecutionDeps => ({
      jupiter: { getQuote: async ({ inputMint, outputMint, amount }) => ({ ...quoteFor(inputMint === WSOL_MINT ? 'BUY' : 'SELL', amount.toString()), inputMint, outputMint, fetchedAt: clock }) },
      async loadPreTradeState() {
        return {
          positionBaseUnits: '1000', limits: { maxPerTradeSol: 1 },
          context: {
            now: clock, mode, aiAccessEnabled: true, agentPaused: false, idempotencyKey: `ctx-${userId}`, token: { mint, blacklisted: false, liquidityUsd: 1_000_000 }, signals: { opportunityScore: 90, consensusScore: 80 },
            portfolio: { totalValueSol: 0.5, walletBalanceSol: 0.5, openPositions: 0, hasPositionInToken: false, tokenExposureSol: 0, allocatedTodaySol: 0, realizedPnlTodaySol: 0, drawdownPct: 0 },
            history: { seenIdempotencyKeys: [], lastTradeAtForToken: null, lastSameOrderAt: null },
          },
        };
      },
      async recordRisk() { /* the risk decision store is covered by the B4 tests */ },
      dryRunner: runner(cfgFor(allow)), now: () => clock,
    });

    it('an AUTO order for an allow-listed user ends as dry_run, and still creates no order, trade or position', async () => {
      const u = await mkUser();
      const before = await tradeRows(u.id);
      const job = ExecutionJobSchema.parse({ userId: u.id, idempotencyKey: `e2e-${tag}-1`, mint, decision: { ...payload(), suggestedPositionSizePct: 2 } });
      const out = await runExecution(db, job, deps(u.id, [u.id]));
      expect(out.status).toBe('dry_run');
      expect(out.signature).toBeUndefined();
      expect(out.dryRun).toMatchObject({ outcome: 'ACCEPTED' });
      expect(await tradeRows(u.id)).toEqual(before);
      expect((await row(job.idempotencyKey)).outcome).toBe('ACCEPTED');
    });
    it('the same order for a user who is not on the list ends as execution_disabled, exactly as before B5a', async () => {
      const u = await mkUser();
      const job = ExecutionJobSchema.parse({ userId: u.id, idempotencyKey: `e2e-${tag}-2`, mint, decision: payload() });
      const out = await runExecution(db, job, deps(u.id, []));
      expect(out.status).toBe('execution_disabled');
      expect(await db.dryRun.count({ where: { userId: u.id } })).toBe(0);
    });
    it('a user who switched to PAPER after the order was queued is rejected by the dry run, not executed', async () => {
      const u = await mkUser();
      await db.user.update({ where: { id: u.id }, data: { mode: 'PAPER' } });
      const job = ExecutionJobSchema.parse({ userId: u.id, idempotencyKey: `e2e-${tag}-3`, mint, decision: payload() });
      const out = await runExecution(db, job, deps(u.id, [u.id]));
      expect(out.status).toBe('dry_run');
      expect(out.dryRun).toMatchObject({ outcome: 'REJECTED', codes: ['MODE_NOT_EXECUTABLE'] });
    });
    it('a confirmed order ends as dry_run, and the confirmation is marked resolved with that result', async () => {
      const u = await mkUser({ mode: 'SEMI_AUTO' });
      const conf = await db.pendingConfirmation.create({ data: { userId: u.id, idempotencyKey: `pc-${tag}`, kind: 'ENTRY', mint, job: {}, sizeSol: 0.01, quote: {}, expiresAt: new Date(Date.now() + 300_000), status: 'CLAIMED' } });
      const job = ExecutionJobSchema.parse({ userId: u.id, idempotencyKey: `confirm:${conf.id}`, confirmationId: conf.id, mint, decision: payload() });
      const out = await runExecution(db, job, deps(u.id, [u.id], 'SEMI_AUTO'));
      expect(out.status).toBe('dry_run');
      expect((await db.pendingConfirmation.findUniqueOrThrow({ where: { id: conf.id } })).result).toMatch(/^dry_run/);
    });
  });

  it('the associated token accounts it reads are the derived ones for that wallet and mint', async () => {
    const u = await mkUser();
    let addresses: string[] = [];
    const spy: DryRunDeps['rpc'] = { ...rpc, simulateTransaction: async (tx, a) => { addresses = a; return rpc.simulateTransaction(tx, a); } };
    await entry(runner(cfgFor([u.id]), { rpc: spy }), u.id);
    expect(addresses).toEqual([u.wallet, associatedTokenAddress(u.wallet, WSOL_MINT), associatedTokenAddress(u.wallet, mint)]);
  });
});
