import { describe, expect, it } from 'vitest';
import { AppearanceBody, DEFAULT_NOTIFICATION_PREFS, InterestsBody, NotificationPrefsBody, ProfileBody, shouldDeliverGlobalAlert } from './alerts';

describe('shouldDeliverGlobalAlert', () => {
  const prefs = (minPriority: 'INFO' | 'WATCH' | 'IMPORTANT' | 'CRITICAL', mutedKinds: string[] = []) => ({ minPriority, mutedKinds });
  it('applies the default threshold: INFO is held back, WATCH and above are delivered', () => {
    expect(shouldDeliverGlobalAlert(DEFAULT_NOTIFICATION_PREFS, { kind: 'X', priority: 'INFO' })).toBe(false);
    expect(shouldDeliverGlobalAlert(DEFAULT_NOTIFICATION_PREFS, { kind: 'X', priority: 'WATCH' })).toBe(true);
    expect(shouldDeliverGlobalAlert(DEFAULT_NOTIFICATION_PREFS, { kind: 'X', priority: 'IMPORTANT' })).toBe(true);
  });
  it('respects a higher or lower threshold', () => {
    expect(shouldDeliverGlobalAlert(prefs('INFO'), { kind: 'X', priority: 'INFO' })).toBe(true);
    expect(shouldDeliverGlobalAlert(prefs('IMPORTANT'), { kind: 'X', priority: 'WATCH' })).toBe(false);
    expect(shouldDeliverGlobalAlert(prefs('IMPORTANT'), { kind: 'X', priority: 'IMPORTANT' })).toBe(true);
  });
  it('mutes a kind, but never a CRITICAL alert, even with the kind muted and the threshold at the top', () => {
    expect(shouldDeliverGlobalAlert(prefs('INFO', ['AI_BUY']), { kind: 'AI_BUY', priority: 'IMPORTANT' })).toBe(false);
    expect(shouldDeliverGlobalAlert(prefs('INFO', ['AI_BUY']), { kind: 'OTHER', priority: 'IMPORTANT' })).toBe(true);
    expect(shouldDeliverGlobalAlert(prefs('CRITICAL', ['AI_BUY']), { kind: 'AI_BUY', priority: 'CRITICAL' })).toBe(true);
  });
});

describe('settings bodies', () => {
  it('rejects unknown fields and malformed kinds, and de-duplicates muted kinds', () => {
    expect(NotificationPrefsBody.safeParse({ minPriority: 'WATCH', mutedKinds: [], extra: 1 }).success).toBe(false);
    expect(NotificationPrefsBody.safeParse({ minPriority: 'LOUD', mutedKinds: [] }).success).toBe(false);
    expect(NotificationPrefsBody.safeParse({ minPriority: 'WATCH', mutedKinds: ['bad kind'] }).success).toBe(false);
    expect(NotificationPrefsBody.parse({ minPriority: 'WATCH', mutedKinds: ['AI_BUY', 'AI_BUY'] }).mutedKinds).toEqual(['AI_BUY']);
  });
  it('sanitizes the display name and validates the time zone', () => {
    expect(ProfileBody.parse({ displayName: '  Ada\u202E   Lovelace\u0000 ' }).displayName).toBe('Ada Lovelace');
    expect(ProfileBody.safeParse({ timezone: 'Not/AZone' }).success).toBe(false);
    expect(ProfileBody.parse({ timezone: 'Asia/Jakarta' }).timezone).toBe('Asia/Jakarta');
    expect(ProfileBody.safeParse({}).success).toBe(false);
  });
  it('validates appearance', () => {
    expect(AppearanceBody.safeParse({ theme: 'NEON' }).success).toBe(false);
    expect(AppearanceBody.safeParse({}).success).toBe(false);
    expect(AppearanceBody.parse({ theme: 'DARK', reducedMotion: true })).toEqual({ theme: 'DARK', reducedMotion: true });
  });
  it('normalizes interests and caps the count', () => {
    expect(InterestsBody.parse({ interests: [' AI Agents ', 'ai agents', 'Memecoins', '   '] }).interests).toEqual(['ai agents', 'memecoins']);
    expect(InterestsBody.safeParse({ interests: Array.from({ length: 21 }, (_, i) => `topic ${i}`) }).success).toBe(false);
  });
});
