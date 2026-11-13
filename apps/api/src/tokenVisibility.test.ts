import { describe, expect, it } from 'vitest';
import { TOKEN_VISIBILITY, tokenMarketStatus, tokenVisibilityCutoff, visibleTokenWhere } from './tokenVisibility';

const now = new Date('2026-11-13T12:00:00Z');
const old = new Date(+now - TOKEN_VISIBILITY.noMarketAfterMs - 1);
const recent = new Date(+now - 60_000);

describe('token visibility', () => {
  it('keeps a token with too few completed dead-pool reads visible', () => {
    const where = visibleTokenWhere(now);
    expect(where.blacklisted).toBe(false);
    expect(where.OR).toContainEqual({ marketQuoteFailures: { lt: TOKEN_VISIBILITY.deadQuoteFailures } });
    expect(tokenMarketStatus({ marketQuoteFailures: 1, firstSeenAt: old }, null, now)).toBe('ACTIVE');
  });

  it('keeps a confirmed dead token visible while it has a fresh metric', () => {
    expect(tokenMarketStatus({ marketQuoteFailures: 14, firstSeenAt: old }, recent, now)).toBe('ACTIVE');
    expect(visibleTokenWhere(now).OR).toContainEqual({ metrics: { some: { at: { gte: tokenVisibilityCutoff(now), lte: now } } } });
  });

  it('keeps a newly seen token inside the grace window', () => {
    expect(tokenMarketStatus({ marketQuoteFailures: 14, firstSeenAt: recent }, null, now)).toBe('ACTIVE');
    expect(visibleTokenWhere(now).OR).toContainEqual({ firstSeenAt: { gte: tokenVisibilityCutoff(now) } });
  });

  it('marks a confirmed dead token with an old or missing metric as no-market', () => {
    expect(tokenMarketStatus({ marketQuoteFailures: 2, firstSeenAt: old }, old, now)).toBe('NO_MARKET');
    expect(tokenMarketStatus({ marketQuoteFailures: 2, firstSeenAt: old }, null, now)).toBe('NO_MARKET');
  });

  it('does not let a future metric keep a token visible', () => {
    const future = new Date(+now + 60_000);
    expect(tokenMarketStatus({ marketQuoteFailures: 2, firstSeenAt: old }, future, now)).toBe('NO_MARKET');
  });
});
