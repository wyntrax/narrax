# NARRA: status, gaps and continuation guide

## Membership webhook continuation (2026-10-09)

Wyntrax reports independent token-gated memberships by signed webhook. Narra accepts MEMBER/PRO/ELITE keys for Solana and resolves the highest active, unexpired key across verified linked wallets. See `docs/ENTITLEMENTS.md` for setup, migration and continuous eligibility age.

Next: copy the creator's new signing secret into receiver configuration, schedule standalone expiry cleanup, and verify a real holder's grant, renewal and revocation through the deployment HTTPS endpoint. Local tests use fixtures for holdings and do not verify live deployment delivery.

Current cleanup verification is recorded in `docs/MEMBERSHIP_WEBHOOK_CLEANUP.md` when complete. The entitlement boundary receives configuration from entrypoints and does not read deployment secrets itself.

This file is for whoever (or whatever assistant) continues the build. It says what exists, what has been verified, what is still missing, and gives ready-to-paste prompts for the next sessions.

"NARRA" is a placeholder brand name, set by `PROJECT_NAME`.

---

## 1. What exists today

**Repo shape** (npm workspaces, TypeScript strict, Vitest): 58 source files (about 3,400 lines) and 21 test files (about 2,200 lines). At the last run, 183 tests passed against a real Postgres 16 and a real Redis 7. Integration tests skip themselves when those are not reachable.

| Area | Where | State |
|---|---|---|
| Shared types, brand config, Zod decision schema, untrusted-text helpers | `packages/shared` | Done |
| Risk Governor (deterministic), system limits, risk profiles | `packages/risk` | Done, 10 tests |
| Database: 45 models, 7 migrations | `packages/database` | Done, applied to local Postgres 16 |
| Queues (7) with dedupe and no-retry for trades | `packages/queue` | Done |
| Helius swap parser, webhook auth, Jupiter quote client, JSON-RPC client | `packages/solana` | Done, tested with fakes only |
| Wallet intelligence: cost-basis stats, wallet score, leader score, style rules, timing clusters, consensus | `packages/smart-money` | Done, pure and tested |
| Narrative: provider interface, normalization, velocity, organic score, lifecycle | `packages/narrative` | Done, pure and tested |
| Market data: DEX Screener and GeckoTerminal sources, rate limiter, token risk flags, fixture provider (B1) | `packages/market-data` | Done, unit-tested; live shapes unverified |
| Tracked wallets: admin API, Helius webhook sync, funding graph, early-buyer discovery (B2) | `apps/api`, `workers/pipeline`, `packages/smart-money`, `packages/solana` | Done, tested with fakes only; Helius and chain behaviour unverified |
| Position monitor: entry baseline, deterministic exit rules, optional AI review, evaluations and alerts (B3) | `packages/positions`, `workers/pipeline`, `packages/ai` | Done. Paper positions now exist (B4), so the monitor has something to watch |
| Token intel: matching, OG score, copycat flags, attention-price divergence, opportunity score | `packages/token-intel` | Done, pure and tested |
| AI: provider interface, prompts, schemas, pipeline, guardrails | `packages/ai` | Done, tested with scripted models only |
| Workers: market data refresh (B1), wallet events, wallet intelligence, narrative ingestion, token resolution, AI analysis, execution (no executor), Postgres stores, chain ports | `workers/pipeline` | Done except the executor |
| API: health, Helius webhook, Privy auth, account controls, read routes, admin AI settings | `apps/api` | Partial, see section 3 |
| UI | `design/prototype/narra-prototype.html` | A mock-data HTML prototype only, not the real frontend |

