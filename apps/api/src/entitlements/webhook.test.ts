import { createHmac, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { registerHttpHardening } from '../http';
import { registerWyntraxWebhook, type WyntraxDeps } from './webhook';
import { VECTOR_BODY, VECTOR_SECRET, VECTOR_SIGNATURE, VECTOR_TIME } from './fixtures.test-support';

const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
if (url.hostname !== 'localhost' || url.port !== '5432' || url.pathname !== '/narra_ent') throw new Error('Require scratch database');
const db = createPrisma(url.toString());
const tag = `wh-${randomUUID()}`;
const now = new Date(Number(VECTOR_TIME) * 1000);
let seq = 0;
const ids: string[] = [], members: string[] = [];
const signBody = (body: string) => 'v1=' + createHmac('sha256', VECTOR_SECRET).update(VECTOR_TIME + '.').update(body).digest('hex');
const payload = () => { const e = JSON.parse(VECTOR_BODY); e.id = `${tag}-${++seq}`; e.data.membershipId = `${tag}-member-${seq}`; ids.push(e.id); members.push(e.data.membershipId); return e; };
async function appFor(overrides: Partial<WyntraxDeps> = {}) {
  const app = Fastify({ logger: false });
  await registerHttpHardening(app);
  await app.register(rateLimit, { global: false });
  await registerWyntraxWebhook(app, { db, secret: VECTOR_SECRET, now: () => now, ...overrides });
  return app;
}
let app: Awaited<ReturnType<typeof appFor>>;
beforeAll(async () => { app = await appFor(); });
afterAll(async () => {
  await app.close();
  await db.webhookEvent.deleteMany({ where: { id: { in: ids } } });
  await db.wyntraxEntitlement.deleteMany({ where: { membershipId: { in: members } } });
  await db.auditLog.deleteMany({ where: { OR: [{ detail: { path: ['membershipId'], string_starts_with: tag } }, { detail: { path: ['eventId'], string_starts_with: tag } }] } });
  await db.$disconnect();
});
const inject = (body: string, id: string, overrides: Record<string, string> = {}, server = app, remoteAddress = `127.0.0.${++seq % 200 + 1}`) => server.inject({ method: 'POST', url: '/v1/integrations/wyntrax/events', remoteAddress, payload: body,
  headers: { 'content-type': 'application/json', 'x-wyntrax-timestamp': VECTOR_TIME, 'x-wyntrax-event-id': id, 'x-wyntrax-signature': signBody(body), ...overrides } });
describe('webhook HTTP boundary with real scratch persistence', () => {
  it('raw bytes before parsing; contract response, duplicate and header identity', async () => {
    const e = payload(), body = JSON.stringify(e);
    const applied = await inject(body, e.id); expect(applied.statusCode).toBe(200); expect(applied.json()).toEqual({ ok: true, status: 'applied' });
    expect((await inject(body, e.id)).json()).toEqual({ ok: true, status: 'duplicate' });
    expect((await inject(body, 'wrong')).statusCode).toBe(400);
    expect((await inject(body + ' ', e.id, { 'x-wyntrax-signature': signBody(body) })).statusCode).toBe(401);
    const spaced = payload(); expect((await inject(JSON.stringify(spaced, null, 2), spaced.id)).statusCode).toBe(200);
  });
  it('accepts previous secret during rotation and does not use Privy auth', async () => {
    const rotated = await appFor({ secret: 'rotated', previousSecret: VECTOR_SECRET });
    try { const e = payload(); expect((await inject(JSON.stringify(e), e.id, {}, rotated)).statusCode).toBe(200); } finally { await rotated.close(); }
  });
  it('missing primary returns 503 even with previous secret, never 404/500', async () => {
    const missing = await appFor({ secret: undefined, previousSecret: VECTOR_SECRET });
    try { expect((await inject(VECTOR_BODY, 'evt_test_0001', { 'x-wyntrax-signature': VECTOR_SIGNATURE }, missing)).statusCode).toBe(503); } finally { await missing.close(); }
  });
  it('returns 401 for missing signature/timestamp and 400 for malformed signed JSON/media/id', async () => {
    const e = payload(), body = JSON.stringify(e);
    for (const field of ['x-wyntrax-timestamp', 'x-wyntrax-signature']) expect((await inject(body, e.id, { [field]: '' })).statusCode).toBe(401);
    expect((await inject(body, e.id, { 'x-wyntrax-event-id': '' })).statusCode).toBe(400);
    for (const malformed of ['{bad', 'null', '[]']) expect((await inject(malformed, e.id)).statusCode).toBe(400);
    expect((await inject(body, e.id, { 'content-type': 'text/plain' })).statusCode).toBe(400);
    expect((await inject(body, e.id, { 'content-encoding': 'gzip' })).statusCode).toBe(400);
    expect(await db.webhookEvent.findUnique({ where: { id: e.id } })).toBeNull();
  });
  it('16KB limit returns 413 before parsing/persistence and rate limit returns 429', async () => {
    expect((await inject('x'.repeat(16385), 'oversize')).statusCode).toBe(413);
    let last;
    for (let i = 0; i < 121; i++) last = await inject('{}', 'limited', {}, app, '192.0.2.99');
    expect(last!.statusCode).toBe(429); expect(last!.json().error).toBe('RATE_LIMITED');
  });
  it('storage failure is sanitized 503 without saving an event', async () => {
    const failed = await appFor({ db: { $transaction: async () => { throw Error('private failure details'); } } as never });
    try { const e = payload(); const response = await inject(JSON.stringify(e), e.id, {}, failed); expect(response.statusCode).toBe(503); expect(response.body).not.toContain('private'); } finally { await failed.close(); }
  });
});
