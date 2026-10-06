import type { Prisma, PrismaClient } from '@narra/database';
import { AGENT_LIMITS, TIGHTENABLE_FIELDS, type AgentPorts, type ProposalView, type SettingsView } from '@narra/agent';
import { AgentDecisionSchema } from '@narra/shared';
import { PROFILES, SYSTEM_LIMITS_KEY, resolveSystemLimits } from '@narra/risk';
import { effectiveStatus } from '@narra/trading';

const n = (d: { toString(): string }) => Number(d.toString());
const nn = (d: { toString(): string } | null) => (d == null ? null : Number(d.toString()));

/** The limits a user is held to, as the six numbers the agent may propose to tighten. No profile means the strictest preset. */
export function effectiveLimits(profile: { maxPerTradeSol: { toString(): string }; maxDailyAllocationSol: { toString(): string }; maxTokenExposurePct: number; maxOpenPositions: number; maxDailyLossPct: number; minConfidence: number } | null): SettingsView['limits'] {
  if (!profile) { const c = PROFILES.CONSERVATIVE; return { maxPerTradeSol: c.maxPerTradeSol, maxDailyAllocationSol: c.maxDailyAllocationSol, maxTokenExposurePct: c.maxTokenExposurePct, maxOpenPositions: c.maxOpenPositions, maxDailyLossPct: c.maxDailyLossPct, minConfidence: c.minConfidence }; }
  return { maxPerTradeSol: n(profile.maxPerTradeSol), maxDailyAllocationSol: n(profile.maxDailyAllocationSol), maxTokenExposurePct: profile.maxTokenExposurePct, maxOpenPositions: profile.maxOpenPositions, maxDailyLossPct: profile.maxDailyLossPct, minConfidence: profile.minConfidence };
}

const toView = (p: { id: string; kind: 'PAUSE_AGENT' | 'TIGHTEN_LIMIT'; field: string | null; fromValue: number | null; value: number | null; reason: string; expiresAt: Date }, summary: string): ProposalView =>
  ({ id: p.id, kind: p.kind, field: (TIGHTENABLE_FIELDS as string[]).includes(p.field ?? '') ? (p.field as ProposalView['field']) : null, fromValue: p.fromValue, value: p.value, reason: p.reason, summary, expiresAt: p.expiresAt });

/**
 * Prisma-backed ports for the chat agent. Reads only, plus one insert: a suggestion the user must apply themselves.
 * Every personal query is filtered by the user id the route got from the session.
 */
