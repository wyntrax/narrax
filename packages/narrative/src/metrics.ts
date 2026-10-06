import type { NarrativeStage } from '@narra/shared';
import { hamming } from './normalize';
import { DEFAULT_LIFECYCLE, candidateStage, nextStage, type LifecycleConfig } from './lifecycle';
import type { MentionPoint } from './types';

const HOUR = 3_600_000;
export const MIN_ORGANIC_SAMPLE = 10;
const MIN_VOLUME = 5;

export type CreatorRole = 'ORIGINATOR' | 'EARLY_AMPLIFIER' | 'FOLLOWER';

export interface NarrativeComputed {
  mentionVelocity: number;
  creatorVelocity: number;
  engagementVelocity: number;
  platforms: number;
  /** Velocity folded into one 0 to 100 number. */
  velocityScore: number;
  acceleration: number;
  organicScore: number;
  manipulationRisk: number;
  /** False when there were too few recent mentions to judge. Organic and risk are then neutral 50s. */
  organicKnown: boolean;
  saturationRisk: number;
  score: number;
  stage: NarrativeStage;
  currentHourly: number;
  peakHourly: number;
  uniqueCreators: number;
  roles: Map<string, CreatorRole>;
}

const sat = (x: number) => 1 - Math.exp(-Math.max(x, 0) / 150);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

function bucket(mentions: MentionPoint[], endMs: number, hours: number) {
  const b = Array.from({ length: hours }, () => ({ n: 0, eng: 0, creators: new Set<string>(), platforms: new Set<string>() }));
  for (const m of mentions) {
    const idx = Math.floor((endMs - m.at.getTime()) / HOUR); // 0 = the latest hour
    if (idx < 0 || idx >= hours) continue;
    const x = b[idx]!;
    x.n++; x.eng += m.engagement; x.creators.add(m.creator); x.platforms.add(m.platform);
  }
  return b;
}

/** Share of mentions that are near-duplicates of another mention, by similarity hash. */
export function duplicateShare(ms: MentionPoint[], maxDistance = 3, cap = 500): number {
  const sample = ms.slice(0, cap);
  if (sample.length < 2) return 0;
  const dup = new Array<boolean>(sample.length).fill(false);
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      if (hamming(sample[i]!.simhash, sample[j]!.simhash) <= maxDistance) { dup[i] = true; dup[j] = true; }
    }
  }
  return dup.filter(Boolean).length / sample.length;
}

/** Excess of mentions packed into one minute beyond what a normal spike would hold. */
function burstShare(ms: MentionPoint[]): number {
  if (!ms.length) return 0;
  const t = ms.map((m) => m.at.getTime()).sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < t.length; i++) {
    while (t[i]! - t[j]! > 60_000) j++;
    best = Math.max(best, i - j + 1);
  }
  return clamp((best / ms.length - 0.2) / 0.8, 0, 1);
}

