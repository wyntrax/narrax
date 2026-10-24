import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@narra/database';
import type { ExecutionJob } from '@narra/queue';
import { ExitRulesSchema, type EntryContext } from '@narra/positions';
import { sanitizeUntrusted } from '@narra/shared';
import type { Quote } from '@narra/solana';
import { confirmationExpiry, openPositionKey, paperBuyFill, paperSellFill } from '@narra/trading';
import { processExecution, type ExecutionDeps, type ExecutionOutcome } from './execution';
import { captureEntryContext } from './positionMonitor';

const num = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Number(d.toString()));
/** Decimal(40,0) as plain digits. toString() can switch to exponent notation for very large numbers. */
const units = (d: { toFixed(dp: number): string }) => d.toFixed(0);
const isUnique = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';
const isExitJob = (job: ExecutionJob) => job.decision.action === 'SELL' || job.decision.action === 'REDUCE';
const LAMPORTS = 1_000_000_000;

export type HandledKind = 'paper_entry' | 'paper_exit' | 'pending_confirmation' | 'none';
export interface Handled { kind: HandledKind; detail: string }

const quoteJson = (q: Quote | null): Prisma.InputJsonValue =>
  (q ? { priceImpactPct: q.priceImpactPct, slippageBps: q.slippageBps, inAmount: q.inAmount, outAmount: q.outAmount, fetchedAt: q.fetchedAt.toISOString() } : {}) as Prisma.InputJsonValue;

const audit = (db: PrismaClient, userId: string, action: string, detail: Prisma.InputJsonValue) => db.auditLog.create({ data: { userId, action, detail } });

/**
 * Paper entry. Nothing is written unless every step works, and all rows are written in one transaction.
 * captureEntryContext runs first: if it throws (no fresh price) no order, trade or position exists afterwards.
 * One open position per token per user is enforced here, in the fan-out, and by the unique Position.openKey.
 * The price fields are an approximation: the market price worsened by the quote's price impact.
 */
async function paperEntry(db: PrismaClient, job: ExecutionJob, outcome: ExecutionOutcome, now: Date): Promise<Handled> {
  const { quote, result } = outcome;
  if (!quote || result.sizeSol <= 0) throw new Error('A paper entry needs a quote and a size');
  const token = await db.token.findUnique({ where: { mint: job.mint }, select: { id: true } });
  if (!token) throw new Error('Token not found');

  let entry: EntryContext;
  try {
    entry = await captureEntryContext(db, token.id, ExitRulesSchema.parse(job.decision.exit), now);
  } catch (e) {
    await audit(db, job.userId, 'paper.entry_skipped', { idempotencyKey: job.idempotencyKey, reason: 'no_entry_context', message: (e as Error).message.slice(0, 200) });
    return { kind: 'none', detail: 'no_entry_context' };
  }
  if (await db.position.findFirst({ where: { userId: job.userId, tokenId: token.id, status: 'OPEN' }, select: { id: true } })) {
    await audit(db, job.userId, 'paper.entry_skipped', { idempotencyKey: job.idempotencyKey, reason: 'position_exists' });
    return { kind: 'none', detail: 'position_exists' };
  }

  const fill = paperBuyFill({ sizeSol: result.sizeSol, marketPriceUsd: entry.priceUsd, quote: { outAmount: quote.outAmount, priceImpactPct: quote.priceImpactPct } });
  const orderId = randomUUID();
  const positionId = randomUUID();
  try {
    await db.$transaction([
      db.order.create({ data: { id: orderId, userId: job.userId, decisionId: job.decisionId ?? null, idempotencyKey: job.idempotencyKey, tokenId: token.id, side: 'BUY', mode: 'AI_PAPER', status: 'CONFIRMED', sizeSol: fill.sizeSol, simulated: true, createdAt: now } }),
      db.position.create({
        data: {
          id: positionId, userId: job.userId, tokenId: token.id, status: 'OPEN', mode: 'PAPER', simulated: true, entryPriceUsd: fill.fillPriceUsd, sizeSol: fill.sizeSol, entrySizeSol: fill.sizeSol,
          baseUnits: fill.baseUnits, openKey: openPositionKey(job.userId, token.id), entryContext: entry as unknown as Prisma.InputJsonValue, openedAt: now,
        },
      }),
      db.trade.create({
        data: {
          userId: job.userId, orderId, positionId, side: 'BUY', mode: 'AI_PAPER', reason: 'Paper entry from an AI decision', expectedPriceUsd: fill.expectedPriceUsd, actualPriceUsd: fill.fillPriceUsd,
          slippageBps: fill.slippageBps, realizedPnlSol: fill.realizedPnlSol, simulated: true, amountSol: fill.sizeSol, feeSol: fill.feeSol, baseUnits: fill.baseUnits, signature: `paper:${orderId}`, executedAt: now,
        },
      }),
      db.executionAttempt.create({ data: { orderId, quote: quoteJson(quote), priceImpactPct: quote.priceImpactPct, slippageBps: quote.slippageBps } }),
      db.auditLog.create({ data: { userId: job.userId, action: 'paper.entry_filled', detail: { orderId, positionId, sizeSol: fill.sizeSol, feeSol: fill.feeSol, simulated: true } } }),
    ]);
  } catch (e) {
    if (isUnique(e)) { // the same order or a second open position for this token: nothing was written
      await audit(db, job.userId, 'paper.entry_skipped', { idempotencyKey: job.idempotencyKey, reason: 'duplicate' });
      return { kind: 'none', detail: 'duplicate' };
    }
    throw e;
  }
  return { kind: 'paper_entry', detail: positionId };
}