**API routes that exist**
- `GET /health`
- `POST /webhooks/helius`
- `GET /v1/me`, `PUT /v1/mode`, `PUT /v1/ai-access`, `POST /v1/ai-access/revoke`, `POST /v1/agent/pause`, `POST /v1/agent/resume`, `PUT /v1/risk-profile`
- `GET /v1/narratives`, `GET /v1/narratives/:slug`
- `GET /v1/opportunities`, `GET /v1/opportunities/:id/analysis`
- `GET /v1/tokens`, `GET /v1/tokens/:mint`
- `GET /v1/smart-money/wallets`, `GET /v1/positions`, `GET /v1/trades`
- B7: `GET /v1/alerts`, `GET /v1/alerts/unread-count`, `POST /v1/alerts/:id/read`, `POST /v1/alerts/read-all`; `GET /v1/settings`, `PUT /v1/settings/profile|appearance|notifications|interests`; `GET /v1/overview`, `GET /v1/intelligence-bar`, `GET /v1/narratives/rotation`; `GET /v1/search`; `GET /v1/wallets/:address`, `GET /v1/wallets/:address/trades`; `GET /v1/me/wallets`, `GET /v1/me/wallets/balances`; `GET /v1/trades/export`; `GET /v1/admin/connections`; WebSocket `GET /v1/stream`. `GET /v1/tokens` gained the screener filters. Lists have cursors.
- `GET /v1/admin/ai-models`, `PUT /v1/admin/ai-models`, `PUT /v1/admin/ai-enabled`
- `GET/POST /v1/admin/wallets`, `POST /v1/admin/wallets/import`, `PATCH /v1/admin/wallets/:address`, `GET /v1/admin/wallets/sync-status`, `POST /v1/admin/wallets/sync`, `GET /v1/admin/wallet-candidates`, `POST /v1/admin/wallet-candidates/:address/approve`, `POST /v1/admin/wallet-candidates/:address/reject`
- `POST /v1/risk/evaluate` (dev only, **unauthenticated, must be removed or protected before any deployment**)

**Scheduled jobs** (BullMQ job schedulers): notification dispatch every 5 s and realtime publish every 2 s (B7), wallet intelligence every 15 min, narrative ingestion every 5 min, token resolution every 10 min, AI analysis every 5 min, market data every 5 min, wallet webhook sync every 10 min, wallet funding every 30 min, wallet discovery every 15 min. A wallet-event queue and an AI-screening queue are consumed by workers.

**Rules the code already enforces** (keep them)
1. No model output can reach a transaction. Decisions are validated by Zod, limited by guardrails, then checked by the Risk Governor. Execution jobs are queued with a single attempt and an idempotency key.
2. Missing inputs fail closed. Nothing defaults a missing balance, price or signal to zero.
3. Token names, symbols and narrative text are untrusted. They reach a model only under an `untrusted` key and never in the system prompt or the decision step.
4. Raw post text and private keys are never stored.
5. User limits can only be stricter than system limits. The model can only tighten slippage and price impact.

---

## 2. Verify these first (assumptions I could not check offline)

Run the whole suite on your own machine before building anything new:

```
npm install   # a new workspace (packages/market-data) was added, so this refreshes package-lock.json; commit it
docker compose up -d
cp .env.example .env
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
npx prisma generate --schema packages/database/prisma/schema.prisma
DATABASE_URL=postgresql://narra:narra@localhost:5432/narra npm test
npm run typecheck
```

Then confirm each of these against live services. None has been tested against the real thing:

