import { GLOBAL_LIMITS } from '@narra/risk';

/**
 * The only things the agent may ask for, and only in the cautious direction. Pausing and tightening add caution.
 * Resuming, raising a limit, enabling AI access, switching mode and everything else that adds risk are not here.
 */
export const TIGHTENABLE = {
  maxPerTradeSol: { direction: 'lower', bound: 0.01, system: GLOBAL_LIMITS.maxPerTradeSol, integer: false },
  maxDailyAllocationSol: { direction: 'lower', bound: 0.05, system: GLOBAL_LIMITS.maxDailyAllocationSol, integer: false },
  maxTokenExposurePct: { direction: 'lower', bound: 1, system: GLOBAL_LIMITS.maxTokenExposurePct, integer: false },
  maxOpenPositions: { direction: 'lower', bound: 1, system: GLOBAL_LIMITS.maxOpenPositions, integer: true },
  maxDailyLossPct: { direction: 'lower', bound: 1, system: GLOBAL_LIMITS.maxDailyLossPct, integer: false },
  minConfidence: { direction: 'higher', bound: 0.99, system: GLOBAL_LIMITS.minConfidence, integer: false },
} as const;

export type TightenableField = keyof typeof TIGHTENABLE;
export const TIGHTENABLE_FIELDS = Object.keys(TIGHTENABLE) as [TightenableField, ...TightenableField[]];

export type TightenCheck = { ok: true } | { ok: false; code: 'UNKNOWN_FIELD' | 'NOT_A_NUMBER' | 'NOT_INTEGER' | 'NOT_STRICTER' | 'OUT_OF_BOUNDS' };

const EPS = 1e-9;

/**
 * Whether `value` is a strictly more cautious setting than `current`, and inside the allowed range
 * (never looser than the system limit, never past the floor that would just switch trading off by typo).
 * Run when the agent proposes and again, against the then-current value, when the user applies.
 */
export function validateTighten(field: string, value: unknown, current: number): TightenCheck {
  if (!Object.prototype.hasOwnProperty.call(TIGHTENABLE, field)) return { ok: false, code: 'UNKNOWN_FIELD' };
  const rule = TIGHTENABLE[field as TightenableField];
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(current)) return { ok: false, code: 'NOT_A_NUMBER' };
  if (rule.integer && !Number.isInteger(value)) return { ok: false, code: 'NOT_INTEGER' };
  if (rule.direction === 'lower') {
    if (value > rule.system + EPS || value < rule.bound - EPS) return { ok: false, code: 'OUT_OF_BOUNDS' };
    return value < current - EPS ? { ok: true } : { ok: false, code: 'NOT_STRICTER' };
  }
  if (value < rule.system - EPS || value > rule.bound + EPS) return { ok: false, code: 'OUT_OF_BOUNDS' };
  return value > current + EPS ? { ok: true } : { ok: false, code: 'NOT_STRICTER' };
}

export const describeTighten = (field: TightenableField, from: number, to: number) => `Change ${field} from ${from} to ${to}`;
