import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PrivyAppId, PrivyVerificationKey } from '@narra/shared';
import { makeAuthenticate, type AccountDeps } from './account';
import { AccessError, requireAdminActor } from './entitlements/common';
import { checkPrivyKey } from './privy-key';
import type { RuntimeSettingsResolver } from './runtime-settings';

export function registerRuntimeRoutes(app: FastifyInstance, settings?: RuntimeSettingsResolver, account?: AccountDeps, check = checkPrivyKey) {
  app.get('/v1/public-config', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
      const privyAppId = settings ? (await settings.read()).privyAppId.value : process.env.PRIVY_APP_ID?.trim() ?? '';
      // Revalidate at caches; the resolver owns the single twenty-second freshness window.
      return reply.header('cache-control', 'public, max-age=0, must-revalidate').send({ privyAppId: privyAppId || null });
    } catch {
      return reply.code(503).header('cache-control', 'no-store').send({ error: 'RUNTIME_SETTINGS_UNAVAILABLE', requestId: req.requestId });
    }
  });
  if (!account || !settings) return;
  const opts = { bodyLimit: 8192, config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, preHandler: [makeAuthenticate(account), async (req: FastifyRequest, reply: FastifyReply) => {
    try { await requireAdminActor(account.db, req.userId!); }
    catch { return reply.code(403).send({ error: 'FORBIDDEN', requestId: req.requestId }); }
  }] };
  // Keep these errors value-free, including provider/network and schema failures.
  const handle = (work: (req: FastifyRequest) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await work(req); } catch (e) {
      return reply.code(e instanceof AccessError ? e.status : e instanceof z.ZodError ? 400 : 503).send({ error: e instanceof AccessError ? e.code : e instanceof z.ZodError ? 'INVALID_INPUT' : 'RUNTIME_SETTINGS_UNAVAILABLE', requestId: req.requestId });
    }
  };
  app.get('/v1/admin/runtime-settings', opts, handle(async () => settings.read()));
  app.post('/v1/admin/runtime-settings/check-privy', opts, handle(async req => {
    const body = z.object({ appId: PrivyAppId, verificationKey: PrivyVerificationKey }).strict().parse(req.body);
    const result = await check(body.appId, body.verificationKey);
    if (!result.ok) throw new AccessError(result.error, 400);
    return result;
  }));
}
