import { z } from 'zod';
import { wrapUntrusted, sanitizeUntrusted, type UntrustedField } from '@narra/shared';
import { AGENT_LIMITS } from './constants';
import type { AgentPorts, ProposalView } from './ports';
import { TIGHTENABLE_FIELDS, describeTighten, validateTighten } from './proposals';

export interface AgentContext { userId: string; now: Date; conversationId: string | null }

/**
 * What a tool hands back. `facts` holds numbers, enums and ids we generated or validated. Anything that came from outside
 * (token names, symbols, model-written summaries, alert text) goes ONLY in `untrusted`, wrapped and sanitized.
 */
export interface ToolOutput { facts: Record<string, unknown>; untrusted?: UntrustedField[]; proposal?: ProposalView; error?: string }

export interface Tool {
  name: string;
  description: string;
  /** Plain-text argument summary for the system prompt. */
  argsHelp: string;
  schema: z.ZodTypeAny;
  run(ports: AgentPorts, ctx: AgentContext, args: unknown): Promise<ToolOutput>;
}

function defineTool<S extends z.ZodTypeAny>(t: { name: string; description: string; argsHelp: string; schema: S; run: (p: AgentPorts, c: AgentContext, a: z.infer<S>) => Promise<ToolOutput> }): Tool {
  return { ...t, run: (p, c, a) => t.run(p, c, a as z.infer<S>) };
}

// Mints are base58. This is the only free-form identifier a model can pass, and it can only look something up.
const mint = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const limit = (max: number, dflt: number) => z.number().int().min(1).max(max).default(dflt);
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const text = (source: string, s: string, max = 200) => wrapUntrusted(source, s, max);
/**
 * Facts are built field by field. Never spread an object from a port into facts: a field added to it later, or a free-text field
 * that should have been wrapped, would then reach the model as if it were trusted.
 */
const SCORES = ['score', 'narrativeScore', 'smartMoneyScore', 'liquidityScore', 'momentumScore', 'riskScore'] as const;
const scores = (o: Record<(typeof SCORES)[number], number>) => ({ score: o.score, narrativeScore: o.narrativeScore, smartMoneyScore: o.smartMoneyScore, liquidityScore: o.liquidityScore, momentumScore: o.momentumScore, riskScore: o.riskScore });
const num = (n: number | null) => (n == null || !Number.isFinite(n) ? null : n);

