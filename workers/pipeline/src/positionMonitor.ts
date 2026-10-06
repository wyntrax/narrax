import type { Prisma, PrismaClient } from '@narra/database';
import { reviewPosition, type LlmProvider, type PositionReviewFacts } from '@narra/ai';
import {
  EntryContextSchema, MONITOR_RULES, combineWithReview, computeSmartMoneyExits, evaluatePosition, parseEntryContext,
  type EntryContext, type Evaluation, type ExitRules, type PositionFacts, type ReviewInput, type SignalLevel,
} from '@narra/positions';
import { sanitizeUntrusted, wrapUntrusted } from '@narra/shared';
import { aiEnabled, loadAiConfig, tokensUsedToday } from './aiAnalysis';

/** Starting values, not validated against outcomes. */
export const MONITOR_LIMITS = {
  maxPositionsPerRun: 200,
  /** An unchanged evaluation is still recorded this often, so a quiet position shows it is being watched. */
  heartbeatMs: 60 * 60_000,
  /** At most one AI review per position in this time. */
  reviewCooldownMs: 30 * 60_000,
  /** A review's answer is reused by later runs for this long. */
  reviewValidityMs: 60 * 60_000,
  maxReviewsPerRun: 10,
  /** Holder rows older than this are not used. */
  holderMaxAgeMs: 6 * 3_600_000,
  /** Entry baselines use holder and consensus rows no older than this. */
  baselineMaxAgeMs: 2 * 3_600_000,
} as const;

const num = (d: { toString(): string } | null | undefined): number | null => (d == null ? null : Number(d.toString()));
const LEVEL_PRIORITY: Record<SignalLevel, 'WATCH' | 'IMPORTANT' | 'CRITICAL'> = { WARN: 'WATCH', REDUCE: 'IMPORTANT', SELL: 'CRITICAL' };
const LEVEL_RANK: Record<SignalLevel, number> = { WARN: 0, REDUCE: 1, SELL: 2 };

/**
 * Builds the baseline stored in Position.entryContext. Position creation (B4) calls this at the moment of entry.
 * It throws, and no position should be opened, when there is no fresh price: an entry with no baseline cannot be monitored.
 * Holder, narrative and smart-money parts are null when unavailable or stale, never zero.
 */
export async function captureEntryContext(db: PrismaClient, tokenId: string, exit: ExitRules, now: Date = new Date()): Promise<EntryContext> {
  const [metric, holder, relations, consensus] = await Promise.all([
    db.tokenMetric.findFirst({ where: { tokenId }, orderBy: { at: 'desc' } }),
    db.tokenHolderMetric.findFirst({ where: { tokenId }, orderBy: { at: 'desc' } }),
    db.narrativeTokenRelation.findMany({ where: { tokenId }, include: { narrative: true }, orderBy: { ogScore: 'desc' }, take: 5 }),
    db.consensusSignal.findFirst({ where: { tokenId }, orderBy: { at: 'desc' } }),
  ]);
  if (!metric || now.getTime() - metric.at.getTime() > MONITOR_RULES.maxDataAgeMs) throw new Error('No fresh price for this token, so no entry context was recorded');
  const recent = (at: Date) => now.getTime() - at.getTime() <= MONITOR_LIMITS.baselineMaxAgeMs;
  const rel = relations.find((r) => r.narrative.stage !== 'DEAD') ?? null;
  return EntryContextSchema.parse({
    version: 1, capturedAt: now.toISOString(), priceUsd: num(metric.priceUsd), liquidityUsd: num(metric.liquidityUsd), volume24hUsd: num(metric.volume24hUsd),
    holders: holder && recent(holder.at) ? holder.holders : null, top10Pct: holder && recent(holder.at) ? holder.top10Pct : null,
    narrative: rel ? { id: rel.narrativeId, score: rel.narrative.score, velocity: rel.narrative.velocity, stage: rel.narrative.stage } : null,
    smartMoney: consensus && recent(consensus.at) ? { score: consensus.score, walletCount: consensus.walletCount, independentEntities: consensus.independentEntities } : null,
    exit,
  });
}

type PositionRow = Prisma.PositionGetPayload<{ include: { token: { select: { id: true; symbol: true; name: true } } } }>;

