import pg from 'pg';
import { Redis } from 'ioredis';
import WebSocket from 'ws';
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { createEventStream, type ServerMessage } from '@narra/realtime';
import { buildApp } from './app';
import { createPrivyVerifier } from './auth';
import {seedTestPro,clearTestPro} from './test-membership';

const dbUrl = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
async function dbUp() {
  const c = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "User" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
async function redisUp() {
  const r = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try { await r.connect(); await r.ping(); return true; } catch { return false; } finally { r.disconnect(); }
}
const up = (await dbUp()) && (await redisUp());

describe.skipIf(!up)('realtime gateway over a real WebSocket (needs Postgres and Redis)', () => {
  const db = createPrisma(dbUrl);
  const tag = `gw${Date.now()}`;
  const APP_ID = 'gw-test';
  const streamKey = `test:gw:${tag}`;
  const cmd = new Redis(redisUrl); const blocking = new Redis(redisUrl); const pub = new Redis(redisUrl);
  const publisher = createEventStream(pub, streamKey);
  const alice = `did:privy:${tag}-a`; const bob = `did:privy:${tag}-b`;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let base = '';
  const sockets: WebSocket[] = [];

  const token = (sub: string, ttl = '5m') => new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject(sub).setIssuer('privy.io').setAudience(APP_ID).setIssuedAt().setExpirationTime(ttl).sign(keys.privateKey);

  interface Client { ws: WebSocket; msgs: ServerMessage[]; closed: Promise<{ code: number; reason: string }>; send(m: unknown): void; events(): Extract<ServerMessage, { type: 'event' }>[] }
  function open(headers: Record<string, string> = {}): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base}/v1/stream`, { headers });
      sockets.push(ws);
      const msgs: ServerMessage[] = [];
      ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
      const closed = new Promise<{ code: number; reason: string }>((res) => ws.on('close', (code, reason) => res({ code, reason: reason.toString() })));
      ws.on('error', () => { /* a refused upgrade or reset is asserted through `closed` */ });
      ws.on('open', () => resolve({ ws, msgs, closed, send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)), events: () => msgs.filter((m): m is Extract<ServerMessage, { type: 'event' }> => m.type === 'event') }));
      ws.on('close', () => reject(new Error('closed before open')));
    });
  }
  const until = async (cond: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 15)); } };
  async function authed(sub: string, extra: Record<string, unknown> = {}) {
    const c = await open();
    c.send({ type: 'auth', token: await token(sub), ...extra });
    await until(() => c.msgs.some((m) => m.type === 'ready'));
    return c;
  }
  const sol = (priceUsd: number) => ({ type: 'market.sol' as const, at: new Date(), data: { priceUsd } });
  const notif = (userId: string, id: string) => ({ type: 'notification.created' as const, userId, at: new Date(), data: { id, alertId: `al-${id}`, kind: 'AI_BUY', priority: 'IMPORTANT', title: 't', body: 'b', refType: null, refId: null } });
  const prices = (c: Client) => c.events().filter((e) => e.event.type === 'market.sol').map((e) => (e.event.data as { priceUsd: number }).priceUsd);

  beforeAll(async () => {
    for(const privyUserId of [alice,bob]){const user=await db.user.create({data:{privyUserId}});await seedTestPro(db,user.id);}
    keys = await generateKeyPair('ES256');
    app = await buildApp({
      account: { db, verifier: createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(keys.publicKey) }) },
      http: { corsOrigins: ['https://app.example.com'] },
      realtime: { stream: createEventStream(cmd, streamKey), readerStream: createEventStream(blocking, streamKey), hubOptions: { authTimeoutMs: 1500, maxPerUser: 3 }, limits: { sweepMs: 50, heartbeatMs: 60_000 } },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `ws://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    await new Promise((r) => setTimeout(r, 300)); // let the stream reader take its starting position
  });

  afterAll(async () => {
    await clearTestPro(db,(await db.user.findMany({where:{privyUserId:{in:[alice,bob]}}})).map(u=>u.id));
    for (const s of sockets) s.terminate();
    await app.close();
    await db.user.deleteMany({ where: { privyUserId: { in: [alice, bob] } } });
    await db.$disconnect();
    await cmd.del(streamKey, ...(await cmd.keys(`${streamKey}:*`)));
    cmd.disconnect(); blocking.disconnect(); pub.disconnect();
  });

  afterEach(async () => { for (const s of sockets.splice(0)) s.terminate(); await new Promise((r) => setTimeout(r, 80)); });

  it('closes a socket that never authenticates, and one that sends anything else first', async () => {
    const idle = await open();
    expect((await idle.closed).code).toBe(4408);
    const eager = await open();
    eager.send({ type: 'subscribe', channels: ['market'] });
    expect((await eager.closed).code).toBe(4401);
  });

  it('refuses a bad token, an expired token and a malformed auth message without saying why', async () => {
    const bad = await open();
    bad.send({ type: 'auth', token: 'not-a-real-token-at-all' });
    expect(await bad.closed).toMatchObject({ code: 4401, reason: 'unauthorized' });

    const expired = await open();
    expired.send({ type: 'auth', token: await token(alice, '-1m') });
    expect((await expired.closed).code).toBe(4401);

    const junk = await open();
    junk.send('{not json');
    await until(() => junk.msgs.length > 0);
    expect(junk.msgs[0]).toEqual({ type: 'error', code: 'bad_message' });
    junk.send({ type: 'auth', token: 'x' }); // too short for the schema
    await until(() => junk.msgs.length > 1);
    expect(junk.msgs[1]).toEqual({ type: 'error', code: 'bad_message' });
    junk.ws.close();
  });

  it('delivers channel events only to subscribers, and a private event only to its owner', async () => {
    const a = await authed(alice, { channels: ['market'] });
    const b = await authed(bob);
    const aliceId = (await db.user.findUniqueOrThrow({ where: { privyUserId: alice } })).id;

    await publisher.publish(sol(111));
    await publisher.publish(notif(aliceId, 'n1'));
    await until(() => prices(a).length === 1 && a.events().some((e) => e.channel === 'me'));
    await new Promise((r) => setTimeout(r, 200));
    expect(prices(a)).toEqual([111]);
    expect(prices(b)).toEqual([]);                                       // Bob never subscribed to `market`
    expect(b.events().filter((e) => e.channel === 'me')).toHaveLength(0); // and the private event was not his
    expect(a.events().find((e) => e.channel === 'me')!.event.data).toMatchObject({ id: 'n1', kind: 'AI_BUY' });

    b.send({ type: 'subscribe', channels: ['market'] });
    await until(() => b.msgs.some((m) => m.type === 'subscribed'));
    await publisher.publish(sol(112));
    await until(() => prices(b).length === 1);
    expect(prices(b)).toEqual([112]);
    b.send({ type: 'unsubscribe', channels: ['market'] });
    await until(() => b.msgs.filter((m) => m.type === 'subscribed').length === 2);
    const last = b.msgs.filter((m) => m.type === 'subscribed').pop() as Extract<ServerMessage, { type: 'subscribed' }>;
    expect(last.channels).toEqual(['me']);
    // The private channel is not part of the client protocol at all, so it cannot be dropped (or asked for).
    b.send({ type: 'unsubscribe', channels: ['me'] });
    b.send({ type: 'subscribe', channels: ['me'] });
    await until(() => b.msgs.filter((m) => m.type === 'error').length === 2);
    expect(b.msgs.filter((m) => m.type === 'error')).toEqual([{ type: 'error', code: 'bad_message' }, { type: 'error', code: 'bad_message' }]);
    a.ws.close(); b.ws.close();
  });

  it('replays what a reconnecting client missed, once each and in order, and nothing from before its last id', async () => {
    const first = await authed(alice, { channels: ['market'] });
    await publisher.publish(sol(201));
    await until(() => prices(first).length === 1);
    const lastId = first.events().at(-1)!.id;
    first.ws.close(); await first.closed;

    await publisher.publish(sol(202)); await publisher.publish(sol(203));
    const second = await authed(alice, { channels: ['market'], lastEventId: lastId });
    await until(() => prices(second).length === 2);
    await publisher.publish(sol(204));
    await until(() => prices(second).length === 3);
    await new Promise((r) => setTimeout(r, 150));
    expect(prices(second)).toEqual([202, 203, 204]);
    expect(second.msgs.some((m) => m.type === 'resync')).toBe(false);
    second.ws.close();
  });

  it('tells a client that is too far behind to refetch, instead of pretending it is caught up', async () => {
    // Trim the stream so that an old id falls outside it.
    const oldId = '1-0';
    await cmd.xadd(streamKey, 'MAXLEN', '=', 1, '*', 't', 'x');
    const c = await authed(alice, { lastEventId: oldId });
    await until(() => c.msgs.some((m) => m.type === 'resync'));
    expect(c.msgs.find((m) => m.type === 'resync')).toEqual({ type: 'resync', reason: 'too_old' });
    c.ws.close();
  });

  it('enforces the per-user connection limit, and the same user can renew a session with a fresh token on the same socket', async () => {
    const held = [await authed(alice), await authed(alice), await authed(alice)];
    const fourth = await open();
    fourth.send({ type: 'auth', token: await token(alice) });
    expect((await fourth.closed).code).toBe(4430);
    held[0]!.send({ type: 'auth', token: await token(alice) });
    await until(() => held[0]!.msgs.filter((m) => m.type === 'ready').length === 2);
    // A socket cannot switch identity
    held[1]!.send({ type: 'auth', token: await token(bob) });
    expect((await held[1]!.closed).code).toBe(4403);
    held.forEach((h) => h.ws.close());
  });

  it('closes a connection when its token expires', async () => {
    const c = await open();
    c.send({ type: 'auth', token: await token(alice, '2s') });
    await until(() => c.msgs.some((m) => m.type === 'ready'));
    expect(await c.closed).toMatchObject({ code: 4411 });
  }, 8000);

  it('rejects a binary frame, an oversized message and a flood of messages', async () => {
    const bin = await open();
    bin.ws.send(Buffer.from([1, 2, 3]));
    expect((await bin.closed).code).toBe(4400);

    const big = await open();
    big.ws.send('x'.repeat(20_000));
    expect((await big.closed).code).toBe(1009);

    const flood = await authed(alice);
    for (let i = 0; i < 40; i++) flood.send({ type: 'ping' });
    expect((await flood.closed).code).toBe(4429);
  });

  it('answers an application-level ping', async () => {
    const c = await authed(alice);
    c.send({ type: 'ping' });
    await until(() => c.msgs.some((m) => m.type === 'pong'));
    c.ws.close();
  });

  it('refuses a browser origin that is not on the allow list, and allows a listed one', async () => {
    const evil = await open({ origin: 'https://evil.example' });
    expect((await evil.closed).code).toBe(4403);
    const good = await open({ origin: 'https://app.example.com' });
    good.send({ type: 'auth', token: await token(alice) });
    await until(() => good.msgs.some((m) => m.type === 'ready'));
    good.ws.close();
  });

  it('closes every client with 1001 when the server shuts down', async () => {
    const own = await buildApp({
      account: { db, verifier: createPrivyVerifier({ appId: APP_ID, verificationKey: await exportSPKI(keys.publicKey) }) },
      realtime: { stream: createEventStream(cmd, streamKey), readerStream: createEventStream(new Redis(redisUrl), streamKey) },
    });
    await own.listen({ port: 0, host: '127.0.0.1' });
    const ws = new WebSocket(`ws://127.0.0.1:${(own.server.address() as { port: number }).port}/v1/stream`);
    sockets.push(ws);
    const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)));
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ type: 'auth', token: await token(alice) }));
    await new Promise((r) => ws.once('message', r));
    await own.close();
    expect(await closed).toBe(1001);
  });
});
