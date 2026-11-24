import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma, PrismaClient } from '@narra/database';
import { evaluateRadarSafety } from '@narra/token-intel';
import { testTradeability } from '../../../scripts/test-tradeability';
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
  title: 'MC: early trencher candidate for Lowcap Gems ($8K cap)',
  body: 'trencher score 70.3 (strong). Market cap $8K, liquidity $4K, 561 holders, top 10 hold 15%. Research signal only, not a prediction or a recommendation to buy. Safety evidence: PASS.',
  refType: 'TOKEN',
  refId: 'token-1',
  createdAt: ago(5),
  earlyRadarOutcome: { profile: 'trencher', tier: 'STRONG', route: 'NARRATIVE', matchKind: 'NAME', score: 70.3 },
  ...over,
});

const token: TelegramTokenRow = { mint: 'HZLEZULB1bV6rgxm6dWMdPnftPw42KG72bwvPeEipump', symbol: 'MC', name: 'Marketcat' };

function fakeDb(
  rows: TelegramAlertRow[],
  initialCursor: Prisma.JsonValue | null = null,
  settingsRows: Array<{ key: string; value: Prisma.JsonValue }> = [],
) {
  let cursor = initialCursor;
  let writes = 0;
  let lastQuery: unknown = null;
  const db = {
    systemSetting: {
      findUnique: async () => ({ value: cursor }),
      findMany: async () => settingsRows,
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
  it('formats a neat research card with frozen safety snapshot telemetry and a chart link', () => {
    const snapshot = {
      ...evaluateRadarSafety({
        tokenId: 'token-1',
        mint: token.mint,
        profile: 'trencher',
        route: 'SOCIAL',
        matchKind: 'MINT',
        tier: 'WATCH',
        score: 61.6,
        metricId: 'm-1',
        holderMetricId: 'h-1',
        riskMetricId: 'r-1',
        priceUsd: 0.001,
        marketCapUsd: 62_000,
        liquidityUsd: 23_000,
        volume24hUsd: 40_000,
        holders: 842,
        top10Pct: 52.6,
        top10ExLpPct: 18.0,
        devHoldingPct: 0,
        riskFlags: [],
        marketAt: ago(2),
        holdersAt: ago(5),
        riskAt: ago(5),
        priceGrowth1hPct: 12.4,
        priceGrowth3hPct: null,
        narrativeManipulationRisk: 14,
        lpBurnedPct: null,
        lpLocked: true,
        bundlePct: 25.8,
        sniperPct: 20.4,
        insiderPct: 0.8,
        sameSlotBuyers: 2,
        uniqueBuyers24h: 120,
        uniqueSellers24h: 80,
        priceImpactPct: 0.48,
        deployerPriorTokens: 0,
        deployerPriorRugs: null,
        tradeabilityAt: ago(1),
        tradeability: testTradeability(token.mint, ago(1), 0.48),
      }, NOW),
      mode: 'shadow' as const,
    };

    const text = formatTelegramAlert(alert({
      title: 'MC: early trencher candidate from social buzz ($62K cap)',
      body: 'trencher score 61.6 (watch). 12 accounts, 16 posts named it in 48h, found by mint address. Market cap $62K, liquidity $23K, 842 holders, top 10 hold 53% (reported; may include the pool). Research signal only, not a prediction or a recommendation to buy. Safety evidence: BLOCK (BUNDLE_SNIPER_INSIDER). Top-10 excluding known pool/locker accounts 18.0%. Warnings: AUTHORITY_NOT_PROVEN. Shadow mode: recorded, not enforced.',
      earlyRadarOutcome: { profile: 'trencher', tier: 'WATCH', route: 'SOCIAL', matchKind: 'MINT', score: 61.6 },
    }), token, snapshot);

    expect(text).toContain('🔴 <b>Marketcat (MC)</b>');
    expect(text).toContain('TRENCHER · WATCH · Score 61.6');
    expect(text).toContain('⛔ <b>Safety: BLOCK</b> <i>(shadow)</i>');
    expect(text).toContain('• Cap $62K · Liq $23K · 842 holders');
    expect(text).toContain('• 1h +12.4% · $50 slippage 0.48%');
    expect(text).toContain('• Top 10 (ex-LP) 18.0% · Dev 0.0% · LP Locked');
    expect(text).toContain('• Bundle 25.8% · Sniper 20.4% · Insider 0.8%');
    expect(text).toContain('• Same-slot buyers: 2 · Deployer prior: 0 tokens (rugs —)');
    expect(text).toContain('• Social (Mint match): 12 accounts, 16 posts (48h)');
    expect(text).toContain('• Chatter manipulation risk: 14/100');
    expect(text).toContain('• Blocked: Bundle + sniper + insider 47.0% (&gt; 28%)');
    expect(text).toContain('• Missing: Deployer history incomplete');
    expect(text).not.toContain('AUTHORITY_NOT_PROVEN');
    expect(text).toContain(`<code>${token.mint}</code>`);
    expect(text).toContain(`<a href="https://dexscreener.com/solana/${token.mint}">DexScreener</a> · 2026-10-20 13:55:00 UTC`);
    expect(text).not.toContain('Research signal only, not a prediction');
    expect(text).toContain('<i>Research signal only · Not financial advice · Small, unvalidated sample</i>');
  });

  it('formats a readable fallback card when no frozen safety snapshot is loaded', () => {
    const text = formatTelegramAlert(alert({ body: 'trencher score 70.3 (strong). Market cap $8K, liquidity $4K, 561 holders, top 10 hold 15%. Research signal only, not a prediction or a recommendation to buy.' }), token);
    expect(text).toContain('⚪ <b>Marketcat (MC)</b>');
    expect(text).toContain('TRENCHER · STRONG · Score 70.3');
    expect(text).toContain('ℹ️ <b>Safety: Unavailable</b>');
    expect(text).toContain(alert().title);
    expect(text).toContain('💬 <b>Why it surfaced</b>');
    expect(text).toContain('trencher score 70.3 (strong).\n\nMarket cap $8K');
    expect(text).not.toContain('not a prediction or a recommendation to buy');
    expect(text).toContain(`<code>${token.mint}</code>`);
    expect(text).toContain(`<a href="https://dexscreener.com/solana/${token.mint}">DexScreener</a> · 2026-10-20 13:55:00 UTC`);
  });

  it('escapes provider text and keeps the mint copyable', () => {
    const text = formatTelegramAlert(alert({ title: 'A <b> & B', body: 'x < y & z. Safety evidence: BLOCK (X&Y).' }), token);
    expect(text).toContain('A &lt;b&gt; &amp; B');
    expect(text).toContain('x &lt; y &amp; z.');
    expect(text).toContain(`<code>${token.mint}</code>`);
  });

  it('preserves safety evidence, links and the disclaimer when a narrative is too long', () => {
    const text = formatTelegramAlert(alert({body: `${'Evidence paragraph. '.repeat(600)}Safety evidence: UNKNOWN (LP_CONTROL).`}), token);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain('…');
    expect(text).toContain('⚠️ <b>Safety: INCOMPLETE</b>');
    expect(text).toContain('• Missing: LP lock/burn status missing');
    expect(text).toContain(`<code>${token.mint}</code>`);
    expect(text).toContain('2026-10-20 13:55:00 UTC');
    expect(text.endsWith('<i>Research signal only · Not financial advice · Small, unvalidated sample</i>')).toBe(true);
  });

  it('keeps zero scores but labels missing or invalid scores and absent safety evidence explicitly', () => {
    for (const score of [null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const text = formatTelegramAlert(alert({ body: 'Legacy body without safety.', earlyRadarOutcome: {...alert().earlyRadarOutcome!, score}}), null);
      expect(text).toContain('Score unavailable');
      expect(text).toContain('ℹ️ <b>Safety: Unavailable</b>');
      expect(text).not.toContain('Safety: PASS');
      expect(text).not.toContain('DexScreener');
    }
    expect(formatTelegramAlert(alert({earlyRadarOutcome: {...alert().earlyRadarOutcome!, score: 0}}), token)).toContain('Score 0');
  });

  it('separates the frozen safety verdict from the evidence paragraph', () => {
    const text = formatTelegramAlert(alert({
      body: 'trencher score 70.3. Top 10 hold 15%. Research signal only, not a prediction or a recommendation to buy. ' +
        'Safety evidence: UNKNOWN (TOP10_EX_LP, LP_CONTROL). Top-10 excluding known pool/locker accounts 22.0%. Warnings: PRICE_ALREADY_EXTENDED. Shadow mode: recorded, not enforced.',
    }), token);
    expect(text).toContain('💬 <b>Why it surfaced</b>\ntrencher score 70.3. Top 10 hold 15%.');
    expect(text).not.toContain('Safety evidence:');
    expect(text).toContain('⚠️ <b>Safety: INCOMPLETE</b> <i>(shadow)</i>');
    expect(text).toContain('• Missing: Top-10 (ex-LP) share missing; LP lock/burn status missing');
    expect(text).toContain('• Top-10 (ex-LP): 22.0%');
    expect(text).toContain('• Warnings: Price already up ≥35% (1h)');
    expect(text.indexOf('Gate Details')).toBeGreaterThan(text.indexOf('Why it surfaced'));
  });

  it('labels blockers, keeps a PASS free of missing-evidence text and leaves an unknown suffix intact', () => {
    expect(formatTelegramAlert(alert({ body: 'Evidence. Safety evidence: BLOCK (TOP10_CONCENTRATION, RUGGED).' }), null))
      .toContain('⛔ <b>Safety: BLOCK</b>');
    expect(formatTelegramAlert(alert({ body: 'Evidence. Safety evidence: BLOCK (TOP10_CONCENTRATION, RUGGED).' }), null))
      .toContain('• Blocked: Top-10 holder share too high; Token flagged as rugged');
    expect(formatTelegramAlert(alert({ body: 'Evidence. Safety evidence: PASS.' }), null)).toContain('✅ <b>Safety: PASS</b>');
    expect(formatTelegramAlert(alert({ body: 'Evidence. Safety evidence: PASS.' }), null)).not.toContain('Missing:');
    expect(formatTelegramAlert(alert({ body: 'Legacy body without a safety suffix.' }), null)).toContain('Legacy body without a safety suffix.');
  });

  it('extracts the suffix without inventing facts for an older call', () => {
    expect(splitTelegramBody('Plain body.')).toEqual({ body: 'Plain body.', safety: null });
    expect(splitTelegramBody('Body. Safety evidence: BLOCK (RUGGED). Shadow mode: recorded, not enforced.'))
      .toEqual({ body: 'Body.', safety: { status: 'BLOCK', codes: ['RUGGED'], top10ExLpPct: null, warnings: null, shadow: true } });
  });

  it('loads frozen safety snapshots when delivering alerts', async () => {
    const snapshot = evaluateRadarSafety({
      tokenId: 'token-1',
      mint: token.mint,
      profile: 'trencher',
      route: 'SOCIAL',
      matchKind: 'MINT',
      tier: 'WATCH',
      score: 65,
      metricId: 'm-1',
      holderMetricId: 'h-1',
      riskMetricId: 'r-1',
      priceUsd: 0.001,
      marketCapUsd: 40_000,
      liquidityUsd: 12_000,
      volume24hUsd: 20_000,
      holders: 400,
      top10Pct: 50,
      top10ExLpPct: 16,
      devHoldingPct: 0,
      riskFlags: [],
      marketAt: ago(1),
      holdersAt: ago(2),
      riskAt: ago(2),
      priceGrowth1hPct: 5,
      priceGrowth3hPct: 10,
      narrativeManipulationRisk: 15,
      lpBurnedPct: 100,
      lpLocked: true,
      bundlePct: 2,
      sniperPct: 3,
      insiderPct: 1,
      sameSlotBuyers: 1,
      uniqueBuyers24h: 80,
      uniqueSellers24h: 60,
      priceImpactPct: 0.5,
      deployerPriorTokens: 0,
      deployerPriorRugs: 0,
      tradeabilityAt: ago(1),
      tradeability: testTradeability(token.mint, ago(1), 0.5),
    }, NOW);
    const fake = fakeDb([alert()], null, [
      { key: 'research.radarSafety.alert-1', value: snapshot as unknown as Prisma.JsonValue },
      { key: 'research.market.token-1', value: { websiteUrl: 'https://marketcat.example', twitterUrl: 'https://x.com/marketcat' } },
    ]);
    const transport = new FakeTransport();
    const result = await deliverEarlyRadarTelegram(fake.db, { chatId: '-100123', now: NOW, transport, delayMs: 0, dryRun: true });
    expect(result.messages[0]?.text).toContain('🟢 <b>Marketcat (MC)</b>');
    expect(result.messages[0]?.text).toContain('• Bundle 2.0% · Sniper 3.0% · Insider 1.0%');
    expect(result.messages[0]?.text).toContain('<a href="https://x.com/marketcat">X</a>');
    expect(result.messages[0]?.text).toContain('<a href="https://marketcat.example/">Website</a>');

    const blockedAlert = alert({ id: 'alert-2', body: 'Blocked token. Safety evidence: BLOCK (BUNDLE_SNIPER_INSIDER).' });
    const unknownAlert = alert({ id: 'alert-3', body: 'Incomplete token. Safety evidence: UNKNOWN (LP_CONTROL).' });
    const filteredDb = fakeDb([blockedAlert, unknownAlert]);
    const filtered = await deliverEarlyRadarTelegram(filteredDb.db, { chatId: '-100123', now: NOW, transport, delayMs: 0, dryRun: false });
    expect(filtered.skippedUnsafe).toBe(2);
    expect(filtered.sent).toBe(0);
    expect(filteredDb.getWrites()).toBe(2);

    const drawdownSnap = evaluateRadarSafety({
      ...snapshot.facts,
      marketAt: ago(1),
      holdersAt: ago(2),
      riskAt: ago(2),
      evidenceAt: null,
      priceGrowth1hPct: -45,
      drawdownFromPeakPct: 68,
      tradeabilityAt: ago(1),
      tradeability: testTradeability(token.mint, ago(1), 0.5),
    }, NOW);
    const renderedDrawdown = formatTelegramAlert(alert(), token, drawdownSnap);
    expect(renderedDrawdown).toContain('Price already dumped from peak');
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

  it('requests HTML parse mode for formatted alert cards', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 8 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const transport = new TelegramBotApiTransport('secret-token', 'https://api.test');
    await transport.send('-100123', '<b>hello</b>', { parseMode: 'HTML' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: '-100123', text: '<b>hello</b>', disable_web_page_preview: true, parse_mode: 'HTML' });
  });
});
