import { median, type TradeRow, type WalletStats } from './stats';

/**
 * Deterministic behavioural signatures for automated, sniper, or micro-dust spray wallets.
 * These are observable swap-pattern heuristics (not ownership claims) used to keep bots from
 * distorting leader scores, consensus signals, and intake capacity.
 */
export const AUTOMATION_RULES = {
  version: 1,
  /** Sustained average trades per active calendar day above this flags high-frequency automation. */
  maxTradesPerDay: 100,
  minActiveDaysForFrequency: 2,
  minTradesForFrequency: 200,
  /** Share of closed legs exited within 15 seconds (same-block / sniper bot). */
  fastExit15sShare: 0.25,
  /** Share of closed legs exited within 60 seconds. */
  fastExit60sShare: 0.5,
  minClosedForFastExits: 10,
  /** Micro-dust spray: many buys with median buy size below 0.01 SOL. */
  minBuysForDustSpray: 20,
  dustMedianBuySol: 0.01,
  /** Fixed-timer bot: large share of closes clustered within ±5s of the median hold time. */
  minClosedForTimer: 20,
  timerToleranceSeconds: 5,
  timerClusterShare: 0.4,
  /** Survivorship-bias spray: leaves far more open bags than closed legs. */
  minClosedForBagOverhang: 20,
  minOpenForBagOverhang: 50,
  openToClosedRatio: 2,
} as const;

export type AutomationReason =
  | 'HIGH_FREQUENCY'
  | 'SNIPER_EXITS'
  | 'DUST_SPRAY'
  | 'FIXED_TIMER_EXITS'
  | 'OPEN_BAG_OVERHANG';

export interface AutomationProfile {
  version: typeof AUTOMATION_RULES.version;
  automated: boolean;
  reasons: AutomationReason[];
  tradesPerDay: number;
  activeDays: number;
  medianBuySol: number | null;
  fastExit15sRate: number | null;
  fastExit60sRate: number | null;
  openPositionCount: number;
}

/**
 * Detects observable bot/automation signatures from a wallet's swap history and computed stats.
 * Never fabricates data: small samples remain unflagged (`automated: false`).
 */
export function detectAutomation(trades: TradeRow[], stats: WalletStats): AutomationProfile {
  const R = AUTOMATION_RULES;
  const reasons: AutomationReason[] = [];

  const activeDaySet = new Set<string>();
  const buySols: number[] = [];
  const inventory = new Map<string, number>();

  const ordered = [...trades].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const t of ordered) {
    if (!(t.qty > 0) || !(t.sol >= 0)) continue;
    activeDaySet.add(t.at.toISOString().slice(0, 10));
    const held = inventory.get(t.token) ?? 0;
    if (t.side === 'BUY') {
      buySols.push(t.sol);
      inventory.set(t.token, held + t.qty);
    } else if (held > 0) {
      const rem = held - Math.min(t.qty, held);
      inventory.set(t.token, rem <= 1e-9 ? 0 : rem);
    }
  }

  let openPositionCount = 0;
  for (const qty of inventory.values()) {
    if (qty > 1e-9) openPositionCount++;
  }

  const activeDays = activeDaySet.size;
  const tradesPerDay = activeDays > 0 ? Math.round((ordered.length / activeDays) * 10) / 10 : 0;
  if (
    ordered.length >= R.minTradesForFrequency &&
    activeDays >= R.minActiveDaysForFrequency &&
    tradesPerDay > R.maxTradesPerDay
  ) {
    reasons.push('HIGH_FREQUENCY');
  }

  const medianBuySol = median(buySols);
  if (buySols.length >= R.minBuysForDustSpray && medianBuySol !== null && medianBuySol < R.dustMedianBuySol) {
    reasons.push('DUST_SPRAY');
  }

  const n = stats.legs.length;
  const fastExit15sRate = n > 0 ? stats.legs.filter((l) => l.holdSeconds <= 15).length / n : null;
  const fastExit60sRate = n > 0 ? stats.legs.filter((l) => l.holdSeconds <= 60).length / n : null;
  if (
    n >= R.minClosedForFastExits &&
    ((fastExit15sRate !== null && fastExit15sRate >= R.fastExit15sShare) ||
      (fastExit60sRate !== null && fastExit60sRate >= R.fastExit60sShare))
  ) {
    reasons.push('SNIPER_EXITS');
  }

  if (n >= R.minClosedForTimer && stats.medianHoldSeconds !== null) {
    const med = stats.medianHoldSeconds;
    const clustered = stats.legs.filter((l) => Math.abs(l.holdSeconds - med) <= R.timerToleranceSeconds).length;
    if (clustered / n >= R.timerClusterShare) {
      reasons.push('FIXED_TIMER_EXITS');
    }
  }

  if (
    n >= R.minClosedForBagOverhang &&
    openPositionCount >= R.minOpenForBagOverhang &&
    openPositionCount > n * R.openToClosedRatio
  ) {
    reasons.push('OPEN_BAG_OVERHANG');
  }

  return {
    version: R.version,
    automated: reasons.length > 0,
    reasons,
    tradesPerDay,
    activeDays,
    medianBuySol,
    fastExit15sRate,
    fastExit60sRate,
    openPositionCount,
  };
}