/** Paper exit. Proceeds come from the quote, so the sale does not need a fresh market price. Realized PnL goes on the sell Trade. */
async function paperExit(db: PrismaClient, job: ExecutionJob, outcome: ExecutionOutcome, now: Date): Promise<Handled> {
  const { quote, result } = outcome;
  if (!quote || result.exitFraction <= 0) throw new Error('A paper exit needs a quote and a fraction');
  const token = await db.token.findUnique({ where: { mint: job.mint }, select: { id: true } });
  if (!token) throw new Error('Token not found');
  const position = await db.position.findFirst({ where: { ...(job.positionId ? { id: job.positionId } : {}), userId: job.userId, tokenId: token.id, status: 'OPEN' } });
  if (!position || !position.simulated) {
    await audit(db, job.userId, 'paper.exit_skipped', { idempotencyKey: job.idempotencyKey, reason: 'no_open_paper_position' });
    return { kind: 'none', detail: 'no_open_paper_position' };
  }
  if (position.baseUnits == null) throw new Error('The position has no recorded token amount');
  const metric = await db.tokenMetric.findFirst({ where: { tokenId: token.id }, orderBy: { at: 'desc' }, select: { priceUsd: true } });
  if (!metric) throw new Error('No market price on record for this token');

  const fill = paperSellFill({
    position: { baseUnits: units(position.baseUnits), costSol: num(position.sizeSol) }, exitFraction: result.exitFraction, marketPriceUsd: num(metric.priceUsd),
    quote: { inAmount: quote.inAmount, outAmount: quote.outAmount, priceImpactPct: quote.priceImpactPct },
  });

  const reducing = job.decision.action === 'REDUCE' && !fill.closes;
  const prior = job.evaluationId ? await db.positionExit.findUnique({ where: { evaluationId: job.evaluationId }, select: { signalCodes: true } }) : null;
  const reducedForCodes = [...new Set([...position.reducedForCodes, ...(reducing ? prior?.signalCodes ?? [] : [])])];
  const orderId = randomUUID();
  try {
    await db.$transaction([
      db.order.create({ data: { id: orderId, userId: job.userId, decisionId: null, idempotencyKey: job.idempotencyKey, tokenId: token.id, side: 'SELL', mode: 'AI_PAPER', status: 'CONFIRMED', sizeSol: fill.proceedsSol, simulated: true, createdAt: now } }),
      db.trade.create({
        data: {
          userId: job.userId, orderId, positionId: position.id, side: 'SELL', mode: 'AI_PAPER', reason: `Paper ${job.decision.action} from the position monitor`, expectedPriceUsd: fill.expectedPriceUsd, actualPriceUsd: fill.fillPriceUsd,
          slippageBps: fill.slippageBps, realizedPnlSol: fill.realizedPnlSol, simulated: true, amountSol: fill.proceedsSol, feeSol: fill.feeSol, baseUnits: fill.unitsSold, signature: `paper:${orderId}`, executedAt: now,
        },
      }),
      // The status filter makes this fail, and the whole transaction roll back, if the position was closed in the meantime.
      db.position.update({
        where: { id: position.id, status: 'OPEN' },
        data: fill.closes
          ? { status: 'CLOSED', closedAt: now, openKey: null, baseUnits: '0', sizeSol: 0 }
          : { baseUnits: fill.remainingUnits, sizeSol: fill.remainingCostSol, ...(reducing ? { reduceCount: { increment: 1 }, reducedForCodes: { set: reducedForCodes } } : {}) },
      }),
      db.executionAttempt.create({ data: { orderId, quote: quoteJson(quote), priceImpactPct: quote.priceImpactPct, slippageBps: quote.slippageBps } }),
      ...(job.evaluationId ? [db.positionExit.updateMany({ where: { evaluationId: job.evaluationId }, data: { outcome: 'filled' } })] : []),
      db.auditLog.create({ data: { userId: job.userId, action: 'paper.exit_filled', detail: { orderId, positionId: position.id, fraction: result.exitFraction, closed: fill.closes, realizedPnlSol: fill.realizedPnlSol, simulated: true } } }),
    ]);
  } catch (e) {
    if (isUnique(e)) { await audit(db, job.userId, 'paper.exit_skipped', { idempotencyKey: job.idempotencyKey, reason: 'duplicate' }); return { kind: 'none', detail: 'duplicate' }; }
    throw e;
  }
  return { kind: 'paper_exit', detail: orderId };
}

