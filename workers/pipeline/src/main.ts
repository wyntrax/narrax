/**
 * Worker bootstrap. Reads and writes Postgres through Prisma.
 * This process cannot sign or send transactions and does NOT consume the execution queue (workers/executor does).
 * Set a Helius RPC URL in the environment or on the admin page to enable real balances for the fan-out and portfolio snapshots. Without it the chain ports throw and real-wallet users are skipped.
 */
import { Worker } from 'bullmq';
import { publishWalletResearch, measureWalletResearch } from './walletResearch';
import { refreshResearchHistory } from './walletResearchHistory';
import { intakeEmergingWallets } from './walletCandidateIntake';
import {combinedMetadataSource,jupiterMetadataSource} from './tokenMetadata';
import { createPrisma } from '@narra/database';
import { AiScreeningJobSchema, QUEUE_NAMES, SwapEventSchema, TokenDiscoveryJobSchema, WyntraxHoldingsJobSchema, WyntraxMembershipEventSchema, createQueues, createRedis } from '@narra/queue';
import { HeliusWebhooks, JupiterClient } from '@narra/solana';
import { runTregJob } from './tregJob';
import { trackEarlyRadarOutcomes } from './earlyRadarTracking';
import { DexScreenerSource, GeckoTerminalSource } from '@narra/market-data';
import { aiProviderFromEnv } from '@narra/ai';
import { makeWalletEventStore, processWalletEvent, ingestNarratives, makeChainPorts, refreshMarketData, processScreeningJob, runAiAnalysis, recomputeWalletIntelligence, resolveTokens, attributeNarrativeMentions, scanSocialTokens, monitorPositions, syncWalletWebhook, ingestWalletFunding, rebuildFundingGraph, scanEarlyBuyers, discoverCandidates, discoverTokenWallets, expirePendingConfirmations, fanOutEntries, fanOutExits, writePortfolioSnapshots, trackOutcomes, dispatchAlerts, publishNewEvents, createHeliusRuntime, type ChainPorts, type WalletEventDeps } from './index';
import { assertEnv } from '@narra/shared';
import { makeDeveloperHoldingSource } from './developerHoldings';
import { makeRadarSafetySource } from './radarSafetyEvidence';
import { makeLaunchEvidenceSource } from './launchEvidence';
import { makeTradeabilitySource } from './tradeabilityEvidence';
import { deliverEarlyRadarTelegram, telegramConfigFromSettings, TelegramBotApiTransport } from './telegram';
import { tregConfigFromSettings } from './integrationSettings';
import {refreshRadarHolders} from './holderFallback';
import {deliverTelegramFeedHealth} from './telegramHealth';
import { syncWyntraxHoldings } from './wyntraxHoldings';
import { deliverWyntraxMembership } from './wyntraxMembership';
import { acquireWorkerLock, WORKER_LOCK_KEY } from './workerLock';

// First, before any connection is opened: stop with a clear list of what is wrong. Messages never contain a value.
assertEnv('worker', process.env, console, undefined, { runtimeHelius: true });

const WORKER_LOCK_TTL_MS = 90_000;

