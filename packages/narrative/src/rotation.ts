/**
 * Narrative rotation: attention moving from one narrative to another. Pure logic, no I/O.
 *
 * Every number here is a named starting value. None is validated against outcomes, and "rotation" is a description of
 * what the scores did over the window, not a prediction that the move continues.
 */
export const ROTATION_RULES = {
  /** A narrative counts as rising or falling only if its score moved at least this many points over the window. */
  minDeltaPoints: 10,
  /** Narratives whose score is below this at both ends are noise and are ignored. */
  minScoreEitherEnd: 30,
  /** How many narratives are listed on each side. */
  maxPerSide: 5,
} as const;

export interface RotationInput {
  id: string;
  slug: string;
  name: string;
  stage: string;
  /** Latest score. Null when the narrative has no metric rows. */
  currentScore: number | null;
  /** Score from the newest metric row at or before the start of the window. Null when no row is that old. */
  previousScore: number | null;
}

export interface RotationItem { id: string; slug: string; name: string; stage: string; from: number; to: number; delta: number }

export interface RotationResult {
  /** True only when at least one narrative fell and one rose by the minimum, so there is something to rotate between. */
  detected: boolean;
  falling: RotationItem[];
  rising: RotationItem[];
  /** Narratives left out because one of the two scores was unknown. Reported so a quiet result is not mistaken for a clean one. */
  unknown: number;
}

export function detectRotation(items: RotationInput[], rules: typeof ROTATION_RULES = ROTATION_RULES): RotationResult {
  const falling: RotationItem[] = [];
  const rising: RotationItem[] = [];
  let unknown = 0;
  for (const n of items) {
    if (n.currentScore == null || n.previousScore == null || !Number.isFinite(n.currentScore) || !Number.isFinite(n.previousScore)) { unknown++; continue; }
    if (Math.max(n.currentScore, n.previousScore) < rules.minScoreEitherEnd) continue;
    const delta = n.currentScore - n.previousScore;
    const item: RotationItem = { id: n.id, slug: n.slug, name: n.name, stage: n.stage, from: n.previousScore, to: n.currentScore, delta };
    if (delta <= -rules.minDeltaPoints) falling.push(item);
    else if (delta >= rules.minDeltaPoints) rising.push(item);
  }
  falling.sort((a, b) => a.delta - b.delta || a.slug.localeCompare(b.slug));
  rising.sort((a, b) => b.delta - a.delta || a.slug.localeCompare(b.slug));
  return { detected: falling.length > 0 && rising.length > 0, falling: falling.slice(0, rules.maxPerSide), rising: rising.slice(0, rules.maxPerSide), unknown };
}
