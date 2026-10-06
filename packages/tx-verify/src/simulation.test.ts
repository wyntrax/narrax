import { describe, expect, it } from 'vitest';
import { verifySimulation, tokenAmountOf, type EffectExpectations, type RawAccount, type SimulationFacts } from './simulation';
import { TOKEN_PROGRAM } from './programs';

const tokenAcct = (amount: bigint, owner = TOKEN_PROGRAM): RawAccount => {
  const b = Buffer.alloc(165); b.writeBigUInt64LE(amount, 64);
  return { lamports: 2_039_280, owner, data: b.toString('base64') };
};
const wallet = (lamports: number): RawAccount => ({ lamports, owner: '11111111111111111111111111111111', data: '' });
const facts = (o: { preSol: number; postSol: number; preIn?: bigint | null; postIn?: bigint | null; preOut?: bigint | null; postOut?: bigint | null; err?: unknown; units?: number | null }): SimulationFacts => ({
  err: o.err ?? null, unitsConsumed: o.units === undefined ? 150_000 : o.units,
  pre: { wallet: wallet(o.preSol), inputAccount: o.preIn === null ? null : tokenAcct(o.preIn ?? 0n), outputAccount: o.preOut === null ? null : tokenAcct(o.preOut ?? 0n) },
  post: { wallet: wallet(o.postSol), inputAccount: o.postIn === null ? null : tokenAcct(o.postIn ?? 0n), outputAccount: o.postOut === null ? null : tokenAcct(o.postOut ?? 0n) },
});
const buyExp: EffectExpectations = { side: 'BUY', inAmount: 10_000_000n, minOutAmount: 900n, maxOverheadLamports: 5_000_000n, maxComputeUnits: 1_400_000 };
const sellExp: EffectExpectations = { side: 'SELL', inAmount: 1000n, minOutAmount: 9_000_000n, maxOverheadLamports: 5_000_000n, maxComputeUnits: 1_400_000 };
const codes = (r: { reasons: { code: string }[] }) => r.reasons.map((x) => x.code);

describe('tokenAmountOf', () => {
  it('reads the amount, treats a missing account as zero, and refuses anything that is not a Token account', () => {
    expect(tokenAmountOf(tokenAcct(12345n))).toBe(12345n);
    expect(tokenAmountOf(null)).toBe(0n);
    expect(tokenAmountOf(tokenAcct(5n, 'SomeOtherProgram1111111111111111111111111111'))).toBeNull();
    expect(tokenAmountOf({ lamports: 1, owner: TOKEN_PROGRAM, data: Buffer.alloc(10).toString('base64') })).toBeNull();
  });
});

describe('verifySimulation: buying', () => {
  it('accepts a swap that costs the input plus normal overhead and delivers at least the minimum', () => {
    const r = verifySimulation(facts({ preSol: 1_000_000_000, postSol: 1_000_000_000 - 10_000_000 - 2_100_000, preOut: null, postOut: 1000n }), buyExp);
    expect(r.reasons).toEqual([]);
    expect(r.summary).toMatchObject({ walletLamportsSpent: '12100000', outputTokensGained: '1000' });
  });
  it('rejects a wallet that loses more SOL than input plus overhead', () => {
    const r = verifySimulation(facts({ preSol: 1_000_000_000, postSol: 1_000_000_000 - 20_000_000, preOut: 0n, postOut: 1000n }), buyExp);
    expect(codes(r)).toContain('WALLET_LOSES_TOO_MUCH_SOL');
  });
  it('rejects an output below the quote minimum, and no output at all', () => {
    expect(codes(verifySimulation(facts({ preSol: 100, postSol: 100, preOut: 0n, postOut: 899n }), buyExp))).toContain('OUTPUT_BELOW_MINIMUM');
    expect(codes(verifySimulation(facts({ preSol: 100, postSol: 100, preOut: 5n, postOut: 5n }), buyExp))).toContain('OUTPUT_BELOW_MINIMUM');
  });
  it('rejects a failed simulation, missing compute units and an over-budget one', () => {
    expect(codes(verifySimulation(facts({ preSol: 1, postSol: 1, err: { InstructionError: [3, 'Custom'] } }), buyExp))).toEqual(['SIMULATION_FAILED']);
    expect(codes(verifySimulation(facts({ preSol: 100, postSol: 100, postOut: 1000n, units: null }), buyExp))).toContain('SIMULATION_NO_UNITS');
    expect(codes(verifySimulation(facts({ preSol: 100, postSol: 100, postOut: 1000n, units: 2_000_000 }), buyExp))).toContain('SIMULATION_UNITS_TOO_HIGH');
  });
  it('rejects a missing wallet account and an unreadable token account instead of assuming zero', () => {
    const f = facts({ preSol: 100, postSol: 100, postOut: 1000n }); f.post.wallet = null;
    expect(codes(verifySimulation(f, buyExp))).toEqual(['WALLET_ACCOUNT_MISSING']);
    const g = facts({ preSol: 100, postSol: 100 }); g.post.outputAccount = tokenAcct(1n, 'EvilProgram11111111111111111111111111111111');
    expect(codes(verifySimulation(g, buyExp))).toEqual(['TOKEN_ACCOUNT_UNREADABLE']);
  });
  it('rejects when the quote gives no usable minimum, so nothing can be checked', () => {
    expect(codes(verifySimulation(facts({ preSol: 100, postSol: 100, postOut: 1000n }), { ...buyExp, minOutAmount: 0n }))).toContain('NO_MINIMUM_OUTPUT');
  });
});

describe('verifySimulation: selling', () => {
  it('accepts a sale of at most the input that returns at least the minimum', () => {
    const r = verifySimulation(facts({ preSol: 100_000_000, postSol: 100_000_000 + 9_500_000, preIn: 1000n, postIn: 0n }), sellExp);
    expect(r.reasons).toEqual([]);
  });
  it('allows fees to eat into proceeds only up to the overhead', () => {
    expect(verifySimulation(facts({ preSol: 100_000_000, postSol: 100_000_000 + 4_000_000, preIn: 1000n, postIn: 0n }), sellExp).ok).toBe(true); // 4M + 5M overhead >= 9M
    expect(codes(verifySimulation(facts({ preSol: 100_000_000, postSol: 100_000_000 + 3_000_000, preIn: 1000n, postIn: 0n }), sellExp))).toContain('PROCEEDS_BELOW_MINIMUM');
  });
  it('rejects selling more tokens than the quote said, and selling nothing', () => {
    expect(codes(verifySimulation(facts({ preSol: 0, postSol: 9_999_999, preIn: 5000n, postIn: 3000n }), sellExp))).toContain('WALLET_LOSES_TOO_MANY_TOKENS');
    expect(codes(verifySimulation(facts({ preSol: 0, postSol: 9_999_999, preIn: 1000n, postIn: 1000n }), sellExp))).toContain('NO_TOKENS_SOLD');
  });
});
