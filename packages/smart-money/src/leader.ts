export interface Entry { wallet: string; token: string; at: Date }

export interface LeaderStats {
  entries: number;
  /** Share of this wallet's entries that at least one other tracked wallet copied within the window. */
  ledRate: number;
  avgFollowers: number;
  /** Share of entries that came after another tracked wallet had already entered within the window. */
  followerRate: number;
  leaderScore: number | null;
}

export const FOLLOW_WINDOW_MS = 30 * 60_000;
export const MIN_ENTRIES = 5;

/** The first buy of each wallet in each token. Later buys of the same token are adds, not entries. */
export function firstEntries(buys: Entry[]): Entry[] {
  const seen = new Map<string, Entry>();
  for (const b of [...buys].sort((a, c) => a.at.getTime() - c.at.getTime())) {
    const k = `${b.wallet}|${b.token}`;
    if (!seen.has(k)) seen.set(k, b);
  }
  return [...seen.values()];
}

/**
 * Leader score from entry timing across tracked wallets. A wallet leads when others enter the same token
 * shortly after it. Entering alone earns nothing: no follower, no lead.
 * Score = 100 x (0.5 x led rate + 0.5 x min(average followers / 3, 1)).
 */
export function computeLeaderStats(buys: Entry[], windowMs = FOLLOW_WINDOW_MS): Map<string, LeaderStats> {
  const entries = firstEntries(buys);
  const byToken = new Map<string, Entry[]>();
  for (const e of entries) byToken.set(e.token, [...(byToken.get(e.token) ?? []), e]);

  const acc = new Map<string, { n: number; led: number; followers: number; followed: number }>();
  for (const list of byToken.values()) {
    for (const e of list) {
      const a = acc.get(e.wallet) ?? { n: 0, led: 0, followers: 0, followed: 0 };
      const t = e.at.getTime();
      const after = list.filter((o) => o.wallet !== e.wallet && o.at.getTime() > t && o.at.getTime() <= t + windowMs).length;
      const before = list.some((o) => o.wallet !== e.wallet && o.at.getTime() < t && o.at.getTime() >= t - windowMs);
      a.n++; a.followers += after; if (after > 0) a.led++; if (before) a.followed++;
      acc.set(e.wallet, a);
    }
  }

  const out = new Map<string, LeaderStats>();
  for (const [wallet, a] of acc) {
    const ledRate = a.led / a.n;
    const avgFollowers = a.followers / a.n;
    out.set(wallet, {
      entries: a.n, ledRate, avgFollowers, followerRate: a.followed / a.n,
      leaderScore: a.n >= MIN_ENTRIES ? Math.round((0.5 * ledRate + 0.5 * Math.min(avgFollowers / 3, 1)) * 1000) / 10 : null,
    });
  }
  return out;
}
