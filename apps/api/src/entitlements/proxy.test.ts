import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { buildApp } from '../app';
import { VECTOR_BODY, VECTOR_SECRET, VECTOR_TIME } from './fixtures.test-support';

import { assertTestDatabase } from '../../../../scripts/test-database';
const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
assertTestDatabase(target);
const db = createPrisma(target.toString()), tag = `proxy-${randomUUID()}`;
let sequence = 0;
const now = () => new Date(Number(VECTOR_TIME) * 1000);
const event = () => { const e = JSON.parse(VECTOR_BODY); e.id = `${tag}-${++sequence}`; e.data.membershipId = `${tag}-member-${sequence}`; return e; };
const sign = (body: Buffer) => 'v1=' + createHmac('sha256', VECTOR_SECRET).update(VECTOR_TIME + '.').update(body).digest('hex');
// In-process forwarding boundary, no nginx process or additional listening port. Byte chunks are
// reassembled without JSON parsing; changed transfer framing does not change signed entity bytes.
const relay = (app: Awaited<ReturnType<typeof buildApp>>, body: Buffer, id: string, signature = sign(body), client = '198.51.100.10') => app.inject({
  method: 'POST', url: '/v1/integrations/wyntrax/events', remoteAddress: '127.0.0.1',
  payload: Buffer.concat([body.subarray(0, 7), body.subarray(7, 91), body.subarray(91)]),
  headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': String(body.length), 'x-forwarded-for': client, 'x-forwarded-proto': 'https', 'x-wyntrax-timestamp': VECTOR_TIME, 'x-wyntrax-event-id': id, 'x-wyntrax-signature': signature },
});
afterAll(async () => {
  await db.webhookEvent.deleteMany({ where: { id: { startsWith: tag } } });
  await db.wyntraxEntitlement.deleteMany({ where: { membershipId: { startsWith: tag } } });
  await db.auditLog.deleteMany({ where: { detail: { path: ['membershipId'], string_starts_with: tag } } });
  await db.$disconnect();
});
describe('reverse-proxy readiness (in-process relay, real API parser and PostgreSQL)', () => {
  it('verifies forwarded raw UTF-8/CRLF/whitespace bytes and rejects proxy JSON reserialization', async () => {
    const app = await buildApp({ trustProxy: true, wyntrax: { db, secret: VECTOR_SECRET, now } });
    try {
      const e = event(); e.data.membershipId += '-é';
      const raw = Buffer.from(' \r\n' + JSON.stringify(e, null, 2).replace(/\n/g, '\r\n') + '\t ');
      expect((await relay(app, raw, e.id)).json()).toEqual({ ok: true, status: 'applied' });
      expect((await db.webhookEvent.findUniqueOrThrow({ where: { id: e.id } })).bodyHash).toBe(createHash('sha256').update(raw).digest('hex'));
      const altered = event(), original = Buffer.from(JSON.stringify(altered, null, 2));
      expect((await relay(app, Buffer.from(JSON.stringify(altered)), altered.id, sign(original))).statusCode).toBe(401);
      expect(await db.webhookEvent.findUnique({ where: { id: altered.id } })).toBeNull();
    } finally { await app.close(); }
  });
  it('accepts exactly nginx 16k = 16384 entity bytes and rejects 16385 before receipt persistence', async () => {
    const app = await buildApp({ trustProxy: true, wyntrax: { db, secret: VECTOR_SECRET, now } });
    try {
      for (const bytes of [16384, 16385]) {
        const e = event(), json = Buffer.from(JSON.stringify(e));
        const body = Buffer.concat([json, Buffer.alloc(bytes - json.length, 32)]);
        expect((await relay(app, body, e.id)).statusCode).toBe(bytes === 16384 ? 200 : 413);
        expect(!!await db.webhookEvent.findUnique({ where: { id: e.id } })).toBe(bytes === 16384);
      }
    } finally { await app.close(); }
  });
  it.each([true, false])('trustProxy=%s: forwarded client IPs get separate buckets only behind a trusted proxy', async trustProxy => {
    const app = await buildApp({ trustProxy, wyntrax: { db, secret: VECTOR_SECRET, now } });
    try {
      const invalid = Buffer.from('{}');
      for (let i = 0; i < 120; i++) expect((await relay(app, invalid, 'invalid', 'bad-signature', '198.51.100.20')).statusCode).toBe(401);
      expect((await relay(app, invalid, 'invalid', 'bad-signature', '198.51.100.20')).statusCode).toBe(429);
      expect((await relay(app, invalid, 'invalid', 'bad-signature', '198.51.100.21')).statusCode).toBe(trustProxy ? 401 : 429);
    } finally { await app.close(); }
  });
});
