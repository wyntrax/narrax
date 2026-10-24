import type { Prisma, PrismaClient } from '@narra/database';
import { AiConfigSchema, analyzeOpportunity, defaultAiConfig, type AiConfig, type LlmProvider, type OpportunityFacts } from '@narra/ai';
import { sanitizeUntrusted, wrapUntrusted, type UntrustedField } from '@narra/shared';
import { attentionPriceDivergence } from '@narra/token-intel';

const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// ---------- Settings ----------

/** The saved admin settings merged over the defaults. Anything invalid falls back to the defaults, never to a looser setting. */
export async function loadAiConfig(db: PrismaClient): Promise<AiConfig> {
  const row = await db.systemSetting.findUnique({ where: { key: 'ai.models' } });
  const base = defaultAiConfig();
  const merged = AiConfigSchema.safeParse({ ...base, ...((row?.value as object | null) ?? {}) });
  return merged.success ? merged.data : base;
}

export async function saveAiConfig(db: PrismaClient, cfg: AiConfig): Promise<void> {
  const value = AiConfigSchema.parse(cfg) as unknown as Prisma.InputJsonValue;
  await db.systemSetting.upsert({ where: { key: 'ai.models' }, create: { key: 'ai.models', value }, update: { value } });
}

/** Kill switch. On by default. Turning it off stops all new analysis. */
export async function aiEnabled(db: PrismaClient): Promise<boolean> {
  const row = await db.systemSetting.findUnique({ where: { key: 'ai.enabled' } });
  return (row?.value as { enabled?: boolean } | null)?.enabled !== false;
}

export async function setAiEnabled(db: PrismaClient, enabled: boolean): Promise<void> {
  await db.systemSetting.upsert({ where: { key: 'ai.enabled' }, create: { key: 'ai.enabled', value: { enabled } }, update: { value: { enabled } } });
}

export async function tokensUsedToday(db: PrismaClient, now: Date): Promise<number> {
  const since = startOfUtcDay(now);
  const [s, reviews] = await Promise.all([
    db.agentAnalysis.aggregate({ where: { createdAt: { gte: since } }, _sum: { inputTokens: true, outputTokens: true } }),
    db.positionEvaluation.aggregate({ where: { createdAt: { gte: since } }, _sum: { aiTokens: true } }),
  ]);
  return (s._sum.inputTokens ?? 0) + (s._sum.outputTokens ?? 0) + (reviews._sum.aiTokens ?? 0);
}

// ---------- Facts ----------

export interface CollectedFacts { facts: OpportunityFacts; untrusted: UntrustedField[]; tokenId: string; symbol: string }

/** Builds the trusted numbers and the untrusted text for one opportunity. Numbers come from our own tables only. */
export async function collectFacts(db: PrismaClient, opportunityId: string): Promise<CollectedFacts | null> {
  const o = await db.opportunity.findUnique({
    where: { id: opportunityId },
    include: {
      token: { include: { metrics: { orderBy: { at: 'desc' }, take: 1 }, holders: { orderBy: { at: 'desc' }, take: 1 }, consensus: { orderBy: { at: 'desc' }, take: 1 } } },
      narrative: true,
    },
  });
  if (!o) return null;
  const rel = o.narrativeId ? await db.narrativeTokenRelation.findUnique({ where: { narrativeId_tokenId: { narrativeId: o.narrativeId, tokenId: o.tokenId } } }) : null;
  const m = o.token.metrics[0], h = o.token.holders[0], c = o.token.consensus[0];
  const created = o.token.createdOnChainAt;
  const d = attentionPriceDivergence(o.attentionGrowth, o.priceGrowth);

  const facts: OpportunityFacts = {
    opportunityScore: o.score,
    scores: { narrative: o.narrativeScore, smartMoney: o.smartMoneyScore, liquidity: o.liquidityScore, momentum: o.momentumScore, og: o.ogScore, risk: o.riskScore },
    relation: rel?.relation ?? null, ogScore: rel?.ogScore ?? null, ogConfidence: rel?.confidence ?? null,
    divergence: { label: d.label, attentionGrowthPct: d.attentionGrowthPct, priceGrowthPct: d.priceGrowthPct },
    liquidityUsd: num(m?.liquidityUsd), holders: h?.holders ?? null, top10Pct: h?.top10Pct ?? null, devHoldingPct: h?.devHoldingPct ?? null,
    tokenAgeMinutes: created ? Math.round((Date.now() - created.getTime()) / 60_000) : null,
    narrative: o.narrative ? { stage: o.narrative.stage, score: o.narrative.score, velocity: o.narrative.velocity, acceleration: o.narrative.acceleration, organicScore: o.narrative.organicScore, saturationRisk: o.narrative.saturationRisk } : null,
    smartMoney: c ? { score: c.score, walletCount: c.walletCount, independentEntities: c.independentEntities, leaderCount: c.leaderCount, netFlowSol: num(c.netFlowSol) ?? 0 } : null,
  };
  const untrusted = [
    wrapUntrusted('token.symbol', o.token.symbol, 32), wrapUntrusted('token.name', o.token.name, 80),
    ...(o.narrative ? [wrapUntrusted('narrative.name', o.narrative.name, 80), ...(o.narrative.summary ? [wrapUntrusted('narrative.summary', o.narrative.summary, 400)] : [])] : []),
  ];
  return { facts, untrusted, tokenId: o.tokenId, symbol: o.token.symbol };
}

// ---------- Job ----------

