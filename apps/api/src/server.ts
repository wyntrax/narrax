import { buildApp } from './app';
import { createPrisma } from '@narra/database';
import { createQueues, createRedis, createPersonalResearchQueue } from '@narra/queue';
import { createEventStream } from '@narra/realtime';
import { JupiterClient } from '@narra/solana';
import { DexScreenerSource } from '@narra/market-data';
import { createHeliusRuntime, makeWalletEventStore } from '@narra/worker-pipeline';
import { aiProviderFromEnv } from '@narra/ai';
import { createRuntimePrivyVerifier } from './auth';
import { createRuntimeSettings } from './runtime-settings';
import { parseCorsOrigins } from './http';
import { assertEnv } from '@narra/shared';
import {makeManualSwapEngine} from './manual-swap-engine';

// First, before any connection is opened: stop with a clear list of what is wrong. Messages never contain a value.
assertEnv('api', process.env, console, undefined, { runtimeAuth: true, runtimeHelius: true });

const connection = createRedis();
// The realtime reader blocks its connection (XREAD BLOCK), so it gets one of its own.
const streamReaderConnection = createRedis();
const queues = createQueues(connection);
const personalResearch = createPersonalResearchQueue(connection);
const db = createPrisma();
const runtime = createRuntimeSettings(db);
const store = makeWalletEventStore(db);

const chatLlm = aiProviderFromEnv();
if (!chatLlm) console.log('no AI provider configured: chat is off');

// An async function because this file runs as CommonJS under tsx, which has no top-level await.
async function main() {
  const config = await runtime.read();
  // Admin-managed Helius settings, re-read at most every few seconds. No restart is
  // needed after a save; the API's own cache is invalidated by the admin route.
  const helius = createHeliusRuntime(db);
  const startup = await helius.read();
  if (startup.invalid.length) console.warn(`ignoring invalid stored Helius settings: ${startup.invalid.join(', ')}`);
  console.log(`helius: ${startup.rpcUrls.value.length} primary, ${startup.rpcFallbackUrls.value.length} fallback, ${startup.holderRpcUrls.value.length} holder endpoint(s)`);
  // Manual swaps use one endpoint per request; rotate the URL so they share the pool.
  let manualCursor = 0;
  const manualRpcUrl = async () => {
    const current = await helius.read();
    const urls = [...current.rpcUrls.value, ...current.rpcFallbackUrls.value];
    if (!urls.length) return '';
    const url = urls[manualCursor % urls.length]!;
    manualCursor++;
    return url;
  };
  const paperQuoteClient=new JupiterClient({apiKey:process.env.JUPITER_API_KEY});
  if (!config.privyAppId.value || !config.privyVerificationKey.value) throw new Error('Configure Privy in SystemSetting or PRIVY_APP_ID and PRIVY_VERIFICATION_KEY.');
  const app = await buildApp({
    manualSwaps: process.env.JUPITER_API_KEY?makeManualSwapEngine(process.env.JUPITER_API_KEY,manualRpcUrl,process.env.MANUAL_TRADING_ENABLED==='true'):undefined,
    runtime,
    wyntrax: { db, secret: process.env.WYNTRAX_WEBHOOK_SECRET || undefined, previousSecret: process.env.WYNTRAX_WEBHOOK_SECRET_PREVIOUS || undefined },
    chatLlm,
    // Quote-only provider. Manual paper routes can never enqueue, sign or send.
    paperQuotes:{getQuote:request=>paperQuoteClient.getQuote(request)},
    // One-token on-demand market quote. No wallet, signing or execution access.
    marketQuotes: new DexScreenerSource({ baseUrl: process.env.DEXSCREENER_BASE_URL }),
    requestWalletSync: () => queues.requestWalletSync(),
    enqueueExecution: (job) => queues.enqueueExecution(job),
    account: { db, verifier: createRuntimePrivyVerifier(runtime), requestPersonalResearch: userId => personalResearch.request(userId), requestTokenDiscovery: mint => queues.enqueueTokenDiscovery(mint), requestMembershipSync: userId => queues.requestWyntraxHoldings(userId) },
    helius,
    webhooks: {
      secret: async () => (await helius.read()).webhookSecret.value,
      enqueue: (e) => queues.enqueueWalletEvent(e),
      isTracked: (wallet) => store.isTracked(wallet),
      recordReceipt: async value => {const key='health.walletWebhook.receipt';await db.systemSetting.upsert({where:{key},create:{key,value},update:{value}});},
    },
    // Exact origins only (comma separated). Empty means browsers on other origins are refused.
    http: { corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS), resolveCorsOrigins: runtime.origins, hsts: process.env.HSTS === 'true' },
    // Only when the API is behind a reverse proxy you control. Otherwise a client could spoof its address and dodge rate limits.
    trustProxy: process.env.TRUST_PROXY === 'true',
    // Yes or no only. The values of these settings never leave the server.
    connections: async () => {
      const current = await helius.read();
      return [
        { name: 'privy', configured: !!(config.privyAppId.value && config.privyVerificationKey.value), purpose: 'Sign-in' },
        { name: 'helius-webhooks', configured: current.ready.webhook, purpose: 'Tracked wallet swap events' },
        { name: 'helius-rpc', configured: current.ready.rpc, purpose: 'Balances and wallet history' },
        { name: 'jupiter', configured: !!process.env.JUPITER_API_KEY, purpose: 'Swap quotes' },
        { name: 'ai-provider', configured: !!process.env.AI_PROVIDER_API_KEY, purpose: 'Opportunity analysis and position review' },
      ];
    },
    ops: { redisPing: async () => (await connection.ping()) === 'PONG', queueCounts: () => queues.counts(), queueHealth:()=>queues.health(), marketDataEnabled: process.env.MARKET_DATA_ENABLED !== 'false',webhookConfigured:async()=>(await helius.read()).ready.webhook,aiProviderConfigured:!!process.env.AI_PROVIDER_API_KEY },
    balances: {
      getBalanceLamports: async (address) => {
        const rpc = await helius.rpc(8_000);
        if (!rpc) throw new Error('Helius RPC is not configured');
        return rpc.getBalanceLamports(address);
      },
      configured: async () => (await helius.read()).ready.rpc,
    },
    realtime: { stream: createEventStream(connection), readerStream: createEventStream(streamReaderConnection) },
  });
  const port = Number(process.env.API_PORT || 4000);
  await app.listen({ port, host: '0.0.0.0' });

  const shutdown = async () => {
    await app.close(); // closes WebSocket clients and stops the stream reader first
    await queues.close(); await personalResearch.queue.close(); connection.disconnect(); streamReaderConnection.disconnect(); await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
