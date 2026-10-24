import type { PrismaClient } from '@narra/database';
import { evidence } from './marketEvidence';

export const HISTORY_WINDOWS = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 } as const;
const LIMIT = 500;
/** Source-linked observations only. Exact timestamps, bounded response, no candles or fabricated interpolation. */
export async function tokenHistory(db: PrismaClient, tokenId: string, window: keyof typeof HISTORY_WINDOWS, now: Date) {
  const rows = await db.tokenMetric.findMany({ where: { tokenId, at: { gte: new Date(+now - HISTORY_WINDOWS[window]), lte: now } }, orderBy: [{ at: 'desc' }, { id: 'desc' }], take: LIMIT + 1 });
  const selected = rows.slice(0, LIMIT);
  const latestKey = `research.market.${tokenId}`;
  const provenance = await db.systemSetting.findMany({ where: { key: { in: [latestKey, ...selected.map(row => `research.marketMetric.${row.id}`)] } } });
  const sources = new Map<string, ReturnType<typeof evidence.parse>>();
  // Exact per-metric provenance wins over the token-level snapshot that embeds the same metric id, so the chosen
  // pair/observation cannot depend on row order.
  for (const row of provenance) {
    const parsed = evidence.safeParse(row.value);
    if (!parsed.success) continue;
    const exact = row.key === `research.marketMetric.${parsed.data.metricId}`;
    if (exact || row.key === latestKey && !sources.has(parsed.data.metricId)) sources.set(parsed.data.metricId, parsed.data);
  }
  const points = selected.flatMap(row => {
    const source = sources.get(row.id), price = Number(row.priceUsd);
    if (!source || Date.parse(source.at) !== +row.at || !Number.isFinite(price) || price <= 0) return [];
    return [{ at: row.at.toISOString(), priceUsd: price, source: source.source, pairAddress: source.pairAddress }];
  }).reverse();
  return { window, asOf: now.toISOString(), points, truncated: rows.length > LIMIT, excludedUnverified: selected.length - points.length };
}
