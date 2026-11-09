import { INVESTIGATION_STRATEGY_RULES, InvestigationResponse, type SmartMoneyInvestigationTotals } from '@narra/shared';

/** Synthetic fixture shared only by component/browser tests. Never requested by production pages. */
export function investigationFixture() {
  const at = '2026-10-26T12:00:00.000Z', from = '2026-10-25T12:00:00.000Z';
  const mint = 'So11111111111111111111111111111111111111112';
  const totals: SmartMoneyInvestigationTotals = { tradeCount: 1, buyCount: 1, sellCount: 0, buySol: '0.000000001', sellSol: '0', netSolSpent: '0.000000001', observedTokenUnitDelta: '999999999999999999999999.00000001', unknownSolCount: 0, unknownQuantityCount: 0, firstObservedAt: at, lastObservedAt: at };
  const participants = Array.from({ length: 4 }, (_, i) => ({ id: `wallet-${i}`, address: i === 0 ? mint : `${'1'.repeat(31)}${i + 1}`, groupId: `cluster:${i}`,
    currentQualification: { status: 'PROVISIONAL', eligible: false, reasons: ['HISTORY_INCOMPLETE_OR_STALE'], rulesVersion: 1 },
    history: { status: 'UNKNOWN', checkedAt: null, coveredFrom: null, coveredTo: null, capped: null, skipped: null },
    totals: i === 1 ? { ...totals, tradeCount: 1, buyCount: 0, sellCount: 1, buySol: '0', sellSol: '2', netSolSpent: '-2', observedTokenUnitDelta: null, unknownQuantityCount: 1 } : totals,
  }));
  return InvestigationResponse.parse({ methodologyVersion: 1, token: { mint, symbol: 'SAMPLE', name: 'Synthetic investigation fixture' }, window: '24h', from, asOf: at, readAt: at,
    contextMode: 'CURRENT', consistency: 'LIVE_REQUERY', coverage: { population: 'ACTIVE_TRACKED_WALLETS', activity: 'OBSERVED_TRADES', aggregationScope: 'LATEST_CAPPED_SAMPLE', tradeLimit: 1000, tradesRead: 4, tradesTruncated: true, relationshipLimit: 250, relationshipsTruncated: true, participantCount: 4, groupCount: 4, currentlyQualifiedCount: 0, historyCoveredCount: 0, limitations: ['TRADE_QUERY_CAPPED', 'TOKEN_QUANTITIES_INCOMPLETE', 'HISTORY_COVERAGE_NOT_ESTABLISHED', 'RELATIONSHIP_QUERY_CAPPED'] },
    totals: { ...totals, tradeCount: 4, buyCount: 3, sellCount: 1, buySol: '0.000000003', sellSol: '2', netSolSpent: '-1.999999997', observedTokenUnitDelta: null, unknownQuantityCount: 1 }, participants,
    groups: participants.map((p, i) => ({ id: p.groupId, basis: i === 0 ? 'FUNDING' : 'TIMING', confidence: 'MEDIUM', clusterCreatedAt: at, participantIds: [p.id], totals: p.totals })),
    relationships: [{ id: 'edge', fromId: 'wallet-0', toId: 'wallet-1', kind: 'FUNDING', confidence: 'MEDIUM', evidence: { type: 'shared', funder: mint } }],
    trades: [{ id: 'trade-1', walletId: 'wallet-0', signature: '2'.repeat(88), side: 'BUY', at, amountSol: '0.000000001', tokenAmount: totals.observedTokenUnitDelta, evidence: { source: '<script>untrusted evidence</script>', eventAt: at } }], nextCursor: 'fixture-next',
    discovery: { status: 'COMPLETE', checkedAt: at, pagesRead: 3, transactionsRead: 300, swapsRead: 120, participantsSeen: 40, candidates: 12, newWallets: 4, backfilledWallets: 4, createdTrades: 18, capped: false, error: null },
  });
}

export function investigationStrategyFixture() {
  const data = investigationFixture(), trade = data.trades[0]!;
  const examples = [0, 2, 5].map((minute, i) => ({ ...trade, id: `example-${i}`, at: new Date(Date.parse(data.asOf) - (5 - minute) * 60000).toISOString(), signature: String(i + 4).repeat(88) }));
  data.strategies = { rules: INVESTIGATION_STRATEGY_RULES, scope: 'LATEST_CAPPED_SAMPLE', evaluatedWallets: 4, observedTrades: 6, excludedTrades: 0, candidateCount: 1, truncated: false,
    items: [{ walletId: 'wallet-0', kind: 'REPEATED_BUYING', supportingCount: 3, opposingCount: 1, walletTradeCount: 4, distinctTimes: 3, firstAt: examples[0]!.at, lastAt: examples[2]!.at, spanMs: 300000, historyStatus: 'UNKNOWN', examples,
      opposingExamples: [{ ...trade, id: 'opposing', side: 'SELL', signature: '7'.repeat(88), amountSol: '2', tokenAmount: null }] }] };
  data.publications = { limit: 10, truncated: true, outcomesReadAt: data.readAt, items: [{ id: 'publication', side: 'SELL', createdAt: data.from, walletCount: 2, supportingGroupCount: 2, netFlowSol: '-3',
    reference: { priceUsd: '2', at: data.from, metricId: 'entry-metric', source: 'dexscreener', pairAddress: data.token.mint },
    frozenEvidence: { status: 'AVAILABLE', walletCount: 2, tradeCount: 6, previewTruncated: true, wallets: [{ address: 'historic-wallet', clusterId: 'historic-cluster', qualification: { status: 'QUALIFIED', eligible: true, reasons: [], rulesVersion: 1 } }], trades: [{ id: 'historic-trade', wallet: 'historic-wallet', side: 'SELL', amountSol: 3, signature: '8'.repeat(88), at: data.from }] },
    outcomes: [
      { horizonHours: 1, dueAt: '2026-10-25T13:00:00.000Z', status: 'MEASURED', returnPct: 50, priceUsd: '3', priceAt: '2026-10-25T13:00:00.000Z', metricId: 'horizon-metric', measuredAt: '2026-10-25T13:01:00.000Z', reason: null },
      { horizonHours: 4, dueAt: '2026-10-25T16:00:00.000Z', status: 'UNKNOWN', returnPct: null, priceUsd: null, priceAt: null, metricId: null, measuredAt: '2026-10-25T16:01:00.000Z', reason: 'NO_FRESH_SOURCE_BACKED_HORIZON_PRICE' },
      { horizonHours: 24, dueAt: data.asOf, status: 'PENDING', returnPct: null, priceUsd: null, priceAt: null, metricId: null, measuredAt: null, reason: null },
    ],
  }] };
  return InvestigationResponse.parse(data);
}