export interface AnalysisOptions {
  limit?: number;
  /** Analyze exactly these opportunities (still subject to the kill switch and the budget). */
  opportunityIds?: string[];
  maxAgeMinutes?: number;
  /** A token analyzed within this window is skipped, so a changing score does not trigger repeat spend. */
  cooldownMinutes?: number;
  minScore?: number;
}

export interface AnalysisSummary {
  skipped?: 'disabled' | 'budget' | 'no_provider';
  analyzed: number;
  deep: number;
  buys: number;
  guarded: number;
  providerFailures: number;
  tokensUsed: number;
}

export async function runAiAnalysis(db: PrismaClient, deps: { llm: LlmProvider | null }, now: Date = new Date(), opts: AnalysisOptions = {}): Promise<AnalysisSummary> {
  const out: AnalysisSummary = { analyzed: 0, deep: 0, buys: 0, guarded: 0, providerFailures: 0, tokensUsed: 0 };
  if (!(await aiEnabled(db))) return { ...out, skipped: 'disabled' };
  if (!deps.llm) return { ...out, skipped: 'no_provider' };
  const cfg = await loadAiConfig(db);
  let used = await tokensUsedToday(db, now);
  if (used >= cfg.tokenBudget) return { ...out, skipped: 'budget' };

  const limit = opts.limit ?? 10;
  const cooldown = (opts.cooldownMinutes ?? 60) * 60_000;
  const rows = await db.opportunity.findMany({
    where: {
      ...(opts.opportunityIds ? { id: { in: opts.opportunityIds } } : { createdAt: { gte: new Date(now.getTime() - (opts.maxAgeMinutes ?? 60) * 60_000) } }),
      score: { gte: opts.minScore ?? 50 }, analyses: { none: {} },
    },
    orderBy: [{ score: 'desc' }, { createdAt: 'desc' }], take: limit * 4, select: { id: true, tokenId: true },
  });

  const seen = new Set<string>();
  for (const row of rows) {
    if (out.analyzed >= limit) break;
    if (seen.has(row.tokenId)) continue; // several rows for one token: take the best
    seen.add(row.tokenId);
    if (cooldown > 0 && (await db.agentAnalysis.count({ where: { opportunity: { tokenId: row.tokenId }, createdAt: { gte: new Date(now.getTime() - cooldown) } } })) > 0) continue;
    if (used >= cfg.tokenBudget) { out.skipped = 'budget'; break; }

    const collected = await collectFacts(db, row.id);
    if (!collected) continue;
    const r = await analyzeOpportunity({ llm: deps.llm, config: cfg }, { facts: collected.facts, untrusted: collected.untrusted });
    const inTok = r.usage.reduce((s, u) => s + u.inputTokens, 0), outTok = r.usage.reduce((s, u) => s + u.outputTokens, 0);
    used += inTok + outTok; out.tokensUsed += inTok + outTok;
    if (!r.usage.length) { out.providerFailures++; continue; } // nothing came back at all: try again on the next run

    const payload = { decision: r.decision, guardrails: r.guardrails, fast: r.fast, judge: r.judge, stages: r.usage } as unknown as Prisma.InputJsonValue;
    await db.agentAnalysis.create({
      data: {
        opportunityId: row.id, fastClassification: r.fast?.classification ?? null, fastScore: r.fast?.score ?? null,
        bullCase: (r.bull ?? undefined) as Prisma.InputJsonValue | undefined, bearCase: (r.bear ?? undefined) as Prisma.InputJsonValue | undefined, riskCase: (r.risk ?? undefined) as Prisma.InputJsonValue | undefined,
        model: r.deep ? cfg.reasoningModel : cfg.fastModel, inputTokens: inTok, outputTokens: outTok, createdAt: now,
        decisions: { create: { userId: null, action: r.decision.action, confidence: r.decision.confidence, payload, createdAt: now } },
      },
    });
    out.analyzed++;
    if (r.deep) out.deep++;
    if (r.guardrails.some((g) => !['SIZE_CAPPED', 'ENTRY_LIMITS_TIGHTENED', 'STOP_LOSS_DEFAULTED'].includes(g))) out.guarded++;
    if (r.decision.action === 'BUY') {
      out.buys++;
      await db.alert.create({
        data: { kind: 'AI_BUY', priority: 'IMPORTANT', title: `AI buy view: ${sanitizeUntrusted(collected.symbol, 32)}`, body: `Confidence ${Math.round(r.decision.confidence * 100)}%, opportunity score ${collected.facts.opportunityScore}. The Risk Governor still decides whether anything is traded.`, refType: 'TOKEN', refId: collected.tokenId, createdAt: now },
      });
    }
  }
  return out;
}

/** Handles a wallet-event screening job: analyze the freshest ranked opportunity for that token, if there is one. */
export async function processScreeningJob(db: PrismaClient, deps: { llm: LlmProvider | null }, job: { mint: string }, now: Date = new Date()): Promise<AnalysisSummary | 'no_opportunity'> {
  const opp = await db.opportunity.findFirst({
    where: { token: { mint: job.mint }, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) }, analyses: { none: {} } },
    orderBy: { createdAt: 'desc' }, select: { id: true },
  });
  if (!opp) return 'no_opportunity'; // not ranked yet (no liquidity or holders), so there is nothing to analyze
  return runAiAnalysis(db, deps, now, { opportunityIds: [opp.id], limit: 1, cooldownMinutes: 15 });
}