async function loadFacts(db: PrismaClient, pos: PositionRow, entry: EntryContext | null, now: Date): Promise<{ facts: PositionFacts; narrativeName: string | null }> {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [latest, hourly, high, holder, risk, narrative, trades] = await Promise.all([
    db.tokenMetric.findFirst({ where: { tokenId: pos.tokenId }, orderBy: { at: 'desc' } }),
    db.tokenMetric.findFirst({ where: { tokenId: pos.tokenId, at: { lte: hourAgo, gte: new Date(now.getTime() - 4 * 3_600_000) } }, orderBy: { at: 'desc' } }),
    db.tokenMetric.aggregate({ where: { tokenId: pos.tokenId, at: { gte: pos.openedAt } }, _max: { priceUsd: true } }),
    db.tokenHolderMetric.findFirst({ where: { tokenId: pos.tokenId }, orderBy: { at: 'desc' } }),
    db.tokenRiskMetric.findFirst({ where: { tokenId: pos.tokenId }, orderBy: { at: 'desc' } }),
    entry?.narrative ? db.narrative.findUnique({ where: { id: entry.narrative.id }, select: { name: true, stage: true, score: true, velocity: true } }) : Promise.resolve(null),
    db.walletTrade.findMany({
      where: { tokenId: pos.tokenId, at: { gte: new Date(now.getTime() - MONITOR_RULES.smartMoney.lookbackMs), lte: now }, wallet: { active: true, profile: { score: { gte: MONITOR_RULES.smartMoney.minWalletScore } } } },
      select: { walletId: true, side: true, tokenAmount: true, at: true, wallet: { select: { clusterId: true, profile: { select: { leaderScore: true } } } } },
    }),
  ]);
  const facts: PositionFacts = {
    now, entryPriceUsd: num(pos.entryPriceUsd)!, entry,
    market: latest ? { at: latest.at, priceUsd: num(latest.priceUsd)!, liquidityUsd: num(latest.liquidityUsd)!, volume24hUsd: num(latest.volume24hUsd)!, price1hAgoUsd: num(hourly?.priceUsd) } : null,
    highWaterUsd: num(high._max.priceUsd),
    holders: holder && now.getTime() - holder.at.getTime() <= MONITOR_LIMITS.holderMaxAgeMs ? { top10Pct: holder.top10Pct } : null,
    riskFlags: risk ? risk.flags : null,
    narrative: narrative ? { stage: narrative.stage, score: narrative.score, velocity: narrative.velocity } : null,
    smartMoneyExits: computeSmartMoneyExits(trades.map((t) => ({ walletId: t.walletId, clusterId: t.wallet.clusterId, leaderScore: t.wallet.profile?.leaderScore ?? 0, side: t.side, tokenAmount: num(t.tokenAmount), at: t.at })), pos.openedAt),
  };
  return { facts, narrativeName: narrative?.name ?? null };
}

function reviewFacts(pos: PositionRow, entry: EntryContext | null, f: PositionFacts, det: Evaluation, now: Date): PositionReviewFacts {
  const m = f.market;
  return {
    position: { ageMinutes: Math.round((now.getTime() - pos.openedAt.getTime()) / 60_000), pnlPct: det.pnlPct, sizeSol: num(pos.sizeSol)!, mode: pos.mode },
    rules: { action: det.action, summary: det.summary, signals: det.signals, unavailable: det.unavailable, blind: det.blind },
    market: {
      priceChange1hPct: m && m.price1hAgoUsd ? (m.priceUsd / m.price1hAgoUsd - 1) * 100 : null, liquidityUsd: m?.liquidityUsd ?? null,
      liquidityChangeSinceEntryPct: m && entry && entry.liquidityUsd > 0 ? (m.liquidityUsd / entry.liquidityUsd - 1) * 100 : null, volume24hUsd: m?.volume24hUsd ?? null,
    },
    narrative: f.narrative && entry?.narrative ? { stage: f.narrative.stage, score: f.narrative.score, scoreAtEntry: entry.narrative.score, velocity: f.narrative.velocity, velocityAtEntry: entry.narrative.velocity } : null,
    smartMoney: f.smartMoneyExits ? { entitiesSold: f.smartMoneyExits.entities, leadersSold: f.smartMoneyExits.leaders } : null,
  };
}

export interface MonitorSummary {
  positions: number; evaluated: number; recorded: number; alerts: number; reviewed: number;
  blind: number; byAction: { HOLD: number; REDUCE: number; SELL: number }; skippedReview: string | null; errors: string[];
}

const codesOf = (signals: unknown): string[] => (Array.isArray(signals) ? signals.map((s) => (s as { code?: unknown })?.code).filter((c): c is string => typeof c === 'string') : []);
const signature = (action: string, codes: string[], blind: boolean) => `${action}|${[...codes].sort().join(',')}|${blind}`;

/**
 * Watches every open position. For each one it applies the deterministic exit rules, optionally asks an AI reviewer in
 * the gray zone (rules say HOLD but warnings are active), records the result when it changes (and hourly), and raises
 * an alert for each newly appearing signal. It only recommends. It never closes a position, places an order, or
 * touches a wallet: turning a recommendation into a sale is a separate step behind the Risk Governor.
 * A review can only make an exit more cautious, by one step, and never replaces a rules decision.
 */
