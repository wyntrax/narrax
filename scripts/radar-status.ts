import { parseArgs } from 'node:util';
import { createPrisma } from '@narra/database';
import { RADAR_SAFETY_BLOCKED_SETTING_PREFIX, RADAR_SAFETY_SETTING_PREFIX } from '@narra/token-intel';
import { radarWarnings, summarizeRadarSafety } from './radar-status-core';
import { researchCoverage, renderResearchCoverage } from '@narra/worker-pipeline';

const usage = `Early Radar liveness check.

  npm run radar:status -- [options]

Options:
  --now <ISO>                 Measurement time (default: now)
  --max-call-age-min <n>      Fail when the newest radar call is older than this (default: 120)
  --max-price-age-min <n>     Fail when the newest market price is older than this (default: 15)
  --json                      Print JSON

Exit codes: 0 = fresh, 2 = stale, 1 = configuration or query error.
Read-only. It never creates a call, alert, order or position.`;

const date = (name: string, raw: string | undefined, fallback: Date): Date => {
  if (!raw) return fallback;
  const d = new Date(raw);
  if (!Number.isFinite(+d)) throw new Error(`${name} must be an ISO date`);
  return d;
};
const num = (name: string, raw: string | undefined, fallback: number): number => {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
};
const ageMs = (from: Date | null, now: Date): number | null => (from ? Math.max(0, now.getTime() - from.getTime()) : null);
const ageLabel = (ms: number | null): string => {
  if (ms == null) return 'never';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h ago`;
  return `${(ms / 86_400_000).toFixed(1)}d ago`;
};
const count = (rows: Array<{ n: number }>) => Number(rows[0]?.n ?? 0);

async function main() {
  const { values } = parseArgs({
    options: {
      now: { type: 'string' },
      'max-call-age-min': { type: 'string' },
      'max-price-age-min': { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const now = date('--now', values.now, new Date());
  const maxCallAgeMin = num('--max-call-age-min', values['max-call-age-min'], 120);
  const maxPriceAgeMin = num('--max-price-age-min', values['max-price-age-min'], 15);
  const freshSince = new Date(+now - 15 * 60_000);
  const callSince24h = new Date(+now - 24 * 3_600_000);
  const callSince7d = new Date(+now - 7 * 86_400_000);
  const youngSince = new Date(+now - 7 * 86_400_000);

  const db = createPrisma();
  try {
    const [lastCall, lastPrice, lastNarrative, calls24h, calls7d, outcomes7d, callsWithoutEntry24h, recentRadarAlerts] = await Promise.all([
      db.alert.findFirst({
        where: { kind: { in: ['EARLY_RADAR_TRENCHER', 'EARLY_RADAR_HOLDER'] } },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true, kind: true, title: true, refId: true,
          earlyRadarOutcome: { select: { entryAt: true, entryPriceUsd: true, entryUnknownReason: true } },
        },
      }),
      db.tokenMetric.findFirst({ orderBy: { at: 'desc' }, select: { at: true } }),
      db.narrative.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      db.alert.count({ where: { kind: { in: ['EARLY_RADAR_TRENCHER', 'EARLY_RADAR_HOLDER'] }, createdAt: { gte: callSince24h } } }),
      db.alert.count({ where: { kind: { in: ['EARLY_RADAR_TRENCHER', 'EARLY_RADAR_HOLDER'] }, createdAt: { gte: callSince7d } } }),
      db.earlyRadarOutcome.groupBy({ by: ['tokenId'], where: { alertedAt: { gte: callSince7d } } }),
      // The gate prevents new calls without fresh evidence. This keeps a regression visible:
      // a call exists, but its frozen entry cannot be measured honestly.
      db.earlyRadarOutcome.count({ where: { alertedAt: { gte: callSince24h }, entryUnknownReason: { not: null } } }),
      db.alert.findMany({
        where: { kind: { in: ['EARLY_RADAR_TRENCHER', 'EARLY_RADAR_HOLDER'] }, createdAt: { gte: callSince7d } },
        orderBy: { createdAt: 'desc' }, take: 500, select: { id: true },
      }),
    ]);

    const [freshRows, linkedFreshRows, youngFreshRows, linkedUnpricedRows, linkedUnpricedConfirmedRows] = await Promise.all([
      db.$queryRaw<Array<{ n: number }>>`
        select count(distinct m."tokenId")::int as n
          from "TokenMetric" m
         where m.at >= ${freshSince} and m."marketCapUsd" < 100000`,
      db.$queryRaw<Array<{ n: number }>>`
        select count(distinct m."tokenId")::int as n
          from "TokenMetric" m
          join "NarrativeTokenRelation" r on r."tokenId" = m."tokenId"
          join "Narrative" n on n.id = r."narrativeId"
         where m.at >= ${freshSince} and m."marketCapUsd" < 100000 and n.stage <> 'DEAD'`,
      db.$queryRaw<Array<{ n: number }>>`
        select count(distinct m."tokenId")::int as n
          from "TokenMetric" m
          join "Token" t on t.id = m."tokenId"
         where m.at >= ${freshSince} and m."marketCapUsd" < 100000 and t."createdOnChainAt" >= ${youngSince}`,
      db.$queryRaw<Array<{ n: number }>>`
        select count(distinct r."tokenId")::int as n
          from "NarrativeTokenRelation" r
          join "Narrative" n on n.id = r."narrativeId"
         where n.stage <> 'DEAD'
           and not exists (select 1 from "TokenMetric" m where m."tokenId" = r."tokenId")`,
      db.$queryRaw<Array<{ n: number }>>`
        select count(distinct r."tokenId")::int as n
          from "NarrativeTokenRelation" r
          join "Narrative" n on n.id = r."narrativeId"
          join "Token" t on t.id = r."tokenId"
         where n.stage <> 'DEAD'
           and t."createdOnChainAt" is not null
           and not exists (select 1 from "TokenMetric" m where m."tokenId" = r."tokenId")`,
    ]);
    const freshUnder100k = count(freshRows);
    const linkedFreshUnder100k = count(linkedFreshRows);
    const youngFreshUnder100k = count(youngFreshRows);
    const linkedUnpriced = count(linkedUnpricedRows);
    const linkedUnpricedConfirmed = count(linkedUnpricedConfirmedRows);

    const callAge = ageMs(lastCall?.createdAt ?? null, now);
    const priceAge = ageMs(lastPrice?.at ?? null, now);
    const narrativeAge = ageMs(lastNarrative?.updatedAt ?? null, now);
    const entry = lastCall?.earlyRadarOutcome ?? null;
    const stale: string[] = [];
    if (callAge == null || callAge > maxCallAgeMin * 60_000) stale.push('RADAR_STALE');
    if (priceAge == null || priceAge > maxPriceAgeMin * 60_000) stale.push('PRICE_STALE');
    const warnings = radarWarnings({
      calls24h,
      callsWithoutFreshEntry24h: callsWithoutEntry24h,
      freshUnder100k,
      linkedFreshUnder100k,
      linkedUnpricedConfirmed,
      narrativeAgeMs: narrativeAge,
    });

    const status = stale.length ? stale.join('+') : 'OK';
    const collection = await researchCoverage(db, now);
    const [safetyRows, blockedDecisions] = await Promise.all([
      db.systemSetting.findMany({
        where: { key: { in: recentRadarAlerts.map((a) => `${RADAR_SAFETY_SETTING_PREFIX}${a.id}`) } },
        select: { value: true },
      }),
      db.systemSetting.count({ where: { key: { startsWith: RADAR_SAFETY_BLOCKED_SETTING_PREFIX } } }),
    ]);
    const safety = summarizeRadarSafety(safetyRows.map((r) => r.value), blockedDecisions);
    const report = {
      collection,
      status,
      safety,
      now: now.toISOString(),
      stale,
      warnings,
      lastCall: lastCall
        ? {
            at: lastCall.createdAt.toISOString(), ageMinutes: Math.round((callAge ?? 0) / 60_000), kind: lastCall.kind, title: lastCall.title, refId: lastCall.refId,
            entry: entry ? { at: entry.entryAt?.toISOString() ?? null, priceUsd: entry.entryPriceUsd == null ? null : Number(entry.entryPriceUsd), unknownReason: entry.entryUnknownReason } : null,
          }
        : null,
      lastPriceAt: lastPrice?.at.toISOString() ?? null,
      lastPriceAgeMinutes: priceAge == null ? null : Math.round(priceAge / 60_000),
      lastNarrativeUpdateAt: lastNarrative?.updatedAt.toISOString() ?? null,
      calls24h,
      callsWithoutFreshEntry24h: callsWithoutEntry24h,
      calls7d,
      tokens7d: outcomes7d.length,
      supply: {
        freshUnder100k,
        linkedFreshUnder100k,
        youngFreshUnder100k,
        linkedUnpriced,
        linkedUnpricedConfirmed,
        freshWindowMinutes: 15,
      },
      thresholds: { maxCallAgeMin, maxPriceAgeMin },
    };

    if (values.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`Radar status: ${status}`);
      console.log(`Newest call: ${lastCall ? `${lastCall.kind} "${lastCall.title}" ${ageLabel(callAge)} (${lastCall.createdAt.toISOString()})` : 'never'}`);
      console.log(`Newest call entry: ${entry ? (entry.entryAt ? `fresh at ${entry.entryAt.toISOString()}` : `unknown${entry.entryUnknownReason ? ` (${entry.entryUnknownReason})` : ''}`) : 'not tracked'}`);
      console.log(`Newest price: ${lastPrice ? `${ageLabel(priceAge)} (${lastPrice.at.toISOString()})` : 'never'}`);
      console.log(`Newest narrative update: ${lastNarrative ? ageLabel(narrativeAge) : 'never'}`);
      console.log(`Calls: ${calls24h} in 24h, ${calls7d} in 7d, ${outcomes7d.length} distinct tokens in 7d`);
      console.log(
        `Supply: ${freshUnder100k} fresh tokens under $100k, ${linkedFreshUnder100k} linked to a live narrative, ${youngFreshUnder100k} under 7 days old, ${linkedUnpriced} linked tokens never priced (${linkedUnpricedConfirmed} with an on-chain creation time)`,
      );
      const modes = Object.entries(safety.modes).map(([mode, n]) => `${mode} ${n}`).join(', ') || 'none';
      const sources = Object.entries(safety.evidenceSources).map(([source, n]) => `${source} ${n}`).join(', ');
      console.log(safety.evaluated
        ? `Safety gate: ${safety.evaluated} snapshots (${safety.pass} pass, ${safety.unknown} unknown, ${safety.block} block); modes ${modes}${sources ? `; evidence ${sources}` : ''}; enforced blocks ${safety.blockedDecisions}${safety.latest?.at ? `; latest ${safety.latest.status} at ${safety.latest.at}` : ''}`
        : `Safety gate: no frozen snapshots yet${calls24h ? ' (recent calls predate the gate)' : ''}; enforced blocks ${safety.blockedDecisions}`);
      const top = (counts: Record<string, number>) => Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([code, n]) => `${code} (${n})`).join(', ');
      if (Object.keys(safety.blockers).length) console.log(`Safety blockers: ${top(safety.blockers)}`);
      if (Object.keys(safety.unknowns).length) console.log(`Safety unknowns: ${top(safety.unknowns)}`);
      if (Object.keys(safety.warnings).length) console.log(`Safety warnings: ${top(safety.warnings)}`);
      if (warnings.length) console.log(`Warnings: ${warnings.join(', ')}`);
      console.log(renderResearchCoverage(collection));
    }
    if (stale.length) process.exitCode = 2;
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Radar status failed');
  process.exitCode = 1;
});
