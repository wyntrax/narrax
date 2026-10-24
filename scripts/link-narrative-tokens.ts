/**
 * One deliberate pass over the live database that fills in narrative-token relations: the name-matching resolver, then
 * the pass that links tokens a narrative's own posts named. The market worker runs both on every refresh; this script
 * is for populating immediately without waiting for the next tick, or for a one-off repair.
 *
 *   npm run narratives:link-tokens
 *
 * Research only: it writes relations, opportunities and alerts. It has no access to orders, positions or execution.
 * Needs DATABASE_URL (this script does not read .env files).
 */
import { createPrisma } from '@narra/database';
import { resolveTokens } from '../workers/pipeline/src/tokenResolution';
import { attributeNarrativeMentions } from '../workers/pipeline/src/narrativeTokens';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const db = createPrisma();
  try {
    const now = new Date();
    // Attribution first, so resolveTokens can turn a narrative's social tokens into opportunities in the same pass.
    const mentions = await attributeNarrativeMentions(db, now);
    const named = await resolveTokens(db, now);
    console.log(JSON.stringify({ now: now.toISOString(), mentionMatch: mentions, nameMatch: named }, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch((e) => { console.error(`Linking narrative tokens failed: ${(e as Error).message}`.slice(0, 300)); process.exitCode = 1; });
