# Radar publication freshness gate

Date: **2026-10-21**. Machine-readable run evidence: `radar-freshness-verification-2026-10-21.json`.

## What changed

Both Early Radar routes used to publish from whatever price and holder rows happened to be newest, at any age. A real
call on 2026-10-20 used evidence **299.6 minutes old** and its frozen outcome is `NO_FRESH_ENTRY_PRICE`.

`createEarlyRadarAlert` now re-reads the exact `metricId` and `holderMetricId` that were scored, inside the same
transaction and advisory lock that deduplicates a call, and refuses to publish when:

| Reason | Meaning |
|---|---|
| `MARKET_MISSING` / `HOLDERS_MISSING` | the exact row is gone or was never supplied |
| `MARKET_INVALID` / `HOLDERS_INVALID` | unusable timestamp, or a missing/non-positive price |
| `MARKET_FUTURE` / `HOLDERS_FUTURE` | timestamp is ahead of the publication clock |
| `MARKET_STALE` | price older than **15 minutes** |
| `HOLDERS_STALE` | holder snapshot older than **60 minutes** |
| `MARKET_UNVERIFIED` | no exact per-observation source for that metric row |

Publication time is captured after lock acquisition, not inherited from the job start, so a slow run cannot publish
under an older timestamp. A newer, unrelated snapshot cannot rescue a stale scored row: the check uses the rows named by
the evaluation.

The holder window is deliberately wider than the price window: holders are collected on a 30-minute reuse cycle, and 60
minutes allows one refresh/retry without accepting hours-old concentration data. Both numbers are operational starting
values, not thresholds tuned on outcomes.

No floor, weight, score, candidate rule or Telegram rule changed. Stale evidence is withheld; it is not backfilled or
repaired from later prices.

## Skip reporting

`resolveTokens` and `scanSocialTokens` summaries now include `evidenceSkipped` keyed by the reasons above. Only tokens
under the $100K ceiling and not flagged suspicious are counted: those are withheld radar candidates. A token that never
reaches the lane, or simply does not score, is not counted as an evidence skip.

`radar:status` also prints the newest call's frozen entry and warns `N_CALLS_WITHOUT_FRESH_ENTRY` for calls in the last
24 hours whose outcome has no fresh entry price. That closes the earlier blind spot where timestamp-only liveness could
report `OK` beside unmeasurable evidence. Exit codes and staleness thresholds are unchanged.

## Live verification

Single worker; resolution job run at `2026-10-21T00:50:37.756Z`, finished `00:51:01.022Z`.

| Route | Stale price | Stale holders | Missing holders | New radar calls |
|---|---|---|---|---|
| narrative | 6 | 1 | 0 | 0 |
| social | 38 | 6 | 25 | 0 |

- The prior stale call (`cmvhacrri01vtmodpguul3ajm`) still has `entryUnknownReason: NO_FRESH_ENTRY_PRICE`; it was not
  retroactively filled.
- That token's current evidence is fresh (price `00:50:23Z`, holders `00:45:00Z`), so its missing entry is now a
  historical fact rather than an ongoing data problem. It did not qualify under the unchanged rules.
- `newRadarCalls: 0`, so Telegram had nothing to deliver in this cycle.

## Duplicate worker incident

At 07:37 local a second `npm run dev:workers` was running beside the configured worker: **2 consumers on every queue**,
including `telegram-delivery`. Delivery advances a per-chat cursor after sending and has no lock around read/send/write,
so two consumers could have sent the same alert twice. Consolidated to one worker.

Added `workers/pipeline/src/workerLock.ts`: a Redis lease (`narra:pipeline:worker`, 90 s TTL, renewal every 30 s,
owner-checked release). A second process now exits with `worker_already_running` and prints the current holder and TTL.
A process that loses its lease exits instead of running beside its replacement. Verified live: the second instance exited
within seconds while the first kept every queue at one consumer.

**Operations:** `taskkill /F` skips graceful shutdown and leaves the lease for up to 90 s. Wait for it, or delete
`narra:pipeline:worker` in the configured Redis database (the current `.env` uses DB 5). A normal stop releases it
immediately.

