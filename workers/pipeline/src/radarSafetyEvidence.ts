import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import { isSolanaAddress } from '@narra/shared';
import { RugCheckSource, type RugCheckReport } from '@narra/market-data';
import { radarSafetyModeFromEnv, RADAR_SAFETY_SOURCE_MAX_AGE_MS } from '@narra/token-intel';

export const RADAR_SAFETY_EVIDENCE_PREFIX = 'research.radarSafetyEvidence.';
export const RADAR_SAFETY_EVIDENCE_TTL_MS = RADAR_SAFETY_SOURCE_MAX_AGE_MS;
export const RADAR_SAFETY_EVIDENCE_MAX_PER_RUN = 3;

/** Only fields that map directly to the safety gate. Every other RugCheck field is deliberately discarded. */
export interface RadarSafetyEvidence {
  mint: string;
  source: 'rugcheck';
  sourceAt: string;
  devHoldingPct: number | null;
  top10ExLpPct: number | null;
  lpBurnedPct: number | null;
  lpLocked: boolean | null;
  riskFlags: string[];
}

export interface RadarSafetySource {
  /** Reset the per-run request budget. Call once at the start of each resolution/social scan. */
  begin(): void;
  get(mint: string, now?: Date): Promise<RadarSafetyEvidence | null>;
}

interface RugCheckLike { getReport(mint: string): Promise<RugCheckReport | null> }

export interface RadarSafetySourceOptions {
  source?: RugCheckLike;
  fetch?: typeof fetch;
  baseUrl?: string;
  enabled?: boolean;
  maxPerRun?: number;
  cacheTtlMs?: number;
}

const Cache = z.object({
  mint: z.string(),
  source: z.literal('rugcheck'),
  sourceAt: z.string().datetime(),
  devHoldingPct: z.number().finite().min(0).max(100).nullable(),
  top10ExLpPct: z.number().finite().min(0).max(100).nullable(),
  lpBurnedPct: z.number().finite().min(0).max(100).nullable(),
  lpLocked: z.boolean().nullable(),
  riskFlags: z.array(z.string().min(1).max(80)).max(20),
});
const cacheKey = (mint: string): string => `${RADAR_SAFETY_EVIDENCE_PREFIX}${mint}`;
const valid = (at: string, now: Date, ttlMs: number): boolean => {
  const ms = +new Date(at);
  return Number.isFinite(ms) && ms <= +now && +now - ms <= ttlMs;
};

/**
 * Bounded, cached safety enrichment for the radar. It calls RugCheck only for candidates that already passed the
 * early-lane screen, never for every covered token. A failed, malformed, stale or over-budget lookup returns null,
 * which the gate renders as UNKNOWN; it never fills a missing field with a safe value.
 */
export function makeRadarSafetySource(db: PrismaClient, opts: RadarSafetySourceOptions = {}): RadarSafetySource | null {
  const enabled = opts.enabled ?? (process.env.RADAR_SAFETY_EVIDENCE?.trim().toLowerCase() !== 'off');
  if (!enabled || radarSafetyModeFromEnv() === 'off') return null;
  const source: RugCheckLike = opts.source ?? new RugCheckSource({
    baseUrl: opts.baseUrl ?? process.env.RUGCHECK_BASE_URL,
    fetch: opts.fetch,
  });
  const configured = Number(opts.maxPerRun ?? process.env.RADAR_SAFETY_EVIDENCE_MAX_PER_RUN ?? RADAR_SAFETY_EVIDENCE_MAX_PER_RUN);
  const maxPerRun = Number.isInteger(configured) && configured >= 1 && configured <= 10 ? configured : RADAR_SAFETY_EVIDENCE_MAX_PER_RUN;
  const cacheTtlMs = opts.cacheTtlMs ?? RADAR_SAFETY_EVIDENCE_TTL_MS;
  let used = 0;
  const inflight = new Map<string, Promise<RadarSafetyEvidence | null>>();

  const readCache = async (mint: string, now: Date): Promise<RadarSafetyEvidence | null> => {
    const row = await db.systemSetting.findUnique({ where: { key: cacheKey(mint) } });
    const parsed = Cache.safeParse(row?.value);
    if (!parsed.success || parsed.data.mint !== mint || !valid(parsed.data.sourceAt, now, cacheTtlMs)) return null;
    return parsed.data;
  };
  const fetchOne = async (mint: string, at?: Date): Promise<RadarSafetyEvidence | null> => {
    let report: RugCheckReport | null;
    try {
      report = await source.getReport(mint);
    } catch {
      return null;
    }
    if (!report || report.mint !== mint) return null;
    const value: RadarSafetyEvidence = {
      mint,
      source: 'rugcheck',
      sourceAt: (at ?? new Date()).toISOString(),
      devHoldingPct: report.devHoldingPct,
      top10ExLpPct: report.top10ExLpPct,
      lpBurnedPct: null,
      lpLocked: report.lpLocked,
      riskFlags: report.riskFlags,
    };
    if (!Cache.safeParse(value).success) return null;
    await db.systemSetting.upsert({ where: { key: cacheKey(mint) }, create: { key: cacheKey(mint), value: value as unknown as Prisma.InputJsonValue }, update: { value: value as unknown as Prisma.InputJsonValue } });
    return value;
  };

  return {
    begin() {
      used = 0;
      inflight.clear();
    },
    async get(mint, at) {
      if (!isSolanaAddress(mint)) return null;
      const pending = inflight.get(mint);
      if (pending) return pending;
      // Register before the first await so concurrent callers share the same cache lookup and request.
      const p = (async () => {
        const cached = await readCache(mint, at ?? new Date());
        if (cached) return cached;
        if (used >= maxPerRun) return null;
        used++;
        return fetchOne(mint, at);
      })().catch(() => null);
      inflight.set(mint, p);
      try { return await p; } finally { if (inflight.get(mint) === p) inflight.delete(mint); }
    },
  };
}
