import { expect, it } from 'vitest';
import { Prisma } from '@narra/database';
import { PublishedInvestigationContext } from '@narra/shared';
import { investigationPublications } from './investigationPublications';
const at = new Date('2026-10-26T08:00:00Z'), due = new Date(+at + 3600000), now = new Date(+at + 2 * 3600000);
function publication(): Parameters<typeof investigationPublications>[0][number] {
  return { id: 'signal', tokenId: 'token', dedupeKey: 'key', side: 'SELL', walletCount: 1, independentEntities: 1, netFlowSol: new Prisma.Decimal(-1), entryPriceUsd: new Prisma.Decimal(2), entryMetricId: 'entry', entryAt: at, createdAt: at,
    evidence: { version: 1, market: { metricId: 'entry', priceUsd: 2, at: at.toISOString(), source: 'dexscreener', pairAddress: 'pair' }, wallets: [{ address: 'historic', clusterId: 'old-cluster', qualification: { status: 'QUALIFIED', eligible: true, reasons: [], rulesVersion: 1 } }], trades: [{ id: 'trade', wallet: 'historic', signature: 'sig', side: 'SELL', amountSol: 1, at: at.toISOString() }] },
    measurements: [{ id: 'measure', signalId: 'signal', horizonHours: 1, dueAt: due, status: 'MEASURED', priceUsd: new Prisma.Decimal(3), priceAt: due, metricId: 'exit', returnPct: 50, reason: null, measuredAt: due }] };
}
it('preserves frozen qualification and SELL price direction, separately from current wallet returns', () => {
  const result = PublishedInvestigationContext.parse(investigationPublications([publication()], now));
  expect(result.items[0]!.frozenEvidence.wallets[0]).toMatchObject({ address: 'historic', clusterId: 'old-cluster', qualification: { status: 'QUALIFIED' } });
  expect(result.items[0]!.outcomes[0]).toMatchObject({ status: 'MEASURED', returnPct: 50, priceUsd: '3' });
});
it('withholds future, stale or incomplete measurements and malformed frozen evidence', () => {
  const future = publication(); future.measurements[0]!.measuredAt = new Date(+now + 1);
  expect(investigationPublications([future], now).items[0]!.outcomes[0]).toMatchObject({ status: 'PENDING', returnPct: null, measuredAt: null });
  for (const patch of [{ metricId: null }, { priceAt: new Date(+due + 1) }, { priceAt: new Date(+due - 900001) }, { returnPct: NaN }, { returnPct: -50 }, { priceUsd: new Prisma.Decimal(0), returnPct: -100 }, { measuredAt: null }]) {
    const row = publication(); Object.assign(row.measurements[0]!, patch);
    expect(investigationPublications([row], now).items[0]!.outcomes[0]).toMatchObject({ status: 'UNKNOWN', returnPct: null, priceUsd: null });
  }
  const malformed = publication(); malformed.evidence = { version: 0 };
  expect(investigationPublications([malformed], now).items[0]).toMatchObject({ reference: null, frozenEvidence: { status: 'UNAVAILABLE' }, outcomes: [{ status: 'UNKNOWN' }] });
});
it('bounds publication and frozen previews without silently changing stored population counts', () => {
  const row = publication(), evidence = row.evidence as { wallets: unknown[]; trades: unknown[] };
  row.evidence = { ...row.evidence as object, wallets: Array(6).fill(evidence.wallets[0]), trades: Array(6).fill(evidence.trades[0]) } as Prisma.JsonObject;
  const result = investigationPublications(Array(11).fill(row), now);
  expect(result.truncated).toBe(true); expect(result.items).toHaveLength(10);
  expect(result.items[0]!.frozenEvidence).toMatchObject({ previewTruncated: true, tradeCount: 6, walletCount: 6 });
  expect(result.items[0]!.frozenEvidence.wallets).toHaveLength(5);
});
