import type { PrismaClient } from '@narra/database';
import { AgentDecisionSchema } from '@narra/shared';
import { ExecutionJobSchema, type ExecutionJob } from '@narra/queue';
import { MONITOR_RULES } from '@narra/positions';
import { GLOBAL_LIMITS, mergeLimits } from '@narra/risk';
import { MAX_DECISION_AGE_MS, buildExitDecision, canRetryExit, checkEligibility, entryKey, exitKey, isDecisionFresh, shouldActOnEvaluation, tradableBalance } from '@narra/trading';
import type { ChainPorts } from './prismaStores';
import { limitsFor } from './prismaStores';
import { loadSystemControls } from './systemConfig';
import { makePaperPorts, type PaperPorts } from './paperLedger';

const MAX_DECISIONS_PER_RUN = 50;
const USER_BATCH = 200;
const MAX_POSITIONS_PER_RUN = 500;
const isUnique = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';

export interface FanOutDeps {
  /** Real balances for SEMI_AUTO and AUTO users. Null when no RPC is configured: those users are then skipped. */
  chain: ChainPorts | null;
  paper?: PaperPorts;
  /** Puts a job on the execution queue. It must use the idempotency key as the job id. */
  enqueue(job: ExecutionJob): Promise<unknown>;
  now?: () => Date;
  /** Limits a run to given users, decisions or positions. Used by tests that share a database, and for targeted re-runs. */
  only?: { userIds?: string[]; decisionIds?: string[]; positionIds?: string[] };
}

export interface FanOutSummary {
  considered: number;
  enqueued: number;
  skipped: Record<string, number>;
}

const bump = (m: Record<string, number>, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by; };

/**
 * Entry fan-out: each recent BUY AgentDecision becomes one ExecutionJob per eligible user.
 * This only decides whether a job is worth creating. Sizing and every limit are the Risk Governor's job, run inside
 * processExecution against a fresh quote. A missing balance or price means no job; a missing quote ends the job with no fill.
 * Re-running is safe: the key is built from decision and user, so the same pair never makes a second job, order or position.
 */
export async function fanOutEntries(db: PrismaClient, deps: FanOutDeps): Promise<FanOutSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const paperPorts = deps.paper ?? makePaperPorts(db);
  const summary: FanOutSummary = { considered: 0, enqueued: 0, skipped: {} };
  const controls = await loadSystemControls(db);
  // An admin's global pause stops new entries before any quote is spent on them. Exits are not affected.
  if (controls.pause.paused) { summary.skipped.system_paused = 1; return summary; }

  const rows = await db.agentDecision.findMany({
    where: { action: 'BUY', userId: null, createdAt: { gte: new Date(now.getTime() - MAX_DECISION_AGE_MS) }, ...(deps.only?.decisionIds ? { id: { in: deps.only.decisionIds } } : {}) },
    orderBy: { createdAt: 'desc' }, take: MAX_DECISIONS_PER_RUN,
    include: { analysis: { include: { opportunity: { include: { token: { select: { id: true, mint: true, blacklisted: true } } } } } } },
  });

  const decisions: { id: string; decision: ExecutionJob['decision']; tokenId: string; mint: string }[] = [];
  for (const r of rows) {
    const parsed = AgentDecisionSchema.safeParse(r.payload);
    const token = r.analysis.opportunity.token;
    if (!parsed.success || parsed.data.action !== 'BUY') { bump(summary.skipped, 'invalid_decision'); continue; }
    if (!isDecisionFresh(r.createdAt, now)) { bump(summary.skipped, 'stale_decision'); continue; }
    if (token.blacklisted) { bump(summary.skipped, 'blacklisted_token'); continue; }
    // A missing or stale price means no job for anyone: the paper fill and the entry context both need it.
    const metric = await db.tokenMetric.findFirst({ where: { tokenId: token.id }, orderBy: { at: 'desc' }, select: { at: true } });
    if (!metric || now.getTime() - metric.at.getTime() > MONITOR_RULES.maxDataAgeMs) { bump(summary.skipped, 'no_fresh_price'); continue; }
    decisions.push({ id: r.id, decision: parsed.data, tokenId: token.id, mint: token.mint });
  }
  if (!decisions.length) return summary;

  const holders = new Map<string, Set<string>>();
  for (const d of decisions) {
    const open = await db.position.findMany({ where: { tokenId: d.tokenId, status: 'OPEN' }, select: { userId: true } });
    holders.set(d.id, new Set(open.map((p) => p.userId)));
  }

  const balances = new Map<string, number | null>(); // one balance read per user per run
  let cursor: string | undefined;
  for (;;) {
    const users = await db.user.findMany({
      where: deps.only?.userIds ? { id: { in: deps.only.userIds } } : {}, take: USER_BATCH, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { permission: true, riskProfile: true, wallets: { where: { kind: 'TRADING' }, take: 1 } },
    });
    if (!users.length) break;
    cursor = users[users.length - 1]!.id;

    const keys = users.flatMap((u) => decisions.map((d) => entryKey(d.id, u.id)));
    const [seenRisk, seenOrders] = await Promise.all([
      db.riskDecision.findMany({ where: { idempotencyKey: { in: keys } }, select: { idempotencyKey: true } }),
      db.order.findMany({ where: { idempotencyKey: { in: keys } }, select: { idempotencyKey: true } }),
    ]);
    const seen = new Set([...seenRisk.map((r) => r.idempotencyKey), ...seenOrders.map((o) => o.idempotencyKey)]);

    for (const user of users) {
      const elig = checkEligibility(user.mode, user.permission, now);
      const paper = user.mode === 'PAPER' || user.mode === 'SHADOW';
      for (const d of decisions) {
        summary.considered++;
        if (!elig.eligible) { bump(summary.skipped, elig.reason.toLowerCase()); continue; }
        if (holders.get(d.id)?.has(user.id)) { bump(summary.skipped, 'position_exists'); continue; }
        const key = entryKey(d.id, user.id);
        if (seen.has(key)) { bump(summary.skipped, 'already_handled'); continue; }

        if (!balances.has(user.id)) {
          try {
            const wallet = user.wallets[0];
            if (paper) balances.set(user.id, await paperPorts.balanceSol(user.id));
            else if (!wallet || !deps.chain) balances.set(user.id, null);
            else balances.set(user.id, await deps.chain.getSolBalance(wallet.address));
          } catch { balances.set(user.id, null); }
        }
        const balance = balances.get(user.id);
        if (balance == null) { bump(summary.skipped, 'balance_unavailable'); continue; }
        if (tradableBalance(balance, mergeLimits(limitsFor(user.riskProfile), controls.limits).minSolReserve) <= 0) { bump(summary.skipped, 'no_tradable_balance'); continue; }

        try {
          await deps.enqueue(ExecutionJobSchema.parse({ userId: user.id, decisionId: d.id, idempotencyKey: key, mint: d.mint, decision: d.decision }));
          summary.enqueued++;
        } catch { bump(summary.skipped, 'enqueue_failed'); }
      }
    }
  }
  return summary;
}

