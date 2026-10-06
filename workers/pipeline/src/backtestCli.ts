/**
 * npm run backtest -- [--days 30] [--cost 3] [--out reports] [--no-save]
 * Replays the stored history, prints the report, and saves it (BacktestRun and a markdown file).
 * Read-only against market data. The range ends 25 hours ago by default, so 24h outcomes can be known.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createPrisma } from '@narra/database';
import { renderMarkdown } from '@narra/analytics';
import { runBacktest, saveBacktestRun, type BacktestConfig } from './backtest';

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
const days = Number(arg('days', '30')), cost = Number(arg('cost', '3'));
if (!Number.isFinite(days) || days <= 0 || !Number.isFinite(cost) || cost < 0) { console.error('Usage: npm run backtest -- [--days 30] [--cost 3] [--out reports] [--no-save]'); process.exit(1); }

async function main() {
  const db = createPrisma();
  try {
    const now = new Date();
    const cfg: BacktestConfig = { from: new Date(now.getTime() - (days * 24 + 25) * 3_600_000), to: new Date(now.getTime() - 25 * 3_600_000), now, costPct: cost };
    const report = await runBacktest(db, cfg);
    const md = renderMarkdown(report);
    console.log(md);
    if (!process.argv.includes('--no-save')) {
      const id = await saveBacktestRun(db, report, cfg);
      const dir = arg('out', 'reports');
      await mkdir(dir, { recursive: true });
      const file = `${dir}/backtest-${now.toISOString().replace(/[:.]/g, '-')}.md`;
      await writeFile(file, md);
      console.error(`\nSaved as BacktestRun ${id} and ${file}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