- [ ] **Migrations apply with the real Prisma CLI.** They were generated with Prisma's WASM schema engine in a sandbox. If `migrate deploy` shows drift, regenerate with `prisma migrate dev`.
- [ ] **Prisma client mode.** The client uses `engineType = "client"` with `@prisma/adapter-pg` (no Rust engine). Confirm it behaves the same in your Docker image. Prisma is pinned to 6.19.x because 7.x rejects `url` in the datasource.
- [ ] **Helius payload shape.** `parseHeliusSwaps` assumes the fee payer is the trading wallet and that one swap leg is SOL or wrapped SOL. Capture real enhanced-transaction webhooks and compare.
- [ ] **Jupiter.** Base URL (`lite-api.jup.ag/swap/v1` is the default) and the unit of `priceImpactPct` (fraction or percent). The client has a `priceImpactFormat` option.
- [ ] **Privy token claims.** The verifier expects ES256, issuer `privy.io`, audience equal to your app id, subject equal to the user id. Confirm in the Privy dashboard and docs.
- [ ] **LLM provider format.** The client follows the common OpenAI chat-completions shape (`response_format: json_object`, `reasoning_effort`). The default model names `gpt-6-luna` and `gpt-6-sol` are placeholders from the spec. Set real ones in `PUT /v1/admin/ai-models`.
- [ ] **B1 sources.** Confirm one real response from each: `GET https://api.dexscreener.com/tokens/v1/solana/<mint>` (bare array of pairs, `priceUsd` as text, `pairCreatedAt` in ms) and GeckoTerminal `new_pools?include=base_token` and `tokens/<mint>/info` (`holders.count`, `holders.distribution_percentage.top_10`, `mint_authority`, `freeze_authority`, `is_honeypot`). Confirm the keyless GeckoTerminal tier returns the holder fields and what its authority fields look like when renounced. Review both providers' terms.
- [ ] **B2 Helius webhooks.** Create the webhook through `wallet-sync` against your account and confirm: the POST/PUT bodies are accepted, `accountAddresses` is replaced (not merged) on PUT, the list endpoint returns `active`, and your `/webhooks/helius` receives swaps with the `authHeader` you set. Confirm the address limit of your plan.
- [ ] **B2 chain assumptions.** On a few real wallets, check that `getSignaturesForAddress` plus `getTransaction` (jsonParsed) finds the funding transfer you can see in an explorer, and that funding by an exchange is skipped by the fan-out rule. On a few real new tokens, check that signatures for the mint include the early swaps and that the fee payer is the buyer.
- [ ] **B2 migration.** `0004_tracked_wallets` is hand-written. Run `npx prisma migrate diff --from-migrations packages/database/prisma/migrations --to-schema-datamodel packages/database/prisma/schema.prisma --shadow-database-url <url> --script` and expect no output.
- [ ] **B3 migration.** `0005_position_evaluations` is hand-written. Run the same `prisma migrate diff` check as for `0004` and expect no output.
- [ ] **B3 thresholds.** Every number in `MONITOR_RULES` is a guess. `npm run backtest` now replays the price, liquidity, volume and momentum rules over stored history. Run it once there are weeks of data, and only act on a result that clears the evidence gates.
- [ ] **B3 review prompt.** Run the position-review prompt against your real model on a few hand-made hostile token names and confirm it stays within HOLD, REDUCE or SELL.
- [ ] **B7 migration.** `0007_api_completion` is hand-written (it was applied with `psql` and checked from scratch, including its de-duplication of notifications, but `prisma migrate diff` and `migrate deploy` were not run). Run the same `prisma migrate diff` check as for `0004` and expect no output.
- [ ] **B7 behind your proxy.** Put the API behind Nginx (or your proxy) and confirm WebSocket upgrades work, the idle timeout is longer than the 30 s heartbeat, and `TRUST_PROXY=true` makes rate limits see client addresses. Set `CORS_ORIGINS` to your real web origin; with it empty browsers on other origins are refused.
- [ ] **B7 Privy over WebSocket.** Connect a real Privy access token to `/v1/stream` and confirm `verifyWithExpiry` reads `exp` and the refresh-by-`auth` flow keeps the socket open.
- [ ] **B7 query speed.** The screener (`LATERAL` joins) and search (`ILIKE '%x%'`) were only run on small data. Run `EXPLAIN ANALYZE` on real volumes; add `pg_trgm` indexes if search is slow.
- [ ] **B5a migration.** `0009_executor_dry_run` is hand-written (applied with `psql`, and the whole chain 0001 to 0009 applied from scratch with every model present), but `prisma migrate diff` was not run. Expect no output from the same diff check as for `0004`.
- [ ] **B5a on your machine, with real services.** Follow `docs/B5A_RUNBOOK.md`: run `npm run dev:executor`, dry-run a few real orders for your own user, and read `/v1/admin/dry-runs`. The questions that matter: does a real Jupiter swap pass the verifier, which instructions does it contain, and are the simulated balance changes what the quote promised? Nothing in B5a has touched a real Jupiter swap endpoint or a real node.
- [ ] **Jupiter Swap V2.** Jupiter's docs say the v1 API is superseded. Check the current quote and swap endpoints, response shapes and API-key requirement before B5b.
- [ ] **`npm audit`** reported 8 issues (3 moderate, 4 high, 1 critical) in transitive dependencies. Triage them.

---

## 3. What is still missing

Priority: **P0** blocks anything real, **P1** needed for the first usable release, **P2** later.

