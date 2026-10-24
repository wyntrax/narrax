/** Pure warning rules for `radar:status`, kept separate so they can be tested without a database. */

export const NARRATIVE_WARN_AGE_MS = 6 * 3_600_000;

export interface RadarWarningInput {
  calls24h: number;
  /** Calls in the last 24 h whose frozen outcome has no fresh entry price. */
  callsWithoutFreshEntry24h: number;
  freshUnder100k: number;
  linkedFreshUnder100k: number;
  linkedUnpricedConfirmed: number;
  narrativeAgeMs: number | null;
}

/**
 * Liveness warnings. A recent call whose outcome has no fresh entry price is reported separately
 * from stale calls: the alert exists, but the evidence behind it cannot be measured honestly.
 */
export function radarWarnings(input: RadarWarningInput): string[] {
  const warnings: string[] = [];
  if (input.calls24h === 0) warnings.push('NO_RADAR_CALL_24H');
  if (input.callsWithoutFreshEntry24h > 0) warnings.push(`${input.callsWithoutFreshEntry24h}_CALLS_WITHOUT_FRESH_ENTRY`);
  if (input.freshUnder100k === 0) warnings.push('NO_FRESH_SUB_100K_PRICES');
  if (input.linkedFreshUnder100k === 0) warnings.push('NO_FRESH_LINKED_SUB_100K_PRICES');
  if (input.narrativeAgeMs == null || input.narrativeAgeMs > NARRATIVE_WARN_AGE_MS) warnings.push('NARRATIVE_NOT_UPDATED_6H');
  if (input.linkedUnpricedConfirmed > 0) warnings.push(`${input.linkedUnpricedConfirmed}_CONFIRMED_LINKED_TOKENS_WITHOUT_ANY_PRICE`);
  return warnings;
}

export type SafetyStatus = 'PASS' | 'UNKNOWN' | 'BLOCK';

export interface RadarSafetySummary {
  /** Recent alerts that have a frozen snapshot. Legacy calls have none and are not counted as pass/fail. */
  evaluated: number;
  pass: number;
  unknown: number;
  block: number;
  modes: Record<string, number>;
  evidenceSources: Record<string, number>;
  blockers: Record<string, number>;
  unknowns: Record<string, number>;
  warnings: Record<string, number>;
  /** Latest blocked decision persisted by enforcement, even when no alert was created. */
  blockedDecisions: number;
  latest: { status: SafetyStatus; mode: string; policyVersion: string | null; at: string | null } | null;
}

const bump = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] ?? 0) + 1;
};
const strings = (value: unknown, max = 20): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 120).slice(0, max) : [];

/** Pure aggregation for `radar:status`; malformed/legacy settings are ignored, never counted as safe. */
export function summarizeRadarSafety(values: unknown[], blockedDecisions = 0): RadarSafetySummary {
  const out: RadarSafetySummary = {
    evaluated: 0, pass: 0, unknown: 0, block: 0, modes: {}, evidenceSources: {}, blockers: {}, unknowns: {}, warnings: {}, blockedDecisions, latest: null,
  };
  let latestMs = -Infinity;
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const o = value as Record<string, unknown>;
    const status = o.status;
    if (status !== 'PASS' && status !== 'UNKNOWN' && status !== 'BLOCK') continue;
    const mode = typeof o.mode === 'string' && o.mode ? o.mode : 'unknown';
    const at = typeof o.evaluatedAt === 'string' && Number.isFinite(+new Date(o.evaluatedAt)) ? o.evaluatedAt : null;
    out.evaluated++;
    if (status === 'PASS') out.pass++;
    else if (status === 'UNKNOWN') out.unknown++;
    else out.block++;
    bump(out.modes, mode);
    const facts = o.facts;
    if (facts && typeof facts === 'object' && !Array.isArray(facts)) {
      const source = (facts as Record<string, unknown>).evidenceSource;
      if (typeof source === 'string' && source.length > 0 && source.length <= 80) bump(out.evidenceSources, source);
    }
    for (const code of strings(o.blockers)) bump(out.blockers, code);
    for (const code of strings(o.unknowns)) bump(out.unknowns, code);
    for (const code of strings(o.warnings)) bump(out.warnings, code);
    const ms = at ? +new Date(at) : -Infinity;
    if (ms > latestMs) {
      latestMs = ms;
      out.latest = {
        status,
        mode,
        policyVersion: typeof o.policyVersion === 'string' ? o.policyVersion : null,
        at,
      };
    }
  }
  return out;
}
