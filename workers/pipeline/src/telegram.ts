import type { Prisma, PrismaClient } from '@narra/database';

/**
 * Read-only Telegram delivery for the research alerts. It reads global Early Radar alerts that the pipeline already
 * wrote, formats one plain-text message per alert, and posts it through the Telegram Bot API. It never creates an
 * alert, order, position or trade, and it never sends an alert that belongs to a user.
 */

export const EARLY_RADAR_ALERT_KINDS = ['EARLY_RADAR_TRENCHER', 'EARLY_RADAR_HOLDER'] as const;
export const TELEGRAM_CURSOR_PREFIX = 'integrations.telegram.cursor.';
export const TELEGRAM_LIMITS = {
  /** A call older than this is not worth posting; the measured median time to peak is about 38 minutes. */
  maxAgeMs: 15 * 60_000,
  maxPerRun: 10,
  sendDelayMs: 1_200,
  maxText: 4_000,
} as const;

export interface TelegramDeliveryConfig {
  chatId: string;
  token: string;
  botApiBase?: string;
  maxAgeMs?: number;
  limit?: number;
  delayMs?: number;
}

export interface TelegramSendResult {
  ok: boolean;
  messageId?: string;
  status?: number;
  retryAfterSeconds?: number;
  description?: string;
}

export interface TelegramTransport {
  send(chatId: string, text: string): Promise<TelegramSendResult>;
}

export interface TelegramAlertRow {
  id: string;
  kind: string;
  priority: string;
  title: string;
  body: string;
  refType: string | null;
  refId: string | null;
  createdAt: Date;
  earlyRadarOutcome: {
    profile: string;
    tier: string;
    route: string;
    matchKind: string;
    score: number | null;
  } | null;
}

export interface TelegramTokenRow {
  mint: string;
  symbol: string;
  name: string;
}

export interface TelegramDeliverySummary {
  configured: true;
  dryRun: boolean;
  scanned: number;
  candidates: number;
  sent: number;
  skippedStale: number;
  failed: number;
  stopped: boolean;
  lastError: string | null;
  messages: Array<{ alertId: string; text: string }>;
}

