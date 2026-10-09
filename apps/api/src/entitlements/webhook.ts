import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@narra/database';
import { authenticateWyntrax, WyntraxEvent } from './wyntrax';
import { hash } from './crypto';
import { applyWyntraxEvent } from './membershipStore';

export interface WyntraxDeps { db?: PrismaClient; secret?: string; previousSecret?: string; now?: () => Date }
export async function registerWyntraxWebhook(app: FastifyInstance, deps: WyntraxDeps = {}) {
  await app.register(async scoped => {
    scoped.setErrorHandler((error, req, reply) => {
      const status = (error as { statusCode?: number }).statusCode;
      const code = status === 413 ? 413 : status === 429 ? 429 : status && status < 500 ? 400 : 503;
      return reply.code(code).send({ error: code === 413 ? 'PAYLOAD_TOO_LARGE' : code === 429 ? 'RATE_LIMITED' : code === 400 ? 'INVALID_INPUT' : 'WYNTRAX_UNAVAILABLE', requestId: req.requestId });
    });
    scoped.removeAllContentTypeParsers();
    // Parsing JSON happens only after the exact raw bytes have passed authentication.
    scoped.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 16384 }, (_req, body, done) => done(null, body));
    scoped.post('/v1/integrations/wyntrax/events', {
      bodyLimit: 16384, config: { rateLimit: { max: 120, timeWindow: '1 minute', groupId: 'wyntrax-webhook' } },
      onRequest: async (req, reply) => {
        if (!deps.secret || !deps.db) return reply.code(503).send({ error: 'WYNTRAX_UNAVAILABLE', requestId: req.requestId });
      },
    }, async (req, reply) => {
      const fail = (status: number, error: string) => reply.code(status).send({ error, requestId: req.requestId });
      const now = (deps.now ?? (() => new Date()))();
      const raw = req.body;
      if (!Buffer.isBuffer(raw)) return fail(400, 'INVALID_INPUT');
      const timestamp = req.headers['x-wyntrax-timestamp'], signature = req.headers['x-wyntrax-signature'];
      // Node can coalesce duplicate headers; reject their raw occurrences too.
      const names = req.raw.rawHeaders.filter((_v, i) => i % 2 === 0).map(s => s.toLowerCase());
      if (['x-wyntrax-timestamp', 'x-wyntrax-signature', 'x-wyntrax-event-id'].some(h => names.filter(n => n === h).length > 1)) return fail(401, 'UNAUTHORIZED');
      if (!authenticateWyntrax(raw, { timestamp, signature }, deps, now)) return fail(401, 'UNAUTHORIZED');
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '') || req.headers['content-encoding']) return fail(400, 'INVALID_INPUT');
      let json: unknown;
      try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { return fail(400, 'INVALID_INPUT'); }
      const parsed = WyntraxEvent.safeParse(json);
      if (!parsed.success || typeof req.headers['x-wyntrax-event-id'] !== 'string' || parsed.data.id !== req.headers['x-wyntrax-event-id']) return fail(400, 'INVALID_INPUT');
      try {
        const status = await applyWyntraxEvent(deps.db!, parsed.data, hash(raw), now);
        return { ok: true, status };
      } catch {
        // Do not serialize provider payloads, Prisma arguments, secrets or signatures into error logs.
        req.log.error({ code: 'WYNTRAX_STORAGE_FAILURE', requestId: req.requestId }, 'membership update unavailable');
        return fail(503, 'WYNTRAX_UNAVAILABLE');
      }
    });
  });
}
