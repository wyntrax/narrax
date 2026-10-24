# Candidate coverage audit — 2026-10-24

## Live observations

Read-only application database audit at **07:30:34 UTC**, with the existing scoped collectors running:

| Observation | Count |
| --- | ---: |
| Non-blacklisted active-narrative-linked or recent-social tokens | 447 |
| Source-backed prices within 15 minutes | 87 |
| Stale prices | 336 |
| Missing prices | 22 |
| Unverified latest prices | 2 |
| Fresh price and holder row within one hour | 85 |
| Recent social handoff | 53 |

The independent social-cohort timestamp query found 52/53 prices within 15 minutes, with one missing holder row among those 52 and none with stale holders. This is a scheduling diagnostic, not a finding that 52 tokens qualified for publication. Only five social tokens had recorded liquidity at least $20K; the separate early-radar profiles use their own existing rules.

Latest completed market diagnostics (run began **07:25:19 UTC**) reported **150 tokens / 18 info calls**, **84 usable snapshots**, **66 without data**, 15 holder rows and zero provider errors. Through that run, 4,638 of 8,700 selected-token attempts produced prices (53.3%). Older `tokensWithoutData` counters combine absent data, failed requests and unrequested batches: they cannot establish the cause of a miss.

Narrative diagnostics through **07:30:22 UTC** recorded **636 MARKET_STALE** skips; social diagnostics through **07:30:25 UTC** recorded 82 MARKET_STALE, 287 HOLDERS_STALE and 117 HOLDERS_MISSING. These are repeated attempts over a partial UTC day, not independent tokens or withheld qualified signals. The broad narrative-link population includes historical associations; it must not be equated with the resolver's current matched candidates.

Coverage varies within each cycle. At **07:35:22 UTC**, the new report found 41/53 social prices fresh rather than 52/53; many prices were about to be topped up by the next social scan. A single snapshot does not measure time-weighted coverage.

## Collection continuity

A bounded read of retained BullMQ history found one market consumer and one narrative consumer. Twenty completed market runs had starts from **05:11:11 to 07:30:28 UTC**, with a largest start-to-start gap of **24.6 minutes**. A retained market failure at **06:29:29 UTC** was classified as a timeout. Recent completed runs mostly took about 5.1 minutes against the five-minute schedule. Completed-run gaps can include failed attempts or long runs; they do not prove the process was offline throughout the interval.

The recent failure text matched a **transaction timeout/expiry** category rather than a quote-request timeout; provider availability alone does not explain this failure. No credential-bearing error text was copied into the audit. The underlying database/host cause still needs investigation.

This does **not** establish uninterrupted 24-hour collection. Only 20 completed market jobs were retained, so older continuity cannot be reconstructed from that sample. No queues or history were purged.

## Implemented diagnostics

- `npm run research:coverage` (or `--json`) requires the database URL in the process environment. It performs database reads only and does not load real env files automatically.
- Two disjoint groups in the bounded scanned sample: unexpired recent-social handoff and active narrative links outside that handoff. The overall scan limit remains 2,000 and is explicitly reported when capped.
- New market runs record counts for outcomes, discovery, social, launches, unpriced narrative tokens and general rotation. Each selection belongs to exactly one group. Within a completed run, selected = written + unavailable + failed + not requested.
- `unavailable` means a completed quote request returned no usable snapshot. `failed` counts tokens in a thrown batch, including the throttled batch. `notRequested` counts remaining selections after an early stop. SOL reference-price requests are excluded.
- Cursor advancement retains its existing behavior, including retrying throttled batches. No new provider requests, selection changes, budget increases or qualification changes.
- Only allowlisted aggregate numeric counters are persisted, with the existing eight-day diagnostic retention. Daily instrumentation count makes partial rollout visible; old runs are not backfilled.
- The coverage check now explicitly rejects non-finite prices as unverified. Fresh holder/risk row timestamps alone do not establish complete evidence or safety.

## First instrumented live cycle

Normal scheduled cycle **07:40:57–07:45:59 UTC** completed with one consumer, **150 tokens / 18 info calls**, 80 prices written and zero errors. Every selected token was requested; none fell into failed or not-requested batches.

| Selection group | Selected | Written | No usable snapshot |
| --- | ---: | ---: | ---: |
| Outcomes | 35 | 33 | 2 |
| Discovery | 15 | 1 | 14 |
| Social | 12 | 11 | 1 |
| Launches | 20 | 19 | 1 |
| Unpriced narrative | 25 | 0 | 25 |
| General rotation | 43 | 16 | 27 |

