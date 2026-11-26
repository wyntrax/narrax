import { describe, expect, it } from 'vitest';
import { TradeEvidenceJobSchema, tradeEvidenceJobId } from './tradeEvidence';

const VALID_MINT = 'So11111111111111111111111111111111111111112';

describe('tradeEvidence queue schema and dedupe', () => {
  it('accepts a valid Solana mint and rejects invalid or extra fields', () => {
    expect(TradeEvidenceJobSchema.parse({ mint: VALID_MINT })).toEqual({ mint: VALID_MINT });
    expect(() => TradeEvidenceJobSchema.parse({ mint: 'not-a-mint' })).toThrow();
    expect(() => TradeEvidenceJobSchema.parse({ mint: VALID_MINT, extra: true })).toThrow();
  });

  it('deduplicates jobIds within the same 60-second bucket without colons', () => {
    const a = tradeEvidenceJobId(VALID_MINT, 1_700_000_040_000);
    const b = tradeEvidenceJobId(VALID_MINT, 1_700_000_099_999);
    const c = tradeEvidenceJobId(VALID_MINT, 1_700_000_100_000);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain(':');
  });
});