/** Stores what the user is asked to confirm, with an expiry, and raises an alert. Exits are CRITICAL, entries IMPORTANT. */
async function savePendingConfirmation(db: PrismaClient, job: ExecutionJob, outcome: ExecutionOutcome, now: Date): Promise<Handled> {
  const { quote, result } = outcome;
  if (!quote) throw new Error('A confirmation needs a quote');
  const exit = isExitJob(job);
  const token = await db.token.findUnique({ where: { mint: job.mint }, select: { symbol: true } });
  const symbol = sanitizeUntrusted(token?.symbol ?? '', 32) || 'token';
  const sizeSol = exit ? Number(quote.outAmount) / LAMPORTS : result.sizeSol;
  try {
    await db.$transaction([
      db.pendingConfirmation.create({
        data: {
          userId: job.userId, idempotencyKey: job.idempotencyKey, kind: exit ? 'EXIT' : 'ENTRY', mint: job.mint, decisionId: job.decisionId ?? null, positionId: job.positionId ?? null,
          evaluationId: job.evaluationId ?? null, job: job as unknown as Prisma.InputJsonValue, sizeSol, exitFraction: result.exitFraction, quote: quoteJson(quote), expiresAt: confirmationExpiry(now), createdAt: now,
        },
      }),
      db.alert.create({
        data: {
          userId: job.userId, kind: 'CONFIRMATION_REQUIRED', priority: exit ? 'CRITICAL' : 'IMPORTANT', refType: 'confirmation', refId: job.idempotencyKey,
          title: `${symbol}: confirm ${exit ? job.decision.action.toLowerCase() : 'buy'}`,
          body: `The agent wants your confirmation. It expires in 5 minutes and is checked again with a fresh quote when you confirm.`,
          notifications: { create: { userId: job.userId } },
        },
      }),
    ]);
  } catch (e) {
    if (isUnique(e)) return { kind: 'none', detail: 'duplicate' };
    throw e;
  }
  return { kind: 'pending_confirmation', detail: job.idempotencyKey };
}

const resultText = (o: ExecutionOutcome) => [o.status, ...o.result.violations.slice(0, 3).map((v) => v.code)].join(': ').slice(0, 200);

