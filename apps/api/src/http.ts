import { randomUUID } from 'node:crypto';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { ZodError } from 'zod';
import { isExactBrowserOrigin } from '@narra/shared';

/** Starting values, not tuned. */
export const HTTP_LIMITS = {
  /** Largest JSON body. The Helius webhook route raises its own limit, and the wallet import (500 rows) fits well inside this. */
  bodyLimitBytes: 256 * 1024,
  requestTimeoutMs: 30_000,
  /** Longer than common proxy idle timeouts (60 s) so the proxy closes first. */
  keepAliveTimeoutMs: 72_000,
  corsMaxAgeSeconds: 600,
} as const;

export interface HttpOptions {
  /** Browser origins allowed to call the API. Empty means no cross-origin access (fail closed). */
  corsOrigins?: string[];
  resolveCorsOrigins?: () => Promise<string[]>;
  /** Send Strict-Transport-Security. Turn on only when the API is served over HTTPS. */
  hsts?: boolean;
}

/** Parses CORS_ORIGINS: comma separated, exact origins only. A wildcard is refused, because the API uses bearer tokens and a wildcard is never what you want here. */
export function parseCorsOrigins(raw: string | undefined): string[] {
  const list = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const o of list) {
    if (o === '*') throw new Error('CORS_ORIGINS must list exact origins; "*" is not allowed');
    try { new URL(o); } catch { throw new Error('CORS_ORIGINS has an invalid origin'); }
    if (!isExactBrowserOrigin(o)) throw new Error('CORS_ORIGINS entries must be bare origins using HTTP(S), without wildcards, credentials or paths');
  }
  return list;
}

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const newRequestId = () => randomUUID();
/** Accepts a caller's id only when it is short and plain, so it cannot carry anything into logs. */
export const requestIdFrom = (header: string | string[] | undefined) => (typeof header === 'string' && REQUEST_ID.test(header) ? header : newRequestId());

declare module 'fastify' {
  interface FastifyRequest { requestId?: string }
}

/** Maps any error to the API's error shape: { error: CODE, requestId, ...details }. 5xx never leaks the message. */
export function toErrorResponse(err: FastifyError | Error, requestId: string): { status: number; body: Record<string, unknown>; headers?: Record<string, string> } {
  const e = err as FastifyError & { issues?: unknown };
  if (err instanceof ZodError) {
    return { status: 400, body: { error: 'INVALID_INPUT', fields: [...new Set(err.issues.map((i) => i.path.join('.')))], requestId } };
  }
  switch (e.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE': return { status: 413, body: { error: 'PAYLOAD_TOO_LARGE', requestId } };
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_CONTENT_LENGTH':
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE': return { status: e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 415 : 400, body: { error: e.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_JSON', requestId } };
    case 'RATE_LIMITED': return { status: 429, body: { error: 'RATE_LIMITED', requestId }, headers: (e as { retryAfter?: string }).retryAfter ? { 'retry-after': String((e as { retryAfter?: string }).retryAfter) } : undefined };
  }
  const status = typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
  if (status >= 500) return { status: 500, body: { error: 'INTERNAL', requestId } };
  if (status === 429) return { status, body: { error: 'RATE_LIMITED', requestId } };
  return { status, body: { error: 'BAD_REQUEST', requestId } };
}

/**
 * Request ids, security headers, CORS, and one error shape for everything that is thrown or not found.
 *
 * Handlers that call reply.code(4xx).send({ error: 'CODE', ... }) already follow the shape and keep working unchanged; they
 * get the id from the x-request-id response header. Anything thrown (a Zod parse, a database error, a bad body, a rate
 * limit) goes through the error handler below and also carries `requestId` in the body.
 */
export async function registerHttpHardening(app: FastifyInstance, opts: HttpOptions = {}): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    req.requestId = requestIdFrom(req.headers['x-request-id']);
    reply.header('x-request-id', req.requestId);
  });

  // An API returns JSON, never a page, so the policy is the strictest one.
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: opts.hsts ? { maxAge: 15_552_000, includeSubDomains: true } : false,
  });

  const origins = opts.corsOrigins ?? [];
  await app.register(cors, {
    origin: opts.resolveCorsOrigins ? (origin, cb) => {
      if (!origin) { cb(null, false); return; }
      opts.resolveCorsOrigins!().then(allowed => cb(null, allowed.includes(origin)), () => cb(null, origins.includes(origin)));
    } : origins.length ? origins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
    exposedHeaders: ['x-request-id', 'retry-after', 'content-disposition'],
    credentials: false, // bearer tokens, never cookies
    maxAge: opts.resolveCorsOrigins ? 20 : HTTP_LIMITS.corsMaxAgeSeconds,
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'NOT_FOUND', requestId: req.requestId }));

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.requestId ?? newRequestId();
    const r = toErrorResponse(err as Error, requestId);
    if (r.status >= 500) req.log.error({ err, requestId }, 'unhandled error');
    for (const [k, v] of Object.entries(r.headers ?? {})) reply.header(k, v);
    return reply.code(r.status).send(r.body);
  });
}
