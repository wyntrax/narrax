import { z } from 'zod';
import type { Prisma } from '@narra/database';
import { FrozenInvestigationEvidence, INVESTIGATION_STRATEGY_RULES as R, type InvestigationPublications } from '@narra/shared';
import { decimalAmount } from './smartMoneyInvestigationSummary';

type Row = Prisma.WalletResearchSignalGetPayload<{ include: { measurements: true } }>;
const Market = z.object({ market: z.object({ metricId: z.string(), at: z.string().datetime(), source: z.literal('dexscreener'), pairAddress: z.string().min(1), priceUsd: z.number().finite().positive() }) });
/** Current measured context, not an as-of backtest; qualification comes only from frozen publication evidence. */
export function investigationPublications(rows: Row[], now: Date): InvestigationPublications {
  return { limit: R.maxPublications, truncated: rows.length > R.maxPublications, outcomesReadAt: now.toISOString(), items: rows.slice(0, R.maxPublications).map(s => {
    const parsed = FrozenInvestigationEvidence.safeParse(s.evidence), market = Market.safeParse(s.evidence);
    const referenceValid = market.success && market.data.market.metricId === s.entryMetricId && market.data.market.at === s.entryAt.toISOString() && s.entryPriceUsd.isFinite() && s.entryPriceUsd.isPositive() && s.entryPriceUsd.equals(market.data.market.priceUsd) && +s.entryAt <= +s.createdAt && +s.createdAt - +s.entryAt <= 900_000;
    const frozen = parsed.success && parsed.data.trades.every(t => Date.parse(t.at) <= +s.createdAt && parsed.data.wallets.some(w => w.address === t.wallet)) ? parsed.data : null;
    return { id: s.id, side: s.side, createdAt: s.createdAt.toISOString(), walletCount: s.walletCount, supportingGroupCount: s.independentEntities,
      netFlowSol: s.netFlowSol.isFinite() ? s.netFlowSol.toFixed() : null,
      reference: referenceValid ? { priceUsd: s.entryPriceUsd.toFixed(), at: s.entryAt.toISOString(), metricId: s.entryMetricId, source: 'dexscreener' as const, pairAddress: market.data.market.pairAddress } : null,
      frozenEvidence: { status: frozen ? 'AVAILABLE' as const : 'UNAVAILABLE' as const, walletCount: frozen?.wallets.length ?? 0, tradeCount: frozen?.trades.length ?? 0,
        previewTruncated: !!frozen && (frozen.wallets.length > R.maxExamples || frozen.trades.length > R.maxExamples), wallets: frozen?.wallets.slice(0, R.maxExamples) ?? [], trades: frozen?.trades.slice(0, R.maxExamples) ?? [] },
      outcomes: s.measurements.filter(m => [1, 4, 24].includes(m.horizonHours)).map(m => {
        const future = +m.dueAt > +now || !!m.measuredAt && +m.measuredAt > +now;
        const expected = referenceValid && m.priceUsd?.isFinite() ? (Number(m.priceUsd) / Number(s.entryPriceUsd) - 1) * 100 : NaN;
        const valid = referenceValid && m.status === 'MEASURED' && !future && +m.dueAt === +s.createdAt + m.horizonHours * 3_600_000 && m.returnPct !== null && Number.isFinite(m.returnPct) && Number.isFinite(expected) && Math.abs(expected - m.returnPct) <= Math.max(1e-8, Math.abs(expected) * 1e-8) && !!m.priceUsd?.isFinite() && m.priceUsd.gt(0) && !!m.priceAt && +m.priceAt <= +m.dueAt && +m.dueAt - +m.priceAt <= 900_000 && !!m.metricId && !!m.measuredAt && +m.measuredAt >= +m.dueAt;
        const status = valid ? 'MEASURED' as const : future || m.status === 'PENDING' ? 'PENDING' as const : 'UNKNOWN' as const;
        return { horizonHours: m.horizonHours, dueAt: m.dueAt.toISOString(), status, returnPct: valid ? m.returnPct : null, priceUsd: valid ? decimalAmount(m.priceUsd) : null,
          priceAt: valid ? m.priceAt!.toISOString() : null, metricId: valid ? m.metricId : null, measuredAt: !future ? m.measuredAt?.toISOString() ?? null : null,
          reason: valid || status === 'PENDING' ? null : m.reason ?? 'INCOMPLETE_MEASUREMENT_EVIDENCE' };
      }),
    };
  }) };
}