function exitLabel(o: ExecutionOutcome, h: Handled): string {
  switch (o.status) {
    case 'simulated': return h.kind === 'paper_exit' ? 'filled' : 'error';
    case 'executed': return 'filled';
    case 'awaiting_confirmation': return 'awaiting_confirmation';
    case 'logged': return 'logged';
    case 'quote_failed': case 'quote_stale': return o.status;
    case 'execution_disabled': return 'execution_disabled';
    // A dry run sent nothing. It is not retried: the exit stays as it is until a person looks at the verdict.
    case 'dry_run': return 'dry_run';
    default: return 'rejected';
  }
}

/** Writes whatever a finished execution job calls for. The Executor is not involved: nothing here sends a transaction. */
export async function handleOutcome(db: PrismaClient, job: ExecutionJob, outcome: ExecutionOutcome, now: Date): Promise<Handled> {
  const exit = isExitJob(job);
  let handled: Handled = { kind: 'none', detail: outcome.status };
  if (outcome.status === 'simulated') handled = exit ? await paperExit(db, job, outcome, now) : await paperEntry(db, job, outcome, now);
  else if (outcome.status === 'awaiting_confirmation') handled = await savePendingConfirmation(db, job, outcome, now);

  if (job.evaluationId && handled.kind !== 'paper_exit') {
    await db.positionExit.updateMany({ where: { evaluationId: job.evaluationId }, data: { outcome: exitLabel(outcome, handled) } });
  }
  if (job.confirmationId) {
    await db.pendingConfirmation.updateMany({ where: { id: job.confirmationId, userId: job.userId }, data: { result: resultText(outcome), resolvedAt: now } });
  }
  return handled;
}

/** Best effort: a failed job leaves a trace and frees the exit for a later retry. Never throws. */
async function markError(db: PrismaClient, job: ExecutionJob, e: unknown, now: Date): Promise<void> {
  const message = (e as Error)?.message?.slice(0, 200) ?? 'error';
  try {
    if (job.evaluationId) await db.positionExit.updateMany({ where: { evaluationId: job.evaluationId }, data: { outcome: 'error' } });
    if (job.confirmationId) await db.pendingConfirmation.updateMany({ where: { id: job.confirmationId, userId: job.userId }, data: { result: `error: ${message}`, resolvedAt: now } });
    await audit(db, job.userId, 'execution.error', { idempotencyKey: job.idempotencyKey, message });
  } catch { /* the original error is what matters */ }
}

/**
 * The execution worker's job: Zod-validated job -> Risk Governor -> fresh quote -> Governor again -> outcome handler.
 * One attempt only. A thrown error is recorded and rethrown, never retried.
 */
export async function runExecution(db: PrismaClient, job: ExecutionJob, deps: ExecutionDeps): Promise<ExecutionOutcome> {
  // Serialize account checks/fills with manual paper confirmations as well as other execution workers.
  // This guard holds a DB lock only; existing routing, risk checks and fill behavior are unchanged.
  return db.$transaction(async guard=>{
    await guard.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`execution:${job.userId}`},0))`;
    return runLockedExecution(db,job,deps);
  },{timeout:60_000,maxWait:10_000});
}
async function runLockedExecution(db:PrismaClient,job:ExecutionJob,deps:ExecutionDeps):Promise<ExecutionOutcome>{
  const now = deps.now ?? (() => new Date());
  try {
    const outcome = await processExecution(job, deps);
    await handleOutcome(db, job, outcome, now());
    return outcome;
  } catch (e) {
    await markError(db, job, e, now());
    throw e;
  }
}

/** Marks pending confirmations past their expiry as expired, and frees the exits that were waiting on them. */
export async function expirePendingConfirmations(db: PrismaClient, now: Date): Promise<number> {
  const stale = await db.pendingConfirmation.findMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, select: { id: true, evaluationId: true }, take: 500 });
  if (!stale.length) return 0;
  const evaluationIds = stale.map((s) => s.evaluationId).filter((x): x is string => !!x);
  const [res] = await db.$transaction([
    db.pendingConfirmation.updateMany({ where: { id: { in: stale.map((s) => s.id) }, status: 'PENDING' }, data: { status: 'EXPIRED', resolvedAt: now } }),
    db.positionExit.updateMany({ where: { evaluationId: { in: evaluationIds }, outcome: 'awaiting_confirmation' }, data: { outcome: 'expired' } }),
  ]);
  return res.count;
}
