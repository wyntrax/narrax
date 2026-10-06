export interface ConsensusEvent { wallet: string; side: 'BUY' | 'SELL'; sol: number; at: Date }
export interface WalletInfo { score: number; leaderScore: number; clusterId: string | null }

export interface Consensus {
  score: number;
  walletCount: number;
  /** Wallets in the same cluster count once, so a cluster cannot fake agreement. */
  independentEntities: number;
  leaderCount: number;
  netFlowSol: number;
  /** Largest share of buyers that entered inside one 15-minute span. */
  timingConcentration: number;
}

export const MIN_WALLET_SCORE = 60;
export const LEADER_THRESHOLD = 70;

/**
 * Smart money consensus for one token from recent events of scored wallets.
 * Returns null when no qualifying wallet bought. Weights: independent entities 35, entity quality 25,
 * leaders 15, net flow 15, timing 10. Heavy selling by the same wallets cuts the score by 30%.
 */
export function computeConsensus(events: ConsensusEvent[], wallets: Map<string, WalletInfo>): Consensus | null {
  const ok = events.filter((e) => (wallets.get(e.wallet)?.score ?? 0) >= MIN_WALLET_SCORE);
  const buys = ok.filter((e) => e.side === 'BUY');
  const buyers = [...new Set(buys.map((b) => b.wallet))];
  if (!buyers.length) return null;

  const entityBest = new Map<string, number>();
  for (const w of buyers) {
    const info = wallets.get(w)!;
    const key = info.clusterId ?? w;
    entityBest.set(key, Math.max(entityBest.get(key) ?? 0, info.score));
  }
  const independent = entityBest.size;
  const avgQuality = [...entityBest.values()].reduce((s, x) => s + x, 0) / independent / 100;
  const leaders = buyers.filter((w) => wallets.get(w)!.leaderScore >= LEADER_THRESHOLD).length;
  const netFlow = ok.reduce((s, e) => s + (e.side === 'BUY' ? e.sol : -e.sol), 0);

  const times = buys.map((b) => b.at.getTime()).sort((a, b) => a - b);
  let best = 0;
  for (let i = 0; i < times.length; i++) {
    const inSpan = new Set(buys.filter((b) => b.at.getTime() >= times[i]! && b.at.getTime() <= times[i]! + 15 * 60_000).map((b) => b.wallet)).size;
    best = Math.max(best, inSpan);
  }
  const timing = best / buyers.length;

  let score = 100 * (0.35 * Math.min(independent / 4, 1) + 0.25 * avgQuality + 0.15 * Math.min(leaders / 2, 1) + 0.15 * (netFlow > 0 ? Math.min(netFlow / 5, 1) : 0) + 0.10 * timing);
  const sellers = new Set(ok.filter((e) => e.side === 'SELL').map((e) => e.wallet));
  if (sellers.size * 2 >= buyers.length) score *= 0.7;

  return { score: Math.round(score * 10) / 10, walletCount: buyers.length, independentEntities: independent, leaderCount: leaders, netFlowSol: netFlow, timingConcentration: timing };
}
