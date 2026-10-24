# Treg social narrative ingestion

## Local runtime and fixture cleanup (2026-10-15)

The `.ps1` files configure a terminal; they do not start any service. The API and web were running without a pipeline worker. A dedicated social consumer is now available:

```powershell
cd C:\dev\narra-entitlements
. .\local-api.ps1
npm run dev:narratives
```

Keep that terminal open. It consumes only `narrative-ingestion`, reuses the same job handler as the full pipeline, and registers the configured interval (currently 30 minutes). `dev:workers` already includes this consumer; use one worker entry point for this local setup. The startup log reports `narrative_worker_ready`; each completed collection logs `narrative_ingestion_complete` and its inserted counts. No Treg token belongs in `local-web.ps1`.

API and web each need their own terminal, with their configuration loaded before startup:

```powershell
# API terminal
. .\local-api.ps1
$env:NODE_OPTIONS='--require=C:/dev/narra-entitlements/apps/web/scripts/no-env-files.cjs'
npm run dev:api

# Web terminal
. .\local-web.ps1
npm run dev:web
```

All three services were started and checked after the harness restart. API health, homepage, Indonesian homepage and `/app/radar` return 200. Redis reports one narrative worker, a 1,800,000 ms schedule and a completed job with 39 inserted mentions and zero provider errors. All three upstream calls returned 200; that collection cost $0.00158. At verification the live narrative had **105 mentions and 94 creators**. Counts will change as the worker continues collecting.

The public homepage previously imported illustrative `sample.json` rankings and charts. It now links to authenticated research with EN/ID coverage notes instead of displaying fabricated scores. Real research remains behind existing authentication and entitlement checks.

The shared local application database also contained integration-test fixtures. With the owner's explicit approval, a narrowly matched cleanup removed **61 fixture narratives, 632 fixture tokens, 108 linked opportunities, 143 fixture alerts, 4,006 associated notifications and 300 fixture creators**. Matching was checked against the test code; Treg-sourced narratives were excluded. A serializable transaction checked that users, linked wallets, orders, positions and the live narrative were preserved. Backup: `C:\Users\gifar\AppData\Local\Temp\opencode\narra-test-research-backup-1792017141502.json`; audit action: `LOCAL_TEST_RESEARCH_CLEANUP`.

Only `solana-ecosystem` remains in Radar. **312 legacy token records remain**, including those linked to trade or analysis history, which was preserved; they must not be described as verified live market data. Broader historical-fixture isolation is still pending. Do not run integration tests against this application database again: use a separately configured test database and Redis instance. No database-writing test was run after this cleanup.

Verification for this update: repository/web typechecks, 446 web unit tests, 25 Treg/CLI unit tests and web lint passed. Real-browser checks verified the new EN desktop and ID mobile homepage section (zero axe violations, no document overflow, no fabricated chart) and the signed-out Privy gate. Authenticated rendering in the owner's browser remains for the owner to confirm after refreshing Radar.

## What is connected

2026-10-16 controlled early-radar preview: one owner-approved query `solana ("CA:" OR "contract address")`, 48 hours, one page per existing platform, unchanged $0.01 ceiling. Accepted 20 X and two TikTok observations; Reddit's 25 rows were outside the window. Extracted nine mints/nine cashtags; DEX Screener returned usable quotes for seven mints, three with reported cap under $100K. Cost $0.00155; no import. Per-reference counts and receipts: `EARLY_RADAR_VERIFICATION_2026-10-16.md`. Preview now outputs hashes/references instead of raw text; optional `--check-mints` checks up to 30 extracted mints without another social fetch.

Narrax can now collect keyword-matched X posts, Reddit posts and TikTok captions through Treg, normalize them into `RawMention`, and use the existing `ingestNarratives` pipeline. It writes `Narrative`, `NarrativeSource`, hashed `NarrativeMention`, creator relationships and metric snapshots consumed by the existing research screens.

This is **watchlist sampling**, not platform-wide trend discovery. You supply topic names and search queries. Search results may be incomplete, ranked, or off-topic; the current lifecycle/scoring thresholds remain uncalibrated for these samples. Creator account age is unknown (`null`). No creator age, post date or missing engagement count is fabricated. TikTok views are not counted as engagement. Raw text is used in memory and hashed before persistence.

