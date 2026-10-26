import { TOKEN_PROGRAM } from './programs';
import type { Reason, SwapExpectations } from './verify';

/** An account as the RPC returns it with base64 encoding. */
export interface RawAccount {
  lamports: number;
  owner: string;
  /** Base64 account data. */
  data: string;
}

/** The accounts a dry run reads before and after the simulated swap. */
export interface SimulatedBalances {
  /** The user's wallet. Must exist. */
  wallet: RawAccount | null;
  /** The user's token account for the input mint, or null if it does not exist (zero tokens). */
  inputAccount: RawAccount | null;
  /** The user's token account for the output mint. */
  outputAccount: RawAccount | null;
}

export interface SimulationFacts {
  err: unknown | null;
  unitsConsumed: number | null;
  pre: SimulatedBalances;
  post: SimulatedBalances;
}

export interface EffectExpectations extends Pick<SwapExpectations, 'side' | 'inAmount'> {
  /** The least the quote promises to deliver after slippage (Jupiter's otherAmountThreshold), in output base units. */
  minOutAmount: bigint;
  maxOverheadLamports: bigint;
  maxComputeUnits: number;
}

export interface EffectSummary {
  err: string | null;
  unitsConsumed: number | null;
  /** Positive means the wallet lost SOL. Fees and rent included. */
  walletLamportsSpent: string | null;
  inputTokensSpent: string | null;
  outputTokensGained: string | null;
}

export interface EffectResult { ok: boolean; reasons: Reason[]; summary: EffectSummary }

/** SPL token account layout: mint (32), owner (32), amount (u64 LE at offset 64). Returns null when it does not look like one. */
export function tokenAmountOf(acct: RawAccount | null): bigint | null {
  if (!acct) return 0n; // the account does not exist, which means it holds nothing
  // Simulation can return a closed account as an empty zero-lamport object instead of null.
  // Require the literal empty encoding: malformed/nonempty data must not be normalized away.
  if (acct.lamports === 0 && acct.data === '') return 0n;
  if (acct.owner !== TOKEN_PROGRAM) return null;
  const bytes = Buffer.from(acct.data, 'base64');
  if (bytes.length < 72) return null;
  return bytes.readBigUInt64LE(64);
}

/**
 * Checks what a simulated swap would do to the user's balances. This is the check that sees through the opaque Jupiter instruction:
 * whatever the route does inside, the user's wallet and token accounts must end up where the quote promised.
 * Pure. Every unknown is a rejection.
 */
export function verifySimulation(f: SimulationFacts, exp: EffectExpectations): EffectResult {
  const reasons: Reason[] = [];
  const fail = (code: string, message: string) => reasons.push({ code, message });
  const summary: EffectSummary = { err: f.err == null ? null : JSON.stringify(f.err).slice(0, 200), unitsConsumed: f.unitsConsumed, walletLamportsSpent: null, inputTokensSpent: null, outputTokensGained: null };
  const done = (): EffectResult => ({ ok: reasons.length === 0, reasons, summary });

  if (f.err != null) { fail('SIMULATION_FAILED', `The simulation failed: ${summary.err}`); return done(); }
  if (f.unitsConsumed === null) fail('SIMULATION_NO_UNITS', 'The simulation did not report compute units.');
  else if (f.unitsConsumed > exp.maxComputeUnits) fail('SIMULATION_UNITS_TOO_HIGH', `The simulation used ${f.unitsConsumed} compute units, above ${exp.maxComputeUnits}.`);

  if (!f.pre.wallet || !f.post.wallet) { fail('WALLET_ACCOUNT_MISSING', 'The wallet account could not be read before or after the simulation.'); return done(); }
  const preIn = tokenAmountOf(f.pre.inputAccount); const postIn = tokenAmountOf(f.post.inputAccount);
  const preOut = tokenAmountOf(f.pre.outputAccount); const postOut = tokenAmountOf(f.post.outputAccount);
  if (preIn === null || postIn === null || preOut === null || postOut === null) { fail('TOKEN_ACCOUNT_UNREADABLE', 'A token account was not a readable Token program account.'); return done(); }

  const lamportsSpent = BigInt(f.pre.wallet.lamports) - BigInt(f.post.wallet.lamports);
  const inputSpent = preIn - postIn;
  const outputGained = postOut - preOut;
  summary.walletLamportsSpent = lamportsSpent.toString();
  summary.inputTokensSpent = inputSpent.toString();
  summary.outputTokensGained = outputGained.toString();

  if (exp.side === 'BUY') {
    // The wallet may lose the swap input plus fees and rent, and nothing more.
    if (lamportsSpent > exp.inAmount + exp.maxOverheadLamports) fail('WALLET_LOSES_TOO_MUCH_SOL', `The wallet would lose ${lamportsSpent} lamports, above the swap input ${exp.inAmount} plus the allowed overhead ${exp.maxOverheadLamports}.`);
    if (outputGained < exp.minOutAmount) fail('OUTPUT_BELOW_MINIMUM', `The wallet would gain ${outputGained} tokens, below the quote's minimum ${exp.minOutAmount}.`);
  } else {
    // Selling: no more tokens may leave than the quote's input, SOL must come back, and fees may eat only the overhead.
    if (inputSpent > exp.inAmount) fail('WALLET_LOSES_TOO_MANY_TOKENS', `The wallet would lose ${inputSpent} tokens, more than the swap input ${exp.inAmount}.`);
    if (inputSpent <= 0n) fail('NO_TOKENS_SOLD', 'The simulation sold no tokens.');
    const gained = -lamportsSpent;
    if (gained + exp.maxOverheadLamports < exp.minOutAmount) fail('PROCEEDS_BELOW_MINIMUM', `The wallet would gain ${gained} lamports, below the quote's minimum ${exp.minOutAmount} even allowing ${exp.maxOverheadLamports} for fees.`);
  }
  if (exp.minOutAmount <= 0n) fail('NO_MINIMUM_OUTPUT', 'The quote has no minimum output, so the result cannot be checked.');
  return done();
}
