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
  const byWallet = new Map<string, Map<string, Entry>>();
  for (const b of buys) {
    let tokens = byWallet.get(b.wallet);
    if (!tokens) {
      tokens = new Map();
      byWallet.set(b.wallet, tokens);
    }
    const prev = tokens.get(b.token);
    if (!prev || b.at.getTime() < prev.at.getTime()) tokens.set(b.token, b);
  }
  const out: Entry[] = [];
  for (const tokens of byWallet.values()) {
    for (const e of tokens.values()) out.push(e);
  }
  return out;
}

/**
 * Leader score from entry timing across tracked wallets. A wallet leads when others enter the same token
 * shortly after it. Entering alone earns nothing: no follower, no lead.
 * Score = 100 x (0.5 x led rate + 0.5 x min(average followers / 3, 1)).
 */
export function computeLeaderStats(buys: Entry[], windowMs = FOLLOW_WINDOW_MS): Map<string, LeaderStats> {
  const entries = firstEntries(buys);
  const byToken = new Map<string, Entry[]>();
  for (const e of entries) {
    let list = byToken.get(e.token);
    if (!list) {
      list = [];
      byToken.set(e.token, list);
    }
    list.push(e);
  }

  const acc = new Map<string, { n: number; led: number; followers: number; followed: number }>();
  for (const list of byToken.values()) {
    const len = list.length;
    if (len === 1) {
      const w = list[0]!.wallet;
      const a = acc.get(w) ?? { n: 0, led: 0, followers: 0, followed: 0 };
      a.n++;
      acc.set(w, a);
      continue;
    }
    for (let i = 0; i < len; i++) {
      const e = list[i]!;
      const a = acc.get(e.wallet) ?? { n: 0, led: 0, followers: 0, followed: 0 };
      const t = e.at.getTime();
      let after = 0;
      let before = false;
      for (let j = 0; j < len; j++) {
        if (i === j) continue;
        const o = list[j]!;
        if (o.wallet === e.wallet) continue;
        const ot = o.at.getTime();
        if (ot > t && ot <= t + windowMs) after++;
        else if (!before && ot < t && ot >= t - windowMs) before = true;
      }
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
