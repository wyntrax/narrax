import type { FastifyInstance } from 'fastify';
import type { SwapEvent } from '@narra/queue';
import { parseHeliusSwaps, verifyWebhookAuth } from '@narra/solana';

export interface WebhookDeps {
  secret: string;
  enqueue(event: SwapEvent): Promise<unknown>;
  /** Only events from wallets we track are queued. */
  isTracked(wallet: string): Promise<boolean>;
}

/**
 * Receives Helius webhooks. The handler only verifies, parses, filters and enqueues.
 * All real work happens in workers, never in a request handler.
 */
export function registerWebhooks(app: FastifyInstance, deps: WebhookDeps): void {
  app.post('/webhooks/helius', { bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    if (!verifyWebhookAuth(req.headers.authorization, deps.secret)) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    const { events, skipped } = parseHeliusSwaps(req.body);
    let queued = 0;
    for (const e of events) {
      if (await deps.isTracked(e.wallet)) { await deps.enqueue(e); queued++; }
    }
    return { received: events.length, queued, skipped };
  });
}
