/**
 * Every threshold the monitor uses, as a named starting value. None has been validated against outcomes, and each
 * should become an admin-editable setting. Exit decisions only ever reduce exposure.
 */
export const MONITOR_RULES = {
  /** Price data older than this is not used. The position is then "blind" and the monitor says so. */
  maxDataAgeMs: 15 * 60_000,
  /** Share of the position a REDUCE asks to sell. SELL is always 100. */
  reduceFractionPct: 50,
  liquidity: {
    /** Liquidity down this much from entry: reduce. */
    reduceDropPct: 40,
    /** Liquidity down this much from entry: sell. */
    sellDropPct: 70,
    /** Below this absolute liquidity, selling later may be impossible: sell. */
    sellFloorUsd: 10_000,
  },
  /** 24h volume below this share of the entry-time figure is a warning. */
  volumeWarnBelowPctOfEntry: 25,
  /** A fall of this much over the last hour is a warning. */
  momentumWarnDropPct1h: 25,
  /** Top-10 share rising by this many points since entry is a warning. */
  concentrationWarnRisePts: 15,
  narrative: {
    /** Score down this many points from entry: reduce. */
    reduceScoreDropPts: 30,
    /** Velocity down this share from entry: warning. */
    warnVelocityDropPct: 60,
  },
  smartMoney: {
    /** Independent tracked-wallet entities that sold: reduce at this many, sell at the next. */
    reduceEntities: 2,
    sellEntities: 3,
    /** A tracked wallet counts as having exited once it sold this share of what it bought. */
    exitFraction: 0.5,
    /** Only wallets with at least this score are considered. */
    minWalletScore: 60,
    /** A wallet with at least this leader score counts as a leader. */
    leaderMinScore: 60,
    /** How far back to look for the wallets' buys. */
    lookbackMs: 7 * 86_400_000,
  },
  /** This many warnings at once escalate to a reduce. */
  warningsToReduce: 2,
} as const;
export type MonitorRules = typeof MONITOR_RULES;
