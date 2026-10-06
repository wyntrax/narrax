import type { Entry } from './leader';
import { firstEntries } from './leader';

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ClusterEdge { a: string; b: string; sharedTokens: number; confidence: Confidence }
export interface Cluster { wallets: string[]; confidence: Confidence }

export const CO_ENTRY_WINDOW_MS = 60_000;
const RANK: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * Groups wallets that repeatedly enter the same tokens within a minute of each other.
 * Timing alone is weak evidence, so the best confidence it can earn is MEDIUM. HIGH is reserved for funding links.
 * These are inferred relationships, never claims about who owns a wallet.
 */
export function detectTimingClusters(buys: Entry[], opts: { windowMs?: number; minSharedTokens?: number } = {}): { clusters: Cluster[]; edges: ClusterEdge[] } {
  const windowMs = opts.windowMs ?? CO_ENTRY_WINDOW_MS;
  const minShared = opts.minSharedTokens ?? 3;
  const entries = firstEntries(buys);
  const byToken = new Map<string, Entry[]>();
  for (const e of entries) byToken.set(e.token, [...(byToken.get(e.token) ?? []), e]);

  const pairs = new Map<string, number>();
  for (const list of byToken.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = list[i]!, y = list[j]!;
        if (Math.abs(x.at.getTime() - y.at.getTime()) > windowMs) continue;
        const key = x.wallet < y.wallet ? `${x.wallet}|${y.wallet}` : `${y.wallet}|${x.wallet}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: ClusterEdge[] = [];
  for (const [key, shared] of pairs) {
    if (shared < minShared) continue;
    const [a, b] = key.split('|') as [string, string];
    edges.push({ a, b, sharedTokens: shared, confidence: shared >= 5 ? 'MEDIUM' : 'LOW' });
  }

  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  for (const e of edges) parent.set(find(e.a), find(e.b));

  const groups = new Map<string, { wallets: Set<string>; conf: Confidence }>();
  for (const e of edges) {
    const root = find(e.a);
    const g = groups.get(root) ?? { wallets: new Set<string>(), conf: 'MEDIUM' as Confidence };
    g.wallets.add(e.a); g.wallets.add(e.b);
    if (RANK[e.confidence] < RANK[g.conf]) g.conf = e.confidence; // a cluster is only as strong as its weakest link
    groups.set(root, g);
  }
  return { clusters: [...groups.values()].map((g) => ({ wallets: [...g.wallets].sort(), confidence: g.conf })), edges };
}
