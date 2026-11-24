import { describe, expect, it } from 'vitest';
import { flowGateReason, flowWithholdReason, WALLET_FLOW_LIMITS, type FlowGateFacts } from './walletResearch';

const passing: FlowGateFacts = {
  tokenAvailable: true, trades: 2, tooManyTrades: false, qualifiedTrades: 2,
  newestQualifiedTradeAgeMs: 60_000, netSol: 1, supportingEntities: 2,
  liquidityUsd: 50_000, holders: 100, riskFlags: [],
};

describe('flowWithholdReason', () => {
  it('publishes only when every gate passes', () => {
    expect(flowWithholdReason(passing)).toBeNull();
  });

  it.each([
    [{ tokenAvailable: false }, 'TOKEN_UNAVAILABLE'],
    [{ trades: 0 }, 'NO_NEW_TRADES'],
    [{ tooManyTrades: true }, 'TOO_MANY_TRADES'],
    [{ qualifiedTrades: 0 }, 'NO_QUALIFIED_WALLETS'],
    [{ newestQualifiedTradeAgeMs: WALLET_FLOW_LIMITS.newestTradeMs + 1 }, 'TRADE_STALE'],
    [{ newestQualifiedTradeAgeMs: null }, 'TRADE_STALE'],
    [{ netSol: WALLET_FLOW_LIMITS.minEntityNetSol / 2 }, 'FLOW_BELOW_MINIMUM'],
    [{ supportingEntities: 1 }, 'FEW_INDEPENDENT_ENTITIES'],
    [{ liquidityUsd: null }, 'NO_MARKET_EVIDENCE'],
    [{ liquidityUsd: WALLET_FLOW_LIMITS.minLiquidityUsd - 1 }, 'THIN_LIQUIDITY'],
    [{ holders: null }, 'NO_HOLDER_OBSERVATION'],
    [{ holders: WALLET_FLOW_LIMITS.minHolders - 1 }, 'FEW_HOLDERS'],
    [{ top10Pct: WALLET_FLOW_LIMITS.maxTop10Pct + 0.1 }, 'HIGH_CONCENTRATION'],
    [{ riskFlags: null }, 'NO_RISK_OBSERVATION'],
    [{ riskFlags: ['HONEYPOT'] }, 'RISK_BLOCKED'],
    [{ riskFlags: ['MINT_AUTHORITY_ACTIVE'] }, 'RISK_BLOCKED'],
  ] as const)('withholds %o as %s', (patch, reason) => {
    expect(flowWithholdReason({ ...passing, ...patch })).toBe(reason);
  });

  it('keeps non-blocking risk flags publishable', () => {
    expect(flowWithholdReason({ ...passing, riskFlags: ['THIN_LIQUIDITY', 'HOLDERS_UNKNOWN'] })).toBeNull();
  });

  it('exposes the wallet-only gate for pending retries', () => {
    expect(flowGateReason({ ...passing, newestQualifiedTradeAgeMs: 0 })).toBeNull();
    expect(flowGateReason({ ...passing, newestQualifiedTradeAgeMs: WALLET_FLOW_LIMITS.newestTradeMs + 1 })).toBe('TRADE_STALE');
  });
});
