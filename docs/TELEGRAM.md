# Early Radar to Telegram

Read-only delivery of global Early Radar alerts to a Telegram group. It posts research alerts that the pipeline
already wrote. It never creates a call, order, position or trade, and it never sends a user-owned notification.

## What it sends

- `EARLY_RADAR_TRENCHER` and `EARLY_RADAR_HOLDER` only, where `userId` is null.
- A plain-text card with a readable structure: profile/tier header, score/route/match line, the call title, a
  **Why it surfaced** paragraph, the frozen safety verdict with its missing/blocked evidence codes, pool-excluded
  concentration and warnings when present, the mint, a chart link, the observation timestamp and a research-only footer.
- The safety suffix is presented as separate lines instead of being buried at the end of the evidence paragraph. The
  stored alert body is unchanged and remains authoritative; the split is presentation only. Older calls without a
  suffix are still delivered without inventing a verdict.
- Fresh calls only: older than `TELEGRAM_MAX_AGE_MIN` (default 15 minutes) is skipped and logged.
- Deduplication is inherited from the alert writer: one alert per token/profile per 6 hours.

It deliberately does **not** send opportunities, decisions, wallet data, positions, PnL or user notifications.
Do not present the messages as investment advice or as a validated edge. The current radar cohort is small:
1h median +1.4%, 4h and 24h INSUFFICIENT, and the 24h median is -48.9%.

## Configuration

Add these to the ignored local `.env` (never commit the bot token):

```dotenv
TELEGRAM_BOT_TOKEN=123456:replace-with-botfather-token
TELEGRAM_CHAT_ID=-1001234567890
# Optional
TELEGRAM_MAX_AGE_MIN=15
TELEGRAM_MAX_PER_RUN=10
TELEGRAM_SEND_DELAY_MS=1200
# TELEGRAM_API_BASE=https://api.telegram.org
# TELEGRAM_ENABLED=false
```

The delivery worker is off when either the token or the chat id is missing. `TELEGRAM_ENABLED=false` disables it
without deleting the credentials.

## Getting the chat id

1. Create a bot with `@BotFather` and copy its token.
2. Add the bot to the group. Give it permission to send messages; it does not need admin rights beyond that.
3. Send any message in the group, then call:

```text
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Use the negative `chat.id` for a private group. A public channel can use `@channelname`. Keep the token out of
screenshots, logs and commits.

## Dry run

The wrapper loads `.env` and prints the exact messages without sending them:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\telegram-send.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\telegram-send.ps1 -Limit 2 -MaxAgeMin 100000
```

The second form deliberately widens the age window so an older stored call can be inspected. Do not use a large
age window with `-Send` in production; it would post stale calls.

## Send to a test chat

1. Put the test chat id in `TELEGRAM_CHAT_ID`, or pass `-ChatId`.
2. Run one explicit send after reviewing the dry run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\telegram-send.ps1 -Send -Limit 1
```

3. Confirm the message in Telegram. Then point `TELEGRAM_CHAT_ID` at the real group and restart the worker.

## Continuous delivery

`workers/pipeline/src/main.ts` registers the `telegram-delivery` queue every 30 seconds when both credentials are
present. Restart `npm run dev:workers` after changing the env. The CLI and worker share the same cursor, so a manual
`-Send` does not make the worker resend the same alert.

The cursor is stored in `SystemSetting` under `integrations.telegram.cursor.<chat-id>`. No schema or migration is
needed. A new chat id starts from `now - TELEGRAM_MAX_AGE_MIN`, so switching groups does not replay the old feed.

## Failure behavior

- `429`, `401`/`403`, a Telegram `5xx` or a network failure stops the run and leaves the cursor in place; the next run
  retries the same alert. This covers rate limits, an invalid token, and a bot that was removed or blocked.
- A malformed-message `400` (for example, too long) advances past that alert so it cannot block the feed, and records
  the error in the summary. A `400` that names a chat/token problem stops instead of consuming the feed.
- Delivery is at-least-once. A crash after Telegram accepts a message but before the cursor write can duplicate one
  message. There is no exactly-once guarantee.
- Telegram can rate-limit a group; the worker sends at most `TELEGRAM_MAX_PER_RUN` messages and waits
  `TELEGRAM_SEND_DELAY_MS` between them.

## Troubleshooting

- **`getMe` works but `getChat` returns `400 chat not found`:** the token is valid, but the bot is not in that
  chat or the id is wrong. Add `@narraxfun_bot` to the group, then send `/start@narraxfun_bot` in the group. With
  BotFather privacy mode on, ordinary group messages may not reach the bot; a command or mention will.
- **No `getUpdates` result:** the bot has not seen a command/membership update. Add it to the group again and send
  `/start@narraxfun_bot`; do not guess the id from a member or another bot.
- **The worker says `telegram delivery on` but nothing arrives:** check the `telegram-delivery` job result. A summary
  with `"scanned":0` means there was no Early Radar call in the last 15 minutes. This is normal during a quiet feed.
  To test the chat path without waiting, use the CLI with a wide age window and one send:
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\telegram-send.ps1 -Send -Limit 1 -MaxAgeMin 100000`.
  That deliberately posts one stored call; keep the worker's production age at 15 minutes.
- **Repeated `chat not found`/`Forbidden` logs:** fix the bot membership or chat id. The cursor is intentionally not
  advanced on these errors, so the alert is retried rather than lost.
- **Duplicate or alternating delivery:** run one `dev:workers` process. Each extra worker adds another consumer to
  the `telegram-delivery` queue.

## Disable or remove

- Set `TELEGRAM_ENABLED=false` and restart the worker, or remove the two credentials.
- To remove the repeating job completely, delete the `telegram-delivery` job scheduler from the configured Redis
  instance after the worker is stopped. The cursor row is harmless and can stay for an audit.

## Verification

`npx vitest run workers/pipeline/src/telegram.test.ts` covers formatting, stale skipping, cursor behavior, global
alert filtering, 429/5xx/auth/malformed handling and the Bot API request. The delivery core was dry-run against the
application database; no live group was used in verification.