export function makeAgentPorts(db: PrismaClient, now: () => Date = () => new Date()): AgentPorts {
  return {
    async listOpportunities(limit) {
      const rows = await db.opportunity.findMany({ where: { createdAt: { gte: new Date(now().getTime() - 24 * 3_600_000) } }, orderBy: [{ score: 'desc' }, { createdAt: 'desc' }], take: limit * 5, include: { token: { select: { mint: true, symbol: true, name: true } } } });
      const seen = new Set<string>(), out = [];
      for (const r of rows) { if (seen.has(r.token.mint)) continue; seen.add(r.token.mint); out.push({ mint: r.token.mint, symbol: r.token.symbol, name: r.token.name, score: r.score, narrativeScore: r.narrativeScore, smartMoneyScore: r.smartMoneyScore, liquidityScore: r.liquidityScore, momentumScore: r.momentumScore, riskScore: r.riskScore, createdAt: r.createdAt }); if (out.length >= limit) break; }
      return out;
    },
    async getToken(mint) {
      const t = await db.token.findUnique({ where: { mint }, include: { metrics: { orderBy: { at: 'desc' }, take: 1 }, opportunities: { orderBy: { createdAt: 'desc' }, take: 1 }, consensus: { orderBy: { at: 'desc' }, take: 1 } } });
      if (!t) return null;
      const m = t.metrics[0], o = t.opportunities[0], c = t.consensus[0];
      return {
        mint: t.mint, symbol: t.symbol, name: t.name, blacklisted: t.blacklisted,
        metric: m ? { priceUsd: n(m.priceUsd), liquidityUsd: n(m.liquidityUsd), volume24hUsd: n(m.volume24hUsd), marketCapUsd: n(m.marketCapUsd), at: m.at } : null,
        opportunity: o ? { score: o.score, narrativeScore: o.narrativeScore, smartMoneyScore: o.smartMoneyScore, liquidityScore: o.liquidityScore, momentumScore: o.momentumScore, riskScore: o.riskScore, createdAt: o.createdAt } : null,
        consensus: c ? { score: c.score, walletCount: c.walletCount, independentEntities: c.independentEntities, leaderCount: c.leaderCount, at: c.at } : null,
      };
    },
    async recentDecisions(mint, limit) {
      const rows = await db.agentDecision.findMany({ where: { userId: null, analysis: { opportunity: { token: { mint } } } }, orderBy: { createdAt: 'desc' }, take: limit, include: { outcome: true } });
      return rows.map((d) => {
        const p = AgentDecisionSchema.safeParse(d.payload);
        return { id: d.id, action: d.action, confidence: d.confidence, reasonCodes: p.success ? p.data.reasonCodes : [], summary: p.success ? p.data.summary : '', createdAt: d.createdAt, outcome: d.outcome ? { label: d.outcome.label, returnPct24h: d.outcome.returnPct24h, isFinal: d.outcome.isFinal } : null };
      });
    },
    async myPositions(userId, status, limit) {
      const rows = await db.position.findMany({ where: { userId, ...(status === 'ALL' ? {} : { status }) }, orderBy: { openedAt: 'desc' }, take: limit, include: { token: { select: { mint: true, symbol: true } }, evaluations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } } });
      return rows.map((p) => {
        const e = p.evaluations[0];
        const codes = Array.isArray(e?.signals) ? (e!.signals as { code?: unknown }[]).map((s) => s?.code).filter((c): c is string => typeof c === 'string') : [];
        return { id: p.id, mint: p.token.mint, symbol: p.token.symbol, status: p.status, simulated: p.simulated, entryPriceUsd: n(p.entryPriceUsd), sizeSol: n(p.sizeSol), openedAt: p.openedAt, closedAt: p.closedAt, reduceCount: p.reduceCount, latestEvaluation: e ? { action: e.action, codes, at: e.createdAt } : null };
      });
    },
    async myTrades(userId, limit) {
      const rows = await db.trade.findMany({ where: { userId }, orderBy: [{ executedAt: 'desc' }, { id: 'desc' }], take: limit, include: { order: { include: { token: { select: { mint: true, symbol: true } } } } } });
      return rows.map((t) => ({ id: t.id, mint: t.order.token.mint, symbol: t.order.token.symbol, side: t.side, simulated: t.simulated, amountSol: nn(t.amountSol), feeSol: nn(t.feeSol), realizedPnlSol: nn(t.realizedPnlSol), executedAt: t.executedAt }));
    },
    async mySettings(userId) {
      const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { permission: true, riskProfile: true } });
      const p = u.permission, at = now();
      return { mode: u.mode, aiTradingEnabled: !!p && p.aiTradingEnabled && !p.revokedAt && (!p.delegatedUntil || p.delegatedUntil > at), agentPaused: p?.agentPaused ?? false, preset: u.riskProfile?.preset ?? null, hasProfile: !!u.riskProfile, limits: effectiveLimits(u.riskProfile) };
    },
    async myAlerts(userId, limit) {
      return db.alert.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, select: { id: true, kind: true, priority: true, title: true, body: true, createdAt: true } });
    },
    async myConfirmations(userId, limit) {
      const at = now();
      const rows = await db.pendingConfirmation.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
      const tokens = await db.token.findMany({ where: { mint: { in: [...new Set(rows.map((r) => r.mint))] } }, select: { mint: true, symbol: true } });
      const sym = new Map(tokens.map((t) => [t.mint, t.symbol]));
      return rows.map((r) => ({ id: r.id, kind: r.kind, status: effectiveStatus(r, at), mint: r.mint, symbol: sym.get(r.mint) ?? '', sizeSol: n(r.sizeSol), expiresAt: r.expiresAt }));
    },
    async backtestSummary() {
      const r = await db.backtestRun.findFirst({ where: { kind: 'FULL' }, orderBy: { createdAt: 'desc' } });
      if (!r) return null;
      const rep = r.report as { generatedAt?: unknown; findings?: unknown; noConclusion?: unknown };
      const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 300)) : []);
      return { generatedAt: typeof rep.generatedAt === 'string' ? rep.generatedAt : r.createdAt.toISOString(), findings: strs(rep.findings), noConclusion: strs(rep.noConclusion) };
    },
    async systemLimits() {
      const row = await db.systemSetting.findUnique({ where: { key: SYSTEM_LIMITS_KEY } });
      return { ...resolveSystemLimits(row?.value).limits };
    },
    async countPendingProposals(userId) {
      return db.chatProposal.count({ where: { userId, status: 'PENDING', expiresAt: { gt: now() } } });
    },
    async createProposal(userId, conversationId, p) {
      const at = now();
      const [row] = await db.$transaction([
        db.chatProposal.create({ data: { userId, conversationId, kind: p.kind, field: p.field ?? null, fromValue: p.fromValue ?? null, value: p.value ?? null, reason: p.reason, expiresAt: new Date(at.getTime() + AGENT_LIMITS.proposalTtlMs), createdAt: at } }),
        db.auditLog.create({ data: { userId, action: 'chat_proposal.created', detail: { kind: p.kind, field: p.field ?? null, from: p.fromValue ?? null, to: p.value ?? null } as Prisma.InputJsonValue } }),
      ]);
      return toView(row, p.summary);
    },
  };
}
