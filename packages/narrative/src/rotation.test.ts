import { describe, expect, it } from 'vitest';
import { ROTATION_RULES, detectRotation, type RotationInput } from './rotation';

const n = (slug: string, previousScore: number | null, currentScore: number | null): RotationInput => ({ id: slug, slug, name: slug, stage: 'ACCELERATING', currentScore, previousScore });

describe('detectRotation', () => {
  it('detects attention moving from one narrative to another', () => {
    const r = detectRotation([n('agents', 91, 74), n('robotics', 44, 88), n('flat', 60, 62)]);
    expect(r.detected).toBe(true);
    expect(r.falling.map((x) => x.slug)).toEqual(['agents']);
    expect(r.rising.map((x) => x.slug)).toEqual(['robotics']);
    expect(r.rising[0]).toMatchObject({ from: 44, to: 88, delta: 44 });
  });

  it('does not call it rotation when only one side moved', () => {
    expect(detectRotation([n('a', 40, 80), n('b', 50, 52)])).toMatchObject({ detected: false, rising: [{ slug: 'a' }], falling: [] });
    expect(detectRotation([n('a', 80, 40)])).toMatchObject({ detected: false, falling: [{ slug: 'a' }], rising: [] });
  });

  it('uses the minimum delta inclusively and ignores smaller moves', () => {
    const min = ROTATION_RULES.minDeltaPoints;
    const r = detectRotation([n('up', 50, 50 + min), n('down', 80, 80 - min), n('small', 50, 50 + min - 1)]);
    expect(r.rising.map((x) => x.slug)).toEqual(['up']);
    expect(r.falling.map((x) => x.slug)).toEqual(['down']);
  });

  it('ignores narratives that are low at both ends', () => {
    expect(detectRotation([n('dust', 5, 25), n('real', 60, 80)]).rising.map((x) => x.slug)).toEqual(['real']);
  });

  it('never guesses a missing score: it counts the narrative as unknown and leaves it out', () => {
    const r = detectRotation([n('new', null, 90), n('gone', 90, null), n('ok', 40, 80)]);
    expect(r.unknown).toBe(2);
    expect(r.rising.map((x) => x.slug)).toEqual(['ok']);
  });

  it('orders by size of move and caps each side', () => {
    const rising = Array.from({ length: 8 }, (_, i) => n(`r${i}`, 30, 45 + i * 3));
    const r = detectRotation([...rising, n('f', 80, 40)]);
    expect(r.rising).toHaveLength(ROTATION_RULES.maxPerSide);
    expect(r.rising[0]!.slug).toBe('r7');
  });
});
