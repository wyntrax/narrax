import { describe, expect, it } from 'vitest';
import { DEFAULT_TIER_REQUIREMENTS, TokenMint, EarlyAccessClosesAt, EarlyAccessDays, POWERED_BY, TierRequirements, TokenSymbol } from './access-config';
import { earlyAccessAdmission, earlyAccessClosed } from './entitlements';

describe('tier requirements', () => {
  it('offers Member 500K and Pro 1M, without Elite', () => {
    expect(DEFAULT_TIER_REQUIREMENTS).toEqual({ MEMBER: 500_000, PRO: 1_000_000 });
    expect(TierRequirements.safeParse(DEFAULT_TIER_REQUIREMENTS).success).toBe(true);
  });
  it('requires each tier to ask for more than the one below, and only positive finite amounts', () => {
    expect(TierRequirements.safeParse({ MEMBER: 1, PRO: 1, ELITE: 2 }).success).toBe(false);
    expect(TierRequirements.safeParse({ MEMBER: 5, PRO: 3, ELITE: 9 }).success).toBe(false);
    expect(TierRequirements.safeParse({ MEMBER: 0, PRO: 3, ELITE: 9 }).success).toBe(false);
    expect(TierRequirements.safeParse({ MEMBER: -1, PRO: 3, ELITE: 9 }).success).toBe(false);
    expect(TierRequirements.safeParse({ MEMBER: 1, PRO: 3, ELITE: Infinity }).success).toBe(false);
    expect(TierRequirements.safeParse({ MEMBER: 1, PRO: 3, ELITE: 9, EARLY_ACCESS: 1 }).success).toBe(false);
    expect(TierRequirements.parse({ MEMBER: 1, PRO: 3 })).toEqual({ MEMBER: 1, PRO: 3 });
    expect(TierRequirements.parse({ MEMBER: 1, PRO: 3, ELITE: 9 })).toEqual({ MEMBER: 1, PRO: 3 });
  });
  it('accepts a plain ticker only', () => {
    expect(TokenSymbol.safeParse('$WYNTRAX').success).toBe(true);
    expect(TokenSymbol.safeParse('WYNTRAX').success).toBe(true);
    for (const bad of ['', '$', 'A B', '<b>x</b>', 'x'.repeat(17)]) expect(TokenSymbol.safeParse(bad).success).toBe(false);
  });
  it('allows clearing the time window and the seat length with null, and rejects nonsense', () => {
    expect(EarlyAccessClosesAt.safeParse(null).success).toBe(true);
    expect(EarlyAccessClosesAt.safeParse('2026-12-01T00:00:00.000Z').success).toBe(true);
    expect(EarlyAccessClosesAt.safeParse('tomorrow').success).toBe(false);
    expect(EarlyAccessDays.safeParse(null).success).toBe(true);
    expect(EarlyAccessDays.safeParse(30).success).toBe(true);
    for (const bad of [0, -3, 1.5, 4000]) expect(EarlyAccessDays.safeParse(bad).success).toBe(false);
  });
  it('takes a Solana mint address or null, nothing else', () => {
    expect(TokenMint.safeParse(null).success).toBe(true);
    expect(TokenMint.safeParse('So11111111111111111111111111111111111111112').success).toBe(true);
    for (const bad of ['', 'short', 'O'.repeat(40), 'a'.repeat(45), '0x' + 'a'.repeat(40)]) expect(TokenMint.safeParse(bad).success).toBe(false);
  });
  it('links to Wyntrax at a fixed address', () => {
    expect(POWERED_BY).toEqual({ name: 'Wyntrax', url: 'https://wyntrax.xyz' });
  });
});

describe('early-access time window', () => {
  const base = { enabled: true, cap: 10, occupied: 1, hasWallet: true, alreadySeated: false, inviteRequired: false };
  const now = new Date('2026-11-01T00:00:00Z');
  it('refuses new seats once the window has ended, including exactly at the closing time', () => {
    expect(earlyAccessAdmission({ ...base, now, closesAt: new Date('2026-10-31T23:59:59Z') })).toBe('EARLY_ACCESS_CLOSED');
    expect(earlyAccessAdmission({ ...base, now, closesAt: now })).toBe('EARLY_ACCESS_CLOSED');
  });
  it('admits before the window ends, with no end date, or when the caller gives no time (old callers)', () => {
    expect(earlyAccessAdmission({ ...base, now, closesAt: new Date('2026-11-02T00:00:00Z') })).toBeNull();
    expect(earlyAccessAdmission({ ...base, now, closesAt: null })).toBeNull();
    expect(earlyAccessAdmission({ ...base, closesAt: new Date('2020-01-01T00:00:00Z') })).toBeNull();
  });
  it('does not take an existing seat away when the window ends', () => {
    expect(earlyAccessAdmission({ ...base, alreadySeated: true, now, closesAt: new Date('2026-10-01T00:00:00Z') })).toBeNull();
  });
  it('still reports disabled before closed, and treats an invalid date as not closed', () => {
    expect(earlyAccessAdmission({ ...base, enabled: false, now, closesAt: new Date('2026-10-01T00:00:00Z') })).toBe('EARLY_ACCESS_DISABLED');
    expect(earlyAccessClosed(new Date('not a date'), now)).toBe(false);
  });
});
