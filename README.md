# NARRA (placeholder name)

## Web Phase 1

`apps/web` is the Next.js 15 / React 19 frontend workspace. Run `npm run dev:web` on port 4010 with the API on 4000. See [web setup](apps/web/README.md) for public configuration, exact CORS and wallet-proof origin requirements, and verification. Phase 2 waits for owner approval.

AI narrative and smart-money intelligence agent for Solana.

## Current market dashboard

### Evidence review follow-up (October 24)

Stored observations now fail independently, cached evidence ages on screen, and RugCheck risk flags are visible.
The real Jupiter parser rejects blank/negative/non-finite impact values, quote requests retain spacing across concurrent
mints and scan boundaries, and unknown safety-policy versions cannot bypass v2 provenance validation. Disabled
collector tasks are registered disabled atomically; Stop/Remove clean up their own native children. The scoped market collector now also matures research-only radar
outcomes with the existing bounded tracker. See [review findings and verification](docs/CONTINUATION.md).

### Same-VPS frontend delivery (October 22)

Frontend CD is now implemented as a separate, disabled-by-default release job: standalone image, exact-image checks before publishing, digest-pinned deployment, build/runtime configuration validation, health checks and previous-image/config rollback. It shares the backend VPS but not its containers or credentials. Configure `WEB_DEPLOY_ENABLED`, the `production-web` environment and host `.env.web` using [Frontend deployment](docs/FRONTEND_DEPLOYMENT.md). Docker/Compose and the first live GitHub/VPS run remain pending.

### Public search visibility (October 22)

Narrax now includes public English/Indonesian research guides and methodology pages, route-specific search/social metadata, structured data and a localized sitemap. Private workspace/access pages remain noindex. Production indexing requires explicit opt-in and the actual HTTPS canonical origin. See the [SEO launch checklist](docs/SEO.md) before publishing; domain verification and search-engine submission are still required.

### Research coverage & discovery reliability (October 21)

