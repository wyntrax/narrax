import { describe, expect, it } from 'vitest';
import { Prisma } from '@narra/database';
import { InvestigationQuery } from '@narra/shared';
import { investigationHistory, investigationTotals } from './smartMoneyInvestigationSummary';

const now = new Date('2026-10-26T12:00:00Z'), from = new Date(+now - 86_400_000);
const trade = (side: 'BUY' | 'SELL', sol: string, qty: string | null) => ({ side, amountSol: new Prisma.Decimal(sol), tokenAmount: qty === null ? null : new Prisma.Decimal(qty), at: now });
describe('investigation measurement semantics', () => {
  it('keeps negative net SOL spent distinct from positive observed token units', () => {
    expect(investigationTotals([trade('BUY', '1', '100'), trade('SELL', '3', '50')])).toMatchObject({ buySol: '1', sellSol: '3', netSolSpent: '-2', observedTokenUnitDelta: '50' });
  });
  it('retains decimal precision beyond JavaScript numbers and default Decimal precision', () => {
    expect(investigationTotals([trade('BUY', '0.000000001', '99999999999999999999999999999999999'), trade('BUY', '0.000000002', '0.000000000000000000000000000001')])).toMatchObject({ netSolSpent: '0.000000003', observedTokenUnitDelta: '99999999999999999999999999999999999.000000000000000000000000000001' });
  });
  it.each([null, '0', '-1', 'NaN'])('keeps missing or invalid quantity %s unknown while retaining known SOL', qty => {
    expect(investigationTotals([trade('BUY', '2', '100'), trade('SELL', '1', qty)])).toMatchObject({ netSolSpent: '1', observedTokenUnitDelta: null, unknownQuantityCount: 1 });
  });
  it('never serializes invalid SOL as a zero or invents holdings from an empty window', () => {
    expect(investigationTotals([trade('BUY', 'NaN', '10')])).toMatchObject({ buySol: null, sellSol: '0', netSolSpent: null, unknownSolCount: 1 });
    expect(investigationTotals([])).toMatchObject({ tradeCount: 0, observedTokenUnitDelta: null, firstObservedAt: null, lastObservedAt: null });
  });
  it('distinguishes missing, partial, stale and covered scan history', () => {
    const history = { checkedAt: now.toISOString(), coveredFrom: from.toISOString(), coveredTo: now.toISOString(), capped: false, skipped: 0 };
    expect(investigationHistory(null, from, now, now).status).toBe('UNKNOWN');
    expect(investigationHistory(history, from, now, now).status).toBe('COVERED');
    for (const patch of [{ capped: true }, { skipped: 1 }, { coveredTo: new Date(+now - 1).toISOString() }]) expect(investigationHistory({ ...history, ...patch }, from, now, now).status).toBe('PARTIAL');
    expect(investigationHistory(history, from, now, new Date(+now + 86_400_001)).status).toBe('STALE');
    expect(investigationHistory({ ...history, checkedAt: new Date(+now + 1).toISOString() }, from, now, now).status).toBe('UNKNOWN');
    expect(investigationHistory({ ...history, coveredFrom: new Date(+now + 1).toISOString() }, from, now, now).status).toBe('UNKNOWN');
  });
  it('requires the original event bound for paging and rejects unknown filters and oversized requests', () => {
    for (const q of [{ cursor: 'abc' }, { limit: 101 }, { window: '30d' }, { wallet: 'abc' }, { asOf: 'tomorrow' }]) expect(InvestigationQuery.safeParse(q).success).toBe(false);
  });
});
