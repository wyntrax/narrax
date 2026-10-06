import { MONITOR_RULES, type MonitorRules } from './rules';

export interface WalletTradeRow {
  walletId: string;
  /** Wallets in the same cluster are one entity. */
  clusterId: string | null;
  leaderScore: number;
  side: 'BUY' | 'SELL';
  /** Token units. Null when the trade did not record them. */
  tokenAmount: number | null;
  at: Date;
}

/**
 * How many independent tracked entities have left a token since the position opened.
 * A wallet has exited when what it sold since `openedAt` is at least rules.smartMoney.exitFraction of what it bought.
 * A wallet with any trade of unknown size is skipped rather than guessed. Wallets sharing a cluster count once.
 * The caller passes only trades of wallets that are active and scored high enough.
 */
export function computeSmartMoneyExits(trades: WalletTradeRow[], openedAt: Date, rules: MonitorRules = MONITOR_RULES): { entities: number; leaders: number } {
  const byWallet = new Map<string, WalletTradeRow[]>();
  for (const t of trades) byWallet.set(t.walletId, [...(byWallet.get(t.walletId) ?? []), t]);
  const entities = new Set<string>();
  const leaders = new Set<string>();
  for (const [walletId, rows] of byWallet) {
    if (rows.some((r) => r.tokenAmount == null || !(r.tokenAmount > 0))) continue;
    const bought = rows.filter((r) => r.side === 'BUY').reduce((s, r) => s + r.tokenAmount!, 0);
    const sold = rows.filter((r) => r.side === 'SELL' && r.at.getTime() >= openedAt.getTime()).reduce((s, r) => s + r.tokenAmount!, 0);
    if (bought <= 0 || sold < rules.smartMoney.exitFraction * bought) continue;
    const entity = rows[0]!.clusterId ?? walletId;
    entities.add(entity);
    if (Math.max(...rows.map((r) => r.leaderScore)) >= rules.smartMoney.leaderMinScore) leaders.add(entity);
  }
  return { entities: entities.size, leaders: leaders.size };
}
