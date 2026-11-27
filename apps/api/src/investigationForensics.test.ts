import { describe, expect, it } from 'vitest';
import { Prisma } from '@narra/database';
import { InvestigationForensics, type SmartMoneyInvestigation } from '@narra/shared';
import { classifyGroupPosture, computeInvestigationForensics } from './investigationForensics';
import { investigationTotals } from './smartMoneyInvestigationSummary';

const from = new Date('2026-10-25T12:00:00Z');
const asOf = new Date('2026-10-26T12:00:00Z');
const mkTrade = (id: string, walletId: string, side: 'BUY' | 'SELL', sol: string, offsetMinutes: number) => ({
  id,
  walletId,
  signature: `${id}-${'1'.repeat(80)}`.slice(0, 86),
  side,
  amountSol: new Prisma.Decimal(sol),
  tokenAmount: new Prisma.Decimal('100'),
  at: new Date(+from + offsetMinutes * 60_000),
});

describe('computeInvestigationForensics', () => {
  it('classifies group postures, HHI concentration, 5m multi-wallet bursts, and intra-window rapid flips accurately', () => {
    const trades = [
      // Coordinated 5-minute burst at +60..+63m across w1 (cluster:A), w2 (cluster:A), and w3 (wallet:w3) -> 3 wallets, 2 independent groups
      mkTrade('t1', 'w1', 'BUY', '4', 60),
      mkTrade('t2', 'w2', 'BUY', '2', 62),
      mkTrade('t3', 'w3', 'BUY', '4', 63),
      // w3 sells 7 SOL 10 minutes later -> rapid flip (+3 SOL extracted, rotating group since 4 < 7*2 and 7 < 4*2)
      mkTrade('t4', 'w3', 'SELL', '7', 73),
      // w4 only sells 5 SOL -> distributing group
      mkTrade('t5', 'w4', 'SELL', '5', 200),
    ];

    const participants: SmartMoneyInvestigation['participants'] = [
      { id: 'w1', address: 'addr1', groupId: 'cluster:A', automated: false, currentQualification: { status: 'QUALIFIED', eligible: true, reasons: [], rulesVersion: 1 }, history: { status: 'COVERED', checkedAt: asOf.toISOString(), coveredFrom: from.toISOString(), coveredTo: asOf.toISOString(), capped: false, skipped: 0 }, totals: investigationTotals(trades.filter(t => t.walletId === 'w1')) },
      { id: 'w2', address: 'addr2', groupId: 'cluster:A', automated: true, currentQualification: { status: 'PROVISIONAL', eligible: false, reasons: ['REVIEW_REQUIRED'], rulesVersion: 1 }, history: { status: 'UNKNOWN', checkedAt: null, coveredFrom: null, coveredTo: null, capped: null, skipped: null }, totals: investigationTotals(trades.filter(t => t.walletId === 'w2')) },
      { id: 'w3', address: 'addr3', groupId: 'wallet:w3', automated: false, currentQualification: { status: 'PROVISIONAL', eligible: false, reasons: ['REVIEW_REQUIRED'], rulesVersion: 1 }, history: { status: 'UNKNOWN', checkedAt: null, coveredFrom: null, coveredTo: null, capped: null, skipped: null }, totals: investigationTotals(trades.filter(t => t.walletId === 'w3')) },
      { id: 'w4', address: 'addr4', groupId: 'wallet:w4', automated: false, currentQualification: { status: 'PROVISIONAL', eligible: false, reasons: ['REVIEW_REQUIRED'], rulesVersion: 1 }, history: { status: 'UNKNOWN', checkedAt: null, coveredFrom: null, coveredTo: null, capped: null, skipped: null }, totals: investigationTotals(trades.filter(t => t.walletId === 'w4')) },
    ];

    const rawGroups: SmartMoneyInvestigation['groups'] = [
      { id: 'cluster:A', basis: 'FUNDING', confidence: 'MEDIUM', clusterCreatedAt: from.toISOString(), participantIds: ['w1', 'w2'], totals: investigationTotals(trades.filter(t => ['w1', 'w2'].includes(t.walletId))) },
      { id: 'wallet:w3', basis: 'UNGROUPED', confidence: null, clusterCreatedAt: null, participantIds: ['w3'], totals: investigationTotals(trades.filter(t => t.walletId === 'w3')) },
      { id: 'wallet:w4', basis: 'UNGROUPED', confidence: null, clusterCreatedAt: null, participantIds: ['w4'], totals: investigationTotals(trades.filter(t => t.walletId === 'w4')) },
    ];
    const groups: SmartMoneyInvestigation['groups'] = rawGroups.map(g => ({ ...g, posture: classifyGroupPosture(g.totals) }));

    const result = InvestigationForensics.parse(computeInvestigationForensics(trades, participants, groups, from, asOf));

    // cluster:A = 6B / 0S -> ACCUMULATING; wallet:w3 = 4B / 7S -> ROTATING; wallet:w4 = 0B / 5S -> DISTRIBUTING
    expect(result.postures).toEqual({
      accumulatingGroups: 1,
      distributingGroups: 1,
      rotatingGroups: 1,
      unpricedGroups: 0,
      accumulatingNetSol: '6',
      distributingNetSol: '-5',
    });

    // Total buy = 10 SOL, w1 is QUALIFIED (4 SOL) -> 40%; 1 automated wallet (w2)
    // Gross volumes: wallet:w3 = 11 (50%), cluster:A = 6 (27.27%), wallet:w4 = 5 (22.73%), total = 22
    expect(result.concentration).toMatchObject({
      top1GroupSharePct: 50,
      top3GroupSharePct: 100,
      qualifiedBuySharePct: 40,
      automatedParticipantCount: 1,
    });
    expect(result.concentration.groupHhi).toBeGreaterThan(3500);

    expect(result.flowSeries).toHaveLength(12);
    expect(result.coEntryBursts).toHaveLength(1);
    expect(result.coEntryBursts[0]).toMatchObject({
      participantCount: 3,
      independentGroupCount: 2,
      totalBuySol: '10',
      spanSeconds: 180,
    });

    expect(result.rapidFlips).toEqual([{
      walletId: 'w3',
      buySol: '4',
      sellSol: '7',
      netExtractedSol: '3',
      buyCount: 1,
      sellCount: 1,
      spanSeconds: 600,
    }]);
  });
});
