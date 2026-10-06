import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import { sanitizeUntrusted } from '@narra/shared';
import { makeAuthenticate, type AccountDeps } from './account';

const LAMPORTS = 1_000_000_000;
const n = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));

/** Starting values, not tuned. */
export const EXPORT_LIMITS = { maxRows: 10_000, batch: 1000 } as const;
const MAX_WALLETS_PER_BALANCE_CALL = 10;

export interface BalanceSource {
  getBalanceLamports(address: string): Promise<bigint>;
}

export interface MeDeps extends Pick<AccountDeps, 'db' | 'verifier' | 'now'> {
  /** Reads SOL balances. Without it balances are reported as unknown, never as zero. */
  balances?: BalanceSource;
}

/**
 * Cells that start with = + - @ tab or CR can be run as formulas by a spreadsheet. Text cells get a leading apostrophe.
 * Numbers are written as plain numbers (a loss legitimately starts with "-") and are never treated as text.
 */
export function csvText(v: string | null | undefined): string {
  if (v == null || v === '') return '';
  let s = v.replace(/[\r\n]+/g, ' ');
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export const csvNum = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '' : String(v));

const CSV_HEADER = ['tradeId', 'executedAt', 'mode', 'side', 'simulated', 'tokenMint', 'tokenSymbol', 'reason', 'amountSol', 'feeSol', 'expectedPriceUsd', 'actualPriceUsd', 'slippageBps', 'realizedPnlSol', 'signature', 'orderId', 'positionId'];

/** The signed-in user's own wallets, balances and trade export. Every query is scoped to the user. Nothing here moves funds. */
export function registerMeRoutes(app: FastifyInstance, deps: MeDeps): void {
  const db: PrismaClient = deps.db;
  const opts = { preHandler: makeAuthenticate(deps), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  const bad = { error: 'INVALID_INPUT' } as const;

  // The deposit address of a trading wallet is the wallet's address. Creating wallets is part of the Executor phase (B5).
  app.get('/v1/me/wallets', opts, async (req) => {
    const rows = await db.wallet.findMany({ where: { userId: req.userId! }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50, select: { id: true, address: true, kind: true, createdAt: true } });
    return { items: rows };
  });

  app.get('/v1/me/wallets/balances', opts, async (req) => {
    const wallets = await db.wallet.findMany({ where: { userId: req.userId! }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_WALLETS_PER_BALANCE_CALL, select: { address: true, kind: true } });
    const source = deps.balances;
    const at = (deps.now ?? (() => new Date()))();
    const items = await Promise.all(wallets.map(async (w) => {
      if (!source) return { address: w.address, kind: w.kind, balanceSol: null, status: 'UNKNOWN' as const };
      try {
        const lamports = await source.getBalanceLamports(w.address);
        return { address: w.address, kind: w.kind, balanceSol: Number(lamports) / LAMPORTS, status: 'OK' as const };
      } catch {
        return { address: w.address, kind: w.kind, balanceSol: null, status: 'UNKNOWN' as const };
      }
    }));
    return { at, items, available: !!source };
  });

  // Audit export of the user's own trades, paper and real, as CSV or JSON. Capped, and says so when it was.
  app.get('/v1/trades/export', { ...opts, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const q = z.object({
      format: z.enum(['csv', 'json']).default('csv'),
      from: z.string().datetime().optional(), to: z.string().datetime().optional(),
      simulated: z.enum(['true', 'false']).optional(),
    }).safeParse(req.query);
    if (!q.success) return reply.code(400).send(bad);
    const from = q.data.from ? new Date(q.data.from) : undefined; const to = q.data.to ? new Date(q.data.to) : undefined;
    if (from && to && from > to) return reply.code(400).send(bad);
    const userId = req.userId!;
    const where: Prisma.TradeWhereInput = {
      userId,
      ...(from || to ? { executedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(q.data.simulated ? { simulated: q.data.simulated === 'true' } : {}),
    };

    const rows: Awaited<ReturnType<typeof fetchBatch>> = [];
    let cursor: string | undefined;
    let truncated = false;
    const fetchBatch = (take: number, after?: string) => db.trade.findMany({
      where, orderBy: [{ executedAt: 'desc' }, { id: 'desc' }], take, ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      include: { order: { select: { id: true, token: { select: { mint: true, symbol: true } } } } },
    });
    while (rows.length < EXPORT_LIMITS.maxRows) {
      const take = Math.min(EXPORT_LIMITS.batch, EXPORT_LIMITS.maxRows - rows.length + 1);
      const batch = await fetchBatch(take, cursor);
      if (!batch.length) break;
      rows.push(...batch);
      cursor = batch[batch.length - 1]!.id;
      if (batch.length < take) break;
    }
    if (rows.length > EXPORT_LIMITS.maxRows) { rows.length = EXPORT_LIMITS.maxRows; truncated = true; }

    const record = (t: (typeof rows)[number]) => ({
      tradeId: t.id, executedAt: t.executedAt.toISOString(), mode: t.mode, side: t.side, simulated: t.simulated,
      tokenMint: t.order?.token?.mint ?? null, tokenSymbol: t.order?.token ? sanitizeUntrusted(t.order.token.symbol, 32) : null, reason: t.reason,
      amountSol: n(t.amountSol), feeSol: n(t.feeSol), expectedPriceUsd: n(t.expectedPriceUsd), actualPriceUsd: n(t.actualPriceUsd), slippageBps: t.slippageBps,
      realizedPnlSol: n(t.realizedPnlSol), signature: t.signature, orderId: t.orderId, positionId: t.positionId,
    });
    await db.auditLog.create({ data: { userId, action: 'trades.exported', detail: { format: q.data.format, rows: rows.length, truncated } } });
    reply.header('x-export-truncated', String(truncated)).header('cache-control', 'no-store');

    if (q.data.format === 'json') return { count: rows.length, truncated, items: rows.map(record) };
    const stamp = (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
    const lines = [CSV_HEADER.join(',')];
    for (const t of rows) {
      const r = record(t);
      lines.push([csvText(r.tradeId), csvText(r.executedAt), csvText(r.mode), csvText(r.side), String(r.simulated), csvText(r.tokenMint), csvText(r.tokenSymbol), csvText(r.reason), csvNum(r.amountSol), csvNum(r.feeSol), csvNum(r.expectedPriceUsd), csvNum(r.actualPriceUsd), csvNum(r.slippageBps), csvNum(r.realizedPnlSol), csvText(r.signature), csvText(r.orderId), csvText(r.positionId)].join(','));
    }
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="trades-${stamp}.csv"`).send(lines.join('\r\n') + '\r\n');
  });
}
