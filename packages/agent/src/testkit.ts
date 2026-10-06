import type { LlmProvider, LlmRequest, LlmResponse } from '@narra/ai';
import type { AgentPorts, ProposalInput, ProposalView, SettingsView } from './ports';
import { GLOBAL_LIMITS } from '@narra/risk';
import { AGENT_LIMITS } from './constants';

export const USER_A = 'user-a';
export const USER_B = 'user-b';
export const NOW = new Date('2026-10-04T12:00:00Z');
export const MINT = 'So11111111111111111111111111111111111111112';

export interface FakeData { symbol: string; name: string; summary: string; alertTitle: string; alertBody: string }

/** In-memory ports for two users. Every call is logged with the user id it was given, so tests can prove nothing crossed users. */
export function fakePorts(planted: Partial<FakeData> = {}) {
  const d: FakeData = { symbol: 'SAFE', name: 'Safe Token', summary: 'A normal summary.', alertTitle: 'Alert', alertBody: 'Body', ...planted };
  const calls: { method: string; userId: string | null }[] = [];
  const proposals: (ProposalView & { userId: string })[] = [];
  const settings: Record<string, SettingsView> = {
    [USER_A]: { mode: 'PAPER', aiTradingEnabled: true, agentPaused: false, preset: 'BALANCED', hasProfile: true, limits: { maxPerTradeSol: 0.25, maxDailyAllocationSol: 1, maxTokenExposurePct: 15, maxOpenPositions: 5, maxDailyLossPct: 8, minConfidence: 0.75 } },
    [USER_B]: { mode: 'AUTO', aiTradingEnabled: true, agentPaused: false, preset: 'AGGRESSIVE', hasProfile: true, limits: { maxPerTradeSol: 0.5, maxDailyAllocationSol: 2, maxTokenExposurePct: 20, maxOpenPositions: 8, maxDailyLossPct: 10, minConfidence: 0.7 } },
  };
  const snapshot = JSON.stringify(settings);
  const log = (method: string, userId: string | null = null) => calls.push({ method, userId });
  const opp = { mint: MINT, symbol: d.symbol, name: d.name, score: 80, narrativeScore: 70, smartMoneyScore: 60, liquidityScore: 50, momentumScore: 40, riskScore: 20, createdAt: NOW };

  const ports: AgentPorts = {
    async listOpportunities() { log('listOpportunities'); return [opp]; },
    async getToken() { log('getToken'); return { mint: MINT, symbol: d.symbol, name: d.name, blacklisted: false, metric: { priceUsd: 1, liquidityUsd: 200_000, volume24hUsd: 500_000, marketCapUsd: 1e6, at: NOW }, opportunity: opp, consensus: null }; },
    async recentDecisions() { log('recentDecisions'); return [{ id: 'dec1', action: 'WATCH', confidence: 0.6, reasonCodes: ['SMART_MONEY'], summary: d.summary, createdAt: NOW, outcome: null }]; },
    async myPositions(userId) { log('myPositions', userId); return [{ id: `pos-${userId}`, mint: MINT, symbol: d.symbol, status: 'OPEN', simulated: true, entryPriceUsd: 1, sizeSol: 0.2, openedAt: NOW, closedAt: null, reduceCount: 0, latestEvaluation: null }]; },
    async myTrades(userId) { log('myTrades', userId); return [{ id: `trade-${userId}`, mint: MINT, symbol: d.symbol, side: 'BUY', simulated: true, amountSol: 0.2, feeSol: 0.002, realizedPnlSol: -0.002, executedAt: NOW }]; },
    async mySettings(userId) { log('mySettings', userId); return settings[userId]!; },
    async myAlerts(userId) { log('myAlerts', userId); return [{ id: 'al1', kind: 'POSITION_REVIEW', priority: 'IMPORTANT', title: d.alertTitle, body: d.alertBody, createdAt: NOW }]; },
    async myConfirmations(userId) { log('myConfirmations', userId); return []; },
    async systemLimits() { log('systemLimits'); return { ...GLOBAL_LIMITS }; },
    async backtestSummary() { log('backtestSummary'); return { generatedAt: NOW.toISOString(), findings: [], noConclusion: ['Not enough data.'] }; },
    async countPendingProposals(userId) { log('countPendingProposals', userId); return proposals.filter((p) => p.userId === userId).length; },
    async createProposal(userId, _conv, p: ProposalInput) {
      log('createProposal', userId);
      const v: ProposalView = { id: `prop${proposals.length + 1}`, kind: p.kind, field: p.field ?? null, fromValue: p.fromValue ?? null, value: p.value ?? null, reason: p.reason, summary: p.summary, expiresAt: new Date(NOW.getTime() + AGENT_LIMITS.proposalTtlMs) };
      proposals.push({ ...v, userId });
      return v;
    },
  };
  return { ports, calls, proposals, settingsUnchanged: () => JSON.stringify(settings) === snapshot, settings };
}

export type Script = (req: LlmRequest, n: number) => string;

/** A model that does whatever the script says. `requests` records everything the code sent it. */
export function scriptedLlm(script: Script) {
  const requests: LlmRequest[] = [];
  const llm: LlmProvider = { async complete(req): Promise<LlmResponse> { requests.push(req); return { text: script(req, requests.length - 1), inputTokens: 10, outputTokens: 5 }; } };
  return { llm, requests };
}

export const call = (tool: string, args: Record<string, unknown> = {}) => JSON.stringify({ type: 'tool_call', tool, args });
export const final = (message: string) => JSON.stringify({ type: 'final', message });
