import type { Prisma, PrismaClient } from '@narra/database';
import type { ExecutionJob, SwapEvent } from '@narra/queue';
import { PROFILES, type RiskLimits } from '@narra/risk';
import type { ExecutionDeps, PreTradeState } from './execution';
import type { WalletEventDeps } from './walletEvent';
import { makePaperPorts, type PaperPorts } from './paperLedger';
import { loadSystemControls } from './systemConfig';
import { walletTradeEvidence } from './walletResearchEvidence';

type Db = PrismaClient;

/** Thrown when an input the Governor needs is missing. The job fails and the trade does not happen. */
export class MissingInputError extends Error {}

const num = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));
const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';

// ---------- Wallet events ----------

export function makeWalletEventStore(db: Db): Pick<WalletEventDeps, 'saveWalletTrade' | 'getWalletScore'> & { isTracked(wallet: string): Promise<boolean> } {
  return {
    async isTracked(wallet) {
      return (await db.trackedWallet.count({ where: { address: wallet, active: true } })) > 0;
    },
    async saveWalletTrade(e: SwapEvent) {
      const wallet = await db.trackedWallet.findUnique({ where: { address: e.wallet }, select: { id: true, active: true } });
      if (!wallet || !wallet.active) return 'untracked';
      const token = await db.token.upsert({
        where: { mint: e.mint },
        create: { mint: e.mint, symbol: 'UNKNOWN', name: 'Unknown' },
        update: {},
        select: { id: true },
      }).catch(async err => {
        // Concurrent deliveries can both try to create the same newly seen mint.
        // Prisma's empty-update upsert may use read/create rather than ON CONFLICT.
        if (!isUniqueViolation(err)) throw err;
        return db.token.findUniqueOrThrow({ where: { mint: e.mint }, select: { id: true } });
      });
      try {
        const evidence = await walletTradeEvidence(db, token.id, new Date(e.at), e.amountSol);
        await db.walletTrade.create({
          data: { walletId: wallet.id, tokenId: token.id, side: e.side, amountSol: e.amountSol, tokenAmount: e.tokenAmount, signature: e.signature, at: new Date(e.at), ...evidence },
        });
        return 'created';
      } catch (err) {
        if (isUniqueViolation(err)) return 'duplicate'; // same signature delivered twice
        throw err;
      }
    },
    async getWalletScore(wallet) {
      const p = await db.walletProfile.findFirst({ where: { wallet: { address: wallet } }, select: { score: true } });
      return p?.score ?? null;
    },
  };
}

// ---------- Execution ----------

/** Facts that do not live in our database. Each one must be supplied by a real provider, never defaulted. */
export interface ChainPorts {
  getSolBalance(address: string): Promise<number>;
  /** Total portfolio value in SOL: balance plus open positions at current prices. */
  getPortfolioValueSol(userId: string): Promise<number>;
  /** Token base units the trading wallet holds for this mint, or null if none. */
  getTokenBaseUnits(address: string, mint: string): Promise<string | null>;
}

