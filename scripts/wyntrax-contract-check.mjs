import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtures = readFileSync(resolve(root, 'apps/api/src/entitlements/fixtures.test-support.ts'), 'utf8');
const fixture = name => new RegExp(`export const ${name} = '([^']*)';`).exec(fixtures)?.[1];
const body = fixture('VECTOR_BODY'), fixedTime = fixture('VECTOR_TIME'), publicSecret = fixture('VECTOR_SECRET');
const sign = (raw, time, secret) => 'v1=' + createHmac('sha256', secret).update(time + '.').update(raw).digest('hex');
const args = process.argv.slice(2), targetArg = args.indexOf('--target');
const target = new URL(targetArg >= 0 ? args[targetArg + 1] : 'http://localhost:14010');
if (target.hostname !== 'localhost' || target.port !== '14010' || target.protocol !== 'http:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw Error('Only isolated http://localhost:14010 is permitted');
if (args.includes('--offline')) {
  if (sign(body, fixedTime, publicSecret) !== fixture('VECTOR_SIGNATURE')) throw Error('Fixed vector mismatch');
   console.log(`PASS offline: exact ${Buffer.byteLength(body)}-byte membership webhook signature`);
} else {
  const secret = process.env.WYNTRAX_WEBHOOK_SECRET;
  if (secret !== publicSecret) throw Error('WYNTRAX_WEBHOOK_SECRET must contain the literal contract test secret');
  const time = args.includes('--now') ? String(Math.floor(Date.now() / 1000)) : fixedTime;
  console.log('Target localhost:14010 (server must use the explicitly configured isolated test database).');
  const send = async (label, raw, expected, timestamp = time, signature = sign(raw, timestamp, secret)) => {
    const response = await fetch(new URL('/v1/integrations/wyntrax/events', target), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json', 'x-wyntrax-event-id': JSON.parse(raw).id, 'x-wyntrax-timestamp': timestamp, 'x-wyntrax-signature': signature }, body: raw });
    const text = await response.text(); console.log(`${label}: HTTP ${response.status} (expected ${expected}) ${text}`);
    if (response.status !== expected) process.exitCode = 1;
    return JSON.parse(text);
  };
  await send('contract vector', body, args.includes('--now') ? 200 : 401);
  await send('tampered body', body + ' ', 401, time, sign(body, time, secret));
  await send('wrong secret', body, 401, time, sign(body, time, 'wrong_test_secret'));
  await send('old timestamp', body, 401, String(Math.floor(Date.now() / 1000) - 301));
  if (args.includes('--now')) {
    const duplicate = await send('duplicate event id', body, 200); if (duplicate.status !== 'duplicate') process.exitCode = 1;
    const stale = JSON.parse(body); stale.id = `contract-stale-${randomUUID()}`; stale.data.seq = 2;
    const result = await send('stale seq', JSON.stringify(stale), 200); if (result.status !== 'stale') process.exitCode = 1;
    const unknown = JSON.parse(body); unknown.id = `contract-invalid-${randomUUID()}`; unknown.data.key = 'UNKNOWN';
    await send('unknown key', JSON.stringify(unknown), 400);
    const test = JSON.parse(body); test.id = `contract-test-${randomUUID()}`; test.type = 'membership.test'; test.data.validUntil = null;
    if ((await send('synthetic test', JSON.stringify(test), 200)).status !== 'test') process.exitCode = 1;
  } else console.log('Use --now for authenticated duplicate/stale/payload checks.');
}
