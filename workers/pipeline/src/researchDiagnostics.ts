import { z } from 'zod';
import type { PrismaClient } from '@narra/database';

export const SOCIAL_INFO_PRIORITY_KEY = 'research.coverage.socialPriority';
export const SOCIAL_INFO_CURSOR_KEY = 'market.socialInfoCursor';
export const RESEARCH_DIAGNOSTICS_PREFIX = 'research.coverage.run.';
export const COVERAGE_LIMITS = { maxCandidates: 200, priorityMaxAgeMs: 60 * 60_000, maxSocialPriceSlots: 12, maxSocialInfoSlots: 6, retentionDays: 8 } as const;
const Priority = z.object({ at: z.string().datetime(), tokenIds: z.array(z.string().min(1)).max(COVERAGE_LIMITS.maxCandidates) });
export const Diagnostic = z.object({ at: z.string().datetime(), runs: z.number().int().nonnegative(), counters: z.record(z.number().finite().nonnegative()) });
export type ResearchStage = 'market' | 'social' | 'narrative';

/** Scheduling hints only, never admission or publication evidence. Replace even on an empty successful scan. */
export async function saveSocialPriority(db: PrismaClient, tokenIds: string[], at: Date) {
  const value = { at: at.toISOString(), tokenIds: [...new Set(tokenIds)].slice(0, COVERAGE_LIMITS.maxCandidates) };
  await db.systemSetting.upsert({ where: { key: SOCIAL_INFO_PRIORITY_KEY }, create: { key: SOCIAL_INFO_PRIORITY_KEY, value }, update: { value } });
}
export async function readSocialPriority(db: PrismaClient, now: Date): Promise<string[]> {
  const row = await db.systemSetting.findUnique({ where: { key: SOCIAL_INFO_PRIORITY_KEY } });
  const parsed = Priority.safeParse(row?.value);
  if (!parsed.success || Date.parse(parsed.data.at) > +now || +now - Date.parse(parsed.data.at) > COVERAGE_LIMITS.priorityMaxAgeMs) return [];
  return [...new Set(parsed.data.tokenIds)];
}

/** Counts successful scan attempts, not unique tokens or missed calls. No errors/provider bodies are stored. */
export async function saveResearchDiagnostics(db: PrismaClient, stage: ResearchStage, at: Date, summary: object) {
  const counters: Record<string, number> = {};
  for (const [key, value] of Object.entries(summary)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && key !== 'solUsd') counters[key] = value;
    if (key === 'errors' && Array.isArray(value)) counters.errors = value.length;
    if (key === 'evidenceSkipped' && value && typeof value === 'object') for (const [reason, count] of Object.entries(value)) {
      if (typeof count === 'number' && Number.isFinite(count) && count >= 0) counters[`evidence.${reason}`] = count;
    }
  }
  const latestKey = `${RESEARCH_DIAGNOSTICS_PREFIX}${stage}.latest`;
  const dayKey = `${RESEARCH_DIAGNOSTICS_PREFIX}${stage}.day.${at.toISOString().slice(0, 10)}`;
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${RESEARCH_DIAGNOSTICS_PREFIX + stage}))`;
    const old = Diagnostic.safeParse((await tx.systemSetting.findUnique({ where: { key: dayKey } }))?.value);
    const sums = { ...(old.success ? old.data.counters : {}) };
    for (const [key, count] of Object.entries(counters)) sums[key] = (sums[key] ?? 0) + count;
    const daily = { at: old.success && old.data.at > at.toISOString() ? old.data.at : at.toISOString(), runs: (old.success ? old.data.runs : 0) + 1, counters: sums };
    await tx.systemSetting.upsert({ where: { key: dayKey }, create: { key: dayKey, value: daily }, update: { value: daily } });
    const latest = Diagnostic.safeParse((await tx.systemSetting.findUnique({ where: { key: latestKey } }))?.value);
    if (!latest.success || Date.parse(latest.data.at) <= +at) {
      const value = { at: at.toISOString(), runs: 1, counters };
      await tx.systemSetting.upsert({ where: { key: latestKey }, create: { key: latestKey, value }, update: { value } });
    }
    const cutoff = new Date(+at - (COVERAGE_LIMITS.retentionDays - 1) * 86_400_000).toISOString().slice(0, 10);
    await tx.systemSetting.deleteMany({ where: { key: { startsWith: `${RESEARCH_DIAGNOSTICS_PREFIX}${stage}.day.`, lt: `${RESEARCH_DIAGNOSTICS_PREFIX}${stage}.day.${cutoff}` } } });
  });
}

export async function readResearchDiagnostics(db: PrismaClient, now: Date) {
  const stages: ResearchStage[] = ['market', 'social', 'narrative'];
  const day = now.toISOString().slice(0, 10);
  const keys = stages.flatMap(stage => [`${RESEARCH_DIAGNOSTICS_PREFIX}${stage}.latest`, `${RESEARCH_DIAGNOSTICS_PREFIX}${stage}.day.${day}`]);
  const rows = await db.systemSetting.findMany({ where: { key: { in: keys } } });
  const parse = (key: string) => {
    const result = Diagnostic.safeParse(rows.find(r => r.key === key)?.value);
    return result.success && Date.parse(result.data.at) <= +now ? result.data : null;
  };
  return stages.map(stage => {
    const latest = parse(`${RESEARCH_DIAGNOSTICS_PREFIX}${stage}.latest`);
    return { stage, latest, stale: !latest || +now - Date.parse(latest.at) > (stage === 'market' ? 15 : 30) * 60_000, today: parse(`${RESEARCH_DIAGNOSTICS_PREFIX}${stage}.day.${day}`) };
  });
}