No database migration was added. The narrative workspace now declares the repository's existing Zod dependency for response validation. The installed developer CLI is `tools-registry` **0.25.0**, installed using `uv tool install --python ">=3.12,<3.14" "tools-registry[proxy]"` on Windows. The production worker uses ordinary HTTPS, not the CLI or an agent MCP server.

## Endpoints and cost

Catalog reviewed on 2026-10-14:

| Platform | Treg catalog endpoint | Catalog estimate per successful call |
|---|---|---|
| X | `anyapi.x.search.posts` | $0.00075 |
| Reddit | `anyapi.reddit.search` | $0.0012 |
| TikTok | `anyapi.tiktok.search.videos` | $0.0012 |

These specific endpoints expose the documented normalized `output.data.items/posts/videos` contract. Routed Treg tools return provider-native rows that change with the serving provider; this adapter deliberately pins supported response contracts. Prices and provider availability can change. Read `treg catalog get <endpoint>` before a larger run.

Every HTTP call sends `X-Treg-Route-Max-Cost` (default **$0.01 per call**), a stable idempotency key for a job/request, `Cache-Control: no-cache` and the backend-owned `feature=narrative-ingestion` tag. Redirects are refused. Requests and body sizes are bounded. No automatic provider switch or immediate paid retry occurs on failures, 402, 429 or pending responses.

`X-Treg-Call-Id` and `X-Treg-Cost-Micro` are recorded, including errors when available. Worker receipts are emitted to structured logs and stored in `AuditLog` with action `NARRATIVE_SOURCE_CALL`. Missing cost metadata stays `null`; provider-body `costUsd` is never substituted for Treg's charge. Receipts are operational records; Treg's ledger is the billing authority.

## First live test: preview only

In PowerShell at `C:\dev\narra-entitlements`:

```powershell
$env:PYTHONIOENCODING='utf-8'
treg login
treg balance
npm run narratives:treg -- --cli --query "Solana" --hours 48
```

Complete the browser login and select the intended Treg team. `--cli` uses that login without copying its token into the repository. Alternatively, provide `TREG_TOKEN` (and `TREG_ORG` for an identity token that needs a team slug) in the process environment and omit `--cli`.

The preview fetches at most **one page per platform**, prints page/validation counts, up to three hash/reference samples per source, call receipts and a cost summary. It makes **no database writes** and needs no database/Redis configuration. It is a live, potentially metered API call, not an offline dry run. `--platforms reddit` selects one source. `--pages 2` permits two pages, up to a maximum of three. Unknown envelope shapes and entirely malformed records cause a source error instead of being treated as empty activity.

Browser login saved the `narrax` team. Its key initially returned `401 disabled key`; the owner enabled it and supplied `TREG_TOKEN` in `local-api.ps1`. Both direct HTTPS and CLI requests now work with those process variables. A JSON quoting error in `TREG_NARRATIVE_TOPICS` was corrected to use single quotes around the JSON; no credential value was changed or printed. The CLI also hit a Windows checkmark-printing error after saving login; the UTF-8 setting above avoids it, and the preview wrapper sets it automatically.

### Live results (2026-10-14)

Query `solana`, topic `Solana ecosystem`, 48-hour window, one page per source:

| Run | X accepted | Reddit accepted | TikTok accepted | Treg charge |
|---|---:|---:|---:|---:|
| Direct HTTPS preview | 20 | 4 | 16 | $0.00158 |
| Direct HTTPS import | 18 | 4 | 16 | $0.00158 |
| CLI preview (Reddit only) | — | 4 | — | $0.00038 |

Total verified charges: **$0.00354** across seven calls. All returned HTTP 200 with call IDs and charge metadata. Reddit returned 25 rows per page, of which 21 were outside the selected window. The import's X response had two posts newer than the run's fixed observation time; these were excluded. No malformed rows were observed.

The import wrote **38 hashed mentions, 35 creator relationships, three source records and one metric snapshot** under `solana-ecosystem`. Three charge receipts were verified in `AuditLog` for import run `22ded512-7f95-4f2c-afe9-c4ff728ec06d`. The existing scoring rules produced stage `ACCELERATING` and score `65.9`; these are uncalibrated outputs from the first small watchlist sample, not independently established trend strength. Browser rendering and a running repeating worker were not exercised during this live check.