## Verification

- Full backend: **1,373 tests / 119 files**, zero failed, skipped or todo.
- Root and web typechecks pass.
- New tests: exact age boundaries (15 min price / 60 min holders, plus one millisecond), missing/invalid/future evidence,
  unusable prices, newer-row substitution, provenance retained across an intervening refresh, publication wall clock,
  skip-count boundaries (ceiling, suspicious relation), singleton lease ownership, late release, renewal and loss, and the
  liveness warning rules.
- Isolated PostgreSQL `narra_radar_test_20261016` and Memurai `127.0.0.1:16389`; fixture providers, never the application
  database.
- Backend report: `C:/Users/gifar/AppData/Local/Temp/opencode/radar-status-backend.json`.

## Limits

- One live resolution cycle, not a continuous-uptime guarantee.
- **25 social candidates under $100K had no holder snapshot at all**, which is a provider-coverage gap, not a gate
  decision. Until holder collection improves, these tokens cannot produce a holder-profile call.
- No fresh qualifying call occurred in this window, so a genuinely fresh call plus automatic Telegram delivery is still
  unverified end to end.
- The gate improves data validity, not predictive performance. The earlier cohort's 24 h median was negative and the
  sample is small; no performance claim follows from this work.

## Collection follow-up: burst pacing and candidate price top-up (2026-10-21, 04:11Z)

The gate was withholding real candidates for two collection reasons, not because the rules were too strict.

**1. GeckoTerminal throttles bursts.** Seven consecutive market runs each wrote exactly **4 holder rows** and then
returned one `geckoterminal: rate_limited (HTTP 429)`; raising the info cap would not have helped. A probe at 12-second
spacing sustained **11/11 successes** after the first throttled call. `GECKO_MIN_INTERVAL_MS` is now **15 s** and the
per-run info cap **18**. Six consecutive verified cycles (03:54-04:22Z): **18 info calls each, 13-18 holder rows, zero
429s**, duration 271-285 s. The 150-token price budget, 30-minute holder reuse and all floors/gates are unchanged.

**2. Social candidates were outside the rotating price set.** `MARKET_STALE` was 49 per social scan because a mentioned
token can miss the market job's 150-token selection and carry a 20-40 minute old price. `scanSocialTokens` now refreshes
the exact quote for resolved candidates whose latest price is older than 15 minutes, bounded to **60 per scan**, from the
same DexScreener source and with `storeMarketSnapshot` provenance. Live effect: `MARKET_STALE` **49 -> 2**,
`tokensEvaluated` **0 -> 20**, `metricsWritten` **27-32**. The gate still decides; nothing is published by the top-up.

**Holder coverage.** The paced loop raised linked-only tokens from **11/45 to 26/26** with holders under 60 minutes.
Linked-and-mentioned reached **35 fresh, 46 still without a holder row**. Of those 46, **43 had never had a risk row**:
the info loop only sees the market job's current selection, so the remaining gap is selection, not provider silence.
Next bounded step is a social-candidate priority handoff inside the same 18-call budget.

**Live state.** 182 fresh sub-$100K tokens, 121 eligible for holder refresh, newest price 1 minute old, latest social
skips 2 stale prices / 39 missing holders / 8 stale holders, **0 new radar calls**. The 22:59Z call still has
`NO_FRESH_ENTRY_PRICE`; the Telegram cursor is unchanged. A fresh qualifying call and its automatic delivery are still
unverified. No performance claim follows from any of this.

**Verified.** Full backend **1,374 tests / 119 files**, zero failed, skipped or todo (`check-test-results.mjs` exit 0),
including 6/6 `socialTokens.integration.test.ts` (new stale-price top-up case) and 25/25 `market.test.ts`; root
typecheck. Isolated `narra_radar_test_20261016` and Memurai 16389 were used, then stopped. Report:
`C:/Users/gifar/AppData/Local/Temp/opencode/final-root-results.json`. Machine-readable evidence:
`reports/collection-pacing-2026-10-21.json`.