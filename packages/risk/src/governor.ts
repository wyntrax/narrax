import type { AgentDecision } from '@narra/shared';
import { mergeLimits } from './limits';
import type { Adjustment, RiskContext, RiskLimits, RiskResult, Route, Violation } from './types';

const round = (n: number, dp = 6) => Number(n.toFixed(dp));
const secondsSince = (now: Date, then: Date | null) => (then ? (now.getTime() - then.getTime()) / 1000 : Infinity);

/**
 * Deterministic Risk Governor. Pure function: no I/O, no clock, no randomness.
 * The AI decision is treated as untrusted input. The model can ask for stricter execution
 * parameters than the limits allow, never looser ones.
 */
export function evaluateRisk(
  decision: AgentDecision,
  ctx: RiskContext,
  userLimits: Partial<RiskLimits> = {},
  globalLimits?: RiskLimits,
): RiskResult {
  const limits = mergeLimits(userLimits, globalLimits);
  const violations: Violation[] = [];
  const adjustments: Adjustment[] = [];
  const fail = (code: string, message: string) => violations.push({ code, message });

  const maxSlippageBps = Math.min(decision.entry.maxSlippageBps, limits.maxSlippageBps);
  const maxPriceImpactPct = Math.min(decision.entry.maxPriceImpactPct, limits.maxPriceImpactPct);

  const isEntry = decision.action === 'BUY';
  const isExit = decision.action === 'REDUCE' || decision.action === 'SELL';

  const result = (route: Route, sizeSol = 0, exitFraction = 0): RiskResult => ({
    approved: violations.length === 0,
    route: violations.length ? 'REJECT' : route,
    sizeSol: violations.length ? 0 : sizeSol,
    exitFraction: violations.length ? 0 : exitFraction,
    maxSlippageBps,
    maxPriceImpactPct,
    violations,
    adjustments,
  });

  // Not a trade: nothing for the governor to block.
  if (!isEntry && !isExit) return result('NO_TRADE');

  // Checks that apply to every trade, entries and exits.
  if (ctx.agentPaused) fail('AGENT_PAUSED', 'The agent is paused.');
  if (ctx.systemPaused && isEntry) fail('SYSTEM_PAUSED', 'New entries are paused system-wide.');
  // Paper entries need AI access too, so a job queued before access was revoked cannot still open a paper position.
  // A paper exit does not: it only closes a simulated position, and closing is what we want.
  if ((ctx.mode === 'SEMI_AUTO' || ctx.mode === 'AUTO' || (ctx.mode === 'PAPER' && isEntry)) && !ctx.aiAccessEnabled) {
    fail('AI_ACCESS_DISABLED', 'AI trading access is off.');
  }
  if (ctx.history.seenIdempotencyKeys.includes(ctx.idempotencyKey)) {
    fail('DUPLICATE_ORDER', 'This order was already submitted.');
  }
  if (secondsSince(ctx.now, ctx.history.lastSameOrderAt) < limits.duplicateWindowSeconds) {
    fail('DUPLICATE_WINDOW', 'A matching order was submitted very recently.');
  }
  if (ctx.quote.expectedSlippageBps > maxSlippageBps) {
    fail('SLIPPAGE_TOO_HIGH', `Expected slippage ${ctx.quote.expectedSlippageBps} bps is above ${maxSlippageBps} bps.`);
  }
  if (ctx.quote.priceImpactPct > maxPriceImpactPct) {
    fail('PRICE_IMPACT_TOO_HIGH', `Price impact ${ctx.quote.priceImpactPct}% is above ${maxPriceImpactPct}%.`);
  }

  if (isExit) {
    if (!ctx.portfolio.hasPositionInToken) fail('NO_POSITION', 'There is no open position to exit.');
    const exitFraction = decision.action === 'SELL' ? 1 : Math.min(Math.max(decision.suggestedPositionSizePct / 100, 0), 1);
    if (exitFraction <= 0) fail('ZERO_EXIT_SIZE', 'The exit size is zero.');
    return result(routeForMode(ctx.mode), 0, round(exitFraction, 4));
  }

  // Entry-only checks.
  if (ctx.token.blacklisted) fail('TOKEN_BLACKLISTED', 'This token is blacklisted.');
  if (decision.confidence < limits.minConfidence) {
    fail('CONFIDENCE_TOO_LOW', `Confidence ${decision.confidence} is below ${limits.minConfidence}.`);
  }
  if (ctx.signals.opportunityScore < limits.minOpportunityScore) {
    fail('OPPORTUNITY_TOO_LOW', `Opportunity score ${ctx.signals.opportunityScore} is below ${limits.minOpportunityScore}.`);
  }
  if (ctx.signals.consensusScore < limits.minConsensusScore) {
    fail('CONSENSUS_TOO_LOW', `Smart money consensus ${ctx.signals.consensusScore} is below ${limits.minConsensusScore}.`);
  }
  if (ctx.token.liquidityUsd < limits.minLiquidityUsd) {
    fail('LIQUIDITY_TOO_LOW', `Liquidity $${ctx.token.liquidityUsd} is below $${limits.minLiquidityUsd}.`);
  }
  if (secondsSince(ctx.now, ctx.history.lastTradeAtForToken) < limits.cooldownSeconds) {
    fail('COOLDOWN_ACTIVE', 'This token was traded too recently.');
  }
  if (!ctx.portfolio.hasPositionInToken && ctx.portfolio.openPositions >= limits.maxOpenPositions) {
    fail('MAX_OPEN_POSITIONS', `Already at ${limits.maxOpenPositions} open positions.`);
  }
  const p = ctx.portfolio;
  if (p.totalValueSol > 0 && p.realizedPnlTodaySol < 0 && (-p.realizedPnlTodaySol / p.totalValueSol) * 100 >= limits.maxDailyLossPct) {
    fail('DAILY_LOSS_LIMIT', 'The daily loss limit has been reached.');
  }
  if (p.drawdownPct >= limits.maxDrawdownPct) fail('DRAWDOWN_LIMIT', 'The portfolio drawdown limit has been reached.');

  // Sizing: start from what the model asked for, then clamp. Limits only ever reduce the size.
  const desired = (p.totalValueSol * decision.suggestedPositionSizePct) / 100;
  const spendable = p.walletBalanceSol - limits.minSolReserve;
  const dailyRoom = limits.maxDailyAllocationSol - p.allocatedTodaySol;
  const exposureRoom = (p.totalValueSol * limits.maxTokenExposurePct) / 100 - p.tokenExposureSol;

  if (desired <= 0) fail('ZERO_SIZE', 'The requested position size is zero.');
  if (spendable <= 0) fail('INSUFFICIENT_BALANCE', 'The balance does not cover the SOL reserve.');
  if (dailyRoom <= 0) fail('DAILY_ALLOCATION_EXCEEDED', 'The daily allocation is used up.');
  if (exposureRoom <= 0) fail('TOKEN_EXPOSURE_EXCEEDED', 'The exposure limit for this token is reached.');

  const size = Math.min(desired, limits.maxPerTradeSol, spendable, dailyRoom, exposureRoom);
  if (violations.length === 0 && size < desired) {
    adjustments.push({ code: 'SIZE_CLAMPED', message: `Size reduced from ${round(desired)} to ${round(size)} SOL by limits.` });
  }
  return result(routeForMode(ctx.mode), round(Math.max(size, 0)), 0);
}

function routeForMode(mode: RiskContext['mode']): Route {
  switch (mode) {
    case 'SHADOW': return 'LOG_ONLY';
    case 'PAPER': return 'SIMULATE';
    case 'SEMI_AUTO': return 'AWAIT_CONFIRMATION';
    case 'AUTO': return 'EXECUTE';
  }
}
