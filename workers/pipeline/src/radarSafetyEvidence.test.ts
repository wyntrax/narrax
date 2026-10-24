import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@narra/database';
import type { RugCheckReport } from '@narra/market-data';
import { makeRadarSafetySource, RADAR_SAFETY_EVIDENCE_PREFIX } from './radarSafetyEvidence';

const MINT = 'FRxQFfRZZpr6aXWsVAhYQ1n3rUPHD89QbNqQFmqNpump';
const OTHER = '7thgKgtK1rp1UtLpWUZEuu9vakedTMoZzuyps6RGpump';
const report = (over: Partial<RugCheckReport> = {}): RugCheckReport => ({
  mint: MINT, detectedAt: null, creator: 'creator', devHoldingPct: 3, top10ExLpPct: 25,
  lpLockedPct: 100, lpLocked: true, rugged: false, riskFlags: [], totalHolders: 500, ...over,
});
const fakeDb = () => {
  const rows = new Map<string, unknown>();
  const db = {
    systemSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => rows.has(where.key) ? { key: where.key, value: rows.get(where.key) } : null,
      upsert: async ({ where, create, update }: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
        rows.set(where.key, create.value ?? update.value);
        return { key: where.key, value: rows.get(where.key) };
      },
    },
  } as unknown as PrismaClient;
  return { db, rows };
};

describe('radar safety evidence source', () => {
  it('caches a report, returns it without another network call, and resets the budget between runs', async () => {
    let calls = 0;
    const source = makeRadarSafetySource(fakeDb().db, {
      enabled: true, maxPerRun: 1, cacheTtlMs: 60_000,
      source: { async getReport(mint) { calls++; return report({ mint }); } },
    })!;
    source.begin();
    expect(await source.get(MINT, new Date('2026-10-22T10:00:00Z'))).toMatchObject({ devHoldingPct: 3, top10ExLpPct: 25, lpLocked: true, source: 'rugcheck' });
    expect(await source.get(MINT, new Date('2026-10-22T10:01:00Z'))).toMatchObject({ top10ExLpPct: 25 });
    expect(await source.get(OTHER, new Date('2026-10-22T10:01:00Z'))).toBeNull();
    expect(calls).toBe(1);
    source.begin();
    expect(await source.get(OTHER, new Date('2026-10-22T10:02:00Z'))).toMatchObject({ top10ExLpPct: 25 });
    expect(calls).toBe(2);
  });

  it('refuses stale cached safety evidence and refetches it', async () => {
    const { db, rows } = fakeDb();
    rows.set(`${RADAR_SAFETY_EVIDENCE_PREFIX}${MINT}`, {
      mint: MINT, source: 'rugcheck', sourceAt: '2026-10-22T09:00:00Z', devHoldingPct: 99,
      top10ExLpPct: 99, lpBurnedPct: null, lpLocked: false, riskFlags: [],
    });
    let calls = 0;
    const source = makeRadarSafetySource(db, {
      enabled: true, maxPerRun: 1, cacheTtlMs: 60_000,
      source: { async getReport() { calls++; return report(); } },
    })!;
    source.begin();
    expect(await source.get(MINT, new Date('2026-10-22T10:00:00Z'))).toMatchObject({ devHoldingPct: 3, top10ExLpPct: 25, lpLocked: true });
    expect(calls).toBe(1);
  });

  it('returns null on failure or malformed cache instead of guessing', async () => {
    const { db, rows } = fakeDb();
    rows.set(`${RADAR_SAFETY_EVIDENCE_PREFIX}${MINT}`, { source: 'rugcheck', sourceAt: 'not-a-date' });
    let calls = 0;
    const source = makeRadarSafetySource(db, {
      enabled: true, maxPerRun: 1,
      source: { async getReport() { calls++; throw new Error('network down'); } },
    })!;
    source.begin();
    expect(await source.get(MINT, new Date('2026-10-22T10:00:00Z'))).toBeNull();
    expect(calls).toBe(1);
  });

  it('deduplicates concurrent requests and respects the network budget', async () => {
    let calls = 0;
    const source = makeRadarSafetySource(fakeDb().db, {
      enabled: true, maxPerRun: 1,
      source: { async getReport(mint) { calls++; return report({ mint }); } },
    })!;
    const results = await Promise.all([source.get(MINT), source.get(MINT), source.get(OTHER)]);
    expect(calls).toBe(1);
    expect(results[0]).toMatchObject({ mint: MINT });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toBeNull();
  });

  it('rejects mismatched reports without writing them to the cache', async () => {
    const { db, rows } = fakeDb();
    const source = makeRadarSafetySource(db, { enabled: true, source: { async getReport() { return report({ mint: OTHER }); } } })!;
    expect(await source.get(MINT)).toBeNull();
    expect(rows.size).toBe(0);
  });

  it.each(['future', 'wrong-mint', 'invalid-pct'])('rejects a %s cache entry', async kind => {
    const { db, rows } = fakeDb();
    const now = new Date('2026-10-22T10:00:00Z');
    rows.set(`${RADAR_SAFETY_EVIDENCE_PREFIX}${MINT}`, {
      mint: kind === 'wrong-mint' ? OTHER : MINT, source: 'rugcheck',
      sourceAt: new Date(+now + (kind === 'future' ? 60_000 : -60_000)).toISOString(),
      devHoldingPct: kind === 'invalid-pct' ? -1 : 0, top10ExLpPct: 10,
      lpBurnedPct: null, lpLocked: true, riskFlags: [],
    });
    const source = makeRadarSafetySource(db, { enabled: true, source: { async getReport() { return null; } } })!;
    expect(await source.get(MINT, now)).toBeNull();
  });

  it('can be disabled without constructing a network source', () => {
    expect(makeRadarSafetySource(fakeDb().db, { enabled: false })).toBeNull();
  });
});
