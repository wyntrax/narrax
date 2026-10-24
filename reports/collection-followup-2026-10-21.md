# Collection and Telegram follow-up

Read-only application inspection. Window: **2026-10-20 22:56:00–23:30:26 UTC** (October 21 local time).
Machine-readable evidence: `collection-followup-2026-10-21.json`.

## Findings

- Eight market refreshes completed. Each selected 150 tokens; 66–104 prices were written per run.
- **723 source-linked observations across 310 tokens**; 234 tokens received multiple observations. **220 tokens** had a source-linked price within the final 15-minute window.
- Market refreshes created 27 launch-token records and wrote 32 holder snapshots. All eight runs reported a provider rate limit, so holder coverage remains constrained.
- Market, token resolution, narrative ingestion and Telegram each had one consumer, no waiting/active backlog at inspection, and **zero new failed jobs** in the window. Retained failures (market 3, narrative 4) predate it.
- `radar:status` returned `OK`; Windows task `NarraRadarStatus` last returned exit 0. This checks the newest call/price timestamps, **not the freshness of evidence inside each call**.

## Automatic Telegram delivery verified

- Alert: **memestock — Trencher / WATCH**, narrative route, score 57.6.
- Alert created: `2026-10-20T22:59:38.764Z`.
- Worker log: `sent:1`, `failed:0`, `stopped:false`, `error:null`.
- Persisted Telegram cursor matches alert `cmvhacrri01vtmodpguul3ajm`, updated at `2026-10-20T23:00:05.397Z`: **26.633 seconds after alert creation**.
- This proves the worker received a successful Telegram Bot API response and saved progress. Human receipt/read status was not independently checked. No manual resend was performed.
- Telegram jobs retain only five minutes of completed history. The successful job had already expired by inspection; the worker log and matching cursor supply the evidence. Empty recent-job results do not imply no delivery.

## Important: new alert, stale underlying evidence

The alert's latest prior price and holder snapshots were both timestamped **18:00:00.083 UTC**, approximately **299.6 minutes** before the alert. Its frozen outcome is correctly marked `NO_FRESH_ENTRY_PRICE`, with no entry price/source. Subsequent prices cannot retroactively repair an alert-time entry.

Code trace: `tokenResolution.ts` reads each token's latest metric and holder row without an age bound before evaluating Early Radar. `socialTokens.ts` likewise has no latest-row age bound. `createEarlyRadarAlert` records the alert even when `radarEntry` returns an unknown entry. Telegram's 15-minute limit applies to the **alert timestamp**, not to the underlying market evidence.

**Recommended next repair:** enforce market-evidence freshness before publishing a new Early Radar call, consistently across both discovery routes; expose stale-evidence skips separately from quiet qualification. This is a data-validity repair, not score/floor tuning. Decide and document holder freshness independently of market-price freshness. Keep this existing alert's missing entry explicit rather than filling it with a later price.

## Limits

This is roughly 34 minutes of post-restart evidence, not a continuous-uptime guarantee or evidence of predictive performance. Coverage counts identify tokens seen within the window, not all newly discovered tokens. Edge time buckets are partial. No product code or configuration was changed during this follow-up; no test suite was rerun for the read-only diagnosis. Worker and existing schedule were left running.
