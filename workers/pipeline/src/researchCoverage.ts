import { z } from 'zod';
import { SNAPSHOT_OMISSION_REASONS } from '@narra/market-data';
import type { Prisma, PrismaClient } from '@narra/database';
import { readResearchDiagnostics, readSocialPriority } from './researchDiagnostics';

const SCAN_LIMIT = 2000;
const Evidence = z.object({ metricId: z.string(), source: z.literal('dexscreener'), at: z.string().datetime() });
const classify = (at: Date | undefined, now: Date, maxAgeMs: number) => !at ? 'missing' : +at > +now ? 'future' : +now - +at > maxAgeMs ? 'stale' : 'fresh';
const empty = () => ({ fresh: 0, stale: 0, missing: 0, future: 0 });
const emptyCoverage = () => ({ scanned: 0, price: { ...empty(), unverified: 0 }, holders: empty(), risk: empty(), freshPriceAndHolders: 0 });

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
  const coverage = emptyCoverage();
  // Disjoint groups within the scanned sample. A historical narrative link is not current candidate qualification.
  const cohorts = { recentSocial: emptyCoverage(), narrativeOnly: emptyCoverage() };
  const socialSet = new Set(socialIds);
  for (const token of tokens) {
    const m = token.metrics[0];
    const h = classify(token.holders[0]?.at, now, 60 * 60_000);
    const src = Evidence.safeParse(m && sources.get(`research.marketMetric.${m.id}`));
    const verified = m && src.success && src.data.metricId === m.id && Date.parse(src.data.at) === +m.at && Number.isFinite(Number(m.priceUsd)) && Number(m.priceUsd) > 0;
    const state = !m ? 'missing' : !verified ? 'unverified' : classify(m.at, now, 15 * 60_000);
    for (const group of [coverage, socialSet.has(token.id) ? cohorts.recentSocial : cohorts.narrativeOnly]) {
      group.scanned++;
      group.price[state]++;
      group.holders[h]++;
      group.risk[classify(token.risk[0]?.at, now, 60 * 60_000)]++;
      if (state === 'fresh' && h === 'fresh') group.freshPriceAndHolders++;
    }
  }
  const since = new Date(+now - 86_400_000);
  const [published24h, unknownEntry24h, measurements] = await Promise.all([
    db.earlyRadarOutcome.count({ where: { alertedAt: { gte: since, lte: now } } }),
    db.earlyRadarOutcome.count({ where: { alertedAt: { gte: since, lte: now }, entryUnknownReason: { not: null } } }),
    db.earlyRadarMeasurement.groupBy({ by: ['status'], where: { outcome: { alertedAt: { gte: since, lte: now } } }, _count: { _all: true } }),
  ]);
  return { checkedAt: now.toISOString(), scope: 'ACTIVE_NARRATIVE_OR_RECENT_SOCIAL' as const, ...coverage, total, capped: total > tokens.length,
    socialPriorityCount: socialIds.length, cohorts, stages,
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
  lines.push('', '### Coverage by group (disjoint scanned sample)', '',
    '| Group | Scanned | Fresh price | Stale price | Missing price | Unverified price | Future price | Fresh price + holders |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [name, group] of Object.entries(report.cohorts)) lines.push(`| ${name} | ${group.scanned} | ${group.price.fresh} | ${group.price.stale} | ${group.price.missing} | ${group.price.unverified} | ${group.price.future} | ${group.freshPriceAndHolders} |`);
  lines.push('', 'Recent social is the unexpired collector handoff; narrative-only means an active narrative link outside that handoff, not proof of current qualification. Holder/risk freshness measures row age, not completeness or safety. Capped samples are not population estimates.');
  const market = report.stages.find(s => s.stage === 'market');
  const counters = market?.latest?.counters;
  lines.push('', '### Latest market price requests', '');
  if (!counters?.['priceCoverage.runs']) lines.push('UNKNOWN: the latest market run has no per-group request telemetry. Older runs are not backfilled.');
  else {
    lines.push(`Run: ${market?.latest?.at} (${market?.stale ? 'STALE' : 'recent'}). Excludes the separate SOL reference-price request.`, '',
      '| Selection group | Selected | Written | No usable snapshot | Request failed | Not requested |',
      '| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const lane of ['outcomes', 'discovery', 'social', 'launches', 'unpriced', 'general']) lines.push(`| ${lane} | ${['selected', 'written', 'unavailable', 'failed', 'notRequested'].map(field => counters[`price.${lane}.${field}`] ?? 'UNKNOWN').join(' | ')} |`);
    lines.push('', `Instrumented UTC-day runs: ${market?.today?.counters['priceCoverage.runs'] ?? 'UNKNOWN'} / ${market?.today?.runs ?? 'UNKNOWN'} recorded runs. Partial instrumentation is not full-day coverage. No usable snapshot means a completed request returned none; it does not establish why the provider omitted it.`);
    lines.push('', '### Latest omission reasons', '');
    if (!counters['priceOmissions.runs']) lines.push('UNKNOWN: this run predates omission-reason instrumentation.');
    else {
      const reasons = Object.entries(counters).filter(([key, count]) => key.startsWith('omission.') && count > 0 && SNAPSHOT_OMISSION_REASONS.some(reason => key.endsWith(`.${reason}`)));
      for (const [key, count] of reasons) lines.push(`- ${key.slice('omission.'.length)}: ${count}`);
      if (!reasons.length) lines.push('No omitted snapshots recorded in this run.');
      lines.push('', `Reason-instrumented UTC-day runs: ${market?.today?.counters['priceOmissions.runs'] ?? 'UNKNOWN'} / ${market?.today?.runs ?? 'UNKNOWN'}. One first blocking reason per omitted token attempt, not every missing field or proof a token does not trade. NO_MATCHING_PAIR means no validated Solana base-token pair matched; UNSPECIFIED means the source supplied no reason. Failed/unrequested batches have no omission reason.`);
    }
  }
  return lines.join('\n');
}
