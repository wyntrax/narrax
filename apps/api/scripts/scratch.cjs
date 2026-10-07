// Local verification harness: never fall back to the application's normal database.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const values = require('dotenv').parse(fs.readFileSync('.env', 'utf8'));
const target = new URL(values.DATABASE_URL);
const redis = new URL(values.REDIS_URL);
if (target.hostname !== 'localhost' || target.port !== '5432' || target.pathname !== '/narra_ent' || redis.pathname !== '/5') throw new Error('Scratch environment guard failed');
const env = { ...process.env, ...values, PORT: '4010', API_PORT: '4010', NODE_ENV: 'test' };
const shadow = new URL(target); shadow.pathname = '/narra_ent_shadow';
function announce() { console.log('DATABASE_URL host=localhost:5432 db=narra_ent; confirmed scratch only (Redis /5, API port 4010).'); }
function run(file, args) {
  announce();
  const result = spawnSync(process.execPath, [file, ...args], { env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  let output = (result.stdout || '') + (result.stderr || '');
  for (const value of [target.toString(), shadow.toString(), values.DATABASE_URL, values.REDIS_URL]) output = output.split(value).join('[REDACTED_URL]');
  output = output.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[REDACTED_DATABASE_URL]');
  console.log(output);
  if (result.status !== 0) process.exitCode = result.status || 1;
  return output;
}
async function maintenance(sql) {
  announce(); console.log('Maintenance postgres: ' + sql);
  const url = new URL(target); url.pathname = '/postgres';
  const db = new Client({ connectionString: url.toString() });
  try { await db.connect(); await db.query(sql); } finally { await db.end(); }
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'diff') {
    await maintenance('CREATE DATABASE "narra_ent_shadow"');
    try { run('node_modules/prisma/build/index.js', ['migrate', 'diff', '--from-migrations', 'packages/database/prisma/migrations', '--to-schema-datamodel', 'packages/database/prisma/schema.prisma', '--shadow-database-url', shadow.toString(), '--script', '--exit-code']); }
    finally { await maintenance('DROP DATABASE "narra_ent_shadow"'); }
  } else if (command === 'deployed-diff') {
    run('node_modules/prisma/build/index.js', ['migrate', 'diff', '--from-url', target.toString(), '--to-schema-datamodel', 'packages/database/prisma/schema.prisma', '--script', '--exit-code']);
  } else if (command === 'deploy' || command === 'generate' || command === 'validate') {
    run('node_modules/prisma/build/index.js', [...(command === 'deploy' ? ['migrate', 'deploy'] : [command]), '--schema', 'packages/database/prisma/schema.prisma']);
  } else if (command === 'test') run('node_modules/vitest/vitest.mjs', ['run', ...args]);
  else if (command === 'typecheck') run('node_modules/typescript/bin/tsc', ['--noEmit', '-p', 'tsconfig.json']);
  else throw new Error('Unknown scratch command');
}
main().catch(e => { console.error('Scratch command failed: ' + (e.code || 'UNKNOWN')); process.exitCode = 1; });
