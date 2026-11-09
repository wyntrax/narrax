import { Prisma } from '@narra/database';
import { z } from 'zod';
import type { SmartMoneyInvestigationTotals } from '@narra/shared';

type Trade = { side: 'BUY' | 'SELL'; amountSol: Prisma.Decimal; tokenAmount: Prisma.Decimal | null; at: Date };
// PostgreSQL Decimal(65,30), plus headroom for the bounded sum; leave global precision alone.
const SumDecimal = Prisma.Decimal.clone({ precision: 80 });
const validAmount = (n: Prisma.Decimal | null): n is Prisma.Decimal => n !== null && n.isFinite() && !n.isNegative();
export const decimalAmount = (n: Prisma.Decimal | null) => validAmount(n) ? n.toFixed() : null;

/** Totals describe only the supplied observed rows, never inventory or complete on-chain activity. */
export function investigationTotals(trades: readonly Trade[]): SmartMoneyInvestigationTotals {
  let buy = new SumDecimal(0), sell = new SumDecimal(0), units = new SumDecimal(0);
  let unknownBuy = 0, unknownSell = 0, unknownQuantity = 0, buys = 0;
  let first: Date | null = null, last: Date | null = null;
  for (const t of trades) {
    const buying = t.side === 'BUY';
    if (buying) buys++;
    if (!validAmount(t.amountSol)) { if (buying) unknownBuy++; else unknownSell++; }
    else if (buying) buy = buy.plus(t.amountSol); else sell = sell.plus(t.amountSol);
    if (!validAmount(t.tokenAmount) || t.tokenAmount.isZero()) unknownQuantity++;
    else units = buying ? units.plus(t.tokenAmount) : units.minus(t.tokenAmount);
    if (!first || t.at < first) first = t.at;
    if (!last || t.at > last) last = t.at;
  }
  return {
    tradeCount: trades.length, buyCount: buys, sellCount: trades.length - buys,
    buySol: unknownBuy ? null : buy.toFixed(), sellSol: unknownSell ? null : sell.toFixed(),
    netSolSpent: unknownBuy + unknownSell ? null : buy.minus(sell).toFixed(),
    observedTokenUnitDelta: !trades.length || unknownQuantity ? null : units.toFixed(),
    unknownSolCount: unknownBuy + unknownSell, unknownQuantityCount: unknownQuantity,
    firstObservedAt: first?.toISOString() ?? null, lastObservedAt: last?.toISOString() ?? null,
  };
}

const History = z.object({ checkedAt: z.string().datetime(), coveredFrom: z.string().datetime(), coveredTo: z.string().datetime(), capped: z.boolean(), skipped: z.number().int().nonnegative() });
export function investigationHistory(value: unknown, from: Date, to: Date, now: Date) {
  const parsed = History.safeParse(value);
  const unknown = { status: 'UNKNOWN' as const, checkedAt: null, coveredFrom: null, coveredTo: null, capped: null, skipped: null };
  if (!parsed.success) return unknown;
  const h = parsed.data, checked = Date.parse(h.checkedAt), start = Date.parse(h.coveredFrom), end = Date.parse(h.coveredTo);
  if (checked > +now || end > checked || start > end) return unknown;
  const status = +now - checked > 86_400_000 ? 'STALE' : h.capped || h.skipped > 0 || start > +from || end < +to ? 'PARTIAL' : 'COVERED';
  return { ...h, status } as typeof h & { status: 'STALE' | 'PARTIAL' | 'COVERED' };
}
