export interface TokenRiskInputs {
  liquidityUsd: number;
  holders: number | null;
  top10Pct: number | null;
  devHoldingPct: number | null;
  mintAuthorityActive: boolean | null;
  freezeAuthorityActive: boolean | null;
  isHoneypot: boolean | null;
  pairAgeMinutes: number | null;
}

export interface TokenRisk {
  /** 0 to 100, higher is worse. */
  riskScore: number;
  flags: string[];
}

/** Starting values, not validated against outcomes. Each is a named constant so it can be tuned or moved to settings. */
export const RISK_WEIGHTS = {
  mintAuthorityActive: 25,
  freezeAuthorityActive: 20,
  top10Over60: 20,
  top10Over40: 10,
  thinLiquidity: 15,
  fewHolders: 10,
  holdersUnknown: 5,
  veryNew: 10,
} as const;
export const RISK_THRESHOLDS = { thinLiquidityUsd: 20_000, fewHolders: 50, veryNewMinutes: 30 } as const;

/**
 * Deterministic risk flags from facts only. Unknown inputs add a flag but never lower the score, and a confirmed
 * honeypot is 100 on its own. A low score means "no known problem", never "safe".
 */
export function tokenRisk(i: TokenRiskInputs): TokenRisk {
  if (i.isHoneypot === true) return { riskScore: 100, flags: ['HONEYPOT'] };
  const flags: string[] = [];
  let score = 0;
  const add = (flag: string, points: number) => { flags.push(flag); score += points; };

  if (i.mintAuthorityActive === true) add('MINT_AUTHORITY_ACTIVE', RISK_WEIGHTS.mintAuthorityActive);
  if (i.freezeAuthorityActive === true) add('FREEZE_AUTHORITY_ACTIVE', RISK_WEIGHTS.freezeAuthorityActive);
  if (i.top10Pct != null && i.top10Pct >= 60) add('TOP10_OVER_60', RISK_WEIGHTS.top10Over60);
  else if (i.top10Pct != null && i.top10Pct >= 40) add('TOP10_OVER_40', RISK_WEIGHTS.top10Over40);
  if (i.liquidityUsd < RISK_THRESHOLDS.thinLiquidityUsd) add('THIN_LIQUIDITY', RISK_WEIGHTS.thinLiquidity);
  if (i.holders == null) add('HOLDERS_UNKNOWN', RISK_WEIGHTS.holdersUnknown);
  else if (i.holders < RISK_THRESHOLDS.fewHolders) add('FEW_HOLDERS', RISK_WEIGHTS.fewHolders);
  if (i.pairAgeMinutes != null && i.pairAgeMinutes < RISK_THRESHOLDS.veryNewMinutes) add('VERY_NEW', RISK_WEIGHTS.veryNew);
  if (i.devHoldingPct == null) flags.push('DEV_HOLDING_UNKNOWN');
  if (i.top10Pct == null) flags.push('CONCENTRATION_UNKNOWN');

  return { riskScore: Math.min(100, score), flags };
}