async function main(): Promise<void> {
  const connection = createRedis();
  // Two pipeline processes would double-consume every queue, and Telegram delivery has no
  // per-chat cursor lock, so a second process could send the same alert twice.
  const lock = await acquireWorkerLock(connection, `${process.pid}:${Date.now()}`, WORKER_LOCK_TTL_MS, () => {
    console.error(JSON.stringify({msg:'worker_lock_lost',detail:'pipeline lease expired, was removed, or changed owner'}));
    process.exit(1);
  });
  if (!lock) {
    // The lease value is the owning pid and start time, so an operator can tell a crashed
    // process from a deliberate one without opening Redis.
    const [holder, ttlMs] = await Promise.all([connection.get(WORKER_LOCK_KEY), connection.pttl(WORKER_LOCK_KEY)]);
    console.error(JSON.stringify({ msg: 'worker_already_running', detail: 'stop the other pipeline worker before starting this one', holder, ttlMs }));
    connection.disconnect();
    process.exit(1);
  }
  const queues = createQueues(connection);
  const db = createPrisma();
  // Admin-managed Helius settings, re-read every few seconds. No restart is needed
  // after a save; every job builds its clients from the current endpoint pools.
  const helius = createHeliusRuntime(db);
  const startup = await helius.read();
  if (startup.invalid.length) console.warn(`ignoring invalid stored Helius settings: ${startup.invalid.join(', ')}`);
  console.log(`helius: ${startup.rpcUrls.value.length} primary, ${startup.rpcFallbackUrls.value.length} fallback, ${startup.holderRpcUrls.value.length} holder endpoint(s)`);
  const jupiter = new JupiterClient({ apiKey: process.env.JUPITER_API_KEY });
  const chainFor = async (): Promise<ChainPorts | null> => {
    const rpc = await helius.rpc();
    return rpc ? makeChainPorts({ db, rpc, jupiter }) : null;
  };

  const walletStore = makeWalletEventStore(db);
  const walletDeps: WalletEventDeps = { ...walletStore, enqueueAiScreening: (j) => queues.enqueueAiScreening(j) };

  // Integrations are admin-managed (with the environment as fallback) and read again on every job. The startup read
  // still fails fast on an invalid environment configuration, exactly as the env-only reader did.
  const startupTreg = await tregConfigFromSettings(db);
  if (!startupTreg) console.log('narrative ingestion off: enable Treg on the admin page or set TREG_NARRATIVE_ENABLED and TREG_TOKEN');
  else console.log(`narrative ingestion on: ${startupTreg.config.platforms.join(', ')} · ${startupTreg.config.topics.length} topics`);
  const startupTelegram = await telegramConfigFromSettings(db);
  if (!startupTelegram) console.log('telegram delivery off: set the bot token and group chat on the admin page or in TELEGRAM_*');
  else console.log(`telegram delivery on: chat ${startupTelegram.chatId}`);

  // Market data comes from free public APIs that need no key. Set MARKET_DATA_ENABLED=false to turn the job off.
  // With it off, no prices, holders or risk rows are written, so token resolution ranks nothing (fail closed).
  const marketEnabled = process.env.MARKET_DATA_ENABLED !== 'false';
  const gecko = new GeckoTerminalSource({ baseUrl: process.env.GECKOTERMINAL_BASE_URL });
  const quotes = new DexScreenerSource({ baseUrl: process.env.DEXSCREENER_BASE_URL });
  const marketDepsFor = async () => {
    if (!marketEnabled) return null;
    const metadata = combinedMetadataSource(await helius.metadataSource(), jupiterMetadataSource());
    const rpc = await helius.rpc(15_000);
    return { holderFallback: await helius.holderSource(), metadata, quotes, info: gecko, launches: gecko, developerHoldings: rpc ? makeDeveloperHoldingSource(db, rpc) : null, launchEvidence: rpc ? makeLaunchEvidenceSource(db, rpc) : null };
  };
  // Bounded public RugCheck lookups for early-radar candidates only. Missing/failed data stays UNKNOWN.
  const radarSafety = marketEnabled ? makeRadarSafetySource(db) : null;
  const tradeability = makeTradeabilitySource(db);
  if (tradeability) console.log('radar tradeability evidence on: jupiter, $50 USDC quote');
  if (radarSafety) console.log(`radar safety evidence on: rugcheck, max ${process.env.RADAR_SAFETY_EVIDENCE_MAX_PER_RUN ?? '3'} lookups per run`);
  if (marketEnabled) console.log('radar launch evidence on: bounded Helius launch scan, 2 candidates per run');

  // Telegram is a delivery layer for global research alerts only. It is off unless the admin page (or env) enables it.
  // The worker never reads user-owned alerts and cannot place orders or touch a position.

  // Wallet jobs. History scans need an RPC URL. Webhook sync needs the Helius API key, the public webhook URL and the shared secret.
  // Each job does nothing when its inputs are missing, and none of them can trade.
  // $WYNTRAX holding checks write local entitlements. The optional outbound notification keeps Wyntrax membership in sync.
  const membershipWebhook = process.env.WYNTRAX_MEMBERSHIP_WEBHOOK_URL && process.env.WYNTRAX_MEMBERSHIP_WEBHOOK_SECRET
    ? { url: process.env.WYNTRAX_MEMBERSHIP_WEBHOOK_URL, secret: process.env.WYNTRAX_MEMBERSHIP_WEBHOOK_SECRET }
    : null;
  if (!startup.ready.rpc) console.log('no Helius RPC URL: $WYNTRAX holding checks are off');
  else if (!membershipWebhook) console.log('$WYNTRAX holding checks on; outbound membership webhook off');
  else console.log('$WYNTRAX holding checks on; outbound membership webhook on');
  if (!startup.ready.rpc) console.log('no Helius RPC URL: wallet funding and discovery scans are off');
  if (!startup.ready.webhook) console.log('wallet webhook sync is off: set the Helius API key, webhook URL and webhook secret on the admin page or in the environment');

  // With no key the AI jobs skip. Nothing else depends on them, and nothing trades on their absence.
  const llm = aiProviderFromEnv();
  if (!llm) console.log('no AI provider configured');

  // Registering the repeating jobs. Done in an async block because this file runs as CommonJS under tsx, which has no top-level await.
  const scheduled = (async () => {
    await queues.scheduleWalletIntelligence();
    await queues.scheduleAiAnalysis();
    await queues.scheduleNarrativeIngestion(startupTreg?.config.intervalMs);
    await queues.scheduleTokenResolution();
    await queues.scheduleMarketData();
    await queues.scheduleHolderRefresh();
    await queues.scheduleWalletSync();
    await queues.schedulePositionMonitor();
    await queues.scheduleWalletFunding();
    await queues.scheduleWalletDiscovery();
    await queues.scheduleEntryFanOut();
    await queues.scheduleExitFanOut();
    await queues.schedulePortfolioSnapshots();
    await queues.scheduleOutcomeTracking();
    await queues.scheduleNotificationDispatch();
    await queues.scheduleRealtimePublish();
    // Always scheduled. The job checks the current admin settings and does nothing when delivery is off.
    await queues.scheduleTelegramDelivery();
    // Always scheduled. The job checks the current admin settings and does nothing when
    // no RPC is configured, so adding a key later does not need a restart.
    await queues.scheduleWyntraxHoldings();
  })();
  scheduled.then(() => console.log('schedules registered'), (e) => { console.error('could not register schedules:', e instanceof Error ? e.message : e); process.exit(1); });
  // Ask for a webhook sync now; the job reads the current settings. After an admin
  // secret change this updates the remote webhook without waiting for the next run.
  await queues.requestWalletSync().catch((e) => console.error('could not enqueue the initial webhook sync:', e instanceof Error ? e.message : e));

  const workers = [
    new Worker(QUEUE_NAMES.walletEvents, (j) => processWalletEvent(SwapEventSchema.parse(j.data), walletDeps), { connection, concurrency: 8 }),
    // One recompute at a time: it rewrites profiles, clusters and consensus together.
    new Worker(QUEUE_NAMES.walletIntelligence, async () => {
      const research = process.env.SMART_MONEY_RESEARCH_ENABLED === 'true';
      const current = await helius.read(), apiKey = current.apiKey.value;
      const historyEnabled = process.env.SMART_MONEY_HISTORY_ENABLED === 'true', providerConfigured = !!apiKey;
      const intake = historyEnabled && providerConfigured ? await intakeEmergingWallets(db) : null;
      if (intake?.added) await queues.requestWalletSync();
      const history = historyEnabled && apiKey ? await refreshResearchHistory(db, apiKey) : null;
      const intelligence = await recomputeWalletIntelligence(db);
      const pipeline = { checkedAt: new Date().toISOString(), historyEnabled, providerConfigured, intakeAdded: intake?.added ?? 0, scanned: history?.scanned ?? 0, failures: history?.failures ?? 0,
        intelligence: { readPages:intelligence.readPages,loadMs:intelligence.loadMs,computeMs:intelligence.computeMs,publishMs:intelligence.publishMs,publicationOperations:intelligence.publicationOperations,tradesUsed:intelligence.tradesUsed } };
      await db.systemSetting.upsert({ where: { key: 'wallet.evaluation.pipeline' }, create: { key: 'wallet.evaluation.pipeline', value: pipeline }, update: { value: pipeline } });
      console.log(JSON.stringify({msg:'wallet_intelligence_complete',...pipeline.intelligence}));
      return JSON.stringify({ ...intelligence, history, research: research ? await publishWalletResearch(db) : 'disabled' });
    }, { connection, concurrency: 1 }),
    // Position monitor: recommends exits and raises alerts. It never closes a position or places an order. The AI review is optional.
    new Worker(QUEUE_NAMES.positionMonitor, async () => JSON.stringify(await monitorPositions(db, { llm })), { connection, concurrency: 1 }),
    new Worker(QUEUE_NAMES.aiAnalysis, async () => JSON.stringify(await runAiAnalysis(db, { llm })), { connection, concurrency: 1 }),
    new Worker(QUEUE_NAMES.aiScreening, async (j) => JSON.stringify(await processScreeningJob(db, { llm }, AiScreeningJobSchema.parse(j.data))), { connection, concurrency: 2 }),
    new Worker(QUEUE_NAMES.tokenResolution, async () => {
      const deps = await marketDepsFor();
      return JSON.stringify({ mentionLinks: await attributeNarrativeMentions(db), ...(await resolveTokens(db, undefined, { safety: radarSafety, tradeability, launchEvidence: deps?.launchEvidence ?? null })), social: await scanSocialTokens(db, { quotes: deps?.quotes ?? null, safety: radarSafety, tradeability, launchEvidence: deps?.launchEvidence ?? null }).catch(() => 'social scan failed') });
    }, { connection, concurrency: 1 }),
    // One refresh at a time: the sources are rate limited per process.
    new Worker(QUEUE_NAMES.marketData, async () => {
      const deps = await marketDepsFor();
      return deps ? JSON.stringify(await refreshMarketData(db, deps)) : 'disabled';
    }, { connection, concurrency: 1 }),
    // Radar-cohort holders need a 60-minute gate, but the market run is already close to its
    // 5-minute schedule. Refresh a few cohort tokens a minute instead of lengthening that run.
    new Worker(QUEUE_NAMES.holderRefresh, async () => {
      const deps = await marketDepsFor();
      const source = deps?.holderFallback ?? null;
      if (!source) return 'disabled';
      const summary = await refreshRadarHolders(db, source);
      console.log(JSON.stringify({ msg: 'holder_refresh_complete', ...summary }));
      return JSON.stringify(summary);
    }, { connection, concurrency: 1 }),
    new Worker(QUEUE_NAMES.walletSync, async () => {
      const current = await helius.read();
      if (!(current.apiKey.value && current.webhookUrl.value && current.webhookSecret.value)) return 'not configured';
      return JSON.stringify(await syncWalletWebhook(db, new HeliusWebhooks({ apiKey: current.apiKey.value }), { webhookUrl: current.webhookUrl.value, authHeader: current.webhookSecret.value }));
    }, { connection, concurrency: 1 }),
    new Worker(QUEUE_NAMES.walletFunding, async () => {
      const rpc = await helius.rpc(15_000);
      const ingest = rpc ? await ingestWalletFunding(db, rpc) : null;
      return JSON.stringify({ ingest, graph: await rebuildFundingGraph(db) });
    }, { connection, concurrency: 1 }),
    new Worker(QUEUE_NAMES.walletDiscovery, async () => {
      const tiers = await helius.rpcTiers(15_000);
      if (!tiers.primary) return 'needs a Helius RPC URL';
      return JSON.stringify({ scan: await scanEarlyBuyers(db, tiers.primary, new Date(), { fallbackRpc: tiers.fallback ?? undefined }), discovery: await discoverCandidates(db) });
    }, { connection, concurrency: 1 }),
    // User-requested, token-scoped discovery. It adds provisional wallets and bounded recent history, then asks for a webhook sync.
    new Worker(QUEUE_NAMES.tokenDiscovery, async (job) => {
      const { mint } = TokenDiscoveryJobSchema.parse(job.data);
      const token = await db.token.findUnique({ where: { mint }, select: { id: true, mint: true, symbol: true, blacklisted: true } });
      if (!token || token.blacklisted) return 'token not found';
      const summary = await discoverTokenWallets(db, { tokenId: token.id, mint: token.mint, symbol: token.symbol, apiKey: (await helius.read()).apiKey.value });
      if (summary.newWallets > 0) await queues.requestWalletSync();
      return JSON.stringify(summary);
    }, { connection, concurrency: 1 }),
    new Worker(QUEUE_NAMES.narrativeIngestion, async (job) => {
      let integration: Awaited<ReturnType<typeof tregConfigFromSettings>>;
      try {
        integration = await tregConfigFromSettings(db);
      } catch (error) {
        // A stored-but-invalid credential fails closed and is visible in the queue result without leaking a value.
        return JSON.stringify({ skipped: 'invalid', code: error instanceof Error ? error.message : 'INVALID_TREG_CONFIG' });
      }
      if (!integration) return 'disabled';
      return runTregJob(db, integration.config, job, { token: integration.token, ...(integration.org ? { org: integration.org } : {}) });
    }, { connection, concurrency: 1 }),
    // Fan-out only creates jobs. It cannot trade, and neither can the jobs: with no Executor they end as a paper fill, a pending confirmation, a log row, a dry run or execution_disabled.
    new Worker(QUEUE_NAMES.entryFanOut, async () => {
      const expired = await expirePendingConfirmations(db, new Date());
      return JSON.stringify({ expired, ...(await fanOutEntries(db, { chain: await chainFor(), enqueue: (j) => queues.enqueueExecution(j) })) });
    }, { connection, concurrency: 1 }),
    new Worker(QUEUE_NAMES.exitFanOut, async () => JSON.stringify(await fanOutExits(db, { enqueue: (j) => queues.enqueueExecution(j) })), { connection, concurrency: 1 }),
    new Worker(QUEUE_NAMES.outcomeTracking, async () => JSON.stringify({decisions:await trackOutcomes(db),earlyRadar:await trackEarlyRadarOutcomes(db),walletResearch:process.env.SMART_MONEY_RESEARCH_ENABLED==='true'?await measureWalletResearch(db):'disabled'}), { connection, concurrency: 1 }),
    new Worker(QUEUE_NAMES.portfolioSnapshots, async () => JSON.stringify(await writePortfolioSnapshots(db, { chain: await chainFor() })), { connection, concurrency: 1 }),
    // Alerts to per-user notifications. Idempotent and safe to run on several workers at once.
    new Worker(QUEUE_NAMES.notificationDispatch, async () => JSON.stringify(await dispatchAlerts(db)), { connection, concurrency: 1 }),
    // New rows to the realtime stream. A failure here never affects the jobs that wrote the rows.
    new Worker(QUEUE_NAMES.realtimePublish, async () => JSON.stringify(await publishNewEvents(db, connection)), { connection, concurrency: 1 }),
    // Global Early Radar alerts to Telegram. Read-only delivery: no alert, order or position is written here.
    new Worker(QUEUE_NAMES.telegramDelivery, async () => {
      const config = await telegramConfigFromSettings(db).catch(() => null);
      if (!config) return 'telegram disabled';
      const transport = new TelegramBotApiTransport(config.token, config.botApiBase);
      const summary = await deliverEarlyRadarTelegram(db, {
        chatId: config.chatId, transport, dryRun: false,
        maxAgeMs: config.maxAgeMs, limit: config.limit, delayMs: config.delayMs,
      });
      if (summary.lastError || summary.sent || summary.failed || summary.stopped) {
        console.log(JSON.stringify({
          msg: 'telegram_delivery', scanned: summary.scanned, candidates: summary.candidates,
          sent: summary.sent, stale: summary.skippedStale, failed: summary.failed,
          stopped: summary.stopped, error: summary.lastError,
        }));
      }
      if(process.env.TELEGRAM_HEALTH_NOTICES!=='false'&&!summary.sent&&!summary.failed&&!summary.stopped){
        const health=await deliverTelegramFeedHealth(db,{chatId:config.chatId,transport,dryRun:false});
        if(health.sent||health.reason==='SEND_FAILED')console.log(JSON.stringify({msg:'telegram_feed_health',...health}));
      }
      return JSON.stringify(summary);
    }, { connection, concurrency: 1 }),
    // $WYNTRAX holding discovery. It can grant paid access locally and enqueue an outbound Wyntrax membership event.
    new Worker(QUEUE_NAMES.wyntraxHoldings, async (job) => {
      const rpc = await helius.rpc(15_000);
      if (!rpc) return 'needs a Helius RPC URL';
      const { userId } = WyntraxHoldingsJobSchema.parse(job.data);
      return JSON.stringify(await syncWyntraxHoldings({
        db, rpc, now: () => new Date(), enqueue: event => queues.enqueueWyntraxMembership(event),
      }, { userId }));
    }, { connection, concurrency: 1 }),
    // Delivery only. The payload is validated again here, and a missing receiver is a completed no-op.
    new Worker(QUEUE_NAMES.wyntraxMembership, async (job) => {
      const event = WyntraxMembershipEventSchema.parse(job.data);
      if (!membershipWebhook) return 'not configured';
      return deliverWyntraxMembership(event, membershipWebhook);
    }, { connection, concurrency: 2 }),
    // The execution queue is consumed by workers/executor, a separate process, since B5a. This process only enqueues.
  ];
  for (const w of workers) w.on('failed', (job, err) => console.error(JSON.stringify({ msg: 'job_failed', queue: w.name, id: job?.id, err: err.message })));

  const shutdown = async () => { await Promise.all(workers.map((w) => w.close())); await queues.close(); await lock.release(); connection.disconnect(); await db.$disconnect(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  console.log('workers started');
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