## Import into the workspace

Once the preview looks appropriate:

```powershell
. .\local-api.ps1
npm run narratives:treg -- --cli --query "Solana" --name "Solana ecosystem" --hours 48 --write
```

`--write` first checks the configured database connection, fetches once, and passes those same observations to ingestion without a second paid fetch. It persists receipts, returns inserted-mention counts and preserves successful sources if another source failed. The command exits nonzero if any source failed; inspect the per-source output before repeating it. A new invocation is a new fetch and may incur a new charge.

Open `/app/radar`, then the narrative detail, or refresh a focused view. Existing API entitlement gates still apply. An empty or stale-only search does not create a new narrative. Successful empty searches for an existing narrative still let the existing lifecycle logic age it. Re-ingestion deduplicates by narrative/platform/post ID; accumulated engagement on already-stored posts is not updated by the existing ingestion pipeline.

## Scheduled ingestion

The worker requires a server-side Treg token in its own process environment. CLI login by itself does not enable the worker. Example configuration (use an org-scoped token from your own Treg dashboard; keep it out of source control):

```powershell
. .\local-api.ps1
# Supply TREG_TOKEN securely in this terminal before starting the worker.
$env:TREG_NARRATIVE_ENABLED='true'
$env:TREG_NARRATIVE_TOPICS='[{"name":"Solana ecosystem","query":"solana"}]'
$env:TREG_NARRATIVE_PLATFORMS='x,reddit,tiktok'
$env:TREG_NARRATIVE_MAX_PAGES='1'
$env:TREG_NARRATIVE_PAGE_SIZE='20'
$env:TREG_MAX_COST_USD='0.01'
$env:TREG_NARRATIVE_INTERVAL_MS='1800000'
$env:NODE_OPTIONS='--require=C:/dev/narra-entitlements/apps/web/scripts/no-env-files.cjs'
npm run dev:workers
```

The Treg adapter is off unless explicitly enabled. Enabled configuration is validated before connections open. At most 10 topics, three pages per source, and three configured platforms are accepted. Default interval is **30 minutes** (minimum five minutes). `PAGE_SIZE` is sent to X only; Reddit and TikTok use their native page size. All posts are filtered to the ingestion window locally; X also receives a `since:` query filter. No account trading behavior is enabled by these settings.

For one topic and all three sources, the default is up to three calls per cycle: the catalog estimate is about $0.00315, and the configured per-call ceiling bounds it to $0.03. The ceiling is **per call**, not a daily account budget. A 30-minute schedule runs 48 cycles/day. Multiple worker processes/jobs can add calls; configure Treg team limits if you want a daily team cap.

## Verification

- 21 provider/transport unit tests passed: all three response shapes, malformed/empty/partial rows, dates, unknown fields, deduplication, paging, stable retry keys, HTTP metadata/cost handling, pending reservations versus settled charges, timeout, payload limits and explicit enablement.
- Four CLI wrapper tests passed, including UTF-8 output, replay metadata, failure-body isolation and malformed/pending output.
- 17 existing narrative tests passed.
- 7 real-Postgres ingestion tests passed with no skips, including Treg-shaped fixtures merging across platforms, hash-only storage, source provenance, repeated-import deduplication, and empty/stale/future-only searches creating no phantom records. Test-owned records were cleaned up.
- Whole-repository and web typechecks passed.
- Automated provider tests use mocked Treg responses; the seven paid live calls and real database import above were verified separately.
- The whole backend suite was attempted but **does not have a clean full-run result**: the latest run reported 1,099 passed, five failed and ten skipped. It overlapped the final receipt-handling edit; a fresh process passed all 25 Treg/CLI tests. Token-resolution tests timed out and subsequent assertions failed; the two skipped groups use an 800 ms database-availability probe. A focused rerun of token resolution, Prisma stores, account routes and narrative ingestion passed **26 tests with zero skips** using `--testTimeout=20000`. No production token-resolution logic or existing assertions were changed. Full-suite stability under local database load remains unverified.
- The October 15 update above verifies scheduled ingestion and public-page browser behavior. Authenticated owner-browser rendering and score calibration remain unverified.

No real `.env` was read or changed. The preview command uses the existing env-free preload. Public setup documentation: https://treg.to/llms.txt and https://treg.to/integrate.md.
