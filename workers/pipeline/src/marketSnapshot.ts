import type { Prisma } from '@narra/database';
import type { MarketSnapshot } from '@narra/market-data';
import { tokenImageUrl } from '@narra/shared';

/** Call inside a transaction: the observation and its provenance must commit together. */
export async function storeMarketSnapshot(tx: Prisma.TransactionClient, tokenId: string, snapshot: MarketSnapshot, source: string, at: Date) {
  const metric = await tx.tokenMetric.create({ data: { tokenId, priceUsd: snapshot.priceUsd, marketCapUsd: snapshot.marketCapUsd, liquidityUsd: snapshot.liquidityUsd, volume24hUsd: snapshot.volume24hUsd, at } });
  const value = { metricId: metric.id, mint: snapshot.mint, imageUrl: tokenImageUrl(snapshot.imageUrl), at: at.toISOString(), source, marketCapIsFdv: snapshot.marketCapIsFdv, priceChange1hPct: snapshot.priceChange1hPct, pairAddress: snapshot.pairAddress, dexId: snapshot.dexId, pairCreatedAt: snapshot.pairCreatedAt?.toISOString() ?? null };
  const key = `research.market.${tokenId}`;
  await tx.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  await tx.systemSetting.create({ data: { key: `research.marketMetric.${metric.id}`, value } });
  return metric;
}