export interface TelegramDeliveryOptions {
  chatId: string;
  transport?: TelegramTransport;
  now?: Date;
  maxAgeMs?: number;
  limit?: number;
  delayMs?: number;
  /** Defaults to true so an accidental call cannot post. The worker explicitly passes false. */
  dryRun?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

interface Cursor {
  at: Date;
  id: string;
}

const numberOr = (raw: string | undefined, fallback: number, allowZero = false): number => {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : fallback;
};

export function telegramConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TelegramDeliveryConfig | null {
  if (env.TELEGRAM_ENABLED?.trim().toLowerCase() === 'false') return null;
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return null;
  return {
    token,
    chatId,
    botApiBase: env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org',
    maxAgeMs: numberOr(env.TELEGRAM_MAX_AGE_MIN, 15) * 60_000,
    limit: Math.max(1, Math.min(Math.floor(numberOr(env.TELEGRAM_MAX_PER_RUN, TELEGRAM_LIMITS.maxPerRun)), 20)),
    delayMs: numberOr(env.TELEGRAM_SEND_DELAY_MS, TELEGRAM_LIMITS.sendDelayMs, true),
  };
}

/** Stable, filesystem-safe key. Chat IDs are normally numeric; public @channel names are sanitized. */
export function telegramCursorKey(chatId: string): string {
  return TELEGRAM_CURSOR_PREFIX + chatId.replace(/[^0-9A-Za-z_-]/g, '_');
}

const truncate = (text: string, max: number): string => max <= 0 ? '' : (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const RESEARCH_ONLY = /\s*Research signal only, not a prediction or a recommendation to buy\.?\s*$/i;
/** The pipeline appends this suffix to new calls. Parsing it is presentation only; the stored body remains authoritative. */
const SAFETY_SUFFIX = /\s*Safety evidence: (PASS|UNKNOWN|BLOCK)(?: \(([^)]*)\))?\.(?: Top-10 excluding known pool\/locker accounts (\d+(?:\.\d+)?)%\.)?(?: Warnings: ([^.]+)\.)?(?: Shadow mode: recorded, not enforced\.)?\s*$/;

export interface TelegramSafetySummary {
  status: 'PASS' | 'UNKNOWN' | 'BLOCK';
  codes: string[];
  top10ExLpPct: string | null;
  warnings: string | null;
  shadow: boolean;
}

export function splitTelegramBody(body: string): { body: string; safety: TelegramSafetySummary | null } {
  const match = SAFETY_SUFFIX.exec(body);
  const withoutSafety = match ? body.slice(0, match.index) : body;
  return {
    body: withoutSafety.replace(RESEARCH_ONLY, '').trim(),
    safety: match ? {
      status: match[1] as TelegramSafetySummary['status'],
      codes: match[2]?.split(',').map((code) => code.trim()).filter(Boolean) ?? [],
      top10ExLpPct: match[3] ?? null,
      warnings: match[4]?.trim() || null,
      shadow: /Shadow mode: recorded, not enforced\./.test(match[0]),
    } : null,
  };
}

export function formatTelegramAlert(alert: TelegramAlertRow, token: TelegramTokenRow | null): string {
  const o = alert.earlyRadarOutcome;
  const profile = (o?.profile ?? (alert.kind === 'EARLY_RADAR_HOLDER' ? 'holder' : 'trencher')).toUpperCase();
  const tier = o?.tier ? ` · ${o.tier.toUpperCase()}` : '';
  const parsed = splitTelegramBody(alert.body);
  const lines = [`NARRAX EARLY RADAR · ${profile}${tier}`];
  if (token) lines.push([token.name, token.symbol ? `(${token.symbol})` : null].filter(Boolean).join(' '));
  lines.push('', alert.title);
  lines.push('', 'Research context');
  lines.push(o?.score != null && Number.isFinite(o.score) ? `Score: ${o.score}` : 'Score: unavailable');
  const source = [o?.route ? `Route: ${o.route}` : null, o?.matchKind ? `Match: ${o.matchKind}` : null].filter(Boolean).join(' · ');
  if (source) lines.push(source);
  let bodyIndex = -1;
  if (parsed.body) {
    lines.push('', 'Why it surfaced', '');
    bodyIndex = lines.length - 1;
  }
  if (parsed.safety) {
    const s = parsed.safety;
    lines.push('', `Safety gate: ${s.status}`);
    if (s.codes.length) lines.push(`${s.status === 'BLOCK' ? 'Blocked by' : 'Missing evidence'}: ${s.codes.join(', ')}`);
    if (s.top10ExLpPct) lines.push(`Top-10 excluding pool/locker accounts: ${s.top10ExLpPct}%`);
    if (s.warnings) lines.push(`Warnings: ${s.warnings}`);
    if (s.shadow) lines.push('Shadow mode: recorded, not enforced.');
  } else lines.push('', 'Safety evidence: unavailable for this alert.');
  if (token?.mint) {
    lines.push('', 'Token details', `Mint: ${token.mint}`);
    lines.push(`Chart: https://dexscreener.com/solana/${encodeURIComponent(token.mint)}`);
  }
  lines.push('', `Alert time: ${alert.createdAt.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`, 'NARRAX research feed');
  const footer = 'Research only. Not a recommendation to buy.\nNo trade was placed and no return is promised.\nSmall, unvalidated sample.';
  const contentLimit = TELEGRAM_LIMITS.maxText - footer.length - 2;
  // Shorten the narrative first, preserving the frozen safety evidence and the research disclaimer.
  if (bodyIndex >= 0) lines[bodyIndex] = truncate(parsed.body, Math.max(0, contentLimit - lines.join('\n').length));
  return `${truncate(lines.join('\n'), contentLimit)}\n\n${footer}`;
}

/** Telegram Bot API sender. The token is kept in the URL built here and is never put in a log or returned error. */
export class TelegramBotApiTransport implements TelegramTransport {
  private readonly baseUrl: string;
  constructor(
    private readonly token: string,
    baseUrl = 'https://api.telegram.org',
    private readonly timeoutMs = 10_000,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async send(chatId: string, text: string): Promise<TelegramSendResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'telegram request failed';
      return { ok: false, description: message.replace(this.token, '[redacted]').slice(0, 300) };
    }
    const raw = await response.json().catch(() => null) as {
      ok?: unknown;
      description?: unknown;
      result?: { message_id?: unknown };
      parameters?: { retry_after?: unknown };
    } | null;
    const description = typeof raw?.description === 'string' ? raw.description.replace(this.token, '[redacted]').slice(0, 300) : `HTTP ${response.status}`;
    if (response.ok && raw?.ok === true) {
      const id = raw.result?.message_id;
      return { ok: true, ...(typeof id === 'number' ? { messageId: String(id) } : {}) };
    }
    const retry = raw?.parameters?.retry_after;
    return {
      ok: false,
      status: response.status,
      ...(typeof retry === 'number' && Number.isFinite(retry) && retry >= 0 ? { retryAfterSeconds: retry } : {}),
      description,
    };
  }
}

