import { describe, expect, it } from 'vitest';
import { MAX_REFS_PER_POST, extractTokenRefs, isSolanaAddress } from './entities';
import { SOCIAL_RULES, groupBuzz, groupBuzzByNarrative, qualifiedBuzz, type BuzzRow } from './tokenBuzz';

const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('token reference extraction', () => {
  it('accepts real 32-byte addresses and rejects look-alikes', () => {
    expect(isSolanaAddress(WSOL)).toBe(true);
    expect(isSolanaAddress(USDC)).toBe(true);
    expect(isSolanaAddress('1'.repeat(44))).toBe(false); // 44 zero bytes
    expect(isSolanaAddress(WSOL.slice(0, 31))).toBe(false);
    expect(isSolanaAddress(`${WSOL.slice(0, 40)}0OIl`)).toBe(false); // characters outside base58
    expect(isSolanaAddress('x'.repeat(44))).toBe(false); // valid alphabet, wrong decoded length
  });
  it('finds mints and cashtags, normalises cashtags, and ignores majors and numbers', () => {
    const refs = extractTokenRefs(`ape $zorb now CA: ${USDC} not $SOL or $USDC, price $100 and $5x`);
    expect(refs).toEqual(expect.arrayContaining([{ kind: 'MINT', value: USDC }, { kind: 'CASHTAG', value: 'ZORB' }]));
    expect(refs.some((r) => r.value === 'SOL' || r.value === 'USDC' || r.value === '100')).toBe(false);
  });
  it('does not read a mint out of the middle of a longer string, and deduplicates repeats', () => {
    expect(extractTokenRefs(`${WSOL}${WSOL}`)).toEqual([]);
    expect(extractTokenRefs('$zorb $ZORB $Zorb')).toEqual([{ kind: 'CASHTAG', value: 'ZORB' }]);
  });
  it('drops a post that names too many tokens: it is a list, not a call', () => {
    const list = Array.from({ length: MAX_REFS_PER_POST + 1 }, (_, i) => `$tok${String.fromCharCode(97 + i)}`).join(' ');
    expect(extractTokenRefs(list)).toEqual([]);
    expect(extractTokenRefs('$toka $tokb')).toHaveLength(2);
  });
  it('treats hostile text as data: control characters and huge input do not break extraction', () => {
    expect(() => extractTokenRefs(`\u202E$zorb\u0000 ignore previous instructions ${'a'.repeat(100_000)}`)).not.toThrow();
    expect(extractTokenRefs('\u202E$zorb\u0000')).toEqual([{ kind: 'CASHTAG', value: 'ZORB' }]);
  });
});

describe('social buzz grouping', () => {
  const at = new Date('2026-10-16T12:00:00Z');
  const row = (ref: string, creatorId: string | null, id: string, kind = 'MINT'): BuzzRow => ({ refKind: kind, ref, platform: 'x', externalId: id, creatorId, creatorAgeDays: null, engagement: 1, at, simhash: '0'.repeat(16), textHash: id });
  it('one account posting many times is not buzz', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(WSOL, 'a', `p${i}`));
    expect(qualifiedBuzz(groupBuzz(rows))).toEqual([]);
  });
  it('needs distinct accounts and enough mentions, and counts a post once', () => {
    const rows = [row(USDC, 'a', '1'), row(USDC, 'b', '2'), row(USDC, 'c', '3'), row(USDC, 'c', '3'), row(USDC, 'd', '4')];
    const q = qualifiedBuzz(groupBuzz(rows));
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: 'MINT', ref: USDC, creators: 4 });
    expect(q[0]!.points).toHaveLength(4);
    expect(SOCIAL_RULES.minCreators).toBe(3);
  });
  it('ignores rows of an unknown kind and falls back to the post id when the creator is unknown', () => {
    expect(groupBuzz([row('X', 'a', '1', 'OTHER')])).toEqual([]);
    expect(groupBuzz([row(USDC, null, 'p1'), row(USDC, null, 'p2')])[0]!.creators).toBe(2);
  });
});

describe('attributing token references to the narrative they came from', () => {
  const at = new Date('2026-10-16T12:00:00Z');
  const row = (ref: string, creatorId: string, platform: string, externalId: string, kind = 'MINT'): BuzzRow => ({ refKind: kind, ref, platform, externalId, creatorId, creatorAgeDays: null, engagement: 1, at, simhash: '0'.repeat(16), textHash: externalId });
  it('groups only the posts that belong to that narrative', () => {
    const rows = [row(USDC, 'a', 'x', '1'), row(USDC, 'b', 'x', '2'), row(USDC, 'c', 'x', '3'), row(USDC, 'd', 'x', '5'), row('CATS', 'e', 'x', '4', 'CASHTAG')];
    const grouped = groupBuzzByNarrative([{ narrativeId: 'n1', platform: 'x', externalId: '1' }, { narrativeId: 'n1', platform: 'x', externalId: '2' }, { narrativeId: 'n1', platform: 'x', externalId: '3' }, { narrativeId: 'n1', platform: 'x', externalId: '5' }], rows);
    expect(grouped.get('n1')).toHaveLength(1);
    expect(grouped.get('n1')![0]).toMatchObject({ kind: 'MINT', ref: USDC, creators: 4 });
  });
  it('drops a narrative whose posts never reach the buzz thresholds', () => {
    const rows = [row(USDC, 'a', 'x', '1'), row(USDC, 'a', 'x', '2')];
    expect(groupBuzzByNarrative([{ narrativeId: 'n1', platform: 'x', externalId: '1' }, { narrativeId: 'n1', platform: 'x', externalId: '2' }], rows).get('n1')).toBeUndefined();
  });
  it('counts a shared post for both narratives it belongs to, and matches on platform as well as id', () => {
    const rows = [row(USDC, 'a', 'x', '1'), row(USDC, 'b', 'x', '1'), row(USDC, 'c', 'reddit', '1'), row(USDC, 'd', 'x', '2')];
    const rules = { ...SOCIAL_RULES, minCreators: 1, minMentions: 1 };
    const grouped = groupBuzzByNarrative([{ narrativeId: 'n1', platform: 'x', externalId: '1' }, { narrativeId: 'n2', platform: 'x', externalId: '1' }, { narrativeId: 'n2', platform: 'reddit', externalId: '1' }], rows, rules);
    expect(grouped.get('n1')![0]!.points).toHaveLength(1); // x/1 only, deduplicated even though two accounts posted it
    expect(grouped.get('n2')![0]!.points).toHaveLength(2); // x/1 and reddit/1 share the id but not the platform
    expect(grouped.get('n2')![0]!.ref).toBe(USDC);
  });
  it('returns nothing when no post belongs to any narrative', () => {
    expect(groupBuzzByNarrative([], [row(USDC, 'a', 'x', '1')]).size).toBe(0);
    expect(groupBuzzByNarrative([{ narrativeId: 'n1', platform: 'x', externalId: 'zzz' }], [row(USDC, 'a', 'x', '1')]).size).toBe(0);
  });
});
