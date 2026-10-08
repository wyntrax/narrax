import { buildApp } from './app';
import { createPrisma } from '@narra/database';
import { createQueues, createRedis } from '@narra/queue';
import { createEventStream } from '@narra/realtime';
import { SolanaRpc } from '@narra/solana';
import { makeWalletEventStore } from '@narra/worker-pipeline';
import { OpenAiCompatibleProvider } from '@narra/ai';
import { createPrivyVerifier } from './auth';
import { parseCorsOrigins } from './http';
import { assertEnv } from '@narra/shared';
import { createEntitlementQueue, requestReconcile } from '../../../workers/pipeline/src/entitlementRegistration';

// First, before any connection is opened: stop with a clear list of what is wrong. Messages never contain a value.
assertEnv('api');

const secret = process.env.HELIUS_WEBHOOK_SECRET ?? '';
const connection = createRedis();
// The realtime reader blocks its connection (XREAD BLOCK), so it gets one of its own.
const streamReaderConnection = createRedis();
const queues = createQueues(connection);
const db = createPrisma();
const entitlementQueue = process.env.WYNTRAX_API_BASE_URL && process.env.WYNTRAX_API_KEY ? createEntitlementQueue(connection) : null;
const store = makeWalletEventStore(db);

// Edits to tracked wallets ask the worker to sync the Helius webhook. Without Helius credentials the scheduled job is also off.
const syncConfigured = !!(process.env.HELIUS_API_KEY && process.env.HELIUS_WEBHOOK_URL && secret);

const chatLlm = process.env.AI_PROVIDER_API_KEY ? new OpenAiCompatibleProvider({ apiKey: process.env.AI_PROVIDER_API_KEY, baseUrl: process.env.AI_BASE_URL }) : null;
if (!chatLlm) console.log('no AI provider configured: chat is off');

// An async function because this file runs as CommonJS under tsx, which has no top-level await.
async function main() {
  const app = await buildApp({
    wyntrax: { db, secret: process.env.WYNTRAX_WEBHOOK_SECRET || undefined, previousSecret: process.env.WYNTRAX_WEBHOOK_SECRET_PREVIOUS || undefined, enqueueReconcile: entitlementQueue ? () => requestReconcile(entitlementQueue) : undefined },
    chatLlm,
    requestWalletSync: syncConfigured ? () => queues.requestWalletSync() : undefined,
    enqueueExecution: (job) => queues.enqueueExecution(job),
    account: { db, verifier: createPrivyVerifier({ appId: process.env.PRIVY_APP_ID ?? '', verificationKey: process.env.PRIVY_VERIFICATION_KEY ?? '' }) },
    webhooks: {
      secret,
      enqueue: (e) => queues.enqueueWalletEvent(e),
      isTracked: (wallet) => store.isTracked(wallet),
    },
    // Exact origins only (comma separated). Empty means browsers on other origins are refused.
    http: { corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS), hsts: process.env.HSTS === 'true' },
    // Only when the API is behind a reverse proxy you control. Otherwise a client could spoof its address and dodge rate limits.
    trustProxy: process.env.TRUST_PROXY === 'true',
    // Yes or no only. The values of these settings never leave the server.
    connections: () => [
      { name: 'privy', configured: !!(process.env.PRIVY_APP_ID && process.env.PRIVY_VERIFICATION_KEY), purpose: 'Sign-in' },
      { name: 'helius-webhooks', configured: syncConfigured, purpose: 'Tracked wallet swap events' },
      { name: 'helius-rpc', configured: !!process.env.HELIUS_RPC_URL, purpose: 'Balances and wallet history' },
      { name: 'jupiter', configured: !!process.env.JUPITER_API_KEY, purpose: 'Swap quotes' },
      { name: 'ai-provider', configured: !!process.env.AI_PROVIDER_API_KEY, purpose: 'Opportunity analysis and position review' },
    ],
    ops: { redisPing: async () => (await connection.ping()) === 'PONG', queueCounts: () => queues.counts(), marketDataEnabled: process.env.MARKET_DATA_ENABLED !== 'false' },
    balances: process.env.HELIUS_RPC_URL ? new SolanaRpc({ url: process.env.HELIUS_RPC_URL }) : undefined,
    realtime: { stream: createEventStream(connection), readerStream: createEventStream(streamReaderConnection) },
  });
  const port = Number(process.env.API_PORT || 4000);
  await app.listen({ port, host: '0.0.0.0' });

  const shutdown = async () => {
    await app.close(); // closes WebSocket clients and stops the stream reader first
    await entitlementQueue?.close();
    await queues.close(); connection.disconnect(); streamReaderConnection.disconnect(); await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
