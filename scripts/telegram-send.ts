import { parseArgs } from 'node:util';
import { createPrisma } from '@narra/database';
import { deliverEarlyRadarTelegram, telegramConfigFromEnv, TelegramBotApiTransport, TELEGRAM_LIMITS } from '../workers/pipeline/src/telegram';

const usage = `Early Radar Telegram delivery.

  npm run telegram:send -- [options]

Options:
  --send                      Actually post to Telegram (default: dry run, prints only)
  --dry-run                   Force dry run, even if --send is present
  --limit <n>                 Maximum alerts read this run (default: 10, max: 20)
  --max-age-min <n>           Ignore calls older than this (default: 15)
  --chat-id <id>              Override TELEGRAM_CHAT_ID
  --json                      Print the delivery summary and messages as JSON
  --help                      Show this help

Reads global Early Radar alerts only. It never sends a user-owned alert, creates a call, order or position.
Requires DATABASE_URL. --send also requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.`;

const positive = (name: string, raw: string | undefined, fallback: number): number => {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number`);
  return n;
};

async function main() {
  const { values } = parseArgs({
    options: {
      send: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      limit: { type: 'string' },
      'max-age-min': { type: 'string' },
      'chat-id': { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const config = telegramConfigFromEnv();
  const send = values.send === true && values['dry-run'] !== true;
  if (send && process.env.TELEGRAM_ENABLED?.trim().toLowerCase() === 'false') throw new Error('TELEGRAM_ENABLED=false disables Telegram delivery');
  const chatId = values['chat-id']?.trim() || config?.chatId || (send ? undefined : 'dry-run');
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID is required (or pass --chat-id)');
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (send && !token) throw new Error('TELEGRAM_BOT_TOKEN is required for --send');

  const limit = Math.max(1, Math.min(Math.floor(positive('--limit', values.limit, config?.limit ?? TELEGRAM_LIMITS.maxPerRun)), 20));
  const maxAgeMs = positive('--max-age-min', values['max-age-min'], (config?.maxAgeMs ?? TELEGRAM_LIMITS.maxAgeMs) / 60_000) * 60_000;
  const transport = send ? new TelegramBotApiTransport(token!, process.env.TELEGRAM_API_BASE, 10_000) : undefined;

  const db = createPrisma();
  try {
    const summary = await deliverEarlyRadarTelegram(db, {
      chatId,
      transport,
      dryRun: !send,
      limit,
      maxAgeMs,
      delayMs: send ? (config?.delayMs ?? TELEGRAM_LIMITS.sendDelayMs) : 0,
    });
    if (values.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    console.log(`Telegram Early Radar delivery (${send ? 'SEND' : 'DRY RUN'}) to ${chatId}`);
    console.log(`Scanned ${summary.scanned}, candidates ${summary.candidates}, sent ${summary.sent}, stale ${summary.skippedStale}, failed ${summary.failed}${summary.stopped ? ' (stopped)' : ''}`);
    for (const message of summary.messages) {
      console.log(`\n--- ${message.alertId} ---\n${message.text}`);
    }
    if (summary.lastError) console.log(`\nLast error: ${summary.lastError}`);
    if (!send) console.log('\nDry run only. Add --send to post.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Telegram delivery failed');
  process.exitCode = 1;
});