The read-only CLI at **07:46:11 UTC** confirmed these persisted counters and correctly reported only **1/61** UTC-day runs instrumented. Recent social coverage was 51/52 source-backed fresh prices, with 49 fresh price + holder pairs. These changing denominators and snapshots are not a before/after performance experiment.

The measured issue in this cycle is **usable snapshot availability**, especially unpriced narrative and discovery selections, rather than failed or unissued requests. A missing usable snapshot can mean an absent pair or rejected/incomplete provider data; this instrumentation does not distinguish those reasons. Repeated token-level misses and their causes must be measured before proposing retry cooldowns or changing slot allocation. One cycle does not justify a scheduling change.

## Full-pipeline handover and omission probe (09:01–09:08 UTC)

The owner started the API, full pipeline worker, web and public Helius webhook. Observed one consumer per pipeline queue, no execution consumer, API `/health` and web `/en` HTTP 200. Webhook sync reported active with ten desired tracked addresses; wallet-event jobs were completing, and the database contained **403 wallet trades timestamped in the trailing ten minutes** at 09:08:13 UTC. This verifies current ingestion activity, not wallet qualification or the completeness of historical coverage.

The older scoped market/narrative scheduled tasks were still enabled but idle. Disabled both so they cannot relaunch alongside the full pipeline. No full worker, API, web or webhook process was stopped. The full worker's cycle **08:59:38–09:04:13 UTC** completed with one market consumer, 150 tokens, 18 info calls, 80 prices and zero errors. Unpriced narrative returned 0/25, discovery 1/13 and social 12/12. The full worker uses the new-pool launch feed; the former scoped worker also read trending pools, so launch-group counts are not directly comparable across this handover.

Across the first two retained full-pipeline cycles (starts 08:59:38 and 09:04:13 UTC), unpriced narrative selections produced **1/52** snapshots, discovery **4/30**, and social **24/24**. These are attempts across groups, not a count of unique persistently failing tokens. Older job retention is limited; daily aggregate counters may cover more runs than retained job payloads.

A separate **single-request, read-only** public DEX Screener probe at **09:04:00 UTC** sampled 15 newest unpriced narrative-linked tokens and 15 non-overlapping discovery-price candidates. All sampled mint addresses were valid. No observations were written to the database and no production budget or source configuration was changed.

| Sample group | No matching Solana base pair | Missing liquidity | Missing cap and FDV | Usable |
| --- | ---: | ---: | ---: | ---: |
| Unpriced narrative | 7 | 7 | 0 | 1 |
| Discovery | 11 | 1 | 1 | 2 |
| Total | 18 | 8 | 1 | 3 |

These are sampled responses, not all 70 misses from a completed cycle or a token-level repeat history. Absence of a matching pair does not prove a token never trades. Missing liquidity/capitalization must not become zero or qualifying evidence.

Implemented `getSnapshotsWithDiagnostics` as an optional quote-source port. DEX Screener reports a first blocking reason from the exact same batch response, preserves deepest-pool selection, keeps invalid siblings from discarding valid pairs, and never falls back to a thinner pool. Unsupported providers explicitly report `UNSPECIFIED`. Malformed `pairs` envelopes now throw a shape error instead of masquerading as empty data; the documented `{pairs:null}` remains an empty result. Request failures and unrequested batches remain distinct from omitted snapshots.

Normal market runs persist only allowlisted aggregate reason counters by selection group. The CLI reports the number of reason-instrumented UTC-day runs; old runs remain unknown. Raw response bodies and per-token retry state are not persisted, and no cooldown or allocation change was introduced. The running full worker predates this change and needs one restart after checks pass.

## Verification and next measurement

Initial coverage phase: 20 focused database integration tests passed; the full isolated backend suite passed **1,518 tests / 134 files**, zero failures/skips/todo. Root/web typechecks passed. Synthetic quote sources exercised absent snapshots, network errors and throttling against real isolated PostgreSQL; the CLI also ran read-only against the live application database. The isolated test Redis was shut down after verification. Omission-reason follow-up: 48 focused tests and root/web typechecks passed; full-suite verification is in progress.

The scoped market collector was reloaded after draining its active job with new queue claims temporarily paused, then resumed. No history was removed and no extra market run was requested.

Use new per-group results to determine whether stale narrative prices stem from repeated unavailable snapshots or too few refresh opportunities. Investigate collector timeout/duration separately before claiming continuous coverage. Do not change selection based on the broad linked-token denominator alone.

This audit demonstrates a coverage/continuity problem, not predictive edge. New scheduling priorities and provider fallbacks require a measured follow-up; no performance improvement is claimed from diagnostic changes alone.
