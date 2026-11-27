import type { Confidence } from './cluster';

export interface FundingRow { walletId: string; funder: string }
export interface FundingEdge {
  fromId: string;
  toId: string;
  confidence: Confidence;
  /** direct: one tracked wallet funded another. shared_funder: both were first funded by the same outside address. */
  type: 'direct' | 'shared_funder';
  funder: string;
}
export interface FundingCluster { walletIds: string[]; confidence: Confidence }

/** A shared outside funder that first-funded more tracked wallets than this is treated as a service (an exchange, a faucet), not a person. Starting value. */
export const MAX_SHARED_FUNDER_FANOUT = 8;

/** Known Solana centralized-exchange hot wallets and cross-chain relayers that must never link unrelated retail wallets as a shared funder. */
export const KNOWN_SERVICE_FUNDERS: ReadonlySet<string> = new Set([
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', // Binance 2
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // Binance 3
  '2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S', // Binance 1
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS', // Coinbase 1
  'GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE', // Coinbase 2
  '2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm', // Coinbase Prime / Hot
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5', // Kraken
  '5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD', // OKX
  'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2', // Bybit
  'u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w',  // Gate.io
  'BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6', // KuCoin
  'ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ', // MEXC
  'AobVSwdW9BbpMdJvTqeCN4hPAmh4rHm7vwLnQ5ATSyrS', // Crypto.com
  'A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR', // Bitget
  '43DbAvKxhXh1oSxkJSqGosNw3HpBnmsWiak6tB5wpecN', // Backpack
]);

const RANK: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * Links tracked wallets by who first funded them.
 * - A tracked wallet that first-funded another tracked wallet is a HIGH link.
 * - Two wallets first-funded by the same outside address are a MEDIUM link, unless that address funded more than
 *   `maxFanout` tracked wallets or is in `ignoredFunders` / `KNOWN_SERVICE_FUNDERS`, in which case it is skipped as a probable service.
 * A cluster is only as strong as its weakest link. These are inferred relationships, never claims about ownership.
 */
export function buildFundingGraph(
  rows: FundingRow[], addressToId: Map<string, string>,
  opts: { ignoredFunders?: Set<string>; maxFanout?: number } = {},
): { edges: FundingEdge[]; clusters: FundingCluster[]; skippedFunders: { funder: string; wallets: number }[] } {
  const maxFanout = opts.maxFanout ?? MAX_SHARED_FUNDER_FANOUT;
  const ignored = opts.ignoredFunders ? new Set([...KNOWN_SERVICE_FUNDERS, ...opts.ignoredFunders]) : KNOWN_SERVICE_FUNDERS;
  const edges: FundingEdge[] = [];
  const skipped: { funder: string; wallets: number }[] = [];
  const outside = new Map<string, string[]>();

  for (const r of rows) {
    const funderId = addressToId.get(r.funder);
    if (funderId) {
      if (funderId !== r.walletId) edges.push({ fromId: funderId, toId: r.walletId, confidence: 'HIGH', type: 'direct', funder: r.funder });
    } else if (!ignored.has(r.funder)) {
      outside.set(r.funder, [...(outside.get(r.funder) ?? []), r.walletId]);
    }
  }
  for (const [funder, ids] of outside) {
    const unique = [...new Set(ids)].sort();
    if (unique.length < 2) continue;
    if (unique.length > maxFanout) { skipped.push({ funder, wallets: unique.length }); continue; }
    for (let i = 0; i < unique.length; i++) for (let j = i + 1; j < unique.length; j++) {
      edges.push({ fromId: unique[i]!, toId: unique[j]!, confidence: 'MEDIUM', type: 'shared_funder', funder });
    }
  }

  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  for (const e of edges) parent.set(find(e.fromId), find(e.toId));
  const groups = new Map<string, { ids: Set<string>; conf: Confidence }>();
  for (const e of edges) {
    const root = find(e.fromId);
    const g = groups.get(root) ?? { ids: new Set<string>(), conf: 'HIGH' as Confidence };
    g.ids.add(e.fromId); g.ids.add(e.toId);
    if (RANK[e.confidence] < RANK[g.conf]) g.conf = e.confidence;
    groups.set(root, g);
  }
  const clusters = [...groups.values()].map((g) => ({ walletIds: [...g.ids].sort(), confidence: g.conf })).sort((a, b) => a.walletIds[0]!.localeCompare(b.walletIds[0]!));
  return { edges, clusters, skippedFunders: skipped };
}