Social candidates missing holder evidence now get a bounded handoff to market collection within the existing **150-token / 18-info-call** budgets. Admin → Data Health shows price/holder/risk freshness, coverage gaps, stage liveness and persisted rejection counters. `npm run radar:daily` pairs a trailing-24h outcome scorecard with current collection diagnostics; counts are repeated attempts, not unique missed signals. No scoring gate was relaxed. See [coverage details](docs/EARLY_RADAR.md#research-coverage-and-discovery-reliability) and [verification](docs/CONTINUATION.md).

### CI/CD (October 21)

GitHub Actions now checks types, lint, isolated backend tests/migrations, web tests/build, fixture-browser tests and Docker builds. Releases publish a backend image to GHCR and optionally deploy it over SSH with migration-before-restart and image rollback. Deployment stays **off** until GitHub/VPS setup and approval are configured; frontend deployment is not included. See [CI/CD setup and verification limits](docs/CI_CD.md). No live deploy has run.

### Wallet-flow research (October 21)

Smart Money now separates **observed buyers**, **operator review** and **evidence qualification**. A wallet is admitted to research flows only when it is approved, has at least 20 closed legs across 5 tokens over 7+ days, a complete uncapped 30-day swap history, positive observed PnL and median ROI, a score of at least 70 and activity within 24 hours. Approval never bypasses those checks, and the ten seed wallets remain provisional. Flows require two independent wallets/clusters, 0.5 SOL net each, fresh trades and market/holder/risk evidence, and freeze their entry and exact signatures. Results are gross token-price changes at 1h/4h/24h; a missing horizon is `UNKNOWN`, never repaired from a later price. Discovery now reports why scans cannot be judged and keeps a bounded list of repeat early buyers. No alert, AI decision, order or position is created by this research. Add a review reason in **Admin -> Smart-money research review**; `npm run wallets:scorecard` prints the outcome cohorts. Both research flags default to off. See [status and limits](docs/CONTINUATION.md).

### Fresh collection coverage (October 21)

The collector now retains the verifying quote for newly discovered social mints, reserves bounded refresh space for fresh launches, retries young pools, and rotates general prices and due holder lookups so older IDs or repeated failures cannot monopolize collection. Existing 150-token / 20-info-call budgets and qualification gates remain. Job summaries expose launch/general selection and social snapshot counts. Verified with **1,346 isolated backend tests** and root/web typechecks; see [operational evidence and remaining gaps](docs/CONTINUATION.md).

### Token research brief (October 21)

On `/app/tokens`, paste an exact Solana mint under **Research a Solana token** to open its indexed research independently of screener filters. Token details now summarize source freshness, 1h price movement, volume/liquidity, pool versus token creation, and available/missing evidence. Copy the mint, refresh the research, or jump to narrative context and historical snapshots. Cached market figures expire after the existing 15-minute window. An unknown address gets an explicit unindexed state with explorer/chart links; this lookup does not start ingestion. English and Indonesian supported. Verified with 572 web tests, 1,342 isolated backend tests and four mocked-auth Chromium flows; real owner-session review remains pending.

`/app/portfolio` includes manual **paper-only** buys and partial/full closes with review, explicit simulation acknowledgement, existing risk checks and duplicate-submit protection. Live positions remain read-only. Buys require existing trading permission and fresh stored evidence; no wallet funds are used. See [current state and verification](docs/CONTINUATION.md).

`/app/trade` is a separate **manual mainnet** flow, default off (`MANUAL_TRADING_ENABLED=false`). It assembles stored research, blocks incomplete buy evidence, builds an unsigned Jupiter Swap V2 transaction, and requires a verified linked wallet to sign. The API simulates, verifies the exact route/amounts/accounts and signed message before broadcasting. It does not create paper orders or positions and does not enable the automated executor. See [Manual trading](docs/MANUAL_TRADING.md).

Early-radar outcome tracking now records frozen alert-time prices/valuations and 1h/24h/7d results. `npm run early-radar:report -- --from <ISO> --to <ISO>` reports sample sizes and missingness by profile, score tier and discovery route. Apply the generated outcome migration before running updated workers. A new call is only published when the exact price and holder rows behind its score are at most 15 and 60 minutes old; otherwise it is skipped and counted by reason, never backfilled from later prices. Verified with 1,373 passing backend tests on isolated installed-version services; production performance remains unverified. See [Early Radar](docs/EARLY_RADAR.md).

**Radar scorecard and liveness (October 20):** `npm run radar:scorecard` recomputes 15m/1h/4h/24h returns, peak capture and a fixed exit-rule replay from frozen alert entries and stored 5-minute closes. It prints medians first, subtracts a 3% round-trip cost and marks every bucket under 30 events / 15 tokens INSUFFICIENT. `npm run radar:status` reports the newest call, newest price and candidate supply, and exits 2 when stale; `scripts/radar-status.ps1` is the Task Scheduler wrapper and `scripts/radar-status-scheduled.ps1` adds timestamped logging for recurring checks. Both are read-only. The live cohort shows the edge is short-lived: the 4h peak median is +21.1% while the 4h close median is -6.0% and the 24h median is -48.9%. See [the dated status](docs/CONTINUATION.md).

**Telegram Early Radar feed (October 20):** a read-only delivery layer posts global Early Radar alerts to one Telegram group. `powershell -File scripts\telegram-send.ps1` is a dry run that prints the exact messages; add `-Send` after setting `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the ignored `.env`. The pipeline worker schedules the same delivery every 30 seconds, skips calls older than 15 minutes, deduplicates by alert and backs off on a 429. It never sends user-owned alerts, orders, positions or P&L, needs no schema or migration, and is not a validated buy signal. See [Telegram setup](docs/TELEGRAM.md).

Tokens and Opportunities now use recent, source-linked DEX Screener snapshots with liquidity, volume, price change, pool age and valuation basis. Historical scores and unverified wallet performance are explicitly separated. The dashboard follows the landing's graphite/pill design in EN/ID and dark/light themes. Run the standalone collector with `npm run dev:market` using the supplied process environment; it shares the existing five-minute market scheduler and should be the only market queue consumer. See [verification and remaining data gaps](docs/DASHBOARD_MARKET_REFRESH_2026-10-16.md).

## Wyntrax membership webhooks

Configure each Solana membership on Wyntrax with this API's public HTTPS `/v1/integrations/wyntrax/events` URL and a MEMBER, PRO or ELITE integration key. Copy the creator signing secret into `WYNTRAX_WEBHOOK_SECRET`; `WYNTRAX_WEBHOOK_SECRET_PREVIOUS` supports rotation. Narra requires wallet-link proof and resolves the highest active, unexpired key across independent membership grants.

Schedule `npm run entitlements:expire` every minute for local grant/challenge cleanup, independently of the pipeline. See [docs/ENTITLEMENTS.md](docs/ENTITLEMENTS.md) for the event contract and migration.

**Start with [docs/CONTINUATION.md](docs/CONTINUATION.md):** what exists, what is verified, what is missing, and ready-to-paste prompts for continuing the backend and building the frontend. `design/prototype/narra-prototype.html` is the approved UI prototype (mock data).

> **Working on this repo with Claude Code or another assistant?** Read [`CLAUDE.md`](CLAUDE.md) first (rules, architecture, gotchas, state), then [`docs/CLAUDE_CODE_PROMPT.md`](docs/CLAUDE_CODE_PROMPT.md) for ready-to-paste session prompts, and [`docs/CONTINUATION.md`](docs/CONTINUATION.md) for the full status and backlog.

## What is here
- `packages/shared`: brand config, enums, Zod schemas for model output, untrusted-data helpers
- `packages/risk`: the deterministic Risk Governor, system limits and risk profiles, with tests
- `packages/database`: Prisma schema (45 models), initial migration, and a Prisma client that uses the pg driver adapter (no Rust query engine)
- `apps/api`: Fastify API with `/health`, the Helius webhook, a dev Risk Governor endpoint, Privy token verification, account routes (mode, AI access, pause/resume/revoke, risk profile), all audited, and read routes for the UI (narratives, opportunities, tokens, smart-money wallets, positions, trades)
- `packages/queue`: BullMQ queues, job schemas, dedupe by transaction signature, execution jobs never retried
- `packages/solana`: Helius swap parser, webhook auth check, Jupiter quote client with freshness check, JSON-RPC client (balances, token holdings)
- `packages/ai`: model provider interface (OpenAI-compatible client), prompts that separate trusted facts from untrusted text, Zod-validated agent outputs, the fast-screen to deep-analysis pipeline, guardrails
- `packages/token-intel`: narrative-to-token matching, OG scoring and copycat detection, attention-price divergence, opportunity score (pure and tested)
- `packages/narrative`: provider interface, topic and text normalization, velocity, organic score, lifecycle engine (pure and tested)
- `packages/smart-money`: pure, tested wallet intelligence: cost-basis stats, wallet score, leader score, style rules, timing clusters, consensus
- `workers/pipeline`: wallet-event processor, deterministic AI filter, execution pipeline (no executor wired), and Postgres-backed stores that build the Risk Governor's inputs from real rows
- `packages/realtime`: the realtime event contract (Zod, one definition per event type), the Redis Streams helpers (publish, dedupe, range read, resume check), the WebSocket protocol, and the in-memory connection hub (pure, tested)
- `packages/tx-verify`: B5a. Pure checks on an unsigned swap transaction and on a simulation's effects. No signing
- `workers/executor`: B5a. The execution-queue consumer. Dry run only: it cannot sign or send
- `docker-compose.yml`: Postgres and Redis for local development

## Run
    npm install
    docker compose up -d
    cp .env.example .env
    npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
    npx prisma generate --schema packages/database/prisma/schema.prisma
    npm test
    npm run typecheck
    npm run dev:api
    npm run dev:workers

## Rules the code enforces
- Model output is untrusted and must pass `AgentDecisionSchema`, then the Risk Governor.
- The model can tighten slippage and price impact, never loosen them.
- User limits can only be stricter than system limits.
- Exits are allowed when entry limits are breached, but still check execution quality.
- Nothing in this repo signs or sends transactions yet. That comes in a later phase behind the queue.

## Before real use
- Confirm the Helius payload shape and the Jupiter base URL and price-impact format against live responses.
- Set `HELIUS_RPC_URL` to enable real balances, portfolio value (balance plus a live sell quote per open position) and token holdings. Without it the worker's chain ports throw and execution jobs fail closed. Nothing defaults a missing input to zero.
- `realizedPnlToday` comes from `Trade.realizedPnlSol`. B4 fills it for paper trades (a buy books its fee as a loss, a sell books proceeds minus cost minus fee). The future Executor must fill it too, or the daily-loss check sees zero for real trades.
- Migrations 0001 to 0003 were generated by Prisma. **0004 to 0009 are hand-written** (two folders each for 0007 and 0009; see above; never rename) (two folders are numbered 0007, `0007_api_completion` and `0007_outcomes_backtests`; do not rename either, Prisma applies both). All migrations apply cleanly with `psql` on a Postgres 16, and the tests pass on that database, but `prisma migrate diff` has not been run on them. To check for drift, with a scratch (shadow) database:
  `npx prisma migrate diff --from-migrations packages/database/prisma/migrations --to-schema-datamodel packages/database/prisma/schema.prisma --shadow-database-url postgresql://narra:narra@localhost:5432/shadow --script`
  It should print an empty migration. Anything else is drift: paste it back. Then run `prisma migrate deploy` to confirm it applies.
- Queue tests need Redis and the store integration tests need the migrated Postgres (set `DATABASE_URL`). Both skip if unreachable. **A skipped integration test is not a pass.** The test run prints the skipped count: if it is above 4 (the queue tests, when Redis is down), something is not connected.

- Privy tokens are verified locally with jose (ES256, issuer `privy.io`, audience = your app id). Confirm the claims and set `PRIVY_APP_ID` and `PRIVY_VERIFICATION_KEY` from your Privy dashboard.
- `PUT /v1/ai-access` only flips our flag. Real delegated signing through Privy, and the wallet-creation and exit-all flows, are a later phase.

## Read API
All require a Privy bearer token. Market data is shared; positions and trades are scoped to the user, and a user only sees their own AI decisions.

    GET /v1/narratives?stage=&limit=          GET /v1/narratives/:slug
    GET /v1/opportunities?limit=               GET /v1/tokens?q=&limit=      GET /v1/tokens/:mint
    GET /v1/smart-money/wallets?limit=         GET /v1/positions             GET /v1/trades?limit=&cursor=

Limits are capped at 100. Nothing writes to these tables yet except the wallet-event worker, so most lists are empty until ingestion and scoring exist.

## Wallet intelligence
### Smart Money freshness and recovery (October 19)
- **30D is a rolling lookback, not a 30-day wait.** Scores refresh every 15 minutes once at least five matched buy/sell closes exist. Wallet count means active tracked addresses; discovery suggestions require admin acceptance before joining that directory.
- Keep the public Helius webhook endpoint running. For local development, start `ngrok http 4000`, set `HELIUS_WEBHOOK_URL` in `local-api.ps1` to the current HTTPS endpoint plus `/webhooks/helius`, and restart the pipeline with that configuration. A tunnel restart can change its URL. An active Helius webhook or successful sync alone does not prove delivery; inspect the last non-empty receipt in Admin Data Health (stale after one hour).
- To recover missed supported swaps, use `npm run wallets:backfill` to preview, then `npm run wallets:backfill -- --apply` with the application environment. This bounded, idempotent recovery stores trades and recomputes scores without enqueueing screening/execution. Short filtered history pages are followed until empty, outside the window, or capped; `capped: true` means incomplete coverage. Depth defaults to 3 pages per wallet; pass `--pages=N` (1–10) for a deeper bounded scan, e.g. `npm run wallets:backfill -- --pages=10 --apply`. A malformed `--pages` value fails rather than silently under-fetching.
- Helius list entries missing addresses are hydrated from webhook detail before diffing. Completed early-buyer scans receive rotating price coverage (at most 25 slots within the existing 150-token refresh budget), so discovery can obtain both first and later prices. Qualification thresholds remain unchanged.

`recomputeWalletIntelligence` runs every 15 minutes (BullMQ scheduler) and rebuilds profiles, 30D metrics, timing clusters and per-token consensus from `WalletTrade` in one transaction. All rules are fixed code, no model is involved.
- Win rate, PnL and ROI use average-cost accounting per token. Sells of tokens first bought before tracking began are skipped.
- A wallet needs at least 5 closed trades to be scored. The win rate uses a confidence lower bound, and a short record is discounted but never rewarded.
- Leader score only looks at tracked wallets: a wallet leads when others enter the same token within 30 minutes after it.
- Clusters come from repeated near-simultaneous entries and are capped at MEDIUM confidence. HIGH needs funding evidence, which is not ingested yet. Clusters are inferred links, not identities.
- Not implemented: MEME_EARLY style (needs token categories), typical entry market cap (needs market-cap data on trades), funding graph.
- The weights and thresholds are starting values. Backtest them before trusting scores for real trades.

## Admin-configured research access (October 19)
`/app/admin` configures the minimum Early Access, Member or Pro tier for each research feature, including Agent. Pro is the highest offered level; legacy Elite memberships resolve to Pro without rewriting records. Saves require a reason and use the audited settings endpoint. **Permissions are always enforced**; legacy rollout-off settings cannot bypass them. Ineligible research links remain visible with locks, and direct URLs show a lock without loading restricted page content. Server HTTP, Agent-tool and realtime checks remain authoritative. Portfolio, Alerts and Settings remain own-account pages. Holding requirements remain based on verified Wyntrax membership. No trading permission or risk limit is changed. See [continuation and verification](docs/CONTINUATION.md).

## Narrative ingestion
`ingestNarratives` asks each `NarrativeProvider` for topics and recent posts, stores a hash and similarity hash per post (never the text), upserts creators, then recomputes each narrative from its stored posts in one transaction: mention, creator and engagement velocity, acceleration, organic score and manipulation risk, saturation risk, score and lifecycle stage. Stage changes raise alerts.
- **Treg social ingestion:** opt-in X, Reddit and TikTok watchlist searches, bounded pages/costs, source receipts, and a preview/import command. Load `local-api.ps1`, then run `npm run dev:narratives` to start the dedicated consumer (30-minute default). Live calls and scheduled ingestion have been verified; `Solana Ecosystem` had 105 real mentions at the latest check. See [docs/SOCIAL_TREG.md](docs/SOCIAL_TREG.md) for setup, fixture cleanup and verification limits. Sampled search results are not global trend coverage. Run database-writing tests against a separate test database, never the application database.
- **Research response fix (October 15):** opportunities without a linked narrative now render correctly in Overview and Opportunities. The topbar distinguishes request failures, restricted access and missing/stale readings; malformed responses no longer produce a connection-error explanation. See [the frontend handoff](apps/web/docs/PHASE2_HANDOFF.md) for verification and remaining data-availability limits.
- **Marketing refresh:** Luora-inspired landing and early-access styling, inspected with REA and adapted to Narrax. See [reference evidence and verification](apps/web/docs/LUORA_REFRESH.md).
- **Owner ZIP integration:** Smart Money, Alerts, Analytics, Agent, Settings, admin tier/window controls and Wyntrax attribution are merged while preserving the refreshed landing. See [merge record and verification](docs/ZIP_INTEGRATION_2026-10-15.md).
- Stages are rule-based: a growing narrative moves up one stage per run, decay applies immediately, and death needs two quiet hours in a row. The thresholds (for example 150 posts/hour for mainstream) are starting values to tune against real data.
- Organic score uses new-account share, near-duplicate posts, one-minute bursts, unique-creator ratio and cross-platform spread. With fewer than 10 recent posts it reports 50 and says so, instead of guessing.
- Not implemented: search velocity, creator network analysis, historical creator hit rate, smart-money correlation.

## Token resolution
`resolveTokens` runs every 10 minutes. For each live narrative it finds token candidates by symbol and name, scores how likely each is the original, stores the relation, and ranks the ones that pass liquidity (20K USD) and holder (50) floors.
- **OG score** (0 to 100) uses launch time against first detection, first-mover rank, gap to the earliest launch, holder spread and deployer history. Factors without data are skipped, and coverage and confidence are reported. A lone candidate, thin data or a close race all lower confidence. "Likely OG" needs high confidence and near-full coverage.
- **Copycats:** homoglyph swaps (R0BOT) and doubled letters (ROBOTT) of an earlier token are flagged SUSPICIOUS and never ranked. A trailing number (ROBO2) reads as a derivative. Serial deployers who launch after the narrative appears are flagged too.
- **Attention vs price** compares narrative mention growth with 3-hour price growth and labels the gap. It describes the gap and never predicts price.
- **No token yet:** a narrative that is emerging or accelerating with no matching token gets one alert, and candidates are picked up as they launch. A candidate is only ranked once it has liquidity and holders. This job cannot touch orders, positions or execution, so a ticker match can never cause a buy.
- Not available yet: website, social-identity and creator links (no data ingested), token descriptions (not in the schema), rug history of a deployer. Acronym symbols are only found when the token name also contains a narrative word.
- Weights, floors and the OG thresholds are starting values to tune against real launches.

## Market data (B1)
`packages/market-data` reads three free public APIs behind small interfaces (`MarketQuoteSource`, `TokenInfoSource`, `LaunchSource`), so any one can be swapped without touching the worker.

| Need | Source | Limit used |
|---|---|---|
| Price, liquidity, 24h volume, market cap, pool age | DEX Screener (`/tokens/v1/solana/...`, 30 mints per call) | 300 requests a minute documented, spaced at 250 ms |
| Launch detection, holder count, top-10 share, mint and freeze authority, honeypot flag | GeckoTerminal (`new_pools`, token `info`) | 30 calls a minute documented, but bursts of ~6 return 429; spaced at 15 s (4/min) |

`refreshMarketData` (in `workers/pipeline`, queue `market-data`, every 5 minutes) does five things: stores SOL/USD in the `market.solUsd` setting (`readSolUsd` refuses a missing or stale value); turns new pools with at least 5,000 USD liquidity into token rows; refreshes prices for placeholder, new, recently priced, narrative-linked and held tokens; fills placeholder names and an approximate age; and, for up to 18 tokens a run at the 15 s Gecko pace, writes holder rows and risk rows (reused for 30 minutes). The social scan separately tops up a bounded number of stale candidate prices from DEX Screener before applying the evidence gate.

Rules it follows: a missing price, liquidity, volume or holder figure skips the row and is never zero-filled; names and symbols are sanitized before storage; a token with no holder row is never ranked; a token whose latest risk row is `HONEYPOT` is never ranked (guard added in `resolveTokens`). Turn the job off with `MARKET_DATA_ENABLED=false`.

Limits, stated plainly:
- Response shapes are exercised against the live providers. GeckoTerminal's holder fields are marked beta, and its top-10 share is of total supply, so it can include pool and exchange accounts and overstate concentration.
- `createdOnChainAt` is the pool creation time, a proxy for token age. `deployer` and developer holding are not available from these sources and stay empty (stored as unknown, never as zero).
- How GeckoTerminal spells "authority renounced" is undocumented. Only an address-shaped value counts as active; anything else is unknown.
- The refresh set is capped at 150 tokens. Priority groups and a rotating cursor reduce, but do not eliminate, starvation under a very large backlog. Rate limits are per process, so run one market consumer.
- Risk weights and the 5,000 USD launch floor are unvalidated starting values (`RISK_WEIGHTS`, `MARKET_DATA_LIMITS`).
- The free providers' terms were not reviewed. One source states DEX Screener's terms bar building a competing product. Read both before launch.

## Tracked wallets (B2)
The tracked wallet set is global and admin-managed: every user's intelligence reads it and it uses Helius capacity. Wallets are deactivated, never deleted, so trade history stays. A deactivated wallet is dropped from the webhook, refused by the event store, and left out of scores, clusters, consensus and the smart-money list.

**Admin API** (all admin-only, audited): `GET/POST /v1/admin/wallets`, `POST /v1/admin/wallets/import` (up to 500), `PATCH /v1/admin/wallets/:address` (label, active), `GET /v1/admin/wallets/sync-status`, `POST /v1/admin/wallets/sync`, `GET /v1/admin/wallet-candidates`, `POST /v1/admin/wallet-candidates/:address/approve|reject`.

**Jobs**
- `wallet-sync` (every 10 min, and on demand after an edit): makes the Helius webhook (SWAP, enhanced) watch exactly the active wallets. It creates the webhook once, adopts one with the same URL, and otherwise only edits the address list. It never deletes or toggles a webhook, never clears the list, and reports a webhook Helius has disabled. Needs `HELIUS_API_KEY`, `HELIUS_WEBHOOK_URL`, `HELIUS_WEBHOOK_SECRET`.
- `wallet-funding` (every 30 min): finds each wallet's first SOL funder from RPC history and rebuilds `funding` clusters. A funder is only claimed when the start of the wallet's history was reached; transfers under 0.05 SOL are ignored (dust is used to fake funding). A tracked wallet that funded another is a HIGH link; two wallets first funded by the same outside address are MEDIUM, unless that address funded more than 8 tracked wallets or is in the `wallets.funderIgnore` setting (probable exchange or service). Funding clusters count once in consensus and are not overwritten by the timing job. Needs `HELIUS_RPC_URL`.
- `wallet-discovery` (every 15 min): scans young tokens (under 6 hours old, history under about 2,000 transactions) for their first buyers, then suggests wallets that were early in at least 2 tokens that later rose 3x with 20K USD liquidity. Score multiplies volume, hit rate (so a bot that buys everything scores low) and earliness. Suggestions are `PENDING` until an admin approves them. Nothing is tracked automatically. Needs `HELIUS_RPC_URL`.

Limits, stated plainly:
- Nothing here was run against Helius or a real chain. The webhook endpoints follow Helius's public reference. Discovery assumes swaps list the token mint account, and that the fee payer is the buyer; swaps that do not are missed. Check both on real data.
- A wallet funded through an exchange or an intermediary shows that intermediary as its funder. Funding links are inferred relationships, never claims about ownership.
- Discovery only sees tokens scanned while young, so it starts empty and fills slowly. Wallets that were early are not necessarily skilled: it can surface luck, snipers and insiders. Review every suggestion.
- Thresholds (dust size, fan-out limit, 3x winner, hit-rate saturation, score floor of 20, scan caps) are unvalidated starting values.
- RPC use per run is capped (funding: 10 wallets; discovery: 5 tokens). Rate limits are per process.
- The migration `0004_tracked_wallets` was written by hand, not generated. Run `prisma migrate diff` to confirm there is no drift.

## Position monitor (B3)
`packages/positions` holds the pure logic and `workers/pipeline/src/positionMonitor.ts` the job (queue `position-monitor`, every 5 minutes). It looks at every open position and **recommends**; it never closes a position, places an order or touches a wallet. Turning a recommendation into a sale is B4/B5, behind the Risk Governor.

**Entry baseline.** `captureEntryContext` builds the typed `Position.entryContext` (price, liquidity, volume, holders, top-10 share, the live narrative, consensus, and the exit rules). B4 must call it when it opens a position. It throws when there is no fresh price, so a position with no baseline is never opened.

**Rules** (all named constants in `MONITOR_RULES`, all unvalidated starting values):
- Stop loss and trailing stop sell. A take-profit target reduces by 50%.
- Liquidity down 40% from entry reduces, down 70% or below 10K USD sells.
- Narrative: a decaying narrative or a 30-point score drop reduces, a dead narrative sells. A newly saturated narrative or a 60% velocity drop is a warning.
- Tracked wallets: 2 independent entities that sold at least half of what they bought (clusters count once), or any leader, reduces; 3 entities sells.
- A confirmed honeypot flag sells (the exit may still fail).
- Volume collapse, a 25% one-hour fall and a 15-point rise in top-10 share are warnings. Two warnings together reduce.

**Honesty built in.** Price rules only run on a price no older than 15 minutes. Otherwise the position is marked *blind*, a warning is raised, and nothing is invented. Every checked-but-impossible rule (developer activity, missing holder data, no entry baseline) is listed under `unavailable`, so a quiet reading is never mistaken for a clean one. Developer activity is always unavailable because no source provides it.

**AI review (optional).** When the rules say HOLD but a warning is active, the reasoning model gets the position facts and the rules' result (token and narrative text only under `untrusted`). It can only make an exit more cautious, by one step: a confident review can turn HOLD into REDUCE. It can never produce a SELL, and never softens a rules decision. At most one review per position every 30 minutes, 10 per run, counted against the daily token budget; its answer is reused for an hour so the reading does not flip. Outage, invalid output, switch off, or budget spent: the rules run alone.

**Output.** `PositionEvaluation` rows are written when the reading changes, when a review runs, and at least hourly. An alert plus a notification is raised for each *newly appearing* signal (WATCH, IMPORTANT or CRITICAL), so the same condition does not alert every five minutes. `GET /v1/positions` now includes each position's latest `evaluation`.

Limits, stated plainly:
- Nothing creates positions yet (B4), so the monitor has nothing to watch outside tests. Take-profit reduces will repeat on each new signal until B4 tracks partial exits.
- Smart-money exits use only wallets tracked here, and need token amounts on their trades.
- The high-water price comes from our own 5-minute price rows, so a spike between rows is missed.
- Migration `0005_position_evaluations` was written by hand. Check it with `prisma migrate diff`.

## Fan-out, paper trading and semi-auto (B4)

Nothing in B4 sends a transaction. There is still no Executor; the worker cannot sign or send.

```
AgentDecision (BUY, global) --entry-fan-out (every minute)--> one ExecutionJob per eligible user  key: entry:<decisionId>:<userId>
Position monitor evaluation (REDUCE/SELL) --exit-fan-out (every minute)--> one exit job             key: exit:<evaluationId>:<attempt>
execution queue (1 attempt, concurrency 1) -> Risk Governor -> fresh Jupiter quote -> Governor again -> outcome handler
   SHADOW      -> logged only (RiskDecision + audit row)
   PAPER       -> paper Order + Trade + Position (all `simulated`, one transaction)
   SEMI_AUTO   -> PendingConfirmation (5 minute expiry) + alert
   AUTO        -> execution_disabled (no Executor)
POST /v1/confirmations/:id/confirm -> atomic claim -> job `confirm:<id>` -> Governor re-run with a fresh quote -> execution_disabled
portfolio-snapshots job (every 5 minutes) -> PortfolioSnapshot, so drawdown has a peak to measure from
```

**Who gets a job.** Not paused, not revoked. SHADOW needs no AI access. PAPER, SEMI_AUTO and AUTO need AI access on; SEMI_AUTO and AUTO also need an unexpired delegation and a trading wallet. A stale decision (over 10 minutes), a token with no fresh price, no balance, an existing open position in the token, or a key already handled means no job. The Governor sizes the order and enforces every limit; the fan-out is only a pre-filter.

**Paper fills.** Token units come from the fresh quote. The USD fill price is the market price worsened by the quote's price impact (an approximation, since no token decimals are stored). Every paper fill costs `PAPER_FEE_SOL`. The entry fee is booked as realized loss on the buy Trade, so the daily-loss check sees it. Paper balance is `PAPER_START_BALANCE_SOL`, minus paper buys and fees, plus sells less fees, derived from Trade rows (never stored). `captureEntryContext` runs first: if it throws, nothing is written. One open position per token per user is enforced in the fan-out, in the handler and by the unique `Position.openKey`.

**Exits.** A SELL always acts. A REDUCE acts only if it carries a signal code that has not already caused a reduce, and at most `MAX_REDUCES_PER_POSITION` times, so a take-profit does not repeat. A failed exit (rejected, no quote, expired, error) is retried after `EXIT_RETRY_COOLDOWN_MS`, up to `MAX_EXIT_ATTEMPTS`. A queued or waiting exit is never retried. Exits are not blocked by daily-loss or drawdown limits (the Governor's exit branch returns before them), but they are still stopped by a paused agent, bad price impact or slippage, and, for SEMI_AUTO and AUTO, missing AI access. A paper position always exits as paper, whatever mode the user is in now. In SEMI_AUTO an exit needs confirmation like an entry.

**Confirmations.** `GET /v1/confirmations?status=PENDING|ALL`, `POST /v1/confirmations/:id/confirm`, `POST .../reject`. Everything is scoped to the signed-in user, so someone else's id is a 404. Confirm is one conditional UPDATE (`status=PENDING AND expiresAt>now`): of any number of simultaneous confirms exactly one wins, and none can win at or after expiry. The endpoint queues a job; the worker re-runs the Governor with a fresh quote and fresh state. Confirm returns 202 and the result lands on the confirmation (`result`), it is not synchronous. If the queue is down the claim is released.

**Settings that are still constants (all UNVALIDATED):** `PAPER_FEE_SOL` 0.002, `PAPER_START_BALANCE_SOL` 10, `CONFIRMATION_TTL_MS` 5 min, `MAX_DECISION_AGE_MS` 10 min, `MAX_EVALUATION_AGE_MS` 2 h, `MAX_REDUCES_PER_POSITION` 2, `EXIT_RETRY_COOLDOWN_MS` 5 min, `MAX_EXIT_ATTEMPTS` 3. All live in `packages/trading/src/constants.ts`.

**Changes to existing behavior:** `RiskDecision` is now one row per user and order (keyed by idempotency key) instead of one per decision, and its `decisionId` is optional (exits have none). The Governor now requires AI access for paper entries (not paper exits). Positions, orders, trades and snapshots carry a `simulated` flag, and the Governor's daily allocation, loss, drawdown, exposure and open-position numbers count only rows matching the user's current (paper or real) side.

## API completion and realtime (B7)

Everything in CONTINUATION section 3.4 **except `GET /v1/analytics/*`**, which waited for B6 (B6 now writes `DecisionOutcome`, so those endpoints can be built; they are not built yet). No new route can trade, sign or move funds.

```
alerts (written by existing jobs) --notification-dispatch (every 5 s)--> Notification rows, one per user the alert is for
new rows in the main tables      --realtime-publish (every 2 s)------> Redis Stream narra:events (one event per row, deduped)
Redis Stream --each API process reads it--> in-memory hub --> WebSocket clients on GET /v1/stream
```

**Alerts and notifications.** Read state lives on `Notification` (one global alert is shown to many users). `notification-dispatch` claims undispatched alerts with `FOR UPDATE SKIP LOCKED`, writes the notifications and marks the alert dispatched in one transaction, so two workers never double-notify and a crash retries safely (`(userId, alertId)` is unique). An alert that belongs to a user always reaches that user. A global alert reaches each user whose preferences allow it: the default threshold is WATCH (`DEFAULT_MIN_ALERT_PRIORITY`, unvalidated), users can lower it, raise it, or mute a kind. **CRITICAL alerts are never held back**, and personal alerts (position signals, confirmations) ignore preferences.

    GET  /v1/alerts?limit=&cursor=&unread=&minPriority=&kind=&sort=recent|priority
    GET  /v1/alerts/unread-count          POST /v1/alerts/:id/read          POST /v1/alerts/read-all

**Settings** (all audited): `GET /v1/settings`, `PUT /v1/settings/profile | appearance | notifications | interests`. Free text is sanitized, unknown fields are refused, time zones are validated. Trading limits and mode keep their own routes.

**Dashboard and search.** `GET /v1/overview` (bar, top narratives, hottest opportunity, rotation, a brief, and the caller's own counts), `GET /v1/intelligence-bar` (light enough to poll), `GET /v1/narratives/rotation?window=1h|6h|24h|7d`, `GET /v1/search?q=` (tokens, narratives, tracked wallets, creators, and transactions by signature; a pasted address or signature is matched exactly). The market brief is built by fixed rules from the numbers, not by a model. A missing SOL price is `null` and a stale one is `stale: true`. Rotation compares each narrative's score now with its score at the start of the window; a narrative with no reading that old is counted as `unknown`, never as unchanged. Rotation thresholds are named, unvalidated constants (`ROTATION_RULES`).

**Wallet detail.** `GET /v1/wallets/:address` (profile, performance per window, cluster, funding, relationships, recent trades, narrative history) and `GET /v1/wallets/:address/trades`. Only active tracked wallets are shown. Cluster and relationship links carry their confidence because they are inferred.

**Token screener.** `GET /v1/tokens` with filters (market cap, liquidity, volume, holders, top-10 share, developer holding, smart-wallet holders, risk score, age, narrative stage or slug, OG score, honeypot, blacklisted) and a whitelisted `sort` and `order`. Filters use each token's latest readings, and **a token with no reading for a filtered or sorted value is left out, not treated as zero**. Sort names map to fixed SQL; user input only ever reaches bound parameters.

**Pagination.** Cursors on `narratives`, `opportunities`, `tokens`, `smart-money/wallets`, `confirmations`, `alerts` and wallet trades. A cursor must belong to the caller's own result set (another user's row id is a 400) and a malformed one is a 400, never a 500. `opportunities` pages through the newest 500 only.

**Own wallets and export.** `GET /v1/me/wallets`, `GET /v1/me/wallets/balances` (needs `HELIUS_RPC_URL`; a missing or failed read is `status: UNKNOWN` with a null balance, never zero), `GET /v1/trades/export?format=csv|json&from=&to=&simulated=` (own trades only, capped at 10,000 rows, `x-export-truncated` says if it was cut, text cells that start with `= + - @` are defused against spreadsheet formula injection, every export is audited). Admins: `GET /v1/admin/connections` says which providers are configured, yes or no, and never returns a key or URL.

**HTTP hardening.** Strict security headers (CSP `default-src 'none'`, `frame-ancestors 'none'`, no referrer), HSTS only when `HSTS=true`, **CORS is closed unless `CORS_ORIGINS` lists exact origins** (a wildcard is refused at startup), 256 KiB body limit, 30 s request timeout, request ids (`x-request-id` on every response, accepted from callers only if short and plain), and one error shape for anything thrown or not found: `{ error: CODE, requestId }` (`INVALID_INPUT`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `RATE_LIMITED` with `retry-after`, `NOT_FOUND`, `INTERNAL` with no message). Existing handlers that reply `{ error: CODE, ... }` themselves are unchanged; they carry the id in the header. `TRUST_PROXY=true` only behind a proxy you control.

**Realtime.** `GET /v1/stream` (WebSocket). The first message must be `{ "type": "auth", "token": "<Privy token>", "lastEventId"?: "<stream id>", "channels"?: [...] }` within 5 s; the token goes in a message, not the URL, so it never reaches an access log. Public channels: `narratives`, `opportunities`, `decisions`, `smartmoney`, `market`, `alerts`. Every connection also gets its private `me` channel (notifications, position evaluations, confirmations, trades), which cannot be asked for or dropped by the client and is only ever delivered to its owner. Send `subscribe` / `unsubscribe` / `ping`. Send a new `auth` with a fresh token before expiry to keep the connection (same user only). On reconnect send `lastEventId` and missed events are replayed; if too many were missed or the stream was trimmed the server sends `{ "type": "resync" }` and the client should refetch what it shows. **Events are hints that something changed, delivered at least once, so a client may see one twice and must treat the REST API as the source of truth.** Limits (starting values): 5 sockets per user, 5000 total, 8 KiB per client message, 30 client messages per 10 s, slow consumers are closed, the stream keeps about 20,000 events.

**Why a publisher job instead of publishing from each writer.** The writers stay unchanged, a restarted worker catches up from its watermark, and a Redis problem can never fail a job that wrote a row. The cost is up to about 2 seconds of latency. A row dated more than 5 minutes in the future is skipped (and counted) so one bad clock cannot stall the feed.

**Verified for real (in the build sandbox, Postgres 16 and Redis 7.0.15, 42 files, 489 tests, none skipped):** dispatch preferences and idempotency under concurrent workers, the publisher's overlap window and dedupe, every new route including cross-user isolation, the screener's filters and tie-safe paging, CSV defusing, CORS and header behavior, and the WebSocket gateway end to end with a real client (auth timeout, bad and expired tokens, channel and private routing, replay, resync, connection limits, token expiry, oversized and flooded input, origin check, shutdown with code 1001).
**Not verified:** `prisma migrate diff` and `migrate deploy` for 0007 (the Prisma engine could not be downloaded in the sandbox, so 0007 was applied with `psql`); Privy tokens against the WebSocket (the tests use locally signed tokens); the gateway behind Nginx (upgrade headers, idle timeouts); query speed of the screener and search on real data volumes (no trigram indexes; `ILIKE '%x%'` scans); more than one API instance at once.
**Known limits:** a global alert creates one `Notification` per eligible user, and there is no retention job yet, so that table grows with users times alerts. Alerts created before migration 0007 were marked dispatched and have no notifications, so they do not appear in `/v1/alerts`. Notifications for a user who never signed in are still created.

## Outcomes, analytics and backtesting (B6)

Nothing here trades. It measures what happened after decisions and replays the exit rules over stored history, so the unvalidated thresholds can be checked once there is enough data.

- **Outcome tracking** (`outcome-tracking` job, every 15 minutes, `trackOutcomes`): writes one `DecisionOutcome` per global decision. It reads stored prices only. The entry price is the latest reading at or before the decision, no older than 15 minutes. It records the 1h and 24h price return, the best and worst price in the window, the lead time to the high (only when a gain followed), and a label on the 24h return: WIN at +10% or more, LOSS at -10% or less, FLAT between. A decision with no price near it is UNKNOWN with a reason (`NO_ENTRY_PRICE`, `NO_HORIZON_PRICE`, `NOT_YET`), never a zero. It is re-measured until its 24h price exists, then left alone.
- **Backtest** (`npm run backtest -- [--days 30] [--cost 3] [--out reports] [--no-save]`): replays history and prints a markdown report, also saved as a `BacktestRun` row and a file. It compares six groups, each judged the same way (price 24h after the signal, less a flat round-trip cost, with and without the live exit rules): AI BUY decisions, opportunity score, narrative only, smart money only, simple momentum, and a baseline (tracked tokens at arbitrary times). It also shows AI results by confidence and by reason code, and two parameter sweeps (exit levels, monitor thresholds) with a train and test split.
- **The replay runs the real `evaluatePosition`** and the same partial-exit rule as the live fan-out. A signal is acted on at the next stored reading, and a reading is only used if it is at or before the replay time (tested: changing the future never moves an earlier exit).
- **Honesty rules built into the report.** Every group shows its event count, distinct tokens, a 95% interval and a win rate interval. Below 30 independent events across 15 tokens in a group, the numbers print but are marked INSUFFICIENT and no verdict is given. Same-token events within 24h count once. The unknown rate is shown next to every result, with the mean if every unknown were a total loss (tokens that rug often stop being tracked, so missing data is not random). A sweep's best-in-training setting is only judged on held-out later events, because trying 80 settings on one history flatters the best of them.
- **Not replayable** (no point-in-time history stored), so still unvalidated: narrative stage and score rules, smart-money exit rules, holder concentration, honeypot flags, developer activity. Wallet-leader accuracy, OG accuracy and false-narrative rate are not built yet.
- **What the numbers will and will not tell you.** The system has only just started storing history, so expect the first reports to say INSUFFICIENT DATA. Even later, results come from one market regime and tokens that move together, so the intervals are narrower than the truth. A result is a reason to keep watching, not a reason to loosen limits. Do not change `MONITOR_RULES` or any limit because of one report.
- **Constants** (all unvalidated): `OUTCOME_CONFIG` (label cut-offs, tolerances), `DEFAULT_ROUND_TRIP_COST_PCT` 3, `REFERENCE_EXIT` (stop 25, target 100, trailing 25), and `GATES` (30 events, 15 tokens, 24h overlap window). Pure logic is in `packages/analytics`; the database side is `workers/pipeline/src/outcomeTracking.ts` and `backtest.ts`.
- **Data cadence matters.** Market data is written every 5 minutes. A decision further than 15 minutes from a stored reading has no entry price and is UNKNOWN, so check the "Median gap between readings" line in the report.

## Agent chat with tools (B8)

A chat assistant that explains the platform and answers questions about the signed-in user's own data. **It cannot trade.** It has no tool that signs, sends, swaps, withdraws, creates an order or touches a wallet, and nothing in its output reaches a transaction.

```
POST /v1/chat {message, conversationId?} -> auth -> budgets -> runAgent(): up to 5 tool calls, one JSON step per model call
GET  /v1/chat/conversations[/:id]            (own only; text of the exchange, never tool results)
GET  /v1/chat/proposals                      suggestions waiting for the user
POST /v1/chat/proposals/:id/apply | /reject  the user's own request; apply re-checks against current settings
```

**Tools** (`packages/agent/src/tools.ts`): read-only (`list_opportunities`, `get_token`, `get_recent_decisions`, `get_my_positions`, `get_my_trades`, `get_my_settings`, `get_my_alerts`, `get_my_confirmations`, `get_backtest_summary`, `get_system_limits`) and two suggestions, `propose_pause_agent` and `propose_tighten_limit`. A suggestion is a database row; nothing changes until the user calls apply, and apply is one atomic claim plus a re-check that the new value is still stricter than the user's *current* one. The agent can only add caution: it cannot resume the agent, raise a limit, turn on AI access or change the mode.

**How the rules are kept (all in code, none depends on the model behaving):**
- Rule 1: the only tools are the registry above. A test pins the exact list, rejects any tool name that sounds like a trade, and scans the package for imports of Solana, queue, database, Privy, Jupiter and `process.env`. A tool call to anything else is refused and counted.
- Rule 3: the system prompt is a fixed string built from the tool list. Token names, symbols, model-written summaries and alert text reach the model only under the `untrusted` key of a tool result, wrapped and sanitized (control and bidi characters removed, length capped). Tool facts are built field by field, never by spreading an object. Every model message is one JSON object, so nothing in a string can close or imitate it.
- Users stay apart: tool schemas are strict and have no user, wallet or address field; the user id comes from the session. A model that passes one is refused.
- Tool results exist only for the turn. History holds the user's text and the assistant's final text, both sanitized; stored messages never contain tool results.
- Output is sanitized before it is returned or stored: HTML, markdown images and links, bare URLs and script schemes are removed (a reply that mentions a link shows "[link removed]"). Replies are returned with `format: "text"`; **the client must render them as plain text.**
- Limits: 5 tool calls per question, 2 bad outputs then a fixed message, 6000 characters per tool result, one question at a time per user per process, 20 questions a minute per client address, 200 questions a day per user, 5 suggestions waiting per user, and two daily token budgets (`chatTokenBudget` 500,000 across all users and `chatTokensPerUserPerDay` 50,000, both admin AI settings). Chat tokens are counted separately from the analysis pipeline's budget, so chat cannot starve it.

**Prompt-injection tests.** `packages/agent/src/injection.corpus.ts` has 31 payloads in 13 categories (role override, smuggled tool calls, forbidden tools, user spoofing, loosening limits, coerced pausing, markup exfiltration, delimiter spoofing, unicode tricks, oversize text, argument injection, secrets, loop bombs). The tests plant each one in a token name, a decision summary, an alert and the user's own message, and run it against a scripted model that OBEYS it. They then check that no forbidden tool ran, no other user's data was read, no loosening or non-existent field became a suggestion, nothing was changed, the system prompt did not change, and the reply is plain text. **That proves the structure holds. It does not show that a real model resists persuasion.** `npm run chat:injection-eval` runs the same corpus against the real model and counts attempts (it costs tokens). Treat that number as information.

**Known limits:** the model can still say false things in text (for example claim it did something it cannot do); no capability stands behind such a claim. A reply could repeat attacker text it was shown; it is sanitized and rendered as text, but a user may still read it. The one-question-at-a-time lock is per process. Chat usage is not yet in a cost report (B9). Replies are not streamed (realtime is in B7). Token names the agent is shown are the same untrusted strings the analysis pipeline sees.


## Analytics endpoints (read-only)

Views of what B6 measures. They write nothing and change no limit or threshold. Token symbols are untrusted text: clients must render them as plain text.

| Endpoint | Who | What |
|---|---|---|
| `GET /v1/analytics/decisions/summary?days=30&action=BUY&costPct=3` | signed in | How global decisions turned out: counts (read, independent, pending, final, unknown and the unknown rate), WIN/LOSS/FLAT, net 24h return with a 95% interval and win rate interval, median lead time, results by confidence bucket, and an `evidence` block |
| `GET /v1/analytics/signals?days=30` | signed in | Net 24h return by reason code for BUY decisions (one decision counts under every code it carries) |
| `GET /v1/analytics/decisions/outcomes?limit&cursor&final` | signed in | The raw outcome rows, newest first, cursor-paged |
| `GET /v1/analytics/me/performance?days=30` | signed in, own data | Realized profit and loss, fees, a daily series and closed-position win rate, with **paper and real kept apart** |
| `GET /v1/analytics/me/equity?days=30&simulated=true` | signed in, own data | The user's portfolio snapshots (downsampled to 500 points), peak, latest and drawdown |
| `GET /v1/analytics/backtest-summary` | signed in | The headline of the newest saved backtest: findings and what it could not conclude |
| `GET /v1/analytics/backtests`, `GET /v1/analytics/backtests/:id` | **admin** | Saved runs and the full report (the per-event working arrays are left out) |

Every aggregate shows how many independent events and distinct tokens it rests on. Under 30 events across 15 tokens the numbers are returned with `sufficient: false` and an `INSUFFICIENT DATA` note. Same-token decisions within 24 hours count once. A request reads at most 5,000 outcomes or 10,000 trades and says `truncated` if it hit that. Not built: per-wallet leader accuracy, outcomes for per-user decisions, and any caching (each request recomputes from the database).

## Admin and operations (B9)

All admin endpoints need `isAdmin`, are rate-limited and are covered by tests. Changes are written to the audit log with who, what (before and after) and why. The runbook is `docs/OPERATIONS.md`.

- **System limits** (`GET/PUT /v1/admin/system-limits`, `POST .../reset`): the code defaults in `packages/risk` are the **absolute ceiling**. An admin can tighten, never loosen past them, and each limit has a strictest allowed value. A stored value that is damaged or looser than the code is ignored. The Governor reads them per job, so a change applies to the next order. A user's own limit can still only be stricter.
- **Global pause on new entries** (`GET/PUT /v1/admin/trading-pause`): stops every new entry in every mode, before any quote is spent (fan-out) and again in the Governor (`SYSTEM_PAUSED`) for jobs already queued. Exits are not affected.
- **Token blacklist** (`GET /v1/admin/blacklist`, `PUT /v1/admin/tokens/:mint/blacklist`): a reason is required and stored with who and when. Open positions are reported, not closed.
- **Audit log** (`GET /v1/admin/audit`), **status** (`GET /v1/admin/status`: health, queues, freshness, controls, counts, budgets, warnings) and **costs** (`GET /v1/admin/costs`, `GET/PUT /v1/admin/ai-pricing`). Prices are entered by an admin and never guessed. Chat messages now record the model so chat can be priced.
- **Startup environment validation** (`assertEnv` in `packages/shared`): both processes check the environment before opening any connection and exit with a list of problems. Messages name variables and never contain values (tested with secrets planted in every field). Optional providers that are missing produce warnings that say which feature is off.
- **Docker and CI**: `docker/Dockerfile`, `docker/docker-compose.prod.example.yml`, `.dockerignore` and `.github/workflows/ci.yml`. The CI workflow runs the migration drift check and fails on any skipped test; `node scripts/check-test-results.mjs` does the skip check locally. None of the Docker or CI files could be run where they were written, only syntax-checked.
- **Merged with B5a**: the executor process (`workers/executor`) enforces the same system limits and global pause, because it runs the same execution store. `assertEnv` has an `executor` role. The status view warns when the execution queue has waiting jobs and no consumer, and the compose example runs the executor.
- **Changed existing behavior**: the Governor and `mergeLimits` take the effective system limits; `get_system_limits` in agent chat now reports the effective limits (the agent test for it was adjusted because that tool now calls the ports); `prismaStores.test.ts`'s fake database gained a `systemSetting` read. Migration `0009_admin_operations` (hand-written) adds blacklist reason columns on `Token` and `model` on `ChatMessage`.
- **Not built**: a second admin's approval for limit changes, time-limited overrides, optimistic locking on edits, alert routing from the status warnings, metrics and log shipping, an admin UI.

## Executor dry run (B5a)

The first stage of the approved B5 plan (`docs/SECURITY_REVIEW_PLAN_B5.md`). **Nothing here can sign or send a transaction, and no signing credential exists.** For an AUTO order, or a confirmed SEMI_AUTO order, from a user on the canary allow list, the executor does everything it would do before signing and records what it found. Everyone else's orders end as `execution_disabled`, exactly as before.

```
execution queue --> workers/executor (own process)
  Risk Governor and fresh quote (unchanged)
  --> preflight, re-read NOW: kill switch, permission, paused, revoked, delegation expiry, mode, trading wallet, per-order cap, daily cap
  --> token policy (entries): classic Token program only, no freeze authority, no mint extensions
  --> Jupiter builds the swap --> verifySwapTransaction (packages/tx-verify)
  --> read balances, simulateTransaction, verifySimulation
  --> one DryRun row (ACCEPTED, REJECTED or ERROR) + audit row. No Order, Trade or Position is written.
```

**The transaction check** (pure, `packages/tx-verify`). Program allow list: System, Token, Associated Token, Compute Budget, Jupiter v6. The user's wallet must be the fee payer and the only signer; a pre-signed transaction is refused. The only SOL transfer allowed goes from the user into the user's own wrapped-SOL account, and no more than the swap input plus a small overhead. Approve, SetAuthority, Transfer, Burn, Freeze, Assign, CreateAccount, Memo and every other program are refused. Closing a token account is allowed only to the user. Token accounts may only be created for the user, for a mint in this swap, at the derived address. Compute limit and priority fee are capped. An account that is only visible through an address lookup table cannot be checked, so an instruction that moves value must not use one (the Jupiter route itself may). Exactly one Jupiter instruction. **Every unknown is a refusal, and every failed check is reported, not only the first.**

**The simulation check.** The route inside Jupiter's instruction is opaque, so the effects are checked instead: the wallet may lose no more SOL than the swap input plus the allowed overhead, and the output must meet the quote's minimum (for a sale, no more tokens may leave than the quote's input and the proceeds must meet the minimum). A failed simulation, a missing account or a quote with no minimum is a refusal. Only the wallet and its two token accounts are checked; other accounts the route touches are not.

**Limits** (approved canary defaults, starting values, unvalidated; each has a built-in ceiling in `workers/executor/src/config.ts` and a value above it stops startup rather than being clamped): 0.01 SOL per transaction, 0.05 SOL per day, 0.005 SOL overhead, 0.001 SOL priority fee, 10 s from quote to simulation. The executor's per-transaction cap is independent of the Risk Governor's. Accepted dry runs and real orders both count toward the daily cap.

**Kill switch.** `GET/PUT /v1/admin/executor/kill-switch` (admin, audited; turning it off needs a reason). The executor reads it before every order. An unreadable value counts as ON. Today a missing row means off; B5b should require an explicit "armed" flag.

**Review.** `GET /v1/admin/dry-runs?outcome=&userId=&limit=&cursor=` returns each run's decoded transaction (every instruction by program and kind), the reasons for any refusal, the simulated balance changes and a message hash. See `docs/B5A_RUNBOOK.md`.

**Running it.** `npm run dev:workers` (everything except execution) and `npm run dev:executor` (execution). The pipeline worker no longer consumes the execution queue. The executor needs `HELIUS_RPC_URL` for balances and simulation, and `EXECUTOR_ALLOWLIST_USER_IDS`. It refuses to start if `EXECUTOR_MODE` is anything but `dry_run`, or if a signing-key variable (`EXECUTOR_SIGNING_KEY`, `PRIVY_APP_SECRET`, `PRIVY_AUTHORIZATION_PRIVATE_KEY`, `WALLET_PRIVATE_KEY`, `SOLANA_PRIVATE_KEY` and similar) is present.

**Structural tests.** `workers/executor/src/isolation.test.ts` reads the source and fails if signing, sending, key handling or Jito code appears in the executor, the verifier, the Solana client, the Risk Governor or the trading package; if the executor reads an unexpected environment variable; if the dry runner writes an Order, Trade or Position; if the API, pipeline worker, AI package or chat agent import the executor or web3.js; if the pipeline consumes the execution queue again; if any `ExecutionDeps` is given an `executor`; or if a chat tool could reach any of it. **These must be changed on purpose, in review, when B5b adds signing.**

**Verified for real (build sandbox, Postgres 16 and Redis, 55 files, 820 tests, none skipped):** 36 verifier and simulation tests including about twenty hostile transactions (extra transfer to an attacker, SetAuthority, Approve, close to attacker, unknown program, wrong fee payer, second signer, pre-signed, token account for the attacker, wrong mint, no or two Jupiter instructions, compute and fee ceilings, lookup-table tricks, junk input); 41 dry-run tests on a real Postgres (accept, every preflight refusal, kill switch on and unreadable, permission races, caps including the daily cap and real orders, token policy, quote mismatches, hostile transactions, failed simulations, stale quotes, build and node failures recorded as ERROR, idempotency including two simultaneous deliveries, and no Order, Trade or Position ever written); the real execution path ending as `dry_run`; config ceilings; the admin routes; migration 0009.
**Only against fakes:** Jupiter's swap endpoint and the node's `simulateTransaction`, `getMultipleAccounts` and `getAccountInfo`. The request and response fields match Jupiter's published v1 docs, which were read and not called. **Not verified:** whether a real Jupiter swap passes the verifier (its instructions have not been seen), real simulation output, Privy (not touched), `prisma migrate diff` for 0009, and the executor running as a real process against real queues.
**Known limits:** Jupiter says its v1 API is superseded by Swap V2. The circuit breakers are not built (they need real order history). Only the wallet and its two token accounts are checked in the simulation. A wallet must be registered by hand for a dry run (see the runbook), since wallet creation belongs to B5d.

## AI pipeline
`runAiAnalysis` runs every 5 minutes (and per wallet-event screening job). Flow: fast screen, then only for ANALYZE or URGENT_ANALYZE a bull, bear and risk role in parallel, then a decision agent that sees only our facts and the roles' structured output, then deterministic guardrails, then an optional judge on BUY. Every model reply is parsed and validated with Zod. One retry names the bad fields without echoing the reply. Every failure path ends in WATCH or IGNORE.
- **Untrusted text** (token name, symbol, narrative text) is wrapped and sent only under an `untrusted` key to the screen and the three roles. It is never in the system prompt and the decision agent never sees it.
- **Guardrails** the model cannot override: a BUY needs deep analysis, no injection flag, a non-suspicious token, 20K USD liquidity, 50 holders, opportunity score at least 60 and confidence at least the configured threshold. Size, slippage and price impact are capped, a stop loss is always set, and exits are not decided here (there is no position context). The Risk Governor still has the final say.
- **Cost control:** daily token budget, per-token cooldown (60 min), a kill switch, and a minimum opportunity score of 50 to be screened at all. A provider outage records nothing so the next run retries.
- **Decisions are global** (`userId` null) and shown to everyone. Per-user fan-out into execution jobs belongs to the semi-auto and auto phases.
- **Admin:** `GET/PUT /v1/admin/ai-models` and `PUT /v1/admin/ai-enabled` (admin users only). Unknown fields such as API keys are refused. Keys come from `AI_PROVIDER_API_KEY` and `AI_BASE_URL` on the server and are never settings.
- **Explainability:** `GET /v1/opportunities/:id/analysis` returns the screen result, bull, bear and risk arguments, the decision, and which guardrails changed it.
- The default model names (`gpt-6-luna`, `gpt-6-sol`) are placeholders from your spec. Set real ones in the admin settings. The request format follows the common chat-completions shape, so confirm it against your provider.
- Not built: the conversational agent with its tool set (getNarratives, getWalletProfile and so on), portfolio-exposure context for the model, per-user cost reporting, prompt-injection evaluation against a real model.

## Next
**B5b (signing for the owner's wallet only, a tiny hard cap) needs the owner's go-ahead after reading the dry-run output** (`docs/B5A_RUNBOOK.md`). B5c (widen AUTO) and B5d (wallet flows) are separate later approvals. B10 hardening comes after B5 is built. See `docs/CONTINUATION.md` section 5.

## Entitlements (Checkpoint B)
Early-access/Wyntrax schema, research-tier resolution, verified wallet linking, signed membership ingestion, gating and reconciliation are implemented. Entitlements cannot grant trading authority or gate safety/own-data access. See [the design](docs/ENTITLEMENTS.md). Local verification uses `node apps/api/scripts/scratch.cjs test` with the isolated `narra_ent` database, Redis /5 and port 4010; it refuses another database target.

### Entitlements Checkpoint C
Checkpoint C was approved with conditions. Research gating defaults OFF; MEMBER remains contract-valid/reserved and the approved v1 map uses EARLY_ACCESS, PRO and ELITE. See the [proxy readiness and rollout/manual contract check](docs/ENTITLEMENTS.md#rollout), including the rollback command. The review packet is archived outside the repository at `C:\dev\narra-entitlements-review`.
