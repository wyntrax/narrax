import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import {
  effectiveHeliusSettings,
  HELIUS_SETTING_KEYS,
  HeliusSettingsInput,
  HeliusUrlList,
  isSecretHeliusKey,
  sanitizeUntrusted,
  type HeliusSettingKey,
} from '@narra/shared';
import { makeRequireAdmin, type AccountDeps } from './account';

const Reason = z.string().min(1).max(1_000);
const TestBody = z.object({
  rpcUrls: HeliusUrlList.optional(),
  rpcFallbackUrls: HeliusUrlList.optional(),
  holderRpcUrls: HeliusUrlList.optional(),
  holderRpcFallbackUrls: HeliusUrlList.optional(),
}).strict();

export interface HeliusDeps extends Pick<AccountDeps, 'db' | 'verifier'> {
  /** Environment fallback. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Injected in tests so no request leaves the process. */
  fetch?: typeof fetch;
  testTimeoutMs?: number;
  /** The API's effective-settings cache, invalidated immediately after a save. */
  runtime?: { invalidate: () => void };
  /** Queues the webhook sync so a rotated secret reaches Helius without waiting. */
  requestSync?: () => Promise<unknown>;
}

const cleanReason = (value: string) => sanitizeUntrusted(value, 300).trim();

/** Never store a credential in the audit log. The action still records that it changed. */
const auditValue = (key: string, value: unknown): Prisma.InputJsonValue => {
  if (isSecretHeliusKey(key)) {
    if (Array.isArray(value)) return value.length ? `${value.length} endpoint(s)` : '<unset>';
    return value == null || value === '' ? '<unset>' : '<set>';
  }
  return (value ?? null) as Prisma.InputJsonValue;
};

type EndpointCode = 'OK' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'HTTP_ERROR' | 'TIMEOUT' | 'NETWORK' | 'INVALID_RESPONSE';
export interface EndpointTest { ok: boolean; code: EndpointCode; status?: number; latencyMs: number }

/**
 * Admin-managed Helius credentials and endpoint pools.
 *
 * A saved value wins over the environment. RPC URLs embed the API key, so pool counts
 * and sources are returned but never the values; every credential is write-only.
 * Processes read the rows through a short cache, so a save applies without a restart.
 */
export function registerHeliusRoutes(app: FastifyInstance, deps: HeliusDeps): void {
  const db: PrismaClient = deps.db;
  const env = deps.env ?? process.env;
  const opts = { preHandler: makeRequireAdmin(deps), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const testOpts = { preHandler: makeRequireAdmin(deps), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
  const bad = (reply: { code(n: number): { send(b: unknown): unknown } }, error = 'INVALID_INPUT') => reply.code(400).send({ error });

  async function rows() {
    return db.systemSetting.findMany({
      where: { key: { in: [...HELIUS_SETTING_KEYS] } },
      select: { key: true, value: true },
    });
  }

  function view(current: Awaited<ReturnType<typeof rows>>) {
    const effective = effectiveHeliusSettings(current, env);
    const pool = (value: { value: string[]; source: 'database' | 'environment' | 'default' }) =>
      ({ configured: value.value.length, source: value.source });
    return {
      rpcUrls: pool(effective.rpcUrls),
      rpcFallbackUrls: pool(effective.rpcFallbackUrls),
      apiKey: { configured: !!effective.apiKey.value, source: effective.apiKey.source },
      holderRpcUrls: pool(effective.holderRpcUrls),
      holderRpcFallbackUrls: pool(effective.holderRpcFallbackUrls),
      webhookUrl: { value: effective.webhookUrl.value || null, source: effective.webhookUrl.source },
      webhookSecret: { configured: !!effective.webhookSecret.value, source: effective.webhookSecret.source },
      ready: effective.ready,
      invalid: effective.invalid,
    };
  }

  app.get('/v1/admin/helius', opts, async () => view(await rows()));

  app.put('/v1/admin/helius', opts, async (req, reply) => {
    const body = z.object({ settings: HeliusSettingsInput, reason: Reason }).strict().safeParse(req.body);
    if (!body.success) return bad(reply);
    const reason = cleanReason(body.data.reason);
    const settings = body.data.settings;
    if (!reason || Object.keys(settings).length === 0) return bad(reply);

    const before = new Map((await rows()).map(row => [row.key, row.value]));
    const proposed = new Map<string, unknown>(before);
    for (const [key, value] of Object.entries(settings) as [HeliusSettingKey, unknown][]) proposed.set(key, value);
    const next = effectiveHeliusSettings([...proposed].map(([key, value]) => ({ key, value })), env);

    if (next.rpcFallbackUrls.value.length && !next.rpcUrls.value.length) return bad(reply, 'HELIUS_RPC_FALLBACK_REQUIRES_PRIMARY');

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    for (const [key, value] of Object.entries(settings) as [HeliusSettingKey, unknown][]) {
      writes.push(db.systemSetting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      }));
      writes.push(db.auditLog.create({
        data: {
          userId: req.userId!,
          action: 'helius.settings_changed',
          detail: { key, before: auditValue(key, before.get(key)), after: auditValue(key, value), reason },
        },
      }));
    }
    await db.$transaction(writes);
    deps.runtime?.invalidate();
    // The worker builds the webhook client from the same rows, so ask it to sync now.
    if (['integrations.helius.api_key', 'integrations.helius.webhook_url', 'integrations.helius.webhook_secret'].some(key => key in settings)) {
      try { await deps.requestSync?.(); } catch { /* the scheduled sync retries */ }
    }
    return view(await rows());
  });

  // Tests entered endpoints, or the saved pools when a field is omitted. It never
  // saves, and neither the URL nor the response body is returned. The client that sent
  // a URL already has it, so an error code and latency are enough.
  app.post('/v1/admin/helius/test', testOpts, async (req, reply) => {
    const body = TestBody.safeParse(req.body ?? {});
    if (!body.success) return bad(reply);
    const saved = effectiveHeliusSettings(await rows(), env);
    const groups = {
      rpc: body.data.rpcUrls ?? saved.rpcUrls.value,
      rpcFallback: body.data.rpcFallbackUrls ?? saved.rpcFallbackUrls.value,
      holder: body.data.holderRpcUrls ?? saved.holderRpcUrls.value,
      holderFallback: body.data.holderRpcFallbackUrls ?? saved.holderRpcFallbackUrls.value,
    };
    if (!Object.values(groups).some(urls => urls.length)) return bad(reply, 'HELIUS_NOT_CONFIGURED');

    const test = (url: string) => testEndpoint(url, deps.fetch ?? fetch, deps.testTimeoutMs ?? 5_000);
    const entries = await Promise.all(Object.entries(groups).map(async ([name, urls]) =>
      [name, await Promise.all(urls.map(test))] as const));
    return Object.fromEntries(entries);
  });
}

async function testEndpoint(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<EndpointTest> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth', params: [] }),
      signal: ctrl.signal,
    });
    const latencyMs = Date.now() - started;
    if (res.status === 429) return { ok: false, code: 'RATE_LIMITED', status: 429, latencyMs };
    if (res.status === 401 || res.status === 403) return { ok: false, code: 'UNAUTHORIZED', status: res.status, latencyMs };
    if (!res.ok) return { ok: false, code: 'HTTP_ERROR', status: res.status, latencyMs };
    const parsed = await res.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
    if (!parsed || parsed.error !== undefined || parsed.result === undefined) return { ok: false, code: 'INVALID_RESPONSE', latencyMs };
    return { ok: true, code: 'OK', latencyMs };
  } catch (error) {
    return { ok: false, code: (error as Error).name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