/**
 * Exit fan-out: an open position whose latest evaluation is REDUCE or SELL, and that has not been acted on, becomes an exit job.
 * The exit decision is built from fixed rules, not a model. One PositionExit row per evaluation claims it, so it cannot be acted on twice.
 * The Governor still decides whether the exit goes ahead (a paused agent or a bad quote stops it). Loss limits do not.
 */
export async function fanOutExits(db: PrismaClient, deps: Pick<FanOutDeps, 'enqueue' | 'now' | 'only'>): Promise<FanOutSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const summary: FanOutSummary = { considered: 0, enqueued: 0, skipped: {} };
  const positions = await db.position.findMany({
    where: { status: 'OPEN', baseUnits: { not: null }, ...(deps.only?.positionIds ? { id: { in: deps.only.positionIds } } : {}), ...(deps.only?.userIds ? { userId: { in: deps.only.userIds } } : {}) }, orderBy: { openedAt: 'asc' }, take: MAX_POSITIONS_PER_RUN,
    include: { token: { select: { mint: true } }, evaluations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } },
  });

  for (const p of positions) {
    summary.considered++;
    const ev = p.evaluations[0];
    if (!ev) { bump(summary.skipped, 'no_evaluation'); continue; }
    const act = shouldActOnEvaluation(ev, { reducedForCodes: p.reducedForCodes, reduceCount: p.reduceCount }, now);
    if (!act.act) { bump(summary.skipped, act.reason.toLowerCase()); continue; }

    const prior = await db.positionExit.findUnique({ where: { evaluationId: ev.id } });
    let attempt = 1;
    if (prior) {
      if (!canRetryExit(prior, now)) { bump(summary.skipped, 'already_acted'); continue; }
      attempt = prior.attempts + 1;
      // Claim the retry. If another run got there first, nothing matches and this one backs off.
      const claimed = await db.positionExit.updateMany({ where: { evaluationId: ev.id, attempts: prior.attempts, outcome: prior.outcome }, data: { attempts: attempt, outcome: 'queued', lastAttemptAt: now } });
      if (claimed.count === 0) { bump(summary.skipped, 'already_acted'); continue; }
    } else {
      try {
        await db.positionExit.create({ data: { positionId: p.id, evaluationId: ev.id, action: ev.action, fractionPct: ev.fractionPct, signalCodes: act.codes, attempts: 1, outcome: 'queued', lastAttemptAt: now } });
      } catch (e) {
        if (isUnique(e)) { bump(summary.skipped, 'already_acted'); continue; }
        throw e;
      }
    }

    try {
      const decision = buildExitDecision(ev, act.codes, { maxSlippageBps: GLOBAL_LIMITS.maxSlippageBps, maxPriceImpactPct: GLOBAL_LIMITS.maxPriceImpactPct });
      await deps.enqueue(ExecutionJobSchema.parse({ userId: p.userId, evaluationId: ev.id, positionId: p.id, idempotencyKey: exitKey(ev.id, attempt), mint: p.token.mint, decision }));
      summary.enqueued++;
    } catch {
      // Nothing was queued, so free the evaluation for a retry after the cooldown.
      await db.positionExit.updateMany({ where: { evaluationId: ev.id }, data: { outcome: 'error' } });
      bump(summary.skipped, 'enqueue_failed');
    }
  }
  return summary;
}
