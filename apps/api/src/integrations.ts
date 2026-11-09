import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@narra/database';
import {
  effectiveIntegrations,
  INTEGRATION_SETTING_KEYS,
  IntegrationSettingsInput,
  isSecretIntegrationKey,
  sanitizeUntrusted,
  TelegramBotToken,
  TelegramChatId,
  type IntegrationSettingKey,
} from '@narra/shared';
import { TelegramBotApiTransport, type TelegramSendResult } from '@narra/worker-pipeline';
import { makeRequireAdmin, type AccountDeps } from './account';

const Reason = z.string().min(1).max(1_000);
const TestBody = z.object({
  chatId: TelegramChatId.optional(),
  botToken: TelegramBotToken.optional(),
}).strict();

export type TelegramTestSender = (input: { chatId: string; token: string }, text: string) => Promise<TelegramSendResult>;

export interface IntegrationDeps extends Pick<AccountDeps, 'db' | 'verifier'> {
  telegramSend?: TelegramTestSender;
  /** Environment fallback. Defaults to process.env; tests set it so a developer's shell cannot change a result. */
  env?: Record<string, string | undefined>;
}

const cleanReason = (value: string) => sanitizeUntrusted(value, 300).trim();

/** Never store a credential in the audit log. The action still records that it changed. */
const auditValue = (key: string, value: unknown): Prisma.InputJsonValue => {
  if (isSecretIntegrationKey(key)) return value == null || value === '' ? '<unset>' : '<set>';
  return (value ?? null) as Prisma.InputJsonValue;
};

/**
 * Admin-managed credentials for the outbound integrations:
 *   - the Telegram group chat that receives token alerts (plus its bot token and delivery limits)
 *   - the Treg API token used by narrative ingestion (plus an optional organisation)
 *
 * The database wins over the environment, secrets are write-only (GET reports only configured/source), and every
 * change needs a reason and is audited without the value. The pipeline worker re-reads these rows on every job, so
 * a change applies without a restart. Nothing here can trade.
 */
export function registerIntegrationRoutes(app: FastifyInstance, deps: IntegrationDeps): void {
  const db: PrismaClient = deps.db;
  const env = deps.env ?? process.env;
  const opts = { preHandler: makeRequireAdmin(deps), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  const testOpts = { preHandler: makeRequireAdmin(deps), config: { rateLimit: { max: 5, timeWindow: '1 minute' } } };
  const bad = (reply: { code(n: number): { send(b: unknown): unknown } }, error = 'INVALID_INPUT', extra: Record<string, unknown> = {}) => reply.code(400).send({ error, ...extra });

  async function rows() {
    return db.systemSetting.findMany({
      where: { key: { in: [...INTEGRATION_SETTING_KEYS] } },
      select: { key: true, value: true },
    });
  }

  async function view() {
    const effective = effectiveIntegrations(await rows(), env);
    return {
      telegram: {
        enabled: effective.telegram.enabled,
        chatId: { value: effective.telegram.chatId.value || null, source: effective.telegram.chatId.source },
        botToken: { configured: !!effective.telegram.botToken.value, source: effective.telegram.botToken.source },
        maxAgeMin: effective.telegram.maxAgeMin,
        maxPerRun: effective.telegram.maxPerRun,
        sendDelayMs: effective.telegram.sendDelayMs,
      },
      treg: {
        enabled: effective.treg.enabled,
        token: { configured: !!effective.treg.token.value, source: effective.treg.token.source },
        org: { value: effective.treg.org.value || null, source: effective.treg.org.source },
      },
      invalid: effective.invalid,
    };
  }

  app.get('/v1/admin/integrations', opts, async () => view());

  app.put('/v1/admin/integrations', opts, async (req, reply) => {
    const body = z.object({ settings: IntegrationSettingsInput, reason: Reason }).strict().safeParse(req.body);
    if (!body.success) return bad(reply);
    const reason = cleanReason(body.data.reason);
    const settings = body.data.settings;
    if (!reason || Object.keys(settings).length === 0) return bad(reply);

    const before = new Map((await rows()).map((row) => [row.key, row.value]));
    const effective = effectiveIntegrations([...before].map(([key, value]) => ({ key, value })), env);

    // Enabling an integration must leave it usable. A token that already comes from the environment counts.
    if (settings['integrations.telegram.enabled'] === true) {
      const token = settings['integrations.telegram.bot_token'] ?? effective.telegram.botToken.value;
      const chatId = settings['integrations.telegram.chat_id'] ?? effective.telegram.chatId.value;
      if (!token || !chatId) return bad(reply, 'TELEGRAM_NOT_CONFIGURED');
    }
    if (settings['integrations.treg.enabled'] === true) {
      const token = settings['integrations.treg.token'] ?? effective.treg.token.value;
      if (!token) return bad(reply, 'TREG_TOKEN_REQUIRED');
    }

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    for (const [key, value] of Object.entries(settings) as [IntegrationSettingKey, unknown][]) {
      writes.push(db.systemSetting.upsert({
        where: { key },
        create: { key, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      }));
      writes.push(db.auditLog.create({
        data: {
          userId: req.userId!,
          action: 'integration.settings_changed',
          detail: { key, before: auditValue(key, before.get(key)), after: auditValue(key, value), reason },
        },
      }));
    }
    await db.$transaction(writes);
    return view();
  });

  // Sends one short message with the entered values, or the effective saved values when a field is left out.
  // It never saves anything and the response never contains the token.
  app.post('/v1/admin/integrations/telegram/test', testOpts, async (req, reply) => {
    const body = TestBody.safeParse(req.body ?? {});
    if (!body.success) return bad(reply);
    const effective = effectiveIntegrations(await rows(), env).telegram;
    const chatId = body.data.chatId ?? effective.chatId.value;
    const token = body.data.botToken ?? effective.botToken.value;
    if (!chatId || !token) return bad(reply, 'TELEGRAM_NOT_CONFIGURED');
    const text = 'NARRAX admin test. Token alerts will post to this chat. Research only.';
    const send: TelegramTestSender = deps.telegramSend ?? ((input, message) =>
      new TelegramBotApiTransport(input.token, env.TELEGRAM_API_BASE).send(input.chatId, message));
    let result: TelegramSendResult;
    try {
      result = await send({ chatId, token }, text);
    } catch {
      return reply.code(502).send({ error: 'TELEGRAM_TEST_FAILED' });
    }
    if (!result.ok) return reply.code(502).send({ error: 'TELEGRAM_TEST_FAILED', description: result.description ?? 'Telegram rejected the message' });
    await db.auditLog.create({ data: { userId: req.userId!, action: 'integration.telegram_tested', detail: { chatId } } });
    return { ok: true, ...(result.messageId ? { messageId: result.messageId } : {}) };
  });
}
