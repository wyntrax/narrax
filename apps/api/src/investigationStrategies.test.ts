import { describe, expect, it } from 'vitest';
import { Prisma } from '@narra/database';
import { INVESTIGATION_STRATEGY_RULES as R, InvestigationStrategies, type SmartMoneyInvestigation } from '@narra/shared';
import { investigationStrategies } from './investigationStrategies';
import { investigationTotals } from './smartMoneyInvestigationSummary';
const at = new Date('2026-10-26T12:00:00Z');
const trade = (id: string, minute: number, side: 'BUY' | 'SELL' = 'BUY', walletId = 'w') => ({ id, walletId, signature: `sig-${id}`, side, at: new Date(+at + minute * 60000), amountSol: new Prisma.Decimal('0.000000001'), tokenAmount: new Prisma.Decimal('9007199254740993.000000000001') });
const participant = (id = 'w'): SmartMoneyInvestigation['participants'][number] => ({ id, address: id, groupId: 'shared-cluster', currentQualification: { status: 'PROVISIONAL', eligible: false, reasons: [], rulesVersion: 1 }, history: { status: 'UNKNOWN', checkedAt: null, coveredFrom: null, coveredTo: null, capped: null, skipped: null }, totals: investigationTotals([]) });
const analyze = (rows: ReturnType<typeof trade>[], capped = false) => InvestigationStrategies.parse(investigationStrategies(rows, [...new Set(rows.map(t => t.walletId))].map(participant), capped));
describe('descriptive per-wallet strategy evidence', () => {
  it('requires three same-side signatures at three times across at least five minutes', () => {
    for (const rows of [[trade('a', 0), trade('b', 5)], [trade('a', 0), trade('b', 0), trade('c', 5)], [trade('a', 0), trade('b', 2), trade('c', 4.99)]]) expect(analyze(rows).items).toEqual([]);
    expect(analyze([trade('a', 0), trade('b', 2), trade('c', 5)]).items[0]).toMatchObject({ kind: 'REPEATED_BUYING', supportingCount: 3, distinctTimes: 3, spanMs: 300000 });
  });
  it('retains opposing activity, unknown history and exact quantities without calling a full exit', () => {
    const result = analyze([trade('a', 0, 'SELL'), trade('b', 2, 'SELL'), trade('c', 5, 'SELL'), trade('d', 3)]);
    expect(result.items[0]).toMatchObject({ kind: 'STAGGERED_SELLING', supportingCount: 3, opposingCount: 1, walletTradeCount: 4, historyStatus: 'UNKNOWN' });
    expect(result.items[0]!.examples[0]!.tokenAmount).toBe('9007199254740993.000000000001'); expect(result.items[0]!.opposingExamples[0]!.id).toBe('d');
  });
  it('does not combine linked wallets or count duplicate signatures and invalid SOL', () => {
    expect(analyze([trade('a', 0, 'BUY', 'w1'), trade('b', 2, 'BUY', 'w2'), trade('c', 5, 'BUY', 'w3')]).items).toEqual([]);
    const t = trade('a', 0), invalid = { ...trade('bad', 3), amountSol: new Prisma.Decimal('NaN') };
    const result = analyze([t, { ...t, id: 'duplicate' }, trade('b', 5), invalid]);
    expect(result.excludedTrades).toBe(2); expect(result.items).toEqual([]);
    expect(analyze([trade('a', 0), trade('b', 2), { ...trade('c', 5), amountSol: new Prisma.Decimal(0) }]).items).toEqual([]);
  });
  it('reports independent sample and display caps and keeps first/last supporting examples', () => {
    const rows = Array.from({ length: 12 }, (_, i) => trade(`a-${i}`, i));
    const result = analyze(rows, true);
    expect(result.scope).toBe('LATEST_CAPPED_SAMPLE'); expect(result.items[0]!.examples).toHaveLength(R.maxExamples);
    expect(result.items[0]!.examples[0]!.id).toBe('a-0'); expect(result.items[0]!.examples.at(-1)!.id).toBe('a-11');
    expect(analyze([...rows].reverse())).toEqual(analyze(rows));
    const many = analyze(Array.from({ length: 21 }, (_, i) => [trade(`${i}-a`, 0, 'BUY', `w${i}`), trade(`${i}-b`, 2, 'BUY', `w${i}`), trade(`${i}-c`, 5, 'BUY', `w${i}`)]).flat());
    expect(many).toMatchObject({ truncated: true, candidateCount: 21 }); expect(many.items).toHaveLength(20);
  });
  it('missing quantities stay unknown and do not become holdings estimates', () => {
    const result = analyze([trade('a', 0), trade('b', 2), { ...trade('c', 5), tokenAmount: null as unknown as Prisma.Decimal }]);
    expect(result.items[0]!.examples.at(-1)!.tokenAmount).toBeNull();
  });
});
