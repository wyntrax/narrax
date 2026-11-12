import type { FastifyInstance } from 'fastify';
import type { SwapEvent } from '@narra/queue';
import { parseHeliusSwaps, verifyWebhookAuth } from '@narra/solana';

export interface WebhookDeps {
  recordReceipt?(receipt:{at:string;items:number;parsed:number;queued:number;skipped:number}):Promise<void>;
  /** The current secret, or a reader so an admin rotation applies without a restart. */
  secret: string | (() => Promise<string>);
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
    const secret = typeof deps.secret === 'function' ? await deps.secret() : deps.secret;
    if (!verifyWebhookAuth(req.headers.authorization, secret)) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    const { events, skipped } = parseHeliusSwaps(req.body);
    let queued = 0;
    for (const e of events) {
      if (await deps.isTracked(e.wallet)) { await deps.enqueue(e); queued++; }
    }
    // Record only non-empty authenticated deliveries. An empty health probe must not
    // make an idle ingestion pipeline look active. No raw payloads or credentials.
    if(Array.isArray(req.body)&&req.body.length&&deps.recordReceipt){try{await deps.recordReceipt({at:new Date().toISOString(),items:req.body.length,parsed:events.length,queued,skipped});}catch{req.log.warn('Could not record webhook receipt telemetry');}}
    return { received: events.length, queued, skipped };
  });
}
