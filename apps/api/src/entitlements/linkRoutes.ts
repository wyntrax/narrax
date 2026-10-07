import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { makeAuthenticate, type AccountDeps } from '../account';
import { AccessError } from './common';
import { createWalletChallenge, unlinkWallet, verifyWalletChallenge } from './linking';

export function registerLinkedWalletRoutes(app: FastifyInstance, deps: AccountDeps) {
  const now = deps.now ?? (() => new Date());
  const options = (max: number) => ({ preHandler: makeAuthenticate(deps), config: { rateLimit: { max, timeWindow: '1 minute' } }, bodyLimit: 4096 });
  const handle = (work: (req: FastifyRequest) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    try { return await work(req); } catch (e) {
      if (e instanceof AccessError) return reply.code(e.status).send({ error: e.code, requestId: req.requestId });
      req.log.error({ code: 'WALLET_LINK_STORAGE_FAILURE', requestId: req.requestId }, 'wallet link operation unavailable');
      return reply.code(503).send({ error: 'WALLET_LINK_UNAVAILABLE', requestId: req.requestId });
    }
  };
  app.post('/v1/me/linked-wallets/challenge', options(10), handle(req => createWalletChallenge(deps.db, req.userId!, req.body, now)));
  app.post('/v1/me/linked-wallets/verify', options(20), handle(req => verifyWalletChallenge(deps.db, req.userId!, req.body, now)));
  app.get('/v1/me/linked-wallets', options(60), handle(async req => ({ items: await deps.db.linkedWallet.findMany({ where: { userId: req.userId! }, select: { id: true, chain: true, address: true, verifiedAt: true }, orderBy: { createdAt: 'asc' } }) })));
  app.delete('/v1/me/linked-wallets/:id', options(10), handle(async req => { await unlinkWallet(deps.db, req.userId!, (req.params as { id: string }).id, now()); return { ok: true }; }));
}
