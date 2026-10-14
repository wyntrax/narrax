import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { AgentDecisionSchema, getBrand } from '@narra/shared';
import { PROFILES, RiskContextSchema, RiskLimitsSchema, evaluateRisk } from '@narra/risk';
import { registerWebhooks, type WebhookDeps } from './webhooks';
import { registerAccountRoutes, type AccountDeps } from './account';
import { registerReadRoutes } from './read';
import { registerAdminRoutes, type ConnectionStatus } from './admin';
import { registerWalletAdminRoutes } from './wallets';
import { registerConfirmationRoutes } from './confirmations';
import { registerChatRoutes } from './chat';
import { registerAnalyticsRoutes } from './analytics';
import { registerAdminOpsRoutes } from './adminOps';
import { registerAdminStatusRoutes, type OpsDeps } from './adminStatus';
import type { LlmProvider } from '@narra/ai';
import { HTTP_LIMITS, registerHttpHardening, type HttpOptions } from './http';
import { registerAlertRoutes } from './alerts';
import { registerSettingsRoutes } from './settings';
import { registerOverviewRoutes } from './overview';
import { registerIntelRoutes } from './intel';
import { registerMeRoutes, type BalanceSource } from './me';
import { registerGateway, type GatewayDeps } from './gateway';
import type { ExecutionJob } from '@narra/queue';
import { registerLinkedWalletRoutes } from './entitlements/linkRoutes';
import { registerWyntraxWebhook, type WyntraxDeps } from './entitlements/webhook';
import { registerFeatureGates } from './entitlements/gating';
import { registerEntitlementRoutes } from './entitlements/routes';
import { createRuntimeSettings, type RuntimeSettingsResolver } from './runtime-settings';
import { registerRuntimeRoutes } from './runtime-routes';

const EvaluateBody = z.object({
  /** Raw model output. Untrusted until it passes the schema. */
  decision: AgentDecisionSchema,
  context: RiskContextSchema,
  profile: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']).default('BALANCED'),
  overrides: RiskLimitsSchema.partial().optional(),
});

export async function buildApp(opts: { webhooks?: WebhookDeps; account?: AccountDeps; runtime?: RuntimeSettingsResolver; /** Queues a Helius webhook sync. Leave out when Helius is not configured. */ requestWalletSync?: () => Promise<unknown>; /** Queues a confirmed order for the execution worker. */ enqueueExecution?: (job: ExecutionJob) => Promise<unknown>; /** The model behind agent chat. Without it chat answers 503. */ chatLlm?: LlmProvider | null; chatQuestionsPerMinute?: number; /** Health checks for the admin status view. */ ops?: OpsDeps; /** CORS, HSTS. */ http?: HttpOptions; /** Reports which providers are configured, for the admin connections view. */ connections?: () => ConnectionStatus[]; /** Reads SOL balances for GET /v1/me/wallets/balances. Without it balances are reported as unknown. */ balances?: BalanceSource; /** WebSocket gateway. Without it GET /v1/stream does not exist. */ realtime?: Omit<GatewayDeps, 'db' | 'verifier' | 'allowedOrigins' | 'resolveAllowedOrigins'>; /** Set when the API sits behind a reverse proxy, so rate limits see the client address and not the proxy's. Never true when the API is exposed directly. */ trustProxy?: boolean; wyntrax?: WyntraxDeps } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers["x-wyntrax-signature"]'] },
    bodyLimit: HTTP_LIMITS.bodyLimitBytes, requestTimeout: HTTP_LIMITS.requestTimeoutMs, keepAliveTimeout: HTTP_LIMITS.keepAliveTimeoutMs,
    trustProxy: opts.trustProxy ?? false,
  });
  await registerHttpHardening(app, opts.http);
  await app.register(rateLimit, {
    max: 120, timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => Object.assign(new Error('rate limit exceeded'), { statusCode: 429, code: 'RATE_LIMITED', retryAfter: Math.ceil(ctx.ttl / 1000) }),
  });

  app.get('/health', async () => ({ status: 'ok', brand: getBrand().name }));
  registerRuntimeRoutes(app, opts.runtime ?? (opts.account ? createRuntimeSettings(opts.account.db) : undefined), opts.account);

  // Dev endpoint: runs the Risk Governor on a decision. It never signs or sends a transaction.
  // In production the context is assembled server-side from the database and a fresh Jupiter quote.
  app.post('/v1/risk/evaluate', async (req, reply) => {
    const parsed = EvaluateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_INPUT', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const { decision, context, profile, overrides } = parsed.data;
    return evaluateRisk(decision, context, { ...PROFILES[profile], ...overrides });
  });

  if (opts.webhooks) registerWebhooks(app, opts.webhooks);
  await registerWyntraxWebhook(app, opts.wyntrax);
  if (opts.account) {
    registerFeatureGates(app, opts.account.db, opts.account.now);
    registerEntitlementRoutes(app, opts.account);
    registerLinkedWalletRoutes(app, opts.account);
    registerAccountRoutes(app, opts.account);
    registerReadRoutes(app, opts.account);
    registerAdminRoutes(app, { ...opts.account, connections: opts.connections });
    registerWalletAdminRoutes(app, { ...opts.account, requestSync: opts.requestWalletSync });
    registerConfirmationRoutes(app, { ...opts.account, enqueueExecution: opts.enqueueExecution });
    registerAlertRoutes(app, opts.account);
    registerSettingsRoutes(app, opts.account);
    registerOverviewRoutes(app, opts.account);
    registerIntelRoutes(app, opts.account);
    registerAnalyticsRoutes(app, opts.account);
    registerAdminOpsRoutes(app, opts.account);
    registerAdminStatusRoutes(app, { ...opts.account, ops: opts.ops });
    registerMeRoutes(app, { ...opts.account, balances: opts.balances });
    if (opts.realtime) await registerGateway(app, { ...opts.realtime, db: opts.account.db, verifier: opts.account.verifier, allowedOrigins: opts.http?.corsOrigins, resolveAllowedOrigins: opts.http?.resolveCorsOrigins });
    registerChatRoutes(app, { ...opts.account, llm: opts.chatLlm ?? null, questionsPerMinute: opts.chatQuestionsPerMinute });
  }

  return app;
}
