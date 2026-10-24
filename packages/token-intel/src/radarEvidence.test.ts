import { expect, it } from 'vitest';
import { radarEvidenceIssue, isRadarEvidenceCandidate, RADAR_EVIDENCE_LIMITS as L } from './radarEvidence';
import { EARLY_RULES } from './earlyRadar';
const now = new Date('2026-10-21T00:00:00Z');
const market = { at: now, priceUsd: 1 }, holders = { at: now };
it('accepts exact boundaries and rejects the next millisecond separately for prices and holders', () => {
  expect(radarEvidenceIssue({ ...market, at: new Date(+now-L.marketMaxAgeMs) }, { at: new Date(+now-L.holdersMaxAgeMs) }, now)).toBeNull();
  expect(radarEvidenceIssue({ ...market, at: new Date(+now-L.marketMaxAgeMs-1) }, holders, now)).toBe('MARKET_STALE');
  expect(radarEvidenceIssue(market, { at: new Date(+now-L.holdersMaxAgeMs-1) }, now)).toBe('HOLDERS_STALE');
});
it('rejects missing, invalid and future timestamps instead of falling back to an older observation', () => {
  expect(radarEvidenceIssue(null, holders, now)).toBe('MARKET_MISSING');
  expect(radarEvidenceIssue(market, null, now)).toBe('HOLDERS_MISSING');
  expect(radarEvidenceIssue({ ...market, at: new Date(NaN) }, holders, now)).toBe('MARKET_INVALID');
  expect(radarEvidenceIssue(market, { at: new Date(NaN) }, now)).toBe('HOLDERS_INVALID');
  expect(radarEvidenceIssue({ ...market, at: new Date(+now+1) }, holders, now)).toBe('MARKET_FUTURE');
  expect(radarEvidenceIssue(market, { at: new Date(+now+1) }, now)).toBe('HOLDERS_FUTURE');
});
it.each([null,0,-1,NaN,Infinity])('rejects an unusable price %s even with fresh timestamps', priceUsd => {
  expect(radarEvidenceIssue({at:now,priceUsd},holders,now)).toBe('MARKET_INVALID');
});
it('counts only tokens that would enter the early lane, so skip totals are not inflated', () => {
  const ceiling = EARLY_RULES.maxMarketCapUsd;
  expect(isRadarEvidenceCandidate(ceiling - 1, 'UNKNOWN')).toBe(true);
  expect(isRadarEvidenceCandidate(ceiling, 'UNKNOWN')).toBe(false);
  expect(isRadarEvidenceCandidate(ceiling + 1, 'UNKNOWN')).toBe(false);
  expect(isRadarEvidenceCandidate(ceiling - 1, 'SUSPICIOUS')).toBe(false);
  for (const missing of [null, undefined, NaN, Infinity]) expect(isRadarEvidenceCandidate(missing, 'UNKNOWN')).toBe(false);
});
