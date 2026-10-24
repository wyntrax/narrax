import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@narra/database';
import {
  EARLY_RADAR_ALERT_KINDS,
  TELEGRAM_CURSOR_PREFIX,
  TelegramBotApiTransport,
  deliverEarlyRadarTelegram,
  formatTelegramAlert,
  splitTelegramBody,
  telegramConfigFromEnv,
  telegramCursorKey,
  type TelegramAlertRow,
  type TelegramSendResult,
  type TelegramTokenRow,
  type TelegramTransport,
} from './telegram';

const NOW = new Date('2026-10-20T14:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const alert = (over: Partial<TelegramAlertRow> = {}): TelegramAlertRow => ({
  id: 'alert-1',
  kind: 'EARLY_RADAR_TRENCHER',
  priority: 'IMPORTANT',
  title: 'MC: early trencher candidate for Lowcap Gems ($3K cap)',
  body: 'trencher score 70.3 (strong). Market cap $3K, liquidity $4K, 561 holders, top 10 hold 15%. Research signal only, not a prediction or a recommendation to buy.',
  refType: 'TOKEN',
  refId: 'token-1',
  createdAt: ago(5),
  earlyRadarOutcome: { profile: 'trencher', tier: 'STRONG', route: 'NARRATIVE', matchKind: 'NAME', score: 70.3 },
  ...over,
});

const token: TelegramTokenRow = { mint: 'HZLEZULB1bV6rgxm6dWMdPnftPw42KG72bwvPeEipump', symbol: 'MC', name: 'Marketcat' };

function fakeDb(rows: TelegramAlertRow[], initialCursor: Prisma.JsonValue | null = null) {
  let cursor = initialCursor;
  let writes = 0;
  let lastQuery: unknown = null;
  const db = {
    systemSetting: {
      findUnique: async () => ({ value: cursor }),
      upsert: async ({ create }: { create: { value: Prisma.JsonValue } }) => { cursor = create.value; writes++; return {}; },
    },
    alert: {
      findMany: async (args: unknown) => { lastQuery = args; return rows; },
    },
    token: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'token-1' ? token : null),
    },
  };
  return { db: db as unknown as PrismaClient, getCursor: () => cursor, getWrites: () => writes, getLastQuery: () => lastQuery };
}

class FakeTransport implements TelegramTransport {
  readonly sent: string[] = [];
  constructor(private readonly result: TelegramSendResult = { ok: true, messageId: '42' }) {}
  async send(_chatId: string, text: string): Promise<TelegramSendResult> {
    this.sent.push(text);
    return this.result;
  }
}

