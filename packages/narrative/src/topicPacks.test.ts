import { describe, expect, it } from 'vitest';
import { MAX_TOPICS, TOPIC_PACKS, TOPIC_PACK_NAMES, estimateCycleCostUsd, mergeTopics } from './topicPacks';
import { normalizeTopic } from './normalize';

describe('topic packs', () => {
  it('every pack topic has a usable name and a query within the provider limit', () => {
    for (const name of TOPIC_PACK_NAMES) for (const t of TOPIC_PACKS[name].topics) {
      expect(normalizeTopic(t.name)).not.toBeNull();
      expect(t.query.length).toBeGreaterThan(2);
      expect(t.query.length).toBeLessThanOrEqual(300);
    }
  });
  it('the trencher and holder packs fit together inside the topic limit, with no duplicate narratives', () => {
    const all = mergeTopics(['trencher', 'holder'], []);
    expect(all.length).toBeLessThanOrEqual(MAX_TOPICS);
    expect(new Set(all.map(t => normalizeTopic(t.name)!.slug)).size).toBe(all.length);
  });
  it('trencher with chatter also fits, and chatter alone is a valid pack', () => {
    expect(mergeTopics(['trencher', 'chatter'], []).length).toBe(7);
    expect(mergeTopics(['chatter'], []).length).toBe(2);
    expect(() => mergeTopics(['trencher', 'holder', 'chatter'], [])).toThrow('TOO_MANY_TREG_TOPICS');
  });
  it('the default solana pack is the previous single topic', () => {
    expect(mergeTopics(['solana'], [])).toEqual([{ name: 'Solana ecosystem', query: 'solana' }]);
  });
  it('custom topics come first and win a name clash', () => {
    const merged = mergeTopics(['solana'], [{ name: 'Solana ecosystem', query: 'solana ("my query")' }, { name: 'Zorblax', query: 'zorblax' }]);
    expect(merged.map(t => t.query)).toEqual(['solana ("my query")', 'zorblax']);
  });
  it('unknown packs, bad names and too many topics are errors, never silently shortened', () => {
    expect(() => mergeTopics(['nope'], [])).toThrow('INVALID_TREG_PACK');
    expect(() => mergeTopics([], [{ name: '#', query: 'x' }])).toThrow('INVALID_TREG_TOPIC');
    const many = Array.from({ length: MAX_TOPICS + 1 }, (_, i) => ({ name: `Topic number ${String.fromCharCode(97 + i)}`, query: 'q' }));
    expect(() => mergeTopics([], many)).toThrow('TOO_MANY_TREG_TOPICS');
  });
  it('estimates one cycle from the catalog prices', () => {
    expect(estimateCycleCostUsd(10, ['x'])).toBeCloseTo(0.0075, 6);
    expect(estimateCycleCostUsd(10, ['x', 'reddit', 'tiktok'])).toBeCloseTo(0.0315, 6);
    expect(estimateCycleCostUsd(10, ['x'], 2)).toBeCloseTo(0.015, 6);
  });
});