export function makeExecutionStore(db: Db, ports: ChainPorts, now: () => Date = () => new Date(), paperPorts: PaperPorts = makePaperPorts(db)): Pick<ExecutionDeps, 'loadPreTradeState' | 'recordRisk'> {
  return {
    async loadPreTradeState(job: ExecutionJob): Promise<PreTradeState> {
      const at = now();
      const dayStart = startOfUtcDay(at);

      const user = await db.user.findUnique({
        where: { id: job.userId },
        include: { permission: true, riskProfile: true, wallets: { where: { kind: 'TRADING' }, take: 1 } },
      });
      if (!user) throw new MissingInputError('User not found');

      const token = await db.token.findUnique({
        where: { mint: job.mint },
        include: { metrics: { orderBy: { at: 'desc' }, take: 1 }, opportunities: { orderBy: { createdAt: 'desc' }, take: 1 }, consensus: { orderBy: { at: 'desc' }, take: 1 } },
      });
      const metric = token?.metrics[0];
      const opportunity = token?.opportunities[0];
      const consensus = token?.consensus[0];
      if (!token || !metric || !opportunity || !consensus) throw new MissingInputError('Token metrics or signals are missing');

      const controls = await loadSystemControls(db);
      const isBuy = job.decision.action === 'BUY';
      const tokenPosition = await db.position.findFirst({ where: { userId: user.id, tokenId: token.id, status: 'OPEN' }, select: { id: true, simulated: true, baseUnits: true } });

      // PAPER and SHADOW users have no wallet: their balance comes from the paper ledger and their rows are marked simulated.
      // An exit follows the position it closes, not the mode now: a paper position always exits as paper.
      let paper = user.mode === 'PAPER' || user.mode === 'SHADOW';
      let mode = user.mode;
      if (!isBuy && tokenPosition) {
        if (tokenPosition.simulated) { paper = true; mode = 'PAPER'; }
        else if (paper) throw new MissingInputError('A real position cannot be exited from a paper mode');
      }
      const wallet = user.wallets[0];
      if (!paper && !wallet) throw new MissingInputError('User has no trading wallet');

      let baseUnits: string | null = null;
      if (!isBuy) {
        if (paper) {
          if (tokenPosition && tokenPosition.baseUnits == null) throw new MissingInputError('The position has no recorded token amount');
          baseUnits = tokenPosition ? (tokenPosition.baseUnits as { toFixed(dp: number): string }).toFixed(0) : null;
        } else baseUnits = await ports.getTokenBaseUnits(wallet!.address, job.mint);
      }

      const [balance, totalValue, openPositions, exposure, allocated, pnl, peak, recentOrders, lastTrade, lastSame] = await Promise.all([
        paper ? paperPorts.balanceSol(user.id) : ports.getSolBalance(wallet!.address),
        paper ? paperPorts.portfolioValueSol(user.id, at) : ports.getPortfolioValueSol(user.id),
        db.position.count({ where: { userId: user.id, status: 'OPEN', simulated: paper } }),
        db.position.aggregate({ where: { userId: user.id, tokenId: token.id, status: 'OPEN', simulated: paper }, _sum: { sizeSol: true } }),
        db.order.aggregate({ where: { userId: user.id, side: 'BUY', simulated: paper, status: { in: ['QUEUED', 'SUBMITTED', 'CONFIRMED'] }, createdAt: { gte: dayStart } }, _sum: { sizeSol: true } }),
        db.trade.aggregate({ where: { userId: user.id, simulated: paper, executedAt: { gte: dayStart } }, _sum: { realizedPnlSol: true } }),
        db.portfolioSnapshot.aggregate({ where: { userId: user.id, simulated: paper, at: { gte: new Date(at.getTime() - 30 * 86_400_000) } }, _max: { totalValueSol: true } }),
        db.order.findMany({ where: { userId: user.id, createdAt: { gte: new Date(at.getTime() - 3_600_000) } }, select: { idempotencyKey: true } }),
        db.trade.findFirst({ where: { userId: user.id, simulated: paper, order: { tokenId: token.id } }, orderBy: { executedAt: 'desc' }, select: { executedAt: true } }),
        db.order.findFirst({ where: { userId: user.id, tokenId: token.id, simulated: paper, side: isBuy ? 'BUY' : 'SELL' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      ]);

      // Drawdown is measured from the highest recent snapshot (or now, if that is higher).
      const peakValue = Math.max(num(peak._max.totalValueSol), totalValue);
      const drawdownPct = peakValue > 0 ? Math.max(0, ((peakValue - totalValue) / peakValue) * 100) : 0;

      const permission = user.permission;
      const aiAccessEnabled = !!permission?.aiTradingEnabled && !permission.revokedAt && (!permission.delegatedUntil || permission.delegatedUntil > at);

      return {
        context: {
          now: at,
          mode,
          aiAccessEnabled,
          agentPaused: permission?.agentPaused ?? false,
          systemPaused: controls.pause.paused,
          idempotencyKey: job.idempotencyKey,
          token: { mint: job.mint, blacklisted: token.blacklisted, liquidityUsd: num(metric.liquidityUsd) },
          signals: { opportunityScore: opportunity.score, consensusScore: consensus.score },
          portfolio: {
            totalValueSol: totalValue, walletBalanceSol: balance, openPositions, hasPositionInToken: !!tokenPosition,
            tokenExposureSol: num(exposure._sum.sizeSol), allocatedTodaySol: num(allocated._sum.sizeSol),
            realizedPnlTodaySol: num(pnl._sum.realizedPnlSol), drawdownPct,
          },
          history: {
            seenIdempotencyKeys: recentOrders.map((o) => o.idempotencyKey),
            lastTradeAtForToken: lastTrade?.executedAt ?? null,
            lastSameOrderAt: lastSame?.createdAt ?? null,
          },
        },
        limits: limitsFor(user.riskProfile),
        systemLimits: controls.limits,
        positionBaseUnits: baseUnits,
      };
    },

    /** One row per user and order, so many users can act on one decision without overwriting each other. */
    async recordRisk({ job, result, quote, status }) {
      const data = {
        userId: job.userId, decisionId: job.decisionId ?? null, approved: result.approved, route: result.route, sizeSol: result.sizeSol,
        violations: result.violations as unknown as Prisma.InputJsonValue,
        adjustments: result.adjustments as unknown as Prisma.InputJsonValue,
      };
      await db.$transaction([
        db.riskDecision.upsert({ where: { idempotencyKey: job.idempotencyKey }, create: { idempotencyKey: job.idempotencyKey, ...data }, update: data }),
        db.auditLog.create({
          data: {
            userId: job.userId, action: `execution.${status}`,
            detail: { idempotencyKey: job.idempotencyKey, decisionId: job.decisionId ?? null, evaluationId: job.evaluationId ?? null, route: result.route, violations: result.violations.map((v) => v.code), priceImpactPct: quote?.priceImpactPct ?? null } as Prisma.InputJsonValue,
          },
        }),
      ]);
    },
  };
}

type ProfileRow = { preset: string; maxPerTradeSol: { toString(): string }; maxDailyAllocationSol: { toString(): string }; maxTokenExposurePct: number; maxOpenPositions: number; maxDailyLossPct: number; minConfidence: number } | null;

/** The preset supplies the base, and the user's saved fields override it. The Governor still caps everything at the system limits. */
export function limitsFor(profile: ProfileRow): Partial<RiskLimits> {
  if (!profile) return PROFILES.CONSERVATIVE; // no saved profile: use the strictest preset
  const base = PROFILES[profile.preset as keyof typeof PROFILES] ?? PROFILES.BALANCED;
  return {
    ...base,
    maxPerTradeSol: num(profile.maxPerTradeSol), maxDailyAllocationSol: num(profile.maxDailyAllocationSol),
    maxTokenExposurePct: profile.maxTokenExposurePct, maxOpenPositions: profile.maxOpenPositions,
    maxDailyLossPct: profile.maxDailyLossPct, minConfidence: profile.minConfidence,
  };
}