function parseCursor(value: Prisma.JsonValue | null | undefined): Cursor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const at = (value as { at?: unknown }).at;
  const id = (value as { id?: unknown }).id;
  if (typeof at !== 'string' || typeof id !== 'string') return null;
  const date = new Date(at);
  return Number.isFinite(+date) ? { at: date, id } : null;
}

async function readCursor(db: PrismaClient, key: string): Promise<Cursor | null> {
  const row = await db.systemSetting.findUnique({ where: { key }, select: { value: true } });
  return parseCursor(row?.value);
}

async function writeCursor(db: PrismaClient, key: string, cursor: Cursor): Promise<void> {
  const value = { at: cursor.at.toISOString(), id: cursor.id };
  await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

const errorText = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 300);
};

/**
 * Reads and (unless dry-run) delivers the newest eligible global Early Radar alerts for one chat.
 * The cursor is stored in SystemSetting, so no schema change is needed. It advances after a success or a
 * malformed-message skip; a 429, auth/chat error, 5xx or network failure leaves it in place so the next run retries.
 */
export async function deliverEarlyRadarTelegram(
  db: PrismaClient,
  opts: TelegramDeliveryOptions,
): Promise<TelegramDeliverySummary> {
  const dryRun = opts.dryRun ?? true;
  const now = opts.now ?? new Date();
  const maxAgeMs = opts.maxAgeMs ?? TELEGRAM_LIMITS.maxAgeMs;
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? TELEGRAM_LIMITS.maxPerRun), 20));
  const delayMs = Math.max(0, opts.delayMs ?? TELEGRAM_LIMITS.sendDelayMs);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const key = telegramCursorKey(opts.chatId);
  const floor = new Date(now.getTime() - maxAgeMs);
  const stored = await readCursor(db, key);
  const start = stored && stored.at >= floor && stored.at <= now ? stored : null;

  const where: Prisma.AlertWhereInput = {
    userId: null,
    kind: { in: [...EARLY_RADAR_ALERT_KINDS] },
    refType: 'TOKEN',
    refId: { not: null },
    createdAt: { gte: floor, lte: now },
    ...(start ? { OR: [{ createdAt: { gt: start.at } }, { createdAt: start.at, id: { gt: start.id } }] } : {}),
  };
  const alerts = await db.alert.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
    include: { earlyRadarOutcome: { select: { profile: true, tier: true, route: true, matchKind: true, score: true } } },
  }) as TelegramAlertRow[];

  const out: TelegramDeliverySummary = {
    configured: true,
    dryRun,
    scanned: alerts.length,
    candidates: 0,
    sent: 0,
    skippedStale: 0,
    failed: 0,
    stopped: false,
    lastError: null,
    messages: [],
  };
  if (!dryRun && !opts.transport) throw new Error('telegram transport is required when dryRun is false');

  let cursor = start;
  for (const alert of alerts) {
    if (now.getTime() - alert.createdAt.getTime() > maxAgeMs) {
      out.skippedStale++;
      cursor = { at: alert.createdAt, id: alert.id };
      if (!dryRun) await writeCursor(db, key, cursor);
      continue;
    }
    out.candidates++;
    let token: TelegramTokenRow | null = null;
    if (alert.refId) {
      token = await db.token.findUnique({ where: { id: alert.refId }, select: { mint: true, symbol: true, name: true } });
    }
    const text = formatTelegramAlert(alert, token);
    if (dryRun) {
      out.messages.push({ alertId: alert.id, text });
      continue;
    }

    let result: TelegramSendResult;
    try {
      result = await opts.transport!.send(opts.chatId, text);
    } catch (error) {
      out.stopped = true;
      out.lastError = errorText(error);
      break;
    }
    if (result.ok) {
      out.sent++;
      cursor = { at: alert.createdAt, id: alert.id };
      await writeCursor(db, key, cursor);
    } else if (
      result.status === 429 ||
      result.status === 401 ||
      result.status === 403 ||
      result.status == null ||
      result.status >= 500 ||
      (result.status === 400 && /chat not found|not a member|blocked|unauthorized|forbidden|invalid token/i.test(result.description ?? ''))
    ) {
      // Rate limits, network errors, auth/chat problems and Telegram 5xx are retryable or need a config fix.
      // Leave the cursor in place so an alert is never silently consumed.
      out.stopped = true;
      out.lastError = result.description ?? 'telegram delivery stopped';
      break;
    } else {
      // A malformed or too-long message will fail the same way next time. Advance past it so it cannot block the feed.
      out.failed++;
      out.lastError = result.description ?? `telegram HTTP ${result.status ?? 'error'}`;
      cursor = { at: alert.createdAt, id: alert.id };
      await writeCursor(db, key, cursor);
    }
    if (out.sent + out.failed < out.candidates && delayMs > 0) await sleep(delayMs);
  }
  return out;
}
