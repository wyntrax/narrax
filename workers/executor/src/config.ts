import { DEFAULT_TX_LIMITS, type TxLimits } from '@narra/tx-verify';

const LAMPORTS = 1_000_000_000;

/**
 * Hard ceilings, written in code on purpose. Configuration can make the executor stricter, never looser than these,
 * and a value above a ceiling stops the process at startup instead of being quietly clamped.
 * Canary values from the approved security review plan (D4). All are starting values, not validated.
 */
export const CEILINGS = {
  /** Most SOL one transaction may spend (the input to the swap), independent of the Risk Governor. */
  hardCapSol: 0.05,
  dailyCapSol: 0.25,
  /** Fees and account rent allowed on top of the swap input. */
  overheadSol: 0.01,
  priorityFeeSol: 0.005,
  broadcastWindowMs: 30_000,
} as const;

export const DEFAULTS = {
  hardCapSol: 0.01,
  dailyCapSol: 0.05,
  overheadSol: 0.005,
  priorityFeeSol: 0.001,
  /** How long a quote may be old by the time the simulation finishes. In B5b this becomes the quote-to-broadcast window. */
  broadcastWindowMs: 10_000,
} as const;

export interface ExecutorConfig {
  /** B5a has one mode. */
  mode: 'dry_run';
  /** User ids the dry run applies to. Empty means nobody. */
  allowlist: ReadonlySet<string>;
  hardCapSol: number;
  dailyCapSol: number;
  broadcastWindowMs: number;
  limits: TxLimits;
}

export class ConfigError extends Error {}

function num(env: Record<string, string | undefined>, name: string, fallback: number, ceiling: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) throw new ConfigError(`${name} must be a positive number.`);
  if (v > ceiling) throw new ConfigError(`${name}=${v} is above the built-in ceiling of ${ceiling}. Change the ceiling in code, with review, if this is intended.`);
  return v;
}

/** Reads the executor's settings from the environment. Throws on anything unexpected: the process must not start with a doubtful config. */
export function loadExecutorConfig(env: Record<string, string | undefined>): ExecutorConfig {
  const mode = env.EXECUTOR_MODE ?? 'dry_run';
  if (mode !== 'dry_run') throw new ConfigError(`EXECUTOR_MODE=${mode} is not supported. This build only has dry_run: it cannot sign or send.`);

  const allowlist = new Set<string>();
  for (const id of (env.EXECUTOR_ALLOWLIST_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ConfigError('EXECUTOR_ALLOWLIST_USER_IDS has an entry that is not a user id.');
    allowlist.add(id);
  }

  const hardCapSol = num(env, 'EXECUTOR_HARD_CAP_SOL', DEFAULTS.hardCapSol, CEILINGS.hardCapSol);
  const dailyCapSol = num(env, 'EXECUTOR_DAILY_CAP_SOL', DEFAULTS.dailyCapSol, CEILINGS.dailyCapSol);
  if (hardCapSol > dailyCapSol) throw new ConfigError('EXECUTOR_HARD_CAP_SOL cannot be above EXECUTOR_DAILY_CAP_SOL.');
  const overheadSol = num(env, 'EXECUTOR_MAX_OVERHEAD_SOL', DEFAULTS.overheadSol, CEILINGS.overheadSol);
  const priorityFeeSol = num(env, 'EXECUTOR_MAX_PRIORITY_FEE_SOL', DEFAULTS.priorityFeeSol, CEILINGS.priorityFeeSol);
  const broadcastWindowMs = num(env, 'EXECUTOR_BROADCAST_WINDOW_MS', DEFAULTS.broadcastWindowMs, CEILINGS.broadcastWindowMs);

  return {
    mode: 'dry_run', allowlist, hardCapSol, dailyCapSol, broadcastWindowMs,
    limits: { ...DEFAULT_TX_LIMITS, maxOverheadLamports: BigInt(Math.round(overheadSol * LAMPORTS)), maxPriorityFeeLamports: BigInt(Math.round(priorityFeeSol * LAMPORTS)) },
  };
}
