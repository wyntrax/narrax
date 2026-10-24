import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPrisma } from '@narra/database';
import { buildRadarScorecard, renderRadarScorecard, type Point, type RadarCall } from '@narra/analytics';
import { researchCoverage, renderResearchCoverage } from '@narra/worker-pipeline';

const usage = `Early Radar scorecard — measured from frozen alert entries and stored 5-minute closes.

  npm run radar:scorecard -- [options]

Options:
  --from <ISO>       Start of the alert cohort (default: 30 days before --to)
  --days <n>         Default cohort length when --from is absent (1–365; default: 30)
  --to <ISO>         End of the alert cohort (default: now)
  --now <ISO>        Measurement time (default: now). Useful for a repeatable replay.
  --profile <name>   trencher or holder
  --tier <name>      WATCH, IMPORTANT, STRONG or CRITICAL
  --route <name>     NARRATIVE or SOCIAL
  --cost <pct>       Round-trip cost in percent (default: 3)
  --json             Print JSON instead of markdown
  --no-save          Do not write a report under reports/
  --out <path>       Report path (markdown or JSON)

Reads the database only. Writes no outcome, decision, order or position.`;

const date = (name: string, raw: string | undefined, fallback?: Date): Date => {
  if (!raw) {
    if (fallback) return fallback;
    throw new Error(`${name} is required`);
  }
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
const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, '-');

async function main() {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      days: { type: 'string' },
      to: { type: 'string' },
      now: { type: 'string' },
      profile: { type: 'string' },
      tier: { type: 'string' },
      route: { type: 'string' },
      cost: { type: 'string' },
      json: { type: 'boolean' },
      'no-save': { type: 'boolean' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  const now = date('--now', values.now, new Date());
  const to = date('--to', values.to, now);
  const days = num('--days', values.days, 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('--days must be an integer from 1 to 365');
  const from = date('--from', values.from, new Date(+to - days * 86_400_000));
  if (from > to) throw new Error('--from must be before --to');
  const costPct = num('--cost', values.cost, 3);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const db = createPrisma();
  try {
    const outcomes = await db.earlyRadarOutcome.findMany({
      where: {
        alertedAt: { gte: from, lte: to },
        ...(values.profile ? { profile: values.profile } : {}),
        ...(values.tier ? { tier: values.tier } : {}),
        ...(values.route ? { route: values.route } : {}),
      },
      select: {
        id: true,
        tokenId: true,
        mint: true,
        alertedAt: true,
        profile: true,
        tier: true,
        route: true,
        matchKind: true,
        score: true,
        entryPriceUsd: true,
        entryAt: true,
        entryMarketCapUsd: true,
        entryUnknownReason: true,
      },
      orderBy: [{ alertedAt: 'asc' }, { id: 'asc' }],
    });

    const tokenIds = [...new Set(outcomes.map((o) => o.tokenId))];
    const metrics = tokenIds.length
      ? await db.tokenMetric.findMany({
          where: { tokenId: { in: tokenIds }, at: { gte: from, lte: new Date(+to + 25 * 3_600_000) } },
          select: { tokenId: true, at: true, priceUsd: true, liquidityUsd: true, volume24hUsd: true },
          orderBy: [{ tokenId: 'asc' }, { at: 'asc' }],
        })
      : [];

    const pricesByToken = new Map<string, Point[]>();
    for (const row of metrics) {
      const priceUsd = Number(row.priceUsd);
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
      const list = pricesByToken.get(row.tokenId) ?? [];
      list.push({ at: row.at, priceUsd, liquidityUsd: Number(row.liquidityUsd), volume24hUsd: Number(row.volume24hUsd) });
      pricesByToken.set(row.tokenId, list);
    }

    const calls: RadarCall[] = outcomes.map((o) => ({
      id: o.id,
      tokenId: o.tokenId,
      mint: o.mint,
      alertedAt: o.alertedAt,
      profile: o.profile,
      tier: o.tier,
      route: o.route,
      matchKind: o.matchKind,
      score: o.score == null ? null : Number(o.score),
      entryPriceUsd: o.entryPriceUsd == null ? null : Number(o.entryPriceUsd),
      entryAt: o.entryAt,
      entryMarketCapUsd: o.entryMarketCapUsd == null ? null : Number(o.entryMarketCapUsd),
      entryUnknownReason: o.entryUnknownReason,
    }));

    const scorecard = buildRadarScorecard(calls, pricesByToken, { from, to, now, costPct });
    // Operational coverage is current, even when the user selects a historical return cohort.
    const collection = await researchCoverage(db, new Date());
    const markdown = `${renderRadarScorecard(scorecard)}\n\n${renderResearchCoverage(collection)}`;
    const output = values.json ? JSON.stringify({ ...scorecard, collection }, null, 2) : markdown;

    if (!values['no-save']) {
      const path = values.out
        ? resolve(values.out)
        : resolve('reports', `radar-scorecard-${stamp(now)}.${values.json ? 'json' : 'md'}`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${output}\n`, 'utf8');
      console.error(`Saved: ${path}`);
    }
    console.log(output);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Radar scorecard failed');
  process.exitCode = 1;
});