### 3.1 Data inputs (P0). Almost everything downstream needs these
- **Market data (B1 built, see README).** Done: `TokenMetric`, `TokenHolderMetric` and `TokenRiskMetric` writers, placeholder name fill, launch detection from new pools, SOL/USD in a setting. Still missing: `deployer` (nothing free provides it; needs a mint-creation lookup), developer holding (stored as unknown), true mint time (pool creation is used as a proxy), token description for matching, website and social identity for OG factors, and USD values on wallet trades (the SOL price now exists, nothing uses it yet).
- **Real narrative providers.** Only `StaticProvider` exists. Needs X, Reddit, YouTube, news or a crypto-social API behind `NarrativeProvider`, with rate limiting, cost caps and terms-of-service review.
- **Tracked wallets (B2 built, see README).** Done: add, import, label, deactivate, webhook sync, funding graph, discovery suggestions. Still missing: per-user private watchlists (`TrackedWallet.userId` is unused), a UI, wallet-to-wallet SOL transfer relationships (`TRANSFER`), CSV export, automatic removal of dead wallets, and a funder allow/deny list editor (it is a raw setting, `wallets.funderIgnore`).
- **Portfolio snapshots (B4 built).** Paper accounts are valued from the paper ledger every 5 minutes; real wallets are snapshotted only when `HELIUS_RPC_URL` is set. Still missing: snapshot retention and a read endpoint for the equity curve.

### 3.2 Position intelligence and learning (P0/P1). Spec phase 6 and the "LEARN" step
- **Position monitor (B3 built, see README).** Done: entry baseline, stop loss, take profit, trailing stop, narrative decay, smart-money exits, liquidity deterioration, volume and momentum warnings, honeypot flag, AI review as one input, alerts. Still missing: developer activity (no data source), per-user exit-rule overrides, admin-editable thresholds. Acting on a recommendation is built for paper and semi-auto in B4 (with partial-exit tracking); real execution is B5.
- **Position-aware AI decisions.** The monitor now sends position facts to a reviewer that can only add caution. The main opportunity pipeline still turns HOLD, REDUCE and SELL into WATCH because it has no position context; that stays until the AI pipeline is given position context (B8).
- **Outcome analysis (B6 built, see README).** `DecisionOutcome` is written for global decisions (1h and 24h return, label, lead time). Still missing: wallet-leader accuracy (needs per-wallet attribution of token outcomes), OG accuracy, false-narrative rate as its own measure, outcomes for per-user decisions, and a read API (B7).
- **Backtesting and replay (B6 built, see README).** Done: replay of the real exit rules, six strategies against a baseline, calibration by confidence and reason code, train and test sweeps, evidence gates. Still missing: point-in-time narrative, smart-money, holder and risk history (so those rules can be replayed; start storing it now), an admin trigger and a report history view (B9), and fills calibrated from real paper or live fills instead of a flat cost.
- **Narrative rotation detection (B7 built).** `GET /v1/narratives/rotation` and the overview describe score moves over a window. Thresholds are unvalidated, and it is a description, not a prediction.

### 3.3 Trading and wallets (P1). Spec phases 7 and 8
- **Fan-out, paper fills, semi-auto confirmations and the Order/Trade/Position writers (B4 built, see README).** Still missing: a separate DB-level pending-confirmation sweep alerting, a confirmations UI, an `Order` row for a confirmed live order (needs the Executor), and per-user mode-specific settings (fee, virtual balance) instead of constants.
- **The Executor** (the empty slot in `processExecution`): Privy delegated signing, Jito bundle or RPC submission, confirmation wait, fresh-quote re-validation, retries policy, TP/SL/trailing orders, tip management.
- **Wallet flows:** create embedded trading wallet, delegation grant and revoke at the Privy level (today the API only flips a flag), balances endpoint, deposit address, **withdraw**, **exit all positions**. The emergency controls pause and revoke exist; exit-all and withdraw do not.
- **Failsafes:** global kill switch for execution, per-user circuit breakers, stuck-order reconciler, duplicate-transaction protection across restarts.

### 3.4 API completion (P1). B7 built, see README
Done: alerts read API, per-user notification fan-out with preferences, overview and intelligence bar, narrative rotation, wallet detail, search, token screener filters, cursor pagination, settings (profile, notifications, appearance, interests), own wallets and balances, trade audit export, an admin connections status view, WebSocket gateway on Redis Streams with replay, CORS, security headers, body limits, request ids and one error shape.
Still missing:
- **Analytics endpoints (built, see README).** Still missing: caching, per-wallet leader accuracy, outcomes for per-user decisions, and a chart-friendly cohort view.
- **Notification retention.** A global alert makes one `Notification` per eligible user and nothing deletes old ones.
- **Search at scale:** no `pg_trgm` indexes. Transaction search finds tracked-wallet swaps and the caller's own trades, not arbitrary chain transactions.
- **"API connections" is built as a status-only admin view** (which providers are configured, yes or no). If the spec meant something else (for example user-supplied keys or webhooks), that needs a decision and a design; key handling would need a security review first.
- **Realtime limits:** the gateway runs in the API process (each process reads the stream itself); delivery is at least once; events are small hints, not state. No per-event authorization beyond channel and owner, so any new event type must be added to `EVENT_DEFS` with the right scope.
- **Structured logs and metrics** beyond request ids. B9 built the admin status view and cost report, but not metrics export, log shipping or alert routing.

