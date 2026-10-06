import type { NarrativeStage } from '@narra/shared';

export interface StageFeatures {
  mentionVelocity: number;
  acceleration: number;
  currentHourly: number;
  previousHourly: number;
  peakHourly: number;
  platforms: number;
  ageHours: number;
  creatorsNow: number;
}

export interface LifecycleConfig {
  /** Mentions per hour at which a narrative counts as mainstream. A tunable starting value. */
  volumeMainstream: number;
}
export const DEFAULT_LIFECYCLE: LifecycleConfig = { volumeMainstream: 150 };

/** The stage the metrics point to right now, ignoring history. Pure and deterministic. */
export function candidateStage(f: StageFeatures, cfg: LifecycleConfig = DEFAULT_LIFECYCLE): NarrativeStage {
  const nearPeak = f.peakHourly > 0 && f.currentHourly >= 0.8 * f.peakHourly;
  if (f.currentHourly === 0 && f.ageHours > 48) return 'DEAD';
  if (f.ageHours >= 24 && f.peakHourly >= 20 && f.currentHourly <= 0.1 * f.peakHourly && f.previousHourly <= 0.1 * f.peakHourly) return 'DEAD'; // two quiet hours in a row, not one
  if (f.peakHourly >= 20 && f.currentHourly <= 0.6 * f.peakHourly && f.acceleration < 0) return 'DECAYING';
  if (f.platforms >= 3 && f.currentHourly >= cfg.volumeMainstream && nearPeak && f.mentionVelocity < 25 && f.ageHours >= 12) return 'SATURATED';
  if (f.platforms >= 3 && f.currentHourly >= cfg.volumeMainstream * 0.5) return 'MAINSTREAM';
  if (f.mentionVelocity >= 100 && f.acceleration > 0 && f.creatorsNow >= 5) return 'ACCELERATING';
  if (f.mentionVelocity >= 30 && f.creatorsNow >= 3 && f.currentHourly >= 5) return 'EMERGING';
  return 'SEED';
}

const GROWTH: NarrativeStage[] = ['SEED', 'EMERGING', 'ACCELERATING', 'MAINSTREAM', 'SATURATED'];

/**
 * Applies history. A growing narrative moves up one stage per run, never skipping, and does not slide back
 * on one quiet reading. Falling off (DECAYING, DEAD) applies at once. A brand-new narrative takes its candidate.
 */
export function nextStage(prev: NarrativeStage | undefined, candidate: NarrativeStage): NarrativeStage {
  if (!prev) return candidate;
  if (candidate === 'DECAYING' || candidate === 'DEAD') return candidate;
  const p = GROWTH.indexOf(prev);
  const c = GROWTH.indexOf(candidate);
  if (p === -1) return candidate; // coming back from DECAYING or DEAD
  if (c > p) return GROWTH[p + 1]!;
  return prev;
}
