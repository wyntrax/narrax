import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { buildApp } from '../app';
import { VECTOR_SECRET } from './fixtures.test-support';
import { assertTestDatabase } from '../../../../scripts/test-database';
const exec = promisify(execFile);
it('contract script: offline fixed vector and isolated localhost:14010 HTTP cases; remote targets refused', async () => {
  const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
  assertTestDatabase(target);
  const db = createPrisma(target.toString());
  const app = await buildApp({ wyntrax: { db, secret: VECTOR_SECRET } });
  try {
    console.log('Contract check uses the explicit test database and localhost:14010.');
    await app.listen({ host: 'localhost', port: 14010 });
    const offline = await exec(process.execPath, ['scripts/wyntrax-contract-check.mjs', '--offline']); expect(offline.stdout).toContain('PASS offline'); console.log(offline.stdout);
    const live = await exec(process.execPath, ['scripts/wyntrax-contract-check.mjs', '--now'], { env: { ...process.env, WYNTRAX_WEBHOOK_SECRET: VECTOR_SECRET } }); expect(live.stdout).toContain('stale seq: HTTP 200'); console.log(live.stdout);
    await expect(exec(process.execPath, ['scripts/wyntrax-contract-check.mjs', '--offline', '--target', 'https://example.com'])).rejects.toThrow();
  } finally { await app.close(); await db.$disconnect(); }
}, 20000);