### 3.5 AI layer (P1/P2)
- **Conversational agent with the tool set** from the spec (`getNarratives`, `getNarrative`, `getNarrativeVelocity`, `getNarrativeLifecycle`, `getNarrativeSources`, `getNarrativeTokenCandidates`, `getToken`, `getTokenMetrics`, `getTokenRisk`, `getSmartMoney`, `getWalletProfile`, `getWalletHistory`, `getWalletCluster`, `getWalletFundingGraph`, `getConsensus`, `getPortfolio`, `getPosition`, `getRiskProfile`, `getTradeHistory`, `getJupiterQuote`), streaming responses, tool results wrapped as untrusted data, and the suggested-queries behavior. The agent must never have a send-transaction tool.
- Portfolio exposure and execution quality as inputs to the deep analysis (the spec lists them).
- Per-user cost reporting and dollar cost (only token counts are tracked).
- A prompt-injection and quality evaluation set run against the real model you choose.

### 3.6 Admin, operations and security (P1)
- Admin dashboard backend: system overview, users, trading activity, risk, models, providers, workers, narrative providers, queue health, logs, API usage, cost monitoring (daily cost, cost per user, per decision, per executed trade, Helius usage, Jito tips).
- System status indicators for Helius, narrative providers, AI, Redis, Postgres, Jupiter, Jito, workers (ONLINE, DEGRADED, OFFLINE).
- **System-wide risk limits are hard-coded** in `packages/risk/src/limits.ts`. Move them to an admin-editable, audited setting (still enforced as the ceiling).
- Token blacklist management (`Token.blacklisted` exists, no API).
- Observability: Sentry, metrics, alerting. (Request ids and an error shape exist since B7; JSON logs are Fastify's default.)
- Deployment: Dockerfiles for api and workers, production compose, Nginx, CI pipeline (with Postgres and Redis services), environment validation at startup, secrets handling, database backups, migration workflow.
- Security review before any live funds: key handling, delegated-signing scope and limits, idempotency end to end, audit-log coverage, abuse and replay protection, dependency audit, penetration test of the webhook and auth paths.
- **Remove or protect `POST /v1/risk/evaluate`.**

### 3.7 Frontend (P1). Not started
There is no `apps/web`. Only the HTML prototype exists (mock data, no real auth or API). The real app needs: Next.js 15 App Router, TypeScript strict, Tailwind and shadcn/ui, Privy login, TanStack Query and Table, lightweight-charts with the event overlays, Zustand where needed, the design system and screens from the prototype, real data for every page, the command palette backed by the search endpoint, onboarding that saves settings, live updates over the WebSocket, dedicated mobile layouts, empty and loading states, light and dark themes, and the admin screens.

### 3.8 Smaller spec items not built
- Creator metrics (`CreatorMetric` is never computed): creator score, narrative lead score, amplification score, hit rate, median lead time. Roles are assigned, scores are not.
- Search velocity, creator network analysis, smart-money correlation on narratives (`NarrativeMetric.smartMoneyCorrelation` is always null).
- OG factors from website, social identity and creator relationship (no data ingested). Token description matching (no description column).
- Wallet style `MEME_EARLY` (needs token categories). Typical entry market cap (needs market cap on wallet trades). The wallet-behavior "narrative history" section.
- Telegram, sniper and multi-chain were explicitly out of scope for the first release.

---

## 4. Known limits and risks in what already exists

- **All thresholds and weights are starting values**, not tuned: wallet score weights, 5-closed-trade minimum, leader window (30 min), cluster rule (3 shared tokens within 60 s), consensus weights, narrative velocity saturation, lifecycle thresholds (150 posts/hour = mainstream), OG weights, opportunity weights and floors (20K USD liquidity, 50 holders), AI guardrails, risk profiles. Backtest before trusting any score for real money.
- Wallet scoring only sees trades that arrive through the webhook for tracked wallets. Sells of tokens bought before tracking started are skipped.
- Timing clusters cap at MEDIUM confidence and are inferred, not identity.
- Consensus requires wallet score of at least 60, which under the current weights needs a strong, long record (about 20 closed trades).
- The AI sees only global facts. It has no view of any user's portfolio.
- A provider outage in the AI job records nothing and retries next run. Repeated invalid output records a WATCH decision and starts the cooldown.
- Integration tests share one database and run one file at a time (`fileParallelism: false`). Tests that write shared lists must clean up after themselves, or later tests break.
- Execution is intentionally unreachable: `processExecution` stops at `execution_disabled` because no `Executor` is wired.

---

## 5. Recommended build order

Each phase should end with: all existing tests still passing, new unit tests for pure logic, integration tests against real Postgres and Redis for anything that writes, `npm run typecheck` clean, a README section, and an honest list of what was not verified.

**Backend track**
- **B1. Market data ingestion (P0). BUILT, awaiting your verification.** Token metadata, price, liquidity, holders, top-10, developer holding, launch detection, SOL price. Writers for `TokenMetric`, `TokenHolderMetric`, `TokenRiskMetric`, token `createdOnChainAt`, `deployer`, symbol, name. Provider interface like narratives; a fixture provider for tests. Done when token resolution produces opportunities from live-shaped data end to end.
- **B2. Tracked wallets. BUILT, awaiting your verification.** CRUD API, import, Helius webhook subscription sync, wallet discovery from profitable early buyers, labels, funding-graph ingestion with HIGH-confidence relationships.
- **B3. Position monitor (spec phase 6). BUILT, awaiting your verification.** Entry snapshot, decay and exit signals, HOLD/REDUCE/SELL decisions (deterministic signals first, AI as one input), trailing and TP/SL logic, alerts.
- **B4. DONE. Fan-out, paper trading and semi-auto (spec phase 7).** Decision to per-user ExecutionJob, SIMULATE fills with Trade and Position, SHADOW logging, confirmation flow, writers for Order, Trade, Position, realized PnL, PortfolioSnapshot.
- **B5. Executor and auto mode (spec phase 8). PLAN APPROVED; B5a (dry run) BUILT, awaiting your verification; B5b onward NOT built.** See `docs/SECURITY_REVIEW_PLAN_B5.md` and `docs/B5A_RUNBOOK.md`.
  - **B5a built:** `workers/executor` (own process, no signing capability), `packages/tx-verify`, `DryRun` table (migration 0009), Jupiter swap-build call, RPC simulate, accounts and mint reads, kill switch, canary caps, admin review routes, structural isolation tests.
  - **B5b (needs your go-ahead):** Privy signing for the owner's wallet only, write-ahead Order, send by RPC, signature tracking and reconciliation, real Trade, Position and PnL from balance deltas, per-user circuit breakers, kill switch flipped to explicit "armed", move the quote and swap clients to Jupiter Swap V2, hostile-fixture suite extended with real captured transactions, crash-injection tests, the isolation tests changed on purpose.
  - **B5c:** remove the allow list and raise the cap in steps, after an external security review and the legal check (D9).
  - **B5d:** exit-all, withdraw, wallet creation record. Separate review.
- **B6. DONE. Outcomes, analytics and backtesting.**
- **B7. DONE. API completion and realtime**, plus the read-only analytics endpoints.
- **B8. DONE. Agent chat with tools.**
- **B9. DONE. Admin and operations, deployment.**
- **B10. Hardening and evaluation.**

**Frontend track** (can start after B1 and B7 basics, in parallel)
- **F1.** Next.js app shell, design system, Privy login, API client, TanStack Query.
- **F2.** Overview, Radar, Narrative detail, Opportunities, Token detail with chart and event overlay.
- **F3.** Smart money, wallet detail, positions, trades, analytics.
- **F4.** Wallet and emergency controls, risk settings, onboarding, settings.
- **F5.** Agent workspace, command palette with real search, alert center.
- **F6.** Admin screens, mobile layouts, accessibility, performance, end-to-end tests.

---

## 6. Prompts for the next session

The prompts now live in **`docs/CLAUDE_CODE_PROMPT.md`**, written for Claude Code, which reads **`CLAUDE.md`** in the repo root automatically. They cover: a first "verify and stabilize" session (do this before B4), the build-phase prompt with a detailed B4 brief and the open decisions, and the frontend prompt. Keep those files, `CLAUDE.md` and this one consistent when you finish a phase.
