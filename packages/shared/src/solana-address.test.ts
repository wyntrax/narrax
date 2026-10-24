import { describe, expect, it } from 'vitest';
import { isSolanaAddress } from './solana-address';

describe('isSolanaAddress', () => {
  it('accepts real 32-byte keys', () => {
    for (const a of ['So11111111111111111111111111111111111111112', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', '11111111111111111111111111111111']) expect(isSolanaAddress(a)).toBe(true);
  });
  it('rejects strings that only look like addresses', () => {
    const fake = `wa1700000000000A`.padEnd(40, '1'); // the shape tests use: valid characters, wrong decoded length
    for (const a of ['', 'short', fake, '1'.repeat(44), 'x'.repeat(44), `0OIl${'1'.repeat(36)}`, 'So1111111111111111111111111111111111111111121']) expect(isSolanaAddress(a), a).toBe(false);
  });
  it('is not fooled by non-strings', () => {
    expect(isSolanaAddress(undefined as unknown as string)).toBe(false);
    expect(isSolanaAddress(null as unknown as string)).toBe(false);
  });
});
