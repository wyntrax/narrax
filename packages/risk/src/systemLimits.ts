import { GLOBAL_LIMITS } from './limits';
import type { RiskLimits } from './types';

/**
 * System limits an admin may change. The numbers in GLOBAL_LIMITS (in code) are the ABSOLUTE CEILING: an admin can make the
 * system stricter than the code, never looser. Loosening beyond the code takes a code change and a deploy, on purpose.
 * Each limit also has a hard bound on the strict side, so a typo cannot switch trading off by accident.
 *
 * A "cap" limit is a maximum (lower is stricter). A "floor" limit is a minimum (higher is stricter).
 */
interface Rule { kind: 'cap' | 'floor'; /** Strictest value allowed. */ bound: number; integer?: boolean }

export const SYSTEM_LIMIT_RULES: Record<keyof RiskLimits, Rule> = {
  maxPerTradeSol: { kind: 'cap', bound: 0.01 },
  maxDailyAllocationSol: { kind: 'cap', bound: 0.05 },
  maxTokenExposurePct: { kind: 'cap', bound: 1 },
  maxOpenPositions: { kind: 'cap', bound: 1, integer: true },
  maxDailyLossPct: { kind: 'cap', bound: 1 },
  maxDrawdownPct: { kind: 'cap', bound: 1 },
  minConfidence: { kind: 'floor', bound: 0.99 },
  minOpportunityScore: { kind: 'floor', bound: 99 },
  minConsensusScore: { kind: 'floor', bound: 99 },
  minLiquidityUsd: { kind: 'floor', bound: 100_000_000 },
  maxSlippageBps: { kind: 'cap', bound: 10, integer: true },
  maxPriceImpactPct: { kind: 'cap', bound: 0.1 },
  minSolReserve: { kind: 'floor', bound: 10 },
  cooldownSeconds: { kind: 'floor', bound: 86_400, integer: true },
  duplicateWindowSeconds: { kind: 'floor', bound: 86_400, integer: true },
};

export const SYSTEM_LIMIT_FIELDS = Object.keys(SYSTEM_LIMIT_RULES) as (keyof RiskLimits)[];
/** Where the admin's overrides are stored (SystemSetting key). */
export const SYSTEM_LIMITS_KEY = 'risk.system_limits';

export type LimitError = 'UNKNOWN_FIELD' | 'NOT_A_NUMBER' | 'NOT_INTEGER' | 'LOOSER_THAN_CODE_CEILING' | 'STRICTER_THAN_ALLOWED';

/** Whether one value is allowed for one limit: between the code ceiling and the hard bound, inclusive. */
export function checkLimit(field: string, value: unknown): LimitError | null {
  if (!Object.prototype.hasOwnProperty.call(SYSTEM_LIMIT_RULES, field)) return 'UNKNOWN_FIELD';
  const rule = SYSTEM_LIMIT_RULES[field as keyof RiskLimits], ceiling = GLOBAL_LIMITS[field as keyof RiskLimits];
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'NOT_A_NUMBER';
  if (rule.integer && !Number.isInteger(value)) return 'NOT_INTEGER';
  if (rule.kind === 'cap') return value > ceiling ? 'LOOSER_THAN_CODE_CEILING' : value < rule.bound ? 'STRICTER_THAN_ALLOWED' : null;
  return value < ceiling ? 'LOOSER_THAN_CODE_CEILING' : value > rule.bound ? 'STRICTER_THAN_ALLOWED' : null;
}

export type SystemLimitsInput = { ok: true; value: Partial<RiskLimits> } | { ok: false; errors: { field: string; code: LimitError | 'NOT_AN_OBJECT' }[] };

/** Checks an admin's submitted overrides. Unknown fields are refused, not ignored. */
export function validateSystemLimitsInput(input: unknown): SystemLimitsInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, errors: [{ field: '', code: 'NOT_AN_OBJECT' }] };
  const errors: { field: string; code: LimitError }[] = [], value: Record<string, number> = {};
  for (const [field, v] of Object.entries(input)) {
    const err = checkLimit(field, v);
    if (err) errors.push({ field, code: err }); else value[field] = v as number;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: value as Partial<RiskLimits> };
}

/**
 * The limits the Governor enforces as the system ceiling: the code defaults, with each valid stored override on top.
 * Anything missing, malformed or looser than the code is ignored and listed in `invalid`, so a damaged setting can never
 * loosen the system (defense in depth: the API refuses such values too).
 */
export function resolveSystemLimits(stored: unknown): { limits: RiskLimits; overrides: Partial<RiskLimits>; invalid: string[] } {
  const limits: RiskLimits = { ...GLOBAL_LIMITS }, overrides: Record<string, number> = {}, invalid: string[] = [];
  if (stored != null && typeof stored === 'object' && !Array.isArray(stored)) {
    for (const [field, v] of Object.entries(stored)) {
      if (checkLimit(field, v) === null) { (limits as unknown as Record<string, number>)[field] = v as number; overrides[field] = v as number; } else invalid.push(field);
    }
  } else if (stored != null) invalid.push('(whole setting)');
  return { limits, overrides: overrides as Partial<RiskLimits>, invalid };
}