export const TOOLS: Tool[] = [
  defineTool({
    name: 'list_opportunities', description: 'The highest-scoring recent opportunities the system has found (all users see the same list).',
    argsHelp: '{"limit"?: 1-10}', schema: z.object({ limit: limit(10, 5) }).strict(),
    async run(p, _c, a) {
      const rows = await p.listOpportunities(a.limit);
      return {
        facts: { count: rows.length, items: rows.map((r, i) => ({ ref: i, mint: r.mint, ...scores(r), at: iso(r.createdAt) })) },
        untrusted: rows.flatMap((r, i) => [text(`opportunity[${i}].symbol`, r.symbol, 32), text(`opportunity[${i}].name`, r.name, 64)]),
      };
    },
  }),
  defineTool({
    name: 'get_token', description: 'Latest price, liquidity, volume, opportunity score and wallet consensus for one token, by mint address.',
    argsHelp: '{"mint": base58 address}', schema: z.object({ mint }).strict(),
    async run(p, _c, a) {
      const t = await p.getToken(a.mint);
      if (!t) return { facts: {}, error: 'not_found' };
      return {
        facts: {
          mint: t.mint, blacklisted: t.blacklisted,
          metric: t.metric && { priceUsd: t.metric.priceUsd, liquidityUsd: t.metric.liquidityUsd, volume24hUsd: t.metric.volume24hUsd, marketCapUsd: t.metric.marketCapUsd, at: iso(t.metric.at) },
          opportunity: t.opportunity && { ...scores(t.opportunity), at: iso(t.opportunity.createdAt) },
          consensus: t.consensus && { score: t.consensus.score, walletCount: t.consensus.walletCount, independentEntities: t.consensus.independentEntities, leaderCount: t.consensus.leaderCount, at: iso(t.consensus.at) },
        },
        untrusted: [text('token.symbol', t.symbol, 32), text('token.name', t.name, 64)],
      };
    },
  }),
  defineTool({
    name: 'get_recent_decisions', description: 'Recent AI decisions about a token (BUY, WATCH, AVOID) with their reason codes and, once known, what the price did afterwards.',
    argsHelp: '{"mint": base58 address, "limit"?: 1-10}', schema: z.object({ mint, limit: limit(10, 5) }).strict(),
    async run(p, _c, a) {
      const rows = await p.recentDecisions(a.mint, a.limit);
      return {
        facts: { count: rows.length, items: rows.map((d) => ({ id: d.id, action: d.action, confidence: d.confidence, reasonCodes: d.reasonCodes.filter((c) => /^[A-Z0-9_]{2,48}$/.test(c)), at: iso(d.createdAt), outcome: d.outcome && { label: d.outcome.label, returnPct24h: num(d.outcome.returnPct24h), isFinal: d.outcome.isFinal } })) },
        untrusted: rows.map((d, i) => text(`decision[${i}].summary`, d.summary, 300)),
      };
    },
  }),
  defineTool({
    name: 'get_my_positions', description: "The signed-in user's own positions, paper or real, with the monitor's latest recommendation.",
    argsHelp: '{"status"?: "OPEN"|"CLOSED"|"ALL", "limit"?: 1-20}', schema: z.object({ status: z.enum(['OPEN', 'CLOSED', 'ALL']).default('OPEN'), limit: limit(20, 10) }).strict(),
    async run(p, c, a) {
      const rows = await p.myPositions(c.userId, a.status, a.limit);
      return {
        facts: { count: rows.length, items: rows.map((x, i) => ({ ref: i, id: x.id, mint: x.mint, status: x.status, simulated: x.simulated, entryPriceUsd: x.entryPriceUsd, sizeSol: x.sizeSol, openedAt: iso(x.openedAt), closedAt: iso(x.closedAt), reduceCount: x.reduceCount, latestEvaluation: x.latestEvaluation && { action: x.latestEvaluation.action, codes: x.latestEvaluation.codes.filter((c) => /^[A-Z0-9_]{2,48}$/.test(c)), at: iso(x.latestEvaluation.at) } })) },
        untrusted: rows.map((x, i) => text(`position[${i}].symbol`, x.symbol, 32)),
      };
    },
  }),
  defineTool({
    name: 'get_my_trades', description: "The signed-in user's own recent trades, with realized profit and loss in SOL.",
    argsHelp: '{"limit"?: 1-20}', schema: z.object({ limit: limit(20, 10) }).strict(),
    async run(p, c, a) {
      const rows = await p.myTrades(c.userId, a.limit);
      return {
        facts: { count: rows.length, items: rows.map((t, i) => ({ ref: i, id: t.id, mint: t.mint, side: t.side, simulated: t.simulated, amountSol: t.amountSol, feeSol: t.feeSol, realizedPnlSol: t.realizedPnlSol, at: iso(t.executedAt) })) },
        untrusted: rows.map((t, i) => text(`trade[${i}].symbol`, t.symbol, 32)),
      };
    },
  }),
  defineTool({
    name: 'get_my_settings', description: "The signed-in user's trading mode, whether AI access is on, whether the agent is paused, and their risk limits.",
    argsHelp: '{}', schema: z.object({}).strict(),
    async run(p, c) {
      const x = await p.mySettings(c.userId);
      return { facts: { mode: x.mode, aiTradingEnabled: x.aiTradingEnabled, agentPaused: x.agentPaused, preset: x.preset, hasProfile: x.hasProfile, limits: Object.fromEntries(TIGHTENABLE_FIELDS.map((f) => [f, x.limits[f]])) } };
    },
  }),
  defineTool({
    name: 'get_my_alerts', description: "The signed-in user's recent alerts.",
    argsHelp: '{"limit"?: 1-20}', schema: z.object({ limit: limit(20, 10) }).strict(),
    async run(p, c, a) {
      const rows = await p.myAlerts(c.userId, a.limit);
      return {
        facts: { count: rows.length, items: rows.map((x, i) => ({ ref: i, id: x.id, kind: x.kind, priority: x.priority, at: iso(x.createdAt) })) },
        untrusted: rows.flatMap((x, i) => [text(`alert[${i}].title`, x.title, 120), text(`alert[${i}].body`, x.body, 300)]),
      };
    },
  }),
  defineTool({
    name: 'get_my_confirmations', description: "The signed-in user's recent semi-auto confirmations (what the agent asked them to approve).",
    argsHelp: '{"limit"?: 1-10}', schema: z.object({ limit: limit(10, 5) }).strict(),
    async run(p, c, a) {
      const rows = await p.myConfirmations(c.userId, a.limit);
      return {
        facts: { count: rows.length, items: rows.map((x, i) => ({ ref: i, id: x.id, kind: x.kind, status: x.status, mint: x.mint, sizeSol: x.sizeSol, expiresAt: iso(x.expiresAt) })) },
        untrusted: rows.map((x, i) => text(`confirmation[${i}].symbol`, x.symbol, 32)),
      };
    },
  }),
  defineTool({
    name: 'get_backtest_summary', description: 'The findings of the latest saved backtest, and what it could not conclude because of too little data.',
    argsHelp: '{}', schema: z.object({}).strict(),
    async run(p) {
      const s = await p.backtestSummary();
      return s ? { facts: { generatedAt: s.generatedAt, findings: s.findings.slice(0, 20), noConclusion: s.noConclusion.slice(0, 20) } } : { facts: {}, error: 'no_backtest_saved' };
    },
  }),
  defineTool({
    name: 'get_system_limits', description: 'The system-wide risk limits that no user setting can exceed.',
    argsHelp: '{}', schema: z.object({}).strict(),
    async run(p) { return { facts: { limits: await p.systemLimits() } }; },
  }),
  defineTool({
    name: 'propose_pause_agent', description: 'Suggest that the user pause the agent. This only creates a suggestion. Nothing changes unless the user applies it themselves.',
    argsHelp: '{"reason": short text, max 300 characters}', schema: z.object({ reason: z.string().min(1).max(2000) }).strict(),
    async run(p, c, a) {
      const reason = sanitizeUntrusted(a.reason, AGENT_LIMITS.maxReasonChars);
      if (!reason) return { facts: {}, error: 'reason_required' };
      if ((await p.mySettings(c.userId)).agentPaused) return { facts: {}, error: 'already_paused' };
      if ((await p.countPendingProposals(c.userId)) >= AGENT_LIMITS.maxPendingProposalsPerUser) return { facts: {}, error: 'too_many_pending_proposals' };
      const proposal = await p.createProposal(c.userId, c.conversationId, { kind: 'PAUSE_AGENT', reason, summary: 'Pause the agent' });
      return { facts: { proposalId: proposal.id, status: 'PENDING', expiresAt: iso(proposal.expiresAt), note: 'The user must apply this themselves.' }, proposal };
    },
  }),
  defineTool({
    name: 'propose_tighten_limit', description: 'Suggest a stricter risk limit. It must be more cautious than the current value. This only creates a suggestion. Nothing changes unless the user applies it themselves.',
    argsHelp: `{"field": ${TIGHTENABLE_FIELDS.map((f) => `"${f}"`).join('|')}, "value": number, "reason": short text, max 300 characters}`,
    schema: z.object({ field: z.enum(TIGHTENABLE_FIELDS), value: z.number(), reason: z.string().min(1).max(2000) }).strict(),
    async run(p, c, a) {
      const reason = sanitizeUntrusted(a.reason, AGENT_LIMITS.maxReasonChars);
      if (!reason) return { facts: {}, error: 'reason_required' };
      const current = (await p.mySettings(c.userId)).limits[a.field];
      const check = validateTighten(a.field, a.value, current);
      if (!check.ok) return { facts: { current }, error: `rejected_${check.code.toLowerCase()}` };
      if ((await p.countPendingProposals(c.userId)) >= AGENT_LIMITS.maxPendingProposalsPerUser) return { facts: {}, error: 'too_many_pending_proposals' };
      const proposal = await p.createProposal(c.userId, c.conversationId, { kind: 'TIGHTEN_LIMIT', field: a.field, fromValue: current, value: a.value, reason, summary: describeTighten(a.field, current, a.value) });
      return { facts: { proposalId: proposal.id, status: 'PENDING', expiresAt: iso(proposal.expiresAt), note: 'The user must apply this themselves.' }, proposal };
    },
  }),
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
export const findTool = (name: string) => TOOLS.find((t) => t.name === name);
