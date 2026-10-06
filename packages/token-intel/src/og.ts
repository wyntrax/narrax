import { leetKey, levenshtein, symbolKey } from './match';

export type TokenRelation = 'OG' | 'PRIMARY' | 'DERIVATIVE' | 'MEME_EXPRESSION' | 'SUSPICIOUS';

export interface Candidate {
  id: string;
  symbol: string;
  createdAt: Date | null;
  deployer: string | null;
  matchScore: number;
  top10Pct: number | null;
  devHoldingPct: number | null;
  /** Other tokens from the same deployer in the days around this launch. Null when unknown. */
  deployerRecentTokens: number | null;
}

export interface OgResult {
  ogScore: number;
  relation: TokenRelation;
  classification: string;
  confidence: number;
  /** Share of the factor weight that had data. Missing factors are skipped, never filled with guesses. */
  coverage: number;
  flags: string[];
  factors: { name: string; value: number; weight: number }[];
}

const HOUR = 3_600_000;
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** True when `longer` is `shorter` with one character repeated, like ROBOTT from ROBOT. */
function isDoubledLetter(longer: string, shorter: string): boolean {
  for (let i = 1; i < longer.length; i++) if (longer[i] === longer[i - 1] && longer.slice(0, i) + longer.slice(i + 1) === shorter) return true;
  return false;
}

const timingValue = (hoursAfterDetection: number) =>
  hoursAfterDetection <= 0 ? 1 : hoursAfterDetection <= 1 ? 0.8 : hoursAfterDetection <= 6 ? 0.5 : hoursAfterDetection <= 24 ? 0.25 : 0.1;

/**
 * Scores every candidate for one narrative at once, because OG status is relative: who launched first, who copied.
 * Factors: launch timing vs first detection 35, first-mover rank 25, gap to the earliest launch 15,
 * holder spread 15, deployer history 10. Social, website and creator links are not in the data yet.
 */
export function resolveCandidates(narrative: { firstDetectedAt: Date }, candidates: Candidate[]): Map<string, OgResult> {
  const dated = candidates.filter((c) => c.createdAt).sort((a, b) => a.createdAt!.getTime() - b.createdAt!.getTime());
  const earliest = dated[0];
  const out = new Map<string, OgResult>();
  const scored: { c: Candidate; r: OgResult }[] = [];

  for (const c of candidates) {
    const factors: OgResult['factors'] = [];
    const flags: string[] = [];
    const add = (name: string, value: number, weight: number) => factors.push({ name, value: clamp(value), weight });

    if (c.createdAt) {
      add('launch_timing', timingValue((c.createdAt.getTime() - narrative.firstDetectedAt.getTime()) / HOUR), 35);
      const rank = dated.findIndex((d) => d.id === c.id);
      const tied = earliest && Math.abs(c.createdAt.getTime() - earliest.createdAt!.getTime()) < 5 * 60_000; // within 5 minutes is too close to call
      add('first_mover_rank', tied || rank === 0 ? 1 : rank === 1 ? 0.5 : 0.2, 25);
      add('gap_to_earliest', earliest ? clamp(1 - (c.createdAt.getTime() - earliest.createdAt!.getTime()) / HOUR / 6) : 1, 15);
    }
    if (c.top10Pct != null || c.devHoldingPct != null) {
      const parts = [
        ...(c.top10Pct != null ? [clamp((60 - c.top10Pct) / 35)] : []),
        ...(c.devHoldingPct != null ? [clamp((20 - c.devHoldingPct) / 15)] : []),
      ];
      add('holder_spread', parts.reduce((s, x) => s + x, 0) / parts.length, 15);
    }
    if (c.deployerRecentTokens != null) add('deployer_history', c.deployerRecentTokens >= 3 ? 0.2 : c.deployerRecentTokens === 2 ? 0.6 : 1, 10);
    if (c.deployerRecentTokens != null && c.deployerRecentTokens >= 3) flags.push('SERIAL_DEPLOYER');

    // Look-alike of an earlier candidate: same symbol after look-alike swaps, or one character away.
    if (c.createdAt) {
      for (const e of dated) {
        if (e.id === c.id || e.createdAt!.getTime() >= c.createdAt.getTime()) continue;
        const a = symbolKey(c.symbol), b = symbolKey(e.symbol);
        // Homoglyph swaps (R0BOT) and doubled letters (ROBOTT) are copy tricks. A trailing number (ROBO2) reads as a sequel, not a fake.
        const lookalike = a !== b && (leetKey(c.symbol) === leetKey(e.symbol) || (a.length >= 4 && a.length === b.length + 1 && levenshtein(a, b) === 1 && isDoubledLetter(a, b)));
        if (lookalike) { flags.push('LOOKALIKE_OF_EARLIER'); break; }
      }
    }

    const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
    const coverage = totalWeight / 100;
    const ogScore = totalWeight ? Math.round((factors.reduce((s, f) => s + f.value * f.weight, 0) / totalWeight) * 100) : 0;
    scored.push({ c, r: { ogScore, relation: 'DERIVATIVE', classification: '', confidence: 0, coverage, flags, factors } });
  }

  const ranked = [...scored].sort((a, b) => b.r.ogScore - a.r.ogScore);
  const gap = ranked.length > 1 ? ranked[0]!.r.ogScore - ranked[1]!.r.ogScore : 100;

  for (const { c, r } of scored) {
    const afterDetection = c.createdAt ? c.createdAt.getTime() > narrative.firstDetectedAt.getTime() : false;
    const isEarliest = !!earliest && c.id === earliest.id; // launches within a minute tie on rank, but only one can be the first
    if (r.flags.includes('LOOKALIKE_OF_EARLIER') || (r.flags.includes('SERIAL_DEPLOYER') && afterDetection)) {
      r.relation = 'SUSPICIOUS'; r.classification = 'SUSPICIOUS COPY';
    } else if (isEarliest && r.ogScore >= 75) {
      r.relation = 'OG';
    } else if (isEarliest) {
      r.relation = 'PRIMARY'; r.classification = 'PRIMARY CANDIDATE';
    } else {
      r.relation = c.matchScore >= 0.6 ? 'DERIVATIVE' : 'MEME_EXPRESSION';
      r.classification = r.relation === 'DERIVATIVE' ? 'DERIVATIVE' : 'MEME EXPRESSION';
    }
    // Never claim more than the evidence supports: little data, no rivals to compare against, or a close race all cap it.
    let conf = 0.4 + 0.5 * r.coverage;
    if (scored.length === 1) conf = Math.min(conf, 0.6);
    const closeToTop = ranked.length > 1 && (r.relation === 'OG' ? gap < 10 : ranked[0]!.r.ogScore - r.ogScore < 10);
    if (closeToTop) conf *= 0.7; // a close race means the call is less certain
    r.confidence = Math.round(Math.min(conf, 0.95) * 100) / 100;
    if (r.relation === 'OG') r.classification = r.confidence >= 0.75 && r.coverage >= 0.9 ? 'LIKELY OG' : 'POSSIBLE OG';
    out.set(c.id, r);
  }
  return out;
}