describe('telegram Early Radar delivery', () => {
  it('formats a readable research card with the frozen outcome and a chart link', () => {
    const text = formatTelegramAlert(alert(), token);
    expect(text).toContain('NARRA EARLY RADAR · TRENCHER · STRONG');
    expect(text).toContain('Score 70.3 · Route NARRATIVE · Match NAME');
    expect(text).toContain(alert().title);
    expect(text).toContain('Why it surfaced');
    expect(text).toContain('trencher score 70.3 (strong).');
    expect(text).not.toContain('Research signal only');
    expect(text).toContain(`Mint: ${token.mint}`);
    expect(text).toContain(`https://dexscreener.com/solana/${token.mint}`);
    expect(text).toContain('NARRA research feed');
    expect(text).toContain('Research only. No trade was placed');
  });

  it('separates the frozen safety verdict from the evidence paragraph', () => {
    const text = formatTelegramAlert(alert({
      body: 'trencher score 70.3. Top 10 hold 15%. Research signal only, not a prediction or a recommendation to buy. ' +
        'Safety evidence: UNKNOWN (TOP10_EX_LP, LP_CONTROL). Top-10 excluding known pool/locker accounts 22.0%. Warnings: PRICE_EXTENDED. Shadow mode: recorded, not enforced.',
    }), token);
    expect(text).toContain('Why it surfaced\ntrencher score 70.3. Top 10 hold 15%.');
    expect(text).not.toContain('Safety evidence:');
    expect(text).toContain('Safety gate: UNKNOWN');
    expect(text).toContain('Missing evidence: TOP10_EX_LP, LP_CONTROL');
    expect(text).toContain('Top-10 excluding pool/locker accounts: 22.0%');
    expect(text).toContain('Warnings: PRICE_EXTENDED');
    expect(text).toContain('Shadow mode: recorded, not enforced.');
    expect(text.indexOf('Safety gate: UNKNOWN')).toBeGreaterThan(text.indexOf('Why it surfaced'));
  });

  it('labels blockers, keeps a PASS free of missing-evidence text and leaves an unknown suffix intact', () => {
    expect(formatTelegramAlert(alert({ body: 'Evidence. Safety evidence: BLOCK (TOP10_CONCENTRATION, RUGGED).' }), null))
      .toContain('Safety gate: BLOCK\nBlocked by: TOP10_CONCENTRATION, RUGGED');
    expect(formatTelegramAlert(alert({ body: 'Evidence. Safety evidence: PASS.' }), null)).toContain('Safety gate: PASS');
    expect(formatTelegramAlert(alert({ body: 'Evidence. Safety evidence: PASS.' }), null)).not.toContain('Missing evidence');
    expect(formatTelegramAlert(alert({ body: 'Legacy body without a safety suffix.' }), null)).toContain('Legacy body without a safety suffix.');
  });

  it('extracts the suffix without inventing facts for an older call', () => {
    expect(splitTelegramBody('Plain body.')).toEqual({ body: 'Plain body.', safety: null });
    expect(splitTelegramBody('Body. Safety evidence: BLOCK (RUGGED). Shadow mode: recorded, not enforced.'))
      .toEqual({ body: 'Body.', safety: { status: 'BLOCK', codes: ['RUGGED'], top10ExLpPct: null, warnings: null, shadow: true } });
  });

  it('defaults to a read-only dry run and does not move the cursor', async () => {
    const fake = fakeDb([alert()]);
    const transport = new FakeTransport();
    const result = await deliverEarlyRadarTelegram(fake.db, { chatId: '-100123', now: NOW, transport, delayMs: 0 });
    expect(result.dryRun).toBe(true);
    expect(result.candidates).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.messages).toHaveLength(1);
    expect(transport.sent).toHaveLength(0);
    expect(fake.getWrites()).toBe(0);
  });

  it('sends only a fresh global Early Radar alert and advances the cursor after success', async () => {
    const fake = fakeDb([alert()]);
    const transport = new FakeTransport();
    const result = await deliverEarlyRadarTelegram(fake.db, { chatId: '-100123', now: NOW, transport, delayMs: 0, dryRun: false });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.stopped).toBe(false);
    expect(transport.sent).toHaveLength(1);
    expect(fake.getWrites()).toBe(1);
    expect(fake.getCursor()).toMatchObject({ id: 'alert-1' });
    const query = fake.getLastQuery() as { where: { userId: null; kind: { in: string[] }; refType: string } };
    expect(query.where.userId).toBeNull();
    expect(query.where.kind.in).toEqual([...EARLY_RADAR_ALERT_KINDS]);
    expect(query.where.refType).toBe('TOKEN');
  });

  it('skips a stale alert and advances past it without sending', async () => {
    const fake = fakeDb([alert({ createdAt: ago(20) })]);
    const transport = new FakeTransport();
    const result = await deliverEarlyRadarTelegram(fake.db, { chatId: '-100123', now: NOW, transport, delayMs: 0, dryRun: false, maxAgeMs: 15 * 60_000 });
    expect(result.skippedStale).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.messages).toHaveLength(0);
    expect(transport.sent).toHaveLength(0);
    expect(fake.getWrites()).toBe(1);
  });

  it('stops on a 429 and leaves the cursor so the next run retries', async () => {
    const fake = fakeDb([alert()]);
    const transport = new FakeTransport({ ok: false, status: 429, retryAfterSeconds: 5, description: 'Too Many Requests' });
    const result = await deliverEarlyRadarTelegram(fake.db, { chatId: '-100123', now: NOW, transport, delayMs: 0, dryRun: false });
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.stopped).toBe(true);
    expect(result.lastError).toContain('Too Many Requests');
    expect(fake.getWrites()).toBe(0);
  });

  it('advances past a malformed message so one bad alert cannot block the feed', async () => {
    const fake = fakeDb([alert()]);
    const transport = new FakeTransport({ ok: false, status: 400, description: 'Bad Request: message is too long' });
    const result = await deliverEarlyRadarTelegram(fake.db, { chatId: '-100123', now: NOW, transport, delayMs: 0, dryRun: false });
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(fake.getWrites()).toBe(1);
  });

  it('stops without consuming alerts when the bot is not in the chat', async () => {
    const fake = fakeDb([alert()]);
    const transport = new FakeTransport({ ok: false, status: 403, description: 'Forbidden: bot is not a member of the group chat' });
    const result = await deliverEarlyRadarTelegram(fake.db, { chatId: '-100123', now: NOW, transport, delayMs: 0, dryRun: false });
    expect(result.stopped).toBe(true);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(fake.getWrites()).toBe(0);
  });

  it('retries a Telegram 5xx instead of consuming the alert', async () => {
    const fake = fakeDb([alert()]);
    const transport = new FakeTransport({ ok: false, status: 502, description: 'Bad Gateway' });
    const result = await deliverEarlyRadarTelegram(fake.db, { chatId: '-100123', now: NOW, transport, delayMs: 0, dryRun: false });
    expect(result.stopped).toBe(true);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(fake.getWrites()).toBe(0);
  });

  it('reads a per-chat cursor and does not resend an alert at the cursor', async () => {
    const cursor = { at: alert().createdAt.toISOString(), id: 'alert-1' };
    const fake = fakeDb([], cursor);
    const result = await deliverEarlyRadarTelegram(fake.db, { chatId: '-100123', now: NOW, dryRun: true });
    expect(result.scanned).toBe(0);
    const query = fake.getLastQuery() as { where: { OR?: unknown } };
    expect(query.where.OR).toBeDefined();
  });

  it('keys cursors per chat and sanitizes a public channel name', () => {
    expect(telegramCursorKey('-100123')).toBe(`${TELEGRAM_CURSOR_PREFIX}-100123`);
    expect(telegramCursorKey('@my_channel')).toBe(`${TELEGRAM_CURSOR_PREFIX}_my_channel`);
  });

  it('reads configuration from the environment and is off without both values', () => {
    expect(telegramConfigFromEnv({})).toBeNull();
    expect(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '' })).toBeNull();
    expect(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '-100', TELEGRAM_MAX_AGE_MIN: '5', TELEGRAM_MAX_PER_RUN: '3', TELEGRAM_SEND_DELAY_MS: '0' })).toMatchObject({
      token: 't',
      chatId: '-100',
      maxAgeMs: 5 * 60_000,
      limit: 3,
      delayMs: 0,
    });
    expect(telegramConfigFromEnv({ TELEGRAM_ENABLED: 'false', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '-100' })).toBeNull();
    expect(telegramConfigFromEnv({ TELEGRAM_ENABLED: 'FALSE', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '-100' })).toBeNull();
  });
});

describe('Telegram Bot API transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts a plain-text message with link previews disabled', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new TelegramBotApiTransport('secret-token', 'https://api.test/');
    const result = await transport.send('-100123', 'hello');
    expect(result).toEqual({ ok: true, messageId: '7' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.test/botsecret-token/sendMessage');
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: '-100123', text: 'hello', disable_web_page_preview: true });
    expect(String(init.body)).not.toContain('secret-token');
  });

  it('returns retry_after on a 429 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'Too Many Requests', parameters: { retry_after: 3 } }), { status: 429, headers: { 'content-type': 'application/json' } })));
    const result = await new TelegramBotApiTransport('secret-token', 'https://api.test').send('-100', 'hello');
    expect(result).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 3, description: 'Too Many Requests' });
  });
});
