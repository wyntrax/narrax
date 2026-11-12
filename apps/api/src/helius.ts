import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import {
  effectiveHeliusSettings,
  HELIUS_SETTING_KEYS,
  HeliusSettingsInput,
  isSecretHeliusKey,
  OptionalHeliusUrl,
  sanitizeUntrusted,
  type HeliusSettingKey,
} from '@narra/shared';
import { makeRequireAdmin, type AccountDeps } from './account';

const Reason = z.string().min(1).max(1_000);
const TestBody = z.object({
  rpcUrl: OptionalHeliusUrl.optional(),
  rpcFallbackUrl: OptionalHeliusUrl.optional(),
  holderRpcUrl: OptionalHeliusUrl.optional(),
  holderRpcFallbackUrl: OptionalHeliusUrl.optional(),
}).strict();

export interface HeliusDeps extends Pick<AccountDeps, 'db' | 'verifier'> {
  /** Environment fallback. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Injected in tests so no request leaves the process. */
  fetch?: typeof fetch;
  testTimeoutMs?: number;
}

const cleanReason = (value: string) => sanitizeUntrusted(value, 300).trim();

/** Never store a credential in the audit log. The action still records that it changed. */
const auditValue = (key: string, value: unknown): Prisma.InputJsonValue => {
  if (isSecretHeliusKey(key)) return value == null || value === '' ? '<unset>' : '<set>';
  return (value ?? null) as Prisma.InputJsonValue;
};

type EndpointCode = 'OK' | 'RATE_LIMITED' | 'UNAUTHORIZED' | 'HTTP_ERROR' | 'TIMEOUT' | 'NETWORK' | 'INVALID_RESPONSE';
export interface EndpointTest { ok: boolean; code: EndpointCode; status?: number; latencyMs: number }

/**
 * Admin-managed Helius credentials and endpoints.
 *
 * A saved value wins over the environment, so an exhausted key can be replaced without
 * editing .env or redeploying. RPC URLs embed the API key, so only the public webhook
 * URL is ever returned; every credential is write-only. Values are read at process
 * startup, so the admin page says a restart is required.
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
    const secret = (value: { value: string; source: 'database' | 'environment' | 'default' }) =>
      ({ configured: !!value.value, source: value.source });
    return {
      rpcUrl: secret(effective.rpcUrl),
      rpcFallbackUrl: secret(effective.rpcFallbackUrl),
      apiKey: secret(effective.apiKey),
      holderRpcUrl: secret(effective.holderRpcUrl),
      holderRpcFallbackUrl: secret(effective.holderRpcFallbackUrl),
      webhookUrl: { value: effective.webhookUrl.value || null, source: effective.webhookUrl.source },
      webhookSecret: secret(effective.webhookSecret),
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

    if (next.rpcFallbackUrl.value && !next.rpcUrl.value) return bad(reply, 'HELIUS_RPC_FALLBACK_REQUIRES_PRIMARY');
    if (next.rpcUrl.value && next.rpcFallbackUrl.value && next.rpcUrl.value === next.rpcFallbackUrl.value) return bad(reply, 'HELIUS_RPC_FALLBACK_DUPLICATE');
    if (next.holderRpcUrl.value && next.holderRpcFallbackUrl.value && next.holderRpcUrl.value === next.holderRpcFallbackUrl.value) return bad(reply, 'HOLDER_RPC_FALLBACK_DUPLICATE');

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
    return view(await rows());
  });

  // Tests the entered endpoints, or the saved ones when a field is omitted. It never
  // saves, and neither the URL nor the response body is returned. The client that sent
  // a URL already has it, so an error code is enough.
  app.post('/v1/admin/helius/test', testOpts, async (req, reply) => {
    const body = TestBody.safeParse(req.body ?? {});
    if (!body.success) return bad(reply);
    const saved = effectiveHeliusSettings(await rows(), env);
    const primary = body.data.rpcUrl ?? saved.rpcUrl.value;
    const fallback = body.data.rpcFallbackUrl ?? saved.rpcFallbackUrl.value;
    const holder = body.data.holderRpcUrl ?? saved.holderRpcUrl.value;
    const holderFallback = body.data.holderRpcFallbackUrl ?? saved.holderRpcFallbackUrl.value;
    if (![primary, fallback, holder, holderFallback].some(Boolean)) return bad(reply, 'HELIUS_NOT_CONFIGURED');

    const test = (url: string) => testEndpoint(url, deps.fetch ?? fetch, deps.testTimeoutMs ?? 5_000);
    const [primaryResult, fallbackResult, holderResult, holderFallbackResult] = await Promise.all([
      primary ? test(primary) : undefined,
      fallback ? test(fallback) : undefined,
      holder ? test(holder) : undefined,
      holderFallback ? test(holderFallback) : undefined,
    ]);
    return {
      ...(primaryResult ? { primary: primaryResult } : {}),
      ...(fallbackResult ? { fallback: fallbackResult } : {}),
      ...(holderResult ? { holder: holderResult } : {}),
      ...(holderFallbackResult ? { holderFallback: holderFallbackResult } : {}),
    };
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
