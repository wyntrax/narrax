import { createPrisma } from '@narra/database';
import { resetAuthSettings } from '../apps/api/src/entitlements/settings';

async function main() {
  const [command, group, ...rest] = process.argv.slice(2);
  if (command !== 'reset' || group !== 'auth' || rest.length) throw new Error('USAGE');
  // Like the API, use the caller's environment. Do not load or overwrite variables from files.
  const db = createPrisma();
  try {
    await resetAuthSettings(db, 'Operator CLI: reset auth to environment');
    console.log('Auth database overrides deleted and audited. Environment fallback applies within 20 seconds.');
  } finally { await db.$disconnect(); }
}
main().catch(e => {
  console.error(e instanceof Error && e.message === 'USAGE' ? 'Usage: npm run settings -- reset auth' : 'Could not reset auth settings. Check DATABASE_URL and database availability.');
  process.exitCode = 1;
});
