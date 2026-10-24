import { describe, expect, it } from 'vitest';
import { NARRATIVE_WARN_AGE_MS, radarWarnings, summarizeRadarSafety, type RadarWarningInput } from './radar-status-core';

const healthy: RadarWarningInput = {
  calls24h: 2,
  callsWithoutFreshEntry24h: 0,
  freshUnder100k: 40,
  linkedFreshUnder100k: 20,
  linkedUnpricedConfirmed: 0,
  narrativeAgeMs: 60_000,
};

describe('radar status warnings', () => {
  it('reports nothing when calls, prices, links and narratives are current', () => {
    expect(radarWarnings(healthy)).toEqual([]);
  });

  it('reports calls without fresh entry evidence separately from having no calls', () => {
    expect(radarWarnings({ ...healthy, callsWithoutFreshEntry24h: 1 })).toEqual(['1_CALLS_WITHOUT_FRESH_ENTRY']);
    expect(radarWarnings({ ...healthy, calls24h: 0 })).toEqual(['NO_RADAR_CALL_24H']);
  });

  it('keeps the existing supply and narrative warnings', () => {
    expect(radarWarnings({ ...healthy, freshUnder100k: 0, linkedFreshUnder100k: 0 })).toEqual([
      'NO_FRESH_SUB_100K_PRICES',
      'NO_FRESH_LINKED_SUB_100K_PRICES',
    ]);
    expect(radarWarnings({ ...healthy, narrativeAgeMs: NARRATIVE_WARN_AGE_MS + 1 })).toEqual(['NARRATIVE_NOT_UPDATED_6H']);
    expect(radarWarnings({ ...healthy, narrativeAgeMs: null })).toEqual(['NARRATIVE_NOT_UPDATED_6H']);
    expect(radarWarnings({ ...healthy, linkedUnpricedConfirmed: 6 })).toEqual(['6_CONFIRMED_LINKED_TOKENS_WITHOUT_ANY_PRICE']);
  });
});

describe('radar safety summary', () => {
  it('counts statuses, modes and recurring evidence gaps without treating malformed data as pass', () => {
    const summary = summarizeRadarSafety([
      { status: 'UNKNOWN', mode: 'shadow', evaluatedAt: '2026-10-22T10:00:00Z', unknowns: ['DEV_HOLDING', 'LP_CONTROL'], policyVersion: 'radar-safety-v1', facts: { evidenceSource: 'rugcheck' } },
      { status: 'BLOCK', mode: 'shadow', evaluatedAt: '2026-10-22T11:00:00Z', blockers: ['TOP10_CONCENTRATION'], policyVersion: 'radar-safety-v1' },
      { status: 'PASS', mode: 'shadow', evaluatedAt: '2026-10-22T12:00:00Z', warnings: ['AUTHORITY_NOT_PROVEN'] },
      { status: 'WHAT', mode: 'shadow' },
      null,
      'not-a-snapshot',
    ], 2);
    expect(summary).toMatchObject({
      evaluated: 3, pass: 1, unknown: 1, block: 1, blockedDecisions: 2,
      modes: { shadow: 3 },
      evidenceSources: { rugcheck: 1 },
      blockers: { TOP10_CONCENTRATION: 1 },
      unknowns: { DEV_HOLDING: 1, LP_CONTROL: 1 },
      warnings: { AUTHORITY_NOT_PROVEN: 1 },
      latest: { status: 'PASS', mode: 'shadow', policyVersion: null, at: '2026-10-22T12:00:00Z' },
    });
  });

  it('returns zeroes and no latest snapshot when nothing has been evaluated', () => {
    expect(summarizeRadarSafety([])).toMatchObject({ evaluated: 0, pass: 0, unknown: 0, block: 0, blockedDecisions: 0, latest: null });
  });
});
