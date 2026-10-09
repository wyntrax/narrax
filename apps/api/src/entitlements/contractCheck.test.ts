import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { buildApp } from '../app';
import { VECTOR_SECRET } from './fixtures.test-support';
const exec = promisify(execFile);
it('contract script: offline fixed vector and real localhost:4010 HTTP cases; remote targets refused', async () => {
  const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
  if (target.hostname !== 'localhost' || target.port !== '5432' || target.pathname !== '/narra_ent') throw Error('Scratch only');
  const db = createPrisma(target.toString());
  const app = await buildApp({ wyntrax: { db, secret: VECTOR_SECRET } });
  try {
    console.log('DATABASE_URL host=localhost:5432 db=narra_ent; contract check listener localhost:4010 only.');
    await app.listen({ host: 'localhost', port: 4010 });
    const offline = await exec(process.execPath, ['scripts/wyntrax-contract-check.mjs', '--offline']); expect(offline.stdout).toContain('PASS offline'); console.log(offline.stdout);
    const live = await exec(process.execPath, ['scripts/wyntrax-contract-check.mjs', '--now']); expect(live.stdout).toContain('stale seq: HTTP 200'); console.log(live.stdout);
    await expect(exec(process.execPath, ['scripts/wyntrax-contract-check.mjs', '--offline', '--target', 'https://example.com'])).rejects.toThrow();
  } finally { await app.close(); await db.$disconnect(); }
}, 20000);
