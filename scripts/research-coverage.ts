import { parseArgs } from 'node:util';
import { createPrisma } from '@narra/database';
import { researchCoverage, renderResearchCoverage } from '@narra/worker-pipeline';

async function main() {
  const { values } = parseArgs({ options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) {
    console.log('npm run research:coverage -- [--json]\nRead-only current coverage audit. Requires DATABASE_URL in the process environment. No provider requests, writes or historical reconstruction.');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = createPrisma();
  try {
    const report = await researchCoverage(db);
    console.log(values.json ? JSON.stringify(report, null, 2) : renderResearchCoverage(report));
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  // Connection errors may contain credentials; keep the public CLI failure generic.
  console.error('Coverage audit failed. Check arguments, DATABASE_URL and database availability privately.');
  process.exitCode = 1;
});
