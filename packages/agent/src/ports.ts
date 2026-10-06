import type { TightenableField } from './proposals';

/**
 * Everything the agent can read or do goes through these functions, and every one that is about a user takes the user id
 * from the signed-in session. The model never supplies a user id, and no tool schema has a field for one.
 * There is nothing here that signs, sends, swaps, withdraws, creates an order or touches a wallet.
 */
export interface OpportunityView { mint: string; symbol: string; name: string; score: number; narrativeScore: number; smartMoneyScore: number; liquidityScore: number; momentumScore: number; riskScore: number; createdAt: Date }
export interface TokenView {
  mint: string; symbol: string; name: string; blacklisted: boolean;
  metric: { priceUsd: number; liquidityUsd: number; volume24hUsd: number; marketCapUsd: number; at: Date } | null;
  opportunity: { score: number; narrativeScore: number; smartMoneyScore: number; liquidityScore: number; momentumScore: number; riskScore: number; createdAt: Date } | null;
  consensus: { score: number; walletCount: number; independentEntities: number; leaderCount: number; at: Date } | null;
}
export interface DecisionView { id: string; action: string; confidence: number; reasonCodes: string[]; summary: string; createdAt: Date; outcome: { label: string; returnPct24h: number | null; isFinal: boolean } | null }
export interface PositionView { id: string; mint: string; symbol: string; status: string; simulated: boolean; entryPriceUsd: number; sizeSol: number; openedAt: Date; closedAt: Date | null; reduceCount: number; latestEvaluation: { action: string; codes: string[]; at: Date } | null }
export interface TradeView { id: string; mint: string; symbol: string; side: string; simulated: boolean; amountSol: number | null; feeSol: number | null; realizedPnlSol: number | null; executedAt: Date }
export interface SettingsView { mode: string; aiTradingEnabled: boolean; agentPaused: boolean; preset: string | null; hasProfile: boolean; limits: Record<TightenableField, number> }
export interface AlertView { id: string; kind: string; priority: string; title: string; body: string; createdAt: Date }
export interface ConfirmationView { id: string; kind: string; status: string; mint: string; symbol: string; sizeSol: number; expiresAt: Date }
export interface BacktestSummaryView { generatedAt: string; findings: string[]; noConclusion: string[] }
export interface ProposalView { id: string; kind: 'PAUSE_AGENT' | 'TIGHTEN_LIMIT'; field: TightenableField | null; fromValue: number | null; value: number | null; reason: string; summary: string; expiresAt: Date }

export interface ProposalInput { kind: 'PAUSE_AGENT' | 'TIGHTEN_LIMIT'; field?: TightenableField; fromValue?: number; value?: number; reason: string; summary: string }

export interface AgentPorts {
  listOpportunities(limit: number): Promise<OpportunityView[]>;
  getToken(mint: string): Promise<TokenView | null>;
  recentDecisions(mint: string, limit: number): Promise<DecisionView[]>;
  myPositions(userId: string, status: 'OPEN' | 'CLOSED' | 'ALL', limit: number): Promise<PositionView[]>;
  myTrades(userId: string, limit: number): Promise<TradeView[]>;
  mySettings(userId: string): Promise<SettingsView>;
  myAlerts(userId: string, limit: number): Promise<AlertView[]>;
  myConfirmations(userId: string, limit: number): Promise<ConfirmationView[]>;
  backtestSummary(): Promise<BacktestSummaryView | null>;
  /** The system limits actually enforced now: the code defaults with any admin overrides. */
  systemLimits(): Promise<Record<string, number>>;
  countPendingProposals(userId: string): Promise<number>;
  createProposal(userId: string, conversationId: string | null, p: ProposalInput): Promise<ProposalView>;
}
