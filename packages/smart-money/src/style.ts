import type { ClosedLeg, TradeRow, WalletStats } from './stats';
import { median } from './stats';
import { MIN_CLOSED_LEGS } from './score';
import type { LeaderStats } from './leader';

export type WalletStyle = 'EARLY_MOMENTUM' | 'MEME_EARLY' | 'SWING' | 'SCALPER' | 'ROTATION' | 'LONG_HOLD' | 'NARRATIVE_LEADER' | 'FOLLOWER' | 'UNKNOWN';

const MIN = 60;
const HOUR = 3600;

/** Share of sells followed by a buy of a different token within 10 minutes. */
export function rotationRate(trades: TradeRow[], windowMs = 10 * 60_000): number {
  const sells = trades.filter((t) => t.side === 'SELL');
  if (sells.length < MIN_CLOSED_LEGS) return 0;
  const buys = trades.filter((t) => t.side === 'BUY').map(t => ({ token: t.token, at: t.at.getTime() }))
    .filter(t => Number.isFinite(t.at)).sort((a,b) => a.at-b.at);
  // Index the next different token so a long run of same-token buys can be
  // skipped in constant time. Each sell then needs only a binary search for
  // the first strictly later buy, rather than scanning all buys (quadratic).
  const nextDifferent = new Int32Array(buys.length);
  for (let i=buys.length-1;i>=0;i--) nextDifferent[i] = i+1===buys.length || buys[i]!.token!==buys[i+1]!.token ? i+1 : nextDifferent[i+1]!;
  let rotated = 0;
  for (const s of sells) {
    const at = s.at.getTime();
    if (!Number.isFinite(at)) continue;
    let lo=0,hi=buys.length;
    while (lo<hi) { const mid=Math.floor((lo+hi)/2); if (buys[mid]!.at<=at) lo=mid+1; else hi=mid; }
    const candidate = buys[lo]?.token===s.token ? buys[nextDifferent[lo]!] : buys[lo];
    if (candidate && candidate.at-at<=windowMs) rotated++;
  }
  return rotated / sells.length;
}

/**
 * Rule-based style label. MEME_EARLY is never assigned yet because it needs token category data.
 * Order matters: leadership and copying come first, then rotation, then holding time.
 */
export function classifyStyle(stats: WalletStats, leader: LeaderStats | undefined, rotation: number): WalletStyle {
  if (stats.legs.length < MIN_CLOSED_LEGS) return 'UNKNOWN';
  if (leader?.leaderScore != null && leader.leaderScore >= 75) return 'NARRATIVE_LEADER';
  if (leader && leader.entries >= MIN_CLOSED_LEGS && leader.followerRate >= 0.7) return 'FOLLOWER';
  if (rotation >= 0.6) return 'ROTATION';
  const hold = stats.medianHoldSeconds ?? 0;
  if (hold < 10 * MIN) return 'SCALPER';
  if (hold >= 72 * HOUR) return 'LONG_HOLD';
  if (hold >= 6 * HOUR) return 'SWING';
  return (stats.medianRoi ?? 0) > 0 ? 'EARLY_MOMENTUM' : 'UNKNOWN';
}

const BUCKETS: [string, number, number][] = [['under 10 minutes', 0, 10 * MIN], ['10 to 60 minutes', 10 * MIN, HOUR], ['1 to 6 hours', HOUR, 6 * HOUR], ['over 6 hours', 6 * HOUR, Infinity]];

/** Best and weakest holding-time buckets by median ROI. Computed from trades, never written by a model. */
export function holdingPatterns(legs: ClosedLeg[], minPerBucket = 3): { best: string | null; weak: string | null } {
  const rows = BUCKETS.map(([label, lo, hi]) => {
    const inB = legs.filter((l) => l.holdSeconds >= lo && l.holdSeconds < hi);
    return { label, n: inB.length, roi: median(inB.map((l) => l.roi)) };
  }).filter((r) => r.n >= minPerBucket && r.roi !== null);
  if (rows.length < 2) return { best: null, weak: null };
  rows.sort((a, b) => b.roi! - a.roi!);
  const fmt = (r: (typeof rows)[number]) => `Holds of ${r.label}: median ROI ${Math.round(r.roi! * 100)}% over ${r.n} trades`;
  return { best: fmt(rows[0]!), weak: fmt(rows[rows.length - 1]!) };
}