export async function monitorPositions(db: PrismaClient, deps: { llm: LlmProvider | null }, now: Date = new Date(), opts: { positionIds?: string[]; maxPositions?: number } = {}): Promise<MonitorSummary> {
  const L = MONITOR_LIMITS;
  const out: MonitorSummary = { positions: 0, evaluated: 0, recorded: 0, alerts: 0, reviewed: 0, blind: 0, byAction: { HOLD: 0, REDUCE: 0, SELL: 0 }, skippedReview: null, errors: [] };
  const positions = await db.position.findMany({
    where: { status: 'OPEN', ...(opts.positionIds ? { id: { in: opts.positionIds } } : {}) },
    orderBy: { openedAt: 'asc' }, take: opts.maxPositions ?? L.maxPositionsPerRun, include: { token: { select: { id: true, symbol: true, name: true } } },
  });
  out.positions = positions.length;

  // The AI review is optional. When anything about it is unavailable the rules run alone.
  let cfg = null as Awaited<ReturnType<typeof loadAiConfig>> | null;
  let used = 0;
  if (!deps.llm) out.skippedReview = 'no_provider';
  else if (!(await aiEnabled(db))) out.skippedReview = 'disabled';
  else {
    cfg = await loadAiConfig(db);
    used = await tokensUsedToday(db, now);
    if (used >= cfg.tokenBudget) { out.skippedReview = 'budget'; cfg = null; }
  }

  for (const pos of positions) {
    try {
      const entry = parseEntryContext(pos.entryContext);
      const { facts, narrativeName } = await loadFacts(db, pos, entry, now);
      const det = evaluatePosition(facts);

      const [prev, lastReview] = await Promise.all([
        db.positionEvaluation.findFirst({ where: { positionId: pos.id }, orderBy: { createdAt: 'desc' } }),
        db.positionEvaluation.findFirst({ where: { positionId: pos.id, aiTokens: { gt: 0 } }, orderBy: { createdAt: 'desc' } }),
      ]);

      let reviewOut: ReviewInput | null = null;
      let ran = false;
      let aiTokens = 0;
      let reviewError: string | null = null;
      const grayZone = det.action === 'HOLD' && det.signals.some((s) => s.level === 'WARN' && s.code !== 'DATA_STALE');
      const lastAge = lastReview ? now.getTime() - lastReview.createdAt.getTime() : Infinity;
      if (grayZone && cfg && deps.llm && out.reviewed < L.maxReviewsPerRun && used < cfg.tokenBudget && lastAge >= L.reviewCooldownMs) {
        const r = await reviewPosition({ llm: deps.llm, config: cfg }, {
          facts: reviewFacts(pos, entry, facts, det, now),
          untrusted: [wrapUntrusted('token.symbol', pos.token.symbol, 32), wrapUntrusted('token.name', pos.token.name, 64), ...(narrativeName ? [wrapUntrusted('narrative.name', narrativeName, 80)] : [])],
        });
        ran = true; out.reviewed++;
        aiTokens = r.usage.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0);
        used += aiTokens;
        reviewOut = r.review ? { action: r.review.action, confidence: r.review.confidence, reasonCodes: r.review.reasonCodes } : null;
        reviewError = r.error ?? null;
      } else if (det.action === 'HOLD' && lastReview && lastAge < L.reviewValidityMs) {
        // Reuse the last answer until it expires, so the result does not flip back and forth between runs.
        const stored = (lastReview.review as { output?: ReviewInput | null } | null)?.output;
        reviewOut = stored ?? null;
      }

      const combined = combineWithReview(det, reviewOut);
      const ev = combined.evaluation;
      out.evaluated++; out.byAction[ev.action]++; if (ev.blind) out.blind++;

      const curCodes = ev.signals.map((s) => s.code);
      const prevCodes = prev ? codesOf(prev.signals) : [];
      const changed = !prev || signature(prev.action, prevCodes, prev.blind) !== signature(ev.action, curCodes, ev.blind);
      const heartbeat = !prev || now.getTime() - prev.createdAt.getTime() >= L.heartbeatMs;
      const newSignals = ev.signals.filter((s) => !prevCodes.includes(s.code));

      const ops: Prisma.PrismaPromise<unknown>[] = [];
      if (changed || heartbeat || ran) {
        ops.push(db.positionEvaluation.create({
          data: {
            positionId: pos.id, action: ev.action, fractionPct: ev.fractionPct, signals: ev.signals as unknown as Prisma.InputJsonValue, unavailable: ev.unavailable,
            blind: ev.blind, pnlPct: ev.pnlPct, priceUsd: facts.market?.priceUsd ?? null, aiTokens, createdAt: now,
            review: { output: reviewOut, applied: combined.reviewApplied, note: combined.reviewNote, ran, error: reviewError } as unknown as Prisma.InputJsonValue,
          },
        }));
        out.recorded++;
      }
      if (newSignals.length) {
        const top = newSignals.reduce((a, s) => (LEVEL_RANK[s.level] > LEVEL_RANK[a] ? s.level : a), 'WARN' as SignalLevel);
        const symbol = sanitizeUntrusted(pos.token.symbol, 32) || 'token';
        ops.push(db.alert.create({
          data: {
            userId: pos.userId, kind: 'POSITION_SIGNAL', priority: LEVEL_PRIORITY[top], refType: 'position', refId: pos.id,
            title: `${symbol}: ${ev.action === 'HOLD' ? 'warning' : `${ev.action} advised`}`,
            body: `${newSignals.map((s) => s.detail).join(' ')} This is a recommendation from fixed rules, not a sale.`.slice(0, 1000),
            notifications: { create: { userId: pos.userId } },
          },
        }));
        out.alerts++;
      }
      if (ops.length) await db.$transaction(ops);
    } catch (e) {
      out.errors.push(`${pos.id.slice(0, 8)}: ${(e as Error).message}`);
    }
  }
  return out;
}
