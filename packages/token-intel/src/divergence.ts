export type DivergenceLabel = 'STRONG_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'NEGATIVE_SATURATED' | 'UNKNOWN';

export interface Divergence {
  label: DivergenceLabel;
  attentionGrowthPct: number | null;
  priceGrowthPct: number | null;
  /** Always a description of the gap, never a forecast. */
  interpretation: string;
}

/**
 * Compares how fast attention grows with how fast price moves over the same window.
 * It is a research signal. It does not predict price, and a gap can close in either direction.
 */
export function attentionPriceDivergence(attentionGrowthPct: number | null, priceGrowthPct: number | null): Divergence {
  const base = { attentionGrowthPct, priceGrowthPct };
  if (attentionGrowthPct == null || priceGrowthPct == null || !Number.isFinite(attentionGrowthPct) || !Number.isFinite(priceGrowthPct)) {
    return { ...base, label: 'UNKNOWN', interpretation: 'Not enough price or attention history to compare.' };
  }
  const a = attentionGrowthPct, p = priceGrowthPct;
  if (a >= 100 && p < 50 && p <= 0.25 * a) return { ...base, label: 'STRONG_POSITIVE', interpretation: 'Attention is growing much faster than price. This does not guarantee price gains.' };
  if (a >= 50 && p < 0.5 * a) return { ...base, label: 'POSITIVE', interpretation: 'Attention is growing faster than price. The gap can close without price following.' };
  if (p >= 200 && a <= 0.25 * p) return { ...base, label: 'NEGATIVE_SATURATED', interpretation: 'Price has run far ahead of attention. Late buyers may be exposed.' };
  if (a < 0 && p > 0) return { ...base, label: 'NEGATIVE', interpretation: 'Attention is falling while price rises.' };
  return { ...base, label: 'NEUTRAL', interpretation: 'Attention and price are moving roughly together.' };
}
