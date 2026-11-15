import type { Prisma, PrismaClient } from '@narra/database';
import { FrozenRadarSafetySchema, effectiveIntegrations, type FrozenRadarSafety } from '@narra/shared';
import { radarSafetySettingKey } from '@narra/token-intel';

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

export interface TelegramSendOptions {
  parseMode?: 'HTML';
}

export interface TelegramTransport {
  send(chatId: string, text: string, options?: TelegramSendOptions): Promise<TelegramSendResult>;
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

/**
 * Reads the admin-managed Telegram settings and falls back to the environment for anything not saved.
 * The worker calls this on every delivery run, so a chat or token change applies without a restart.
 */
export async function telegramConfigFromSettings(
  db: Pick<PrismaClient, 'systemSetting'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramDeliveryConfig | null> {
  const rows = await db.systemSetting.findMany({ where: { key: { startsWith: 'integrations.telegram.' } }, select: { key: true, value: true } });
  const settings = effectiveIntegrations(rows, env).telegram;
  if (!settings.enabled.value || !settings.botToken.value || !settings.chatId.value) return null;
  return telegramConfigFromEnv({
    ...env,
    TELEGRAM_ENABLED: 'true',
    TELEGRAM_BOT_TOKEN: settings.botToken.value,
    TELEGRAM_CHAT_ID: settings.chatId.value,
    TELEGRAM_MAX_AGE_MIN: String(settings.maxAgeMin.value),
    TELEGRAM_MAX_PER_RUN: String(settings.maxPerRun.value),
    TELEGRAM_SEND_DELAY_MS: String(settings.sendDelayMs.value),
  });
}

/** Stable, filesystem-safe key. Chat IDs are normally numeric; public @channel names are sanitized. */
export function telegramCursorKey(chatId: string): string {
  return TELEGRAM_CURSOR_PREFIX + chatId.replace(/[^0-9A-Za-z_-]/g, '_');
}

const truncate = (text: string, max: number): string => max <= 0 ? '' : (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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

const CODE_LABELS: Record<string, { block?: string; unknown?: string; warn?: string }> = {
  TOP10_CONCENTRATION: { block: 'Top-10 holder share too high', unknown: 'Top-10 holder share missing' },
  TOP10_EX_LP: { block: 'Top-10 (ex-LP) share too concentrated', unknown: 'Top-10 (ex-LP) share missing' },
  DEV_HOLDING: { block: 'Dev wallet holds too much supply', unknown: 'Dev holding missing' },
  LP_CONTROL: { block: 'LP unlocked or under-burned', unknown: 'LP lock/burn status missing' },
  BUNDLE_SNIPER_INSIDER: { block: 'Bundle + sniper + insider > 20%', unknown: 'Bundle/sniper/insider evidence incomplete' },
  LAUNCH_BUNDLE: { block: 'Multiple wallets bought in launch slot', unknown: 'Launch-slot buyer count missing' },
  DEPLOYER_HISTORY: { block: 'Serial deployer or prior rug', unknown: 'Deployer history incomplete' },
  ORGANIC_EVIDENCE: { block: 'Chatter looks manipulated', unknown: 'Organic chatter score missing' },
  WASH_VOLUME: { block: 'Suspected wash volume', unknown: 'Wash-volume check incomplete' },
  TRADEABILITY: { block: 'High swap slippage ($50 test)', unknown: 'Swap quote unavailable' },
  RISK_EVIDENCE: { unknown: 'Contract risk check missing or stale' },
  MARKET_EVIDENCE: { unknown: 'Market quote missing or stale' },
  HOLDER_EVIDENCE: { unknown: 'Holder snapshot missing or stale' },
  SOURCE_EVIDENCE: { unknown: 'Safety source check stale' },
  HONEYPOT: { block: 'Honeypot detected' },
  RUGGED: { block: 'Token flagged as rugged' },
  MINT_AUTHORITY_ACTIVE: { block: 'Mint authority still active' },
  FREEZE_AUTHORITY_ACTIVE: { block: 'Freeze authority still active' },
  PRICE_ALREADY_EXTENDED: { block: 'Price already up ≥50% (1h)', warn: 'Price already up ≥50% (1h)' },
  PRICE_ALREADY_EXTENDED_3H: { block: 'Price already up ≥100% (3h)', warn: 'Price already up ≥100% (3h)' },
  PRICE_DRAWDOWN: { block: 'Price already dumped from peak' },
  WASH_TURNOVER_HIGH: { warn: 'Very high 24h turnover' },
};

const fmtUsdCompact = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
};
const fmtPct = (v: number | null | undefined, digits = 1): string => (v != null && Number.isFinite(v) ? `${v.toFixed(digits)}%` : '—');
const fmtSignedPct = (v: number | null | undefined): string | null =>
  v != null && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : null;

function describeSafetyCode(code: string, kind: 'BLOCK' | 'UNKNOWN' | 'WARN', snapshot?: FrozenRadarSafety | null): string {
  const mapped = CODE_LABELS[code];
  const base = kind === 'BLOCK' ? mapped?.block : kind === 'UNKNOWN' ? mapped?.unknown : mapped?.warn;
  const check = snapshot?.checks.find((c) => c.code === code);
  if (kind === 'BLOCK' && check && typeof check.value === 'number' && Number.isFinite(check.value)) {
    if (code === 'BUNDLE_SNIPER_INSIDER') return `Bundle + sniper + insider ${check.value.toFixed(1)}% (&gt; 20%)`;
    if (code === 'LAUNCH_BUNDLE') return `${Math.round(check.value)} same-slot launch buyers (&gt; 2)`;
    if (code === 'TOP10_EX_LP') return `Top-10 (ex-LP) ${check.value.toFixed(1)}% (&gt;= 35%)`;
    if (code === 'TOP10_CONCENTRATION') return `Top-10 (raw) ${check.value.toFixed(1)}% (&gt;= 35%)`;
    if (code === 'DEV_HOLDING') return `Dev holds ${check.value.toFixed(1)}%`;
    if (code === 'TRADEABILITY') return `Swap slippage ${check.value.toFixed(1)}% (&gt; 3%)`;
  }
  return escapeHtml(base ?? code);
}

function summarizeSignal(alert: TelegramAlertRow, parsedBody: string, snapshot?: FrozenRadarSafety | null): string[] {
  const o = alert.earlyRadarOutcome;
  const items: string[] = [];
  if (o?.route === 'SOCIAL') {
    const matchLabel = o.matchKind === 'MINT' ? 'Mint match' : o.matchKind === 'TICKER_ONLY' ? 'Ticker only — copycat risk' : o.matchKind;
    const buzz = /(\d+ accounts?, \d+ posts?) named it in (\d+h)/i.exec(parsedBody);
    items.push(buzz ? `Social (${matchLabel}): ${buzz[1]} (${buzz[2]})` : `Social (${matchLabel})`);
  } else if (o?.route === 'NARRATIVE') {
    const narr = /\bfor (.+?) \(\$/.exec(alert.title)?.[1];
    const stage = /\bnarrative ([a-z_]+)/i.exec(parsedBody)?.[1];
    const detail = [narr, stage ? `stage: ${stage.toLowerCase()}` : null].filter(Boolean).join(' · ');
    items.push(detail ? `Narrative: ${detail}` : 'Narrative match');
  }
  if (snapshot?.facts.narrativeManipulationRisk != null) {
    items.push(`Chatter manipulation risk: ${Math.round(snapshot.facts.narrativeManipulationRisk)}/100`);
  }
  return items;
}

function safetyBadge(status: 'PASS' | 'BLOCK' | 'UNKNOWN' | null, shadow: boolean): string {
  const modeNote = shadow ? ' <i>(shadow)</i>' : '';
  if (status === 'PASS') return `✅ <b>Safety: PASS</b>${modeNote}`;
  if (status === 'BLOCK') return `⛔ <b>Safety: BLOCK</b>${modeNote}`;
  if (status === 'UNKNOWN') return `⚠️ <b>Safety: INCOMPLETE</b>${modeNote}`;
  return 'ℹ️ <b>Safety: Unavailable</b>';
}

export function formatTelegramAlert(
  alert: TelegramAlertRow,
  token: TelegramTokenRow | null,
  safetySnapshot?: FrozenRadarSafety | null,
): string {
  const o = alert.earlyRadarOutcome;
  const profile = (o?.profile ?? (alert.kind === 'EARLY_RADAR_HOLDER' ? 'holder' : 'trencher')).toUpperCase();
  const tier = o?.tier ? o.tier.toUpperCase() : '';
  const scoreText = o?.score != null && Number.isFinite(o.score) ? `${o.score}` : 'unavailable';
  const parsed = splitTelegramBody(alert.body);
  const status = safetySnapshot?.status ?? parsed.safety?.status ?? null;
  const shadow = safetySnapshot ? safetySnapshot.mode === 'shadow' : Boolean(parsed.safety?.shadow);
  const icon = status === 'PASS' ? '🟢' : status === 'BLOCK' ? '🔴' : status === 'UNKNOWN' ? '🟡' : '⚪';

  const heading = token
    ? `${icon} <b>${escapeHtml(token.name)}${token.symbol ? ` (${escapeHtml(token.symbol)})` : ''}</b>`
    : `${icon} <b>${escapeHtml(alert.title)}</b>`;
  const subhead = `${escapeHtml(profile)}${tier ? ` · ${escapeHtml(tier)}` : ''} · Score ${scoreText}`;
  const lines = [heading, subhead, safetyBadge(status, shadow)];

  let bodyIndex = -1;
  if (safetySnapshot) {
    const f = safetySnapshot.facts;
    const lpText = f.lpBurnedPct != null
      ? `LP ${Math.round(f.lpBurnedPct)}% burned`
      : f.lpLocked === true
        ? 'LP Locked'
        : f.lpLocked === false
          ? 'LP Unlocked'
          : 'LP —';
    const top10Text = f.top10ExLpPct != null
      ? `Top 10 (ex-LP) ${f.top10ExLpPct.toFixed(1)}%`
      : `Top 10 (raw) ${fmtPct(f.top10Pct)}`;
    const priceMoves = [
      fmtSignedPct(f.priceGrowth1hPct) ? `1h ${fmtSignedPct(f.priceGrowth1hPct)}` : null,
      fmtSignedPct(f.priceGrowth3hPct) ? `3h ${fmtSignedPct(f.priceGrowth3hPct)}` : null,
      f.priceImpactPct != null ? `$50 slippage ${f.priceImpactPct.toFixed(2)}%` : null,
    ].filter(Boolean);

    lines.push('', '📊 <b>Market</b>');
    lines.push(`• Cap ${fmtUsdCompact(f.marketCapUsd)} · Liq ${fmtUsdCompact(f.liquidityUsd)} · ${f.holders != null ? `${Math.round(f.holders)} holders` : 'holders —'}`);
    if (priceMoves.length) lines.push(`• ${priceMoves.join(' · ')}`);
    lines.push(`• ${top10Text} · Dev ${fmtPct(f.devHoldingPct)} · ${lpText}`);

    const deployerPrior = f.deployerPriorTokens != null && f.deployerPriorRugs != null
      ? `${f.deployerPriorTokens} tokens (${f.deployerPriorRugs} rugs)`
      : f.deployerPriorTokens != null
        ? `${f.deployerPriorTokens} tokens (rugs —)`
        : f.deployerPriorRugs != null
          ? `${f.deployerPriorRugs} rugs`
          : '—';
    lines.push('', '🕵️ <b>Launch &amp; Manipulation</b>');
    lines.push(`• Bundle ${fmtPct(f.bundlePct)} · Sniper ${fmtPct(f.sniperPct)} · Insider ${fmtPct(f.insiderPct)}`);
    lines.push(`• Same-slot buyers: ${f.sameSlotBuyers ?? '—'} · Deployer prior: ${deployerPrior}`);

    const signalItems = summarizeSignal(alert, parsed.body, safetySnapshot);
    if (signalItems.length) {
      lines.push('', '💬 <b>Signal</b>');
      for (const item of signalItems) lines.push(`• ${escapeHtml(item)}`);
    } else if (parsed.body) {
      lines.push('', '💬 <b>Signal</b>', '');
      bodyIndex = lines.length - 1;
    }

    const visibleWarnings = safetySnapshot.warnings.filter((w) => w !== 'AUTHORITY_NOT_PROVEN');
    if (safetySnapshot.blockers.length || safetySnapshot.unknowns.length || visibleWarnings.length) {
      lines.push('', '🛡️ <b>Gate Details</b>');
      if (safetySnapshot.blockers.length) {
        lines.push(`• Blocked: ${safetySnapshot.blockers.map((c) => describeSafetyCode(c, 'BLOCK', safetySnapshot)).join('; ')}`);
      }
      if (safetySnapshot.unknowns.length) {
        lines.push(`• Missing: ${safetySnapshot.unknowns.map((c) => describeSafetyCode(c, 'UNKNOWN', safetySnapshot)).join('; ')}`);
      }
      if (visibleWarnings.length) {
        lines.push(`• Warnings: ${visibleWarnings.map((c) => describeSafetyCode(c, 'WARN', safetySnapshot)).join('; ')}`);
      }
    }
  } else {
    if (token) lines.push('', escapeHtml(alert.title));
    if (parsed.body) {
      lines.push('', '💬 <b>Why it surfaced</b>', '');
      bodyIndex = lines.length - 1;
    }
    if (parsed.safety) {
      const s = parsed.safety;
      const warnings = s.warnings?.split(',').map((w) => w.trim()).filter((w) => w && w !== 'AUTHORITY_NOT_PROVEN') ?? [];
      if (s.codes.length || s.top10ExLpPct || warnings.length) {
        lines.push('', '🛡️ <b>Gate Details</b>');
        if (s.codes.length) {
          const kind = s.status === 'BLOCK' ? 'BLOCK' : 'UNKNOWN';
          const label = s.status === 'BLOCK' ? 'Blocked' : 'Missing';
          lines.push(`• ${label}: ${s.codes.map((c) => describeSafetyCode(c, kind)).join('; ')}`);
        }
        if (s.top10ExLpPct) lines.push(`• Top-10 (ex-LP): ${escapeHtml(s.top10ExLpPct)}%`);
        if (warnings.length) lines.push(`• Warnings: ${warnings.map((w) => describeSafetyCode(w, 'WARN')).join('; ')}`);
      }
    }
  }

  const utcTime = alert.createdAt.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  if (token?.mint) {
    lines.push('', '🔗 <b>Token</b>', `<code>${escapeHtml(token.mint)}</code>`);
    lines.push(`<a href="https://dexscreener.com/solana/${encodeURIComponent(token.mint)}">DexScreener</a> · ${utcTime}`);
  } else {
    lines.push('', `Alert time: ${utcTime}`);
  }

  const footer = '<i>Research signal only · Not financial advice · Small, unvalidated sample</i>';
  const contentLimit = TELEGRAM_LIMITS.maxText - footer.length - 2;
  // Shorten the narrative first, preserving the frozen safety evidence and the research disclaimer.
  if (bodyIndex >= 0) {
    const evidence = parsed.body
      .replace(/(?<=\.) (?=Market cap\b)/g, '\n\n')
      .replace(/ (?=Cautions:)/g, '\n');
    lines[bodyIndex] = escapeHtml(truncate(evidence, Math.max(0, contentLimit - lines.join('\n').length)));
  }
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

  async send(chatId: string, text: string, options?: TelegramSendOptions): Promise<TelegramSendResult> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...(options?.parseMode ? { parse_mode: options.parseMode } : {}) }),
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

  const safetyByAlertId = new Map<string, FrozenRadarSafety>();
  if (alerts.length && typeof db.systemSetting.findMany === 'function') {
    const rows = await db.systemSetting.findMany({
      where: { key: { in: alerts.map((a) => radarSafetySettingKey(a.id)) } },
      select: { key: true, value: true },
    });
    for (const row of rows) {
      const parsed = FrozenRadarSafetySchema.safeParse(row.value);
      if (parsed.success) safetyByAlertId.set(row.key, parsed.data);
    }
  }

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
    const text = formatTelegramAlert(alert, token, safetyByAlertId.get(radarSafetySettingKey(alert.id)) ?? null);
    if (dryRun) {
      out.messages.push({ alertId: alert.id, text });
      continue;
    }

    let result: TelegramSendResult;
    try {
      result = await opts.transport!.send(opts.chatId, text, { parseMode: 'HTML' });
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
