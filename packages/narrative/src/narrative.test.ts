import { describe, expect, it } from 'vitest';
import { candidateStage, computeNarrativeMetrics, creatorRoles, duplicateShare, hamming, nextStage, normalizeHandle, normalizeText, normalizeTopic, sha256, simhash64, type MentionPoint } from './index';

const NOW = new Date('2026-09-30T12:00:00Z');
const MIN = 60_000;
let seq = 0;
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const WORDS = 'robot arm fleet factory servo warehouse humanoid chip battery sensor vision demo launch token market narrative signal build ship'.split(' ');
const sentence = () => Array.from({ length: 9 }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ') + ` ${Math.floor(rnd() * 1e6)}`;

function m(minutesAgo: number, o: Partial<MentionPoint> & { text?: string } = {}): MentionPoint {
  const text = normalizeText(o.text ?? sentence());
  return { externalId: `m${++seq}`, platform: 'x', creator: `c${seq}`, creatorAgeDays: 400, engagement: 10, at: new Date(NOW.getTime() - minutesAgo * MIN), simhash: simhash64(text), textHash: sha256(text), ...o };
}
/** n mentions spread over one hour slot. slot 0 is the latest hour. */
const hour = (slot: number, n: number, o: Partial<MentionPoint> = {}) => Array.from({ length: n }, (_, i) => m(slot * 60 + 1 + (i * 58) / Math.max(n, 1), o));

describe('normalization', () => {
  it('canonicalizes topics and rejects junk', () => {
    expect(normalizeTopic('#Quantum   LOBSTER!!')).toEqual({ name: 'Quantum Lobster', slug: 'quantum-lobster' });
    expect(normalizeTopic('quantum lobster')?.slug).toBe('quantum-lobster');
    expect(normalizeTopic('a')).toBeNull();
    expect(normalizeTopic('!!!')).toBeNull();
    expect(normalizeHandle(' @Bob ')).toBe('bob');
  });
  it('strips links, tags and punctuation before hashing', () => {
    expect(normalizeText('Buy $LOBSTER now!!! https://x.co/a #moon @someone')).toBe('buy lobster now');
    expect(simhash64(normalizeText('Buy $LOBSTER now https://a.co/1'))).toBe(simhash64(normalizeText('buy lobster NOW!!! https://b.co/2')));
  });
  it('gives similar texts close hashes and unrelated texts far ones', () => {
    const a = simhash64(normalizeText('the robotics narrative is accelerating fast across every platform right now and wallets are buying'));
    const b = simhash64(normalizeText('the robotics narrative is accelerating fast across every platform right now and wallets are selling'));
    const c = simhash64(normalizeText('completely different words about cooking pasta with garlic and olive oil tonight for dinner'));
    expect(hamming(a, a)).toBe(0);
    expect(hamming(a, b)).toBeLessThan(hamming(a, c));
    expect(hamming(a, c)).toBeGreaterThan(16);
  });
});

describe('velocity and stage', () => {
  const baseline = Array.from({ length: 24 }, (_, i) => hour(i + 2, 1)).flat();
  it('flags a sudden surge across creators as accelerating', () => {
    const ms = [...baseline, ...hour(1, 6), ...hour(0, 40, { creatorAgeDays: 300 })].map((x, i) => (i % 3 === 0 ? { ...x, platform: 'reddit' } : x));
    const r = computeNarrativeMetrics(ms, NOW);
    expect(r.mentionVelocity).toBeGreaterThan(100);
    expect(r.acceleration).toBeGreaterThan(0);
    expect(r.stage).toBe('ACCELERATING');
    expect(r.velocityScore).toBeGreaterThan(50);
  });
  it('does not call a handful of posts a surge', () => {
    const r = computeNarrativeMetrics(hour(0, 3), NOW);
    expect(r.stage).toBe('SEED');
    expect(r.velocityScore).toBeLessThan(30);
  });
  it('detects decay after a peak and death after silence', () => {
    const peak = [...hour(0, 30), ...hour(1, 40), ...hour(2, 60), ...hour(3, 100), ...hour(4, 50), ...hour(5, 20), ...hour(6, 10)]
      .map((x, i) => ({ ...x, platform: ['x', 'reddit', 'youtube'][i % 3]! }));
    expect(computeNarrativeMetrics(peak, NOW).stage).toBe('DECAYING');
    const oneQuietHour = [...hour(1, 40, { platform: 'x' }), ...hour(2, 10, { platform: 'reddit' }), ...hour(3, 8, { platform: 'youtube' }), ...hour(26, 5)];
    expect(computeNarrativeMetrics(oneQuietHour, NOW).stage).toBe('DECAYING'); // one silent hour after a surge is decay, not death
    const dead = hour(30, 80).map((x, i) => ({ ...x, platform: ['x', 'reddit', 'youtube'][i % 3]! }));
    expect(computeNarrativeMetrics(dead, NOW).stage).toBe('DEAD');
  });
  it('separates a rising mainstream narrative from a saturated one', () => {
    const plat = (xs: MentionPoint[]) => xs.map((x, i) => ({ ...x, platform: ['x', 'reddit', 'youtube', 'news'][i % 4]!, creator: `u${i}` }));
    const rising = plat([...Array.from({ length: 24 }, (_, i) => hour(i + 2, 10)).flat(), ...hour(1, 40), ...hour(0, 100)]);
    expect(computeNarrativeMetrics(rising, NOW).stage).toBe('MAINSTREAM');
    const flat = plat([...Array.from({ length: 24 }, (_, i) => hour(i + 2, 190)).flat(), ...hour(1, 205), ...hour(0, 200)]);
    expect(computeNarrativeMetrics(flat, NOW).stage).toBe('SATURATED');
  });
  it('ignores mentions outside the 48 hour window or in the future', () => {
    const r = computeNarrativeMetrics([...hour(60, 50), m(-30)], NOW);
    expect(r.currentHourly).toBe(0);
    expect(r.peakHourly).toBe(0);
  });
});

describe('lifecycle history', () => {
  it('moves up one stage at a time and never slides back on one quiet reading', () => {
    expect(nextStage('SEED', 'ACCELERATING')).toBe('EMERGING');
    expect(nextStage('EMERGING', 'SATURATED')).toBe('ACCELERATING');
    expect(nextStage('ACCELERATING', 'SEED')).toBe('ACCELERATING');
    expect(nextStage('MAINSTREAM', 'EMERGING')).toBe('MAINSTREAM');
    expect(nextStage(undefined, 'MAINSTREAM')).toBe('MAINSTREAM');
  });
  it('lets decay apply at once and a revival come straight back', () => {
    expect(nextStage('ACCELERATING', 'DECAYING')).toBe('DECAYING');
    expect(nextStage('MAINSTREAM', 'DEAD')).toBe('DEAD');
    expect(nextStage('DECAYING', 'ACCELERATING')).toBe('ACCELERATING');
  });
  it('is deterministic for the same features', () => {
    const f = { mentionVelocity: 150, acceleration: 20, currentHourly: 50, previousHourly: 40, peakHourly: 50, platforms: 2, ageHours: 5, creatorsNow: 12 };
    expect(candidateStage(f)).toBe(candidateStage({ ...f }));
  });
});

describe('organic score', () => {
  const platforms = ['x', 'reddit', 'youtube'];
  it('rates broad, aged, varied discussion as organic', () => {
    const ms = Array.from({ length: 60 }, (_, i) => m(i * 5 + 1, { platform: platforms[i % 3]!, creatorAgeDays: 200 + i }));
    const r = computeNarrativeMetrics(ms, NOW);
    expect(r.organicKnown).toBe(true);
    expect(r.manipulationRisk).toBeLessThan(15);
    expect(r.organicScore).toBeGreaterThan(85);
  });
  it('rates one repeated message from new accounts in a burst as coordinated', () => {
    const ms = Array.from({ length: 40 }, (_, i) => m(1 + i / 100, { text: 'BUY $LOBSTER NOW 100x guaranteed', creatorAgeDays: 2, creator: `bot${i % 8}` }));
    const r = computeNarrativeMetrics(ms, NOW);
    expect(r.manipulationRisk).toBeGreaterThan(70);
    expect(r.organicScore).toBeLessThan(30);
  });
  it('says unknown instead of guessing when there is too little data', () => {
    const r = computeNarrativeMetrics(hour(0, 4), NOW);
    expect(r).toMatchObject({ organicKnown: false, organicScore: 50, manipulationRisk: 50 });
  });
  it('measures duplicates by similarity hash', () => {
    const same = Array.from({ length: 10 }, () => m(1, { text: 'same message everywhere' }));
    expect(duplicateShare(same)).toBe(1);
    expect(duplicateShare(Array.from({ length: 10 }, () => m(1)))).toBe(0);
    expect(duplicateShare([])).toBe(0);
  });
});

describe('creator roles', () => {
  it('orders creators by first mention', () => {
    const ms = Array.from({ length: 20 }, (_, i) => m(1000 - i * 10, { creator: `k${i}` }));
    const roles = creatorRoles(ms);
    expect(roles.get('k0')).toBe('ORIGINATOR');
    expect([...roles.values()].filter((r) => r === 'EARLY_AMPLIFIER')).toHaveLength(4);
    expect([...roles.values()].filter((r) => r === 'FOLLOWER')).toHaveLength(15);
    expect(roles.get('k19')).toBe('FOLLOWER');
  });
  it('handles one creator and none', () => {
    expect(creatorRoles([m(5, { creator: 'solo' })]).get('solo')).toBe('ORIGINATOR');
    expect(creatorRoles([]).size).toBe(0);
  });
});
