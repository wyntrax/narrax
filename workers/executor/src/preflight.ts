import type { PrismaClient } from '@narra/database';
import type { ExecutionJob } from '@narra/queue';
import { interpretKillSwitch, KILL_SWITCH_KEY } from '@narra/trading';
import type { Reason } from '@narra/tx-verify';
import type { ExecutorConfig } from './config';

export interface PreflightOk { ok: true; wallet: string }
export interface PreflightFail { ok: false; reasons: Reason[] }

/** SOL already committed today (UTC) by this user through dry runs that were accepted and through real orders. */
export async function spentTodaySol(db: PrismaClient, userId: string, now: Date): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [dry, real] = await Promise.all([
    db.dryRun.aggregate({ _sum: { sizeSol: true }, where: { userId, side: 'BUY', outcome: 'ACCEPTED', createdAt: { gte: start } } }),
    // Real orders cannot exist before B5b. Counted already so the cap does not silently stop applying when they do.
    db.order.aggregate({ _sum: { sizeSol: true }, where: { userId, simulated: false, side: 'BUY', status: { in: ['QUEUED', 'SUBMITTED', 'CONFIRMED'] }, createdAt: { gte: start } } }),
  ]);
  return Number(dry._sum.sizeSol?.toString() ?? 0) + Number(real._sum.sizeSol?.toString() ?? 0);
}

/**
 * Step 1 of the executor: everything is read again NOW, not trusted from when the job was queued. A permission revoked,
 * an agent paused, a mode switched or the kill switch thrown between queueing and this moment stops the order.
 * Collects every failure so a reviewer sees them all.
 */
export async function preflight(db: PrismaClient, job: ExecutionJob, sizeSol: number, isEntry: boolean, cfg: ExecutorConfig, now: Date): Promise<PreflightOk | PreflightFail> {
  const reasons: Reason[] = [];
  const fail = (code: string, message: string) => reasons.push({ code, message });

  const [setting, perm, user, wallet] = await Promise.all([
    db.systemSetting.findUnique({ where: { key: KILL_SWITCH_KEY } }),
    db.tradingPermission.findUnique({ where: { userId: job.userId } }),
    db.user.findUnique({ where: { id: job.userId }, select: { mode: true } }),
    db.wallet.findFirst({ where: { userId: job.userId, kind: 'TRADING' }, orderBy: { createdAt: 'asc' }, select: { address: true } }),
  ]);

  const ks = interpretKillSwitch(setting?.value);
  if (ks.tripped) fail('KILL_SWITCH', ks.reason ? `The kill switch is on: ${ks.reason}` : 'The kill switch is on.');

  if (!perm) fail('NO_PERMISSION_RECORD', 'The user has no trading permission record.');
  else {
    if (!perm.aiTradingEnabled) fail('AI_ACCESS_DISABLED', 'AI trading access is off.');
    if (perm.agentPaused) fail('AGENT_PAUSED', 'The agent is paused.');
    if (perm.revokedAt) fail('ACCESS_REVOKED', 'AI trading access was revoked.');
    if (perm.delegatedUntil && perm.delegatedUntil <= now) fail('DELEGATION_EXPIRED', 'The delegation has expired.');
  }

  // An unconfirmed order may only run in AUTO. A confirmed one was approved by the user, so SEMI_AUTO is fine too.
  if (!user) fail('NO_USER', 'The user does not exist.');
  else if (user.mode !== 'AUTO' && !(user.mode === 'SEMI_AUTO' && job.confirmationId)) fail('MODE_NOT_EXECUTABLE', `The account mode is ${user.mode}, which does not allow this order to execute.`);

  if (!wallet) fail('NO_TRADING_WALLET', 'The user has no trading wallet on record.');

  if (isEntry) {
    if (sizeSol > cfg.hardCapSol) fail('HARD_CAP_EXCEEDED', `The order is ${sizeSol} SOL, above the executor's per-transaction cap of ${cfg.hardCapSol} SOL.`);
    const spent = await spentTodaySol(db, job.userId, now);
    if (spent + sizeSol > cfg.dailyCapSol + 1e-9) fail('DAILY_CAP_EXCEEDED', `${spent} SOL is already committed today and this order is ${sizeSol} SOL, above the daily cap of ${cfg.dailyCapSol} SOL.`);
  }

  return reasons.length || !wallet ? { ok: false, reasons } : { ok: true, wallet: wallet.address };
}
