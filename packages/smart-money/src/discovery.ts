export interface EarlyBuyer { wallet: string; /** 1 is the first buyer. */ rank: number }
export interface TokenScan { tokenId: string; buyers: EarlyBuyer[]; /** Did the token's price run up afterwards? Decided by the caller from price history. */ winner: boolean }
export interface Candidate {
  address: string;
  /** 0 to 100. A starting formula, not validated against outcomes. */
  score: number;
  winnerTokens: number;
  scannedTokens: number;
  hitRate: number;
  avgRank: number;
  winners: string[];
}

export const DISCOVERY = {
  /** Only the first N buyers of a token count as early. */
  maxRank: 30,
  /** A wallet must be early in at least this many winning tokens to be suggested. */
  minWinnerTokens: 2,
  /** Winning tokens at which the volume part of the score saturates. */
  saturateAt: 5,
  /** Hit rate (winners over all scanned tokens the wallet was early in) at which the hit-rate part saturates. */
  hitRateSaturate: 0.5,
} as const;

/**
 * Suggests wallets that were early buyers of several tokens that later ran up.
 * A wallet that is early in everything (a sniper or MEV bot) has a low hit rate, because losing tokens count against
 * it, so score multiplies volume by hit rate and by how early it got in. Excluded addresses (already tracked,
 * already reviewed) are dropped. Output is a suggestion for a human to review, never an instruction to track.
 */
export function rankCandidates(scans: TokenScan[], exclude: Set<string> = new Set(), opts: Partial<typeof DISCOVERY> = {}): Candidate[] {
  const o = { ...DISCOVERY, ...opts };
  type Acc = { winners: string[]; scanned: number; ranks: number[] };
  const acc = new Map<string, Acc>();
  for (const s of scans) {
    const best = new Map<string, number>();
    for (const b of s.buyers) if (b.rank >= 1 && b.rank <= o.maxRank) best.set(b.wallet, Math.min(best.get(b.wallet) ?? Infinity, b.rank));
    for (const [wallet, rank] of best) {
      const a = acc.get(wallet) ?? { winners: [], scanned: 0, ranks: [] };
      a.scanned++;
      if (s.winner) { a.winners.push(s.tokenId); a.ranks.push(rank); }
      acc.set(wallet, a);
    }
  }
  const out: Candidate[] = [];
  for (const [address, a] of acc) {
    if (exclude.has(address) || a.winners.length < o.minWinnerTokens) continue;
    const hitRate = a.winners.length / a.scanned;
    const avgRank = a.ranks.reduce((s, x) => s + x, 0) / a.ranks.length;
    const earliness = 1 - (0.5 * (avgRank - 1)) / Math.max(1, o.maxRank - 1);
    const score = 100 * Math.min(1, a.winners.length / o.saturateAt) * Math.min(1, hitRate / o.hitRateSaturate) * earliness;
    out.push({ address, score: Math.round(score * 10) / 10, winnerTokens: a.winners.length, scannedTokens: a.scanned, hitRate, avgRank, winners: a.winners });
  }
  return out.sort((x, y) => y.score - x.score || x.address.localeCompare(y.address));
}
