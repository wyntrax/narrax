import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import { readResearchDiagnostics, readSocialPriority } from './researchDiagnostics';

const SCAN_LIMIT = 2000;
const Evidence = z.object({ metricId: z.string(), source: z.literal('dexscreener'), at: z.string().datetime() });
const classify = (at: Date | undefined, now: Date, maxAgeMs: number) => !at ? 'missing' : +at > +now ? 'future' : +now - +at > maxAgeMs ? 'stale' : 'fresh';
const empty = () => ({ fresh: 0, stale: 0, missing: 0, future: 0 });

/** Current bounded coverage, not a reconstructed historical cohort. All timestamps use the supplied JS UTC time. */
export async function researchCoverage(db: PrismaClient, now: Date = new Date()) {
  const socialIds = await readSocialPriority(db, now);
  const where: Prisma.TokenWhereInput = { blacklisted: false, OR: [{ narratives: { some: { narrative: { stage: { not: 'DEAD' } } } } }, { id: { in: socialIds } }] };
  const [total, tokens, stages] = await Promise.all([
    db.token.count({ where }),
    db.token.findMany({ where, take: SCAN_LIMIT, orderBy: { id: 'asc' }, select: {
      id: true,
      metrics: { orderBy: [{ at: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, at: true, priceUsd: true } },
      holders: { orderBy: { at: 'desc' }, take: 1, select: { at: true } },
      risk: { orderBy: { at: 'desc' }, take: 1, select: { at: true } },
    } }),
    readResearchDiagnostics(db, now),
  ]);
  const evidence = await db.systemSetting.findMany({ where: { key: { in: tokens.flatMap(t => t.metrics.map(m => `research.marketMetric.${m.id}`)) } } });
  const sources = new Map(evidence.map(row => [row.key, row.value]));
  const price = { ...empty(), unverified: 0 }, holders = empty(), risk = empty();
  let freshPriceAndHolders = 0;
  for (const token of tokens) {
    const m = token.metrics[0];
    const h = classify(token.holders[0]?.at, now, 60 * 60_000);
    holders[h]++;
    risk[classify(token.risk[0]?.at, now, 60 * 60_000)]++;
    if (!m) { price.missing++; continue; }
    const src = Evidence.safeParse(sources.get(`research.marketMetric.${m.id}`));
    if (!src.success || src.data.metricId !== m.id || Date.parse(src.data.at) !== +m.at || !(Number(m.priceUsd) > 0)) { price.unverified++; continue; }
    const state = classify(m.at, now, 15 * 60_000);
    price[state]++;
    if (state === 'fresh' && h === 'fresh') freshPriceAndHolders++;
  }
  const since = new Date(+now - 86_400_000);
  const [published24h, unknownEntry24h, measurements] = await Promise.all([
    db.earlyRadarOutcome.count({ where: { alertedAt: { gte: since, lte: now } } }),
    db.earlyRadarOutcome.count({ where: { alertedAt: { gte: since, lte: now }, entryUnknownReason: { not: null } } }),
    db.earlyRadarMeasurement.groupBy({ by: ['status'], where: { outcome: { alertedAt: { gte: since, lte: now } } }, _count: { _all: true } }),
  ]);
  return { checkedAt: now.toISOString(), scope: 'ACTIVE_NARRATIVE_OR_RECENT_SOCIAL' as const, scanned: tokens.length, total, capped: total > tokens.length,
    socialPriorityCount: socialIds.length, price, holders, risk, freshPriceAndHolders, stages,
    calls: { published24h, unknownEntry24h, measurements: Object.fromEntries(measurements.map(m => [m.status, m._count._all])) },
  };
}

export function renderResearchCoverage(report: Awaited<ReturnType<typeof researchCoverage>>) {
  const lines = ['## Collection quality (current snapshot)', '',
    `Checked: ${report.checkedAt}. Active narrative links or recent social handoff: ${report.scanned}/${report.total}${report.capped ? ' (CAPPED)' : ''}.`,
    `Source-backed fresh prices: ${report.price.fresh}; missing: ${report.price.missing}; stale: ${report.price.stale}; future: ${report.price.future}; unverified: ${report.price.unverified}.`,
    `Holders: ${report.holders.fresh} fresh, ${report.holders.missing} missing, ${report.holders.stale} stale, ${report.holders.future} future. Fresh price + holders: ${report.freshPriceAndHolders}.`,
    `Risk: ${report.risk.fresh} fresh, ${report.risk.missing} missing, ${report.risk.stale} stale, ${report.risk.future} future. Freshness is not a safety verdict.`,
    `Published calls in trailing 24h: ${report.calls.published24h}; unknown frozen entry: ${report.calls.unknownEntry24h}; horizon states: ${JSON.stringify(report.calls.measurements)}.`, '',
    'Counters are repeated scan attempts, not unique tokens or missed calls. Daily totals cover recorded successful runs today (UTC), possibly a partial day. No telemetry means UNKNOWN. This snapshot is not historical attribution or proof of edge.', ''];
  for (const stage of report.stages) lines.push(`- ${stage.stage}: ${stage.stale ? 'STALE / UNKNOWN' : 'recent'}; last ${stage.latest?.at ?? 'unknown'}; UTC-day runs ${stage.today?.runs ?? 'unknown'}; counters ${stage.today ? JSON.stringify(stage.today.counters) : 'unknown'}`);
  return lines.join('\n');
}
