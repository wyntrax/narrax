import { describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { parseCorsOrigins, requestIdFrom, toErrorResponse } from './http';
import { ZodError, z } from 'zod';

describe('parseCorsOrigins', () => {
  it('accepts exact origins and an empty value', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('')).toEqual([]);
    expect(parseCorsOrigins('https://app.example.com, http://localhost:3000')).toEqual(['https://app.example.com', 'http://localhost:3000']);
  });
  it('refuses a wildcard, a path, and garbage, so a typo cannot open the API up', () => {
    expect(() => parseCorsOrigins('*')).toThrow(/not allowed/);
    expect(() => parseCorsOrigins('https://app.example.com/')).toThrow(/bare origins/);
    expect(() => parseCorsOrigins('https://app.example.com/path')).toThrow(/bare origins/);
    expect(() => parseCorsOrigins('not a url')).toThrow(/invalid origin/);
  });
});

describe('request ids and error mapping (pure)', () => {
  it('keeps a plain caller id and replaces anything that could carry junk into logs', () => {
    expect(requestIdFrom('abc12345-req')).toBe('abc12345-req');
    expect(requestIdFrom('short')).not.toBe('short');
    expect(requestIdFrom('has space and\nnewline')).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFrom(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('maps a Zod error to INVALID_INPUT with the field names and no values', () => {
    const err = (() => { try { z.object({ a: z.string() }).parse({ a: 5 }); } catch (e) { return e as ZodError; } throw new Error('x'); })();
    expect(toErrorResponse(err, 'rid')).toEqual({ status: 400, body: { error: 'INVALID_INPUT', fields: ['a'], requestId: 'rid' } });
  });
  it('never leaks the message of a server error', () => {
    const r = toErrorResponse(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'), 'rid');
    expect(r).toEqual({ status: 500, body: { error: 'INTERNAL', requestId: 'rid' } });
  });
});

describe('HTTP hardening', () => {
  async function app(http?: Parameters<typeof buildApp>[0] extends infer O ? (O extends { http?: infer H } ? H : never) : never) {
    const a = await buildApp({ http });
    a.get('/boom', async () => { throw new Error('secret internals: postgres://user:pw@host/db'); });
    a.post('/echo', async (req) => ({ got: req.body }));
    a.get('/limited', { config: { rateLimit: { max: 2, timeWindow: '1 minute' } } }, async () => ({ ok: true }));
    return a;
  }

  it('puts a request id on every response, and echoes a plain one from the caller', async () => {
    const a = await app();
    const r1 = await a.inject({ url: '/health' });
    expect(r1.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const r2 = await a.inject({ url: '/health', headers: { 'x-request-id': 'client-req-0001' } });
    expect(r2.headers['x-request-id']).toBe('client-req-0001');
    await a.close();
  });

  it('sends strict security headers, and HSTS only when switched on', async () => {
    const off = await app();
    const r = await off.inject({ url: '/health' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['strict-transport-security']).toBeUndefined();
    expect(r.headers['x-powered-by']).toBeUndefined();
    await off.close();
    const on = await app({ hsts: true });
    expect((await on.inject({ url: '/health' })).headers['strict-transport-security']).toContain('max-age=');
    await on.close();
  });

  it('allows no cross-origin access by default, and only the listed origins when configured', async () => {
    const closed = await app();
    const none = await closed.inject({ url: '/health', headers: { origin: 'https://evil.example' } });
    expect(none.headers['access-control-allow-origin']).toBeUndefined();
    await closed.close();

    const a = await app({ corsOrigins: ['https://app.example.com'] });
    const ok = await a.inject({ url: '/health', headers: { origin: 'https://app.example.com' } });
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.com');
    const evil = await a.inject({ url: '/health', headers: { origin: 'https://evil.example' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await a.inject({ method: 'OPTIONS', url: '/v1/me', headers: { origin: 'https://app.example.com', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(String(pre.headers['access-control-allow-headers'])).toContain('authorization');
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined(); // bearer tokens only, never cookies
    await a.close();
  });

  it('answers an unknown route, bad JSON, a wrong content type and an oversized body in the API error shape', async () => {
    const a = await app();
    const nf = await a.inject({ url: '/nope' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual({ error: 'NOT_FOUND', requestId: nf.headers['x-request-id'] });

    const badJson = await a.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: '{"a":' });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json()).toMatchObject({ error: 'INVALID_JSON' });

    const media = await a.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'text/xml' }, payload: '<a/>' });
    expect(media.statusCode).toBe(415);
    expect(media.json()).toMatchObject({ error: 'UNSUPPORTED_MEDIA_TYPE' });

    const big = await a.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ pad: 'x'.repeat(300 * 1024) }) });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ error: 'PAYLOAD_TOO_LARGE' });
    await a.close();
  });

  it('returns a generic 500 with the request id and never the internal message', async () => {
    const a = await app();
    const r = await a.inject({ url: '/boom', headers: { 'x-request-id': 'trace-me-12345' } });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: 'INTERNAL', requestId: 'trace-me-12345' });
    expect(r.body).not.toContain('postgres://');
    await a.close();
  });

  it('answers a rate-limited request with 429, RATE_LIMITED and retry-after', async () => {
    const a = await app();
    await a.inject({ url: '/limited' }); await a.inject({ url: '/limited' });
    const r = await a.inject({ url: '/limited' });
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ error: 'RATE_LIMITED' });
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    await a.close();
  });
});