/** Originators spoke first, early amplifiers next, everyone else follows. Based on first-mention order only. */
export function creatorRoles(mentions: MentionPoint[]): Map<string, CreatorRole> {
  const first = new Map<string, number>();
  for (const m of mentions) first.set(m.creator, Math.min(first.get(m.creator) ?? Infinity, m.at.getTime()));
  const order = [...first.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
  const n = order.length;
  const orig = Math.min(3, Math.max(1, Math.floor(n * 0.05)));
  const early = Math.min(Math.ceil(n * 0.2), n - orig);
  const out = new Map<string, CreatorRole>();
  order.forEach((c, i) => out.set(c, i < orig ? 'ORIGINATOR' : i < orig + early ? 'EARLY_AMPLIFIER' : 'FOLLOWER'));
  return out;
}

export function computeNarrativeMetrics(
  mentions: MentionPoint[],
  now: Date,
  prevStage?: NarrativeStage,
  cfg: LifecycleConfig = DEFAULT_LIFECYCLE,
): NarrativeComputed {
  const end = now.getTime();
  const inWindow = mentions.filter((m) => m.at.getTime() <= end && m.at.getTime() > end - 48 * HOUR);
  const b = bucket(inWindow, end, 48);
  const cur = b[0]!, prev = b[1]!;
  const base = b.slice(2, 26);
  const mean = (f: (x: (typeof b)[number]) => number) => base.reduce((s, x) => s + f(x), 0) / base.length;
  const baseN = mean((x) => x.n), baseC = mean((x) => x.creators.size), baseE = mean((x) => x.eng);

  const vel = (v: number, b0: number, floor = 2) => ((v - b0) / Math.max(b0, floor)) * 100;
  const meanEng = inWindow.length ? inWindow.reduce((s, x) => s + x.engagement, 0) / inWindow.length : 0;
  const guard = (v: number, volume: number) => (v > 0 ? v * Math.min(volume / MIN_VOLUME, 1) : v); // a few posts is not a surge
  const mentionVelocity = guard(vel(cur.n, baseN), cur.n);
  const prevVelocity = guard(vel(prev.n, baseN), prev.n);
  const creatorVelocity = guard(vel(cur.creators.size, baseC), cur.n);
  const engagementVelocity = guard(vel(cur.eng, baseE, Math.max(2 * meanEng, 2)), cur.n);
  const acceleration = mentionVelocity - prevVelocity;

  const platforms = cur.platforms.size;
  // Fewer than 10 posts in the hour discounts the whole score, so tiny narratives cannot rank high on percentages alone.
  const volumeFactor = Math.min(cur.n / 10, 1);
  const velocityScore = round1(volumeFactor * 100 * (0.4 * sat(mentionVelocity) + 0.25 * sat(creatorVelocity) + 0.2 * sat(engagementVelocity) + 0.15 * Math.min(platforms / 3, 1)));

  // Organic quality over the last 6 hours.
  const recent = inWindow.filter((m) => m.at.getTime() > end - 6 * HOUR);
  const creators = new Set(recent.map((m) => m.creator));
  const organicKnown = recent.length >= MIN_ORGANIC_SAMPLE;
  let manipulationRisk = 50;
  if (organicKnown) {
    const aged = recent.filter((m) => m.creatorAgeDays !== null);
    const newShare = aged.length ? aged.filter((m) => (m.creatorAgeDays as number) < 30).length / aged.length : 0;
    const plat = new Set(recent.map((m) => m.platform)).size;
    manipulationRisk = Math.round(clamp(25 * newShare + 30 * duplicateShare(recent) + 20 * burstShare(recent) + 15 * (1 - creators.size / recent.length) + (plat < 2 ? 10 : 0), 0, 100));
  }
  const organicScore = 100 - manipulationRisk;

  const hourly = b.map((x) => x.n);
  const peakHourly = Math.max(...hourly);
  const firstAt = inWindow.length ? Math.min(...inWindow.map((m) => m.at.getTime())) : end;
  const ageHours = (end - firstAt) / HOUR;

  const candidate = candidateStage({ mentionVelocity, acceleration, currentHourly: cur.n, previousHourly: prev.n, peakHourly, platforms, ageHours, creatorsNow: cur.creators.size }, cfg);
  const stage = nextStage(prevStage, candidate);

  const saturationRisk = Math.round(100 * (0.5 * Math.min(cur.n / cfg.volumeMainstream, 1) + 0.3 * Math.min(platforms / 4, 1) + 0.2 * Math.min(ageHours / 72, 1)));
  const score = round1(0.5 * velocityScore + 0.3 * organicScore + 0.2 * 100 * Math.min(platforms / 3, 1));

  return {
    mentionVelocity: round1(mentionVelocity), creatorVelocity: round1(creatorVelocity), engagementVelocity: round1(engagementVelocity), platforms,
    velocityScore, acceleration: round1(acceleration), organicScore, manipulationRisk, organicKnown, saturationRisk, score, stage,
    currentHourly: cur.n, peakHourly, uniqueCreators: new Set(inWindow.map((m) => m.creator)).size, roles: creatorRoles(inWindow),
  };
}
