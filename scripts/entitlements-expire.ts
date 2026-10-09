import { createPrisma } from '@narra/database';
import { sweepExpired } from '../apps/api/src/entitlements/expiry';
async function main() {
  const db = createPrisma();
  try { console.log(JSON.stringify(await sweepExpired(db, new Date()))); }
  finally { await db.$disconnect(); }
}
main().catch(() => { console.error('ENTITLEMENT_EXPIRY_UNAVAILABLE'); process.exitCode = 1; });
