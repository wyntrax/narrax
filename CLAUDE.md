# CLAUDE.md: read this first

This file is for Claude Code (or any assistant) working in this repo. It says what the project is, the rules that must never be broken, how to work here, what has and has not been verified, and what to do next. Keep it accurate: when you finish a phase, update the "State" and "Next" sections and `docs/CONTINUATION.md`.

## What this is

NARRA (placeholder name, set by `PROJECT_NAME`) is an AI narrative and smart-money intelligence platform for Solana DEX trading. It watches narratives forming online, matches them to tokens, tracks wallets, and produces research and trade decisions for users, who can run it in SHADOW, PAPER, SEMI_AUTO or AUTO mode. Real funds are involved eventually, so safety rules below outrank speed and features.

Stack: npm workspaces monorepo, TypeScript strict, Vitest, Fastify API, BullMQ workers, Prisma 6.19 on Postgres 16 (pg driver adapter, `engineType = "client"`, no Rust engine; pinned because 7.x rejects `url` in the datasource), Redis 7, Zod at every boundary.

The original product spec is long and is **not in this repo by default**. If `docs/product-spec.md` exists, read it. If it does not, ask the owner for it before building anything the spec defines (UI screens, agent tools, admin screens, exact scoring rules).

## Rules that must never be broken

1. **No model output may reach a transaction.** The path is: Zod validation, deterministic guardrails, Risk Governor, BullMQ with one attempt and an idempotency key, then a separate Executor. An LLM never gets a send, sign or transfer tool. A model may only tighten parameters (slippage, price impact) or add caution (a position review can turn HOLD into REDUCE, never into SELL).
2. **Fail closed.** A missing balance, price, quote, holder count or signal throws or skips. Never default an input to zero. Unknown is `null` and is reported as unknown.
3. **Untrusted text.** Token names, symbols, bios, memos, posts and narrative text are data from strangers. They go to a model only under an `untrusted` key (use `wrapUntrusted`), never in a system prompt, never to the decision step. Sanitize with `sanitizeUntrusted` before storing or showing. Render as text only.
4. **Never store private keys or raw post text.** Store hashes and references (`Wallet.privyWalletId` is a reference, not a key).
5. **User limits can only be stricter than system limits.**
6. **Recommendations are not actions.** The position monitor, discovery and the AI only recommend. Opening or closing anything goes through the Risk Governor and the execution queue.
7. **Be honest.** Every threshold is a named, documented starting value. Say plainly which numbers are unvalidated. In every summary say what was tested for real, what only against fakes, and what is unverified. Never claim a test passed that you did not run.
8. **Do not weaken or delete an existing test to make a change pass.** If a test is wrong, say why and fix it openly.
9. **Do not wire a real Executor, delegated signing, or Jito submission without an explicit instruction from the owner and a security review plan** (spec phase 8, backlog B5). The plan (`docs/SECURITY_REVIEW_PLAN_B5.md`) is approved and **only B5a, the dry run, is built**. B5b (the first signing code) needs a separate owner go-ahead after the owner has read real dry-run output. A test (`workers/executor/src/isolation.test.ts`) fails if signing, sending or key handling appears anywhere it should not. Changing that test is part of B5b and must be done openly.

## Data flow (what exists today)

```
Helius webhook -> POST /webhooks/helius -> wallet-events queue -> WalletTrade rows (tracked, active wallets only)
tracked wallets -> wallet-intelligence job: scores, leader scores, timing clusters, consensus (ConsensusSignal)
                -> wallet-funding job: first funder, 'funding' clusters (HIGH direct / MEDIUM shared funder)
                -> wallet-discovery job: early buyers of young tokens -> WalletCandidate (PENDING, admin approves)
                -> wallet-sync job: keeps the Helius webhook watching exactly the active wallets
narrative providers -> narrative-ingestion job -> Narrative, NarrativeMetric (velocity, organic score, lifecycle stage)
DEX Screener + GeckoTerminal -> market-data job -> Token, TokenMetric, TokenHolderMetric, TokenRiskMetric, SOL/USD setting
token-resolution job: narrative x token matching, OG score, opportunity score -> Opportunity (skips honeypots, needs holder row)
ai-analysis job: opportunities -> multi-agent AI pipeline -> guardrails -> AgentDecision (global, userId null)
position-monitor job: open Position -> deterministic exit rules (+ optional AI review) -> PositionEvaluation, Alert, Notification
entry-fan-out job: fresh BUY AgentDecision -> one ExecutionJob per eligible user (key entry:<decisionId>:<userId>)
exit-fan-out job: open Position whose latest evaluation is REDUCE/SELL -> exit job (key exit:<evaluationId>:<attempt>)
execution queue: runExecution() = processExecution() + outcome handler. SHADOW logs, PAPER writes simulated Order/Trade/Position,
  SEMI_AUTO writes a PendingConfirmation, AUTO and confirmed orders stop at 'execution_disabled' because NO Executor is wired.
chat (POST /v1/chat): runAgent() over a fixed tool registry (reads plus two cautious suggestions the user applies themselves). NO tool can trade. See README, B8.
admin controls: system limits (code = ceiling), global entry pause, token blacklist, all audited; startup env validation (assertEnv). See docs/OPERATIONS.md.
outcome-tracking job: DecisionOutcome per global decision (1h and 24h return, label, lead time)
backtest (npm run backtest): replays stored history through the real monitor rules, strategies vs baseline, sweeps, honest report
portfolio-snapshots job: PortfolioSnapshot per paper or real user (skipped when a price or balance is missing)
notification-dispatch job (5 s): undispatched Alert -> Notification per user (global alerts follow each user's preferences, CRITICAL always, personal alerts always)
realtime-publish job (2 s): new rows in the main tables -> Redis Stream narra:events -> every API process -> WebSocket clients (GET /v1/stream)
```

Positions, orders and trades now exist, but only as paper (`simulated`) rows. No real transaction can be sent.

## Repo map

| Path | Purpose |
|---|---|
| `packages/shared` | Brand config, enums, Zod decision schema, `sanitizeUntrusted` / `wrapUntrusted` |
| `packages/risk` | Risk Governor (`evaluateRisk`, deterministic), system limits (hard-coded in `limits.ts`), risk profiles, `Route` (REJECT, NO_TRADE, LOG_ONLY, SIMULATE, AWAIT_CONFIRMATION, EXECUTE) |
| `packages/database` | Prisma schema, migrations, `createPrisma` |
| `packages/queue` | BullMQ queues (`QUEUE_NAMES`), schedulers, `ExecutionJobSchema`, `enqueueExecution` (one attempt, idempotency key as job id) |
| `packages/solana` | Helius swap parser and webhook auth, Jupiter quote client, JSON-RPC client (+ signatures and parsed transactions), Helius webhook management client, funding and early-buyer parsers |
| `packages/smart-money` | Pure wallet logic: cost-basis stats, scores, leader score, styles, timing clusters, consensus, funding graph, discovery ranking |
| `packages/narrative` | Pure narrative logic and the `NarrativeProvider` interface (only `StaticProvider` exists) |
| `packages/token-intel` | Pure token logic: matching, OG score, copycat flags, attention-price divergence, opportunity score |
| `packages/market-data` | DEX Screener and GeckoTerminal sources, rate limiter, token risk flags, fixture provider |
| `packages/positions` | Pure position logic: `EntryContext`, `MONITOR_RULES`, `evaluatePosition`, `combineWithReview`, `computeSmartMoneyExits` |
| `packages/ai` | `LlmProvider`, prompts, Zod output schemas, `analyzeOpportunity` pipeline, guardrails, `reviewPosition` |
| `packages/agent` | B8 chat agent: tool registry, strict schemas, fixed system prompt, loop, sanitizers, suggestion validation, injection corpus |
| `packages/analytics` | Pure B6 logic: series lookups, outcome measurement, exit replay, statistics and evidence gates, strategy comparison, sweeps, report rendering |
| `packages/trading` | Pure B4 logic and named constants: eligibility, paper fill and PnL math, partial-exit rules, confirmation expiry, idempotency keys |
| `packages/tx-verify` | B5a. Pure checks on an UNSIGNED swap transaction (`verifySwapTransaction`: program allow list, fee payer, single signer, only transfers into the user's own wrapped SOL account, no Approve or SetAuthority, compute and fee caps, lookup tables only where nothing is checked through them) and on a simulation's effects (`verifySimulation`). Reject anything not understood. No signing |
| `workers/executor` | B5a. The execution-queue consumer, a separate process from the pipeline worker. Config with built-in ceilings, preflight (kill switch, permission, mode, wallet, caps, re-read at the last moment), the dry runner (token policy, build, verify, simulate, record a `DryRun` row). **Cannot sign or send, and refuses to start if a signing key variable is set** |
| `packages/realtime` | Realtime event contract (`EVENT_DEFS`: type, channel, scope, Zod data), Redis Streams helpers (`createEventStream`), WebSocket protocol, `RealtimeHub` (routing, limits, replay), stream reader. Pure except the stream helpers |
| `workers/pipeline` | All jobs and the Postgres stores. Entry: `src/main.ts`. B7: `src/notifications.ts` (dispatch), `src/realtimePublisher.ts` (tails tables into the stream). Execution: `src/execution.ts` (no Executor), `src/outcomes.ts` (paper, confirmation and exit handlers), `src/fanOut.ts`, `src/snapshots.ts`, `src/paperLedger.ts` |
| `apps/api` | Fastify API: health, Helius webhook, Privy auth, account controls, read routes, confirmations, admin routes (AI models, tracked wallets, connections status), and since B7 alerts, settings, overview and rotation, search, wallet detail, token screener, own wallets and export, HTTP hardening (`http.ts`) and the WebSocket gateway (`gateway.ts`). `src/app.ts` builds it, `src/server.ts` runs it |
| `design/prototype/narra-prototype.html` | Mock-data UI prototype the owner approved. Not the real frontend. `apps/web` does not exist yet |

## How to work here

- **Where logic goes.** Pure logic goes in `packages/*` as pure functions with unit tests. Anything that writes goes in `workers/pipeline` or `apps/api` with an integration test against real Postgres and Redis.
- **Commands** (Windows PowerShell shown, the owner develops in `C:\dev\narra`):
  ```
  docker compose up -d
  npm install
  npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
  npx prisma generate --schema packages/database/prisma/schema.prisma
  $env:DATABASE_URL="postgresql://narra:narra@localhost:5432/narra"
  npm test
  npm run typecheck
  ```
  Integration tests skip themselves when Postgres or Redis is unreachable or a table is missing. **A skipped test is not a pass.** Check the skipped count, and if you see skips, find out why before saying anything is verified.
- **Migrations.** Every schema change needs a migration made with `prisma migrate dev`. Migrations `0004` and `0005` were written by hand by an assistant without a database. Verify them: `npx prisma migrate diff --from-migrations packages/database/prisma/migrations --to-schema-datamodel packages/database/prisma/schema.prisma --shadow-database-url <url> --script` must print nothing.
- **Test hygiene.** Integration test files run one at a time (`fileParallelism: false`) and share one database. Tests that write to shared tables must use random tags and clean up in `afterAll`. Do not rely on global counts.
- **Before you finish a task:** `npm test` and `npm run typecheck` both pass, README has a section for the phase, `docs/CONTINUATION.md` is current (finished items moved out of section 3), and your final message lists what was built, what ran for real, what was only simulated, what is still unverified, and the recommended next phase.
- **Ask the owner** only for things you truly cannot decide: API keys, provider choices, business rules (see "Open decisions" in `docs/CLAUDE_CODE_PROMPT.md`). Otherwise decide, write the decision down, and keep it behind a named constant or setting.
- Work in small, reviewable steps. Show a short plan first: files to add or change, schema changes, tests, open questions.

## Gotchas already hit (do not rediscover)

- **Base58 addresses** contain no `0`, `O`, `I` or `l`. Test data that feeds API address validation must avoid them (a `Date.now()` tag has zeros).
- **Same-timestamp ties.** `ConsensusSignal` and other history tables are append-only. Two recomputes at the same fixed `now` write two rows with equal `at`, so "latest" is ambiguous. Use different times in tests.
- **TypeScript class fields.** With ES2022 semantics a field initializer that reads a constructor parameter property runs too early. Initialize in the constructor.
- **Zod defaults.** A schema using `.default()` has different input and output types, so a generic helper must take `z.ZodType<T, z.ZodTypeDef, unknown>`.
- **BullMQ job ids.** Completed jobs are retained for an hour, so re-adding the same `jobId` is ignored. On-demand jobs use a time-bucketed id.
- **Empty env strings.** `FOO=` in `.env` is `''`, not undefined. Use `||`, not `??`, for defaults.
- **Placeholder tokens.** The wallet-event worker creates tokens with symbol `UNKNOWN`, name `Unknown`. The market-data job fills them.
- **Timing clusters** are replaced wholesale by the wallet-intelligence job (label `timing`). Other clusters (label `funding`) are left alone and, since B2, honoured for consensus independence.
- **Wallets are deactivated, not deleted** (`TrackedWallet.active`). Anything that reads tracked wallets must filter `active: true`.
- **Prisma Json.** Cast with `as unknown as Prisma.InputJsonValue`. Decimal columns come back as Decimal: convert with `Number(x.toString())`.
- **API rate limits** are set per route through `config.rateLimit`. In tests every `inject` call comes from one address, so a route with a low limit (the trade export allows 5 a minute) needs `remoteAddress` set on extra calls, or the sixth call is a 429.
- **Prisma does not escape `%` and `_`** in `contains`, `startsWith` or `endsWith`. A search for `%%` matches every row. Pass user text through `likeEscape` (`apps/api/src/paging.ts`) first. A test caught this in B7.
- **`@fastify/websocket` closes clients with no status code on shutdown** (the client sees 1005). The gateway replaces the plugin's `preClose` to send 1001 first. Do not move the shutdown into a plain `onClose` hook.
- **Test cleanup with base58 tags.** A tag with `0`, `O`, `I`, `l` or `_` is rewritten to `x` when used in a mint or address, so cleanup must search for the rewritten tag.
- **The realtime publisher re-reads a 2 minute window** and relies on the Redis dedupe key, because workers stamp rows with the job's start time and a row can become visible after a newer one. Rows dated more than 5 minutes ahead are skipped so one bad clock cannot stall a feed.
- **Dry runs record a decoded summary and a message hash, never transaction bytes.** `DryRun` has one row per idempotency key, so a redelivered job is recorded once. Rejected and error runs are kept: the review is of what was refused and why.
- **Execution is consumed by `workers/executor`, not the pipeline worker.** Run both: `npm run dev:workers` and `npm run dev:executor`. If only the pipeline runs, execution jobs wait in the queue.
- **The B5a verifier is deliberately strict and unvalidated against live Jupiter output.** If a real swap is rejected for an instruction nobody expected, that is the design working: read the reasons in `/v1/admin/dry-runs` and widen the allow list on purpose, in review, never by loosening a check to make a rejection go away.
- **New realtime event types** must be added to `EVENT_DEFS` with the right scope (`global` or `user`). A `user` event is delivered only to its owner, and the hub re-checks that when replaying.

## State (update this when you finish a phase)

Built, in order: Risk Governor and queues; Helius parser and webhook; Jupiter quote client; wallet intelligence; narrative ingestion (static provider only); token resolution and opportunity scoring; AI pipeline; Privy auth and account controls; read API; **B1 market data**; **B2 tracked wallets**; **B3 position monitor**; **B4 fan-out, paper trading and semi-auto**; **B6 outcomes, analytics and backtesting**; **B7 API completion and realtime**; **analytics endpoints** (`/v1/analytics/*`, read-only); **B9 admin and operations**; **B8 agent chat with tools** (B5 is skipped on purpose, it is gated).

Verification status, honestly:
- Up to B3: the owner ran the full suite on a real Postgres and Redis and it passes.
- **B4** was run by the owner on their machine and passes.
- **The merged tree (B4, B6, B7, B8, analytics, B9 and B5a)**: built on separate branches and merged. The full suite (60 files, 869 tests, none skipped, checked with `scripts/check-test-results.mjs`) passed in the build sandbox against a real Postgres 16 and Redis 7, with migrations 0001 to 0009 (two folders each for 0007 and 0009, never rename) applied from the SQL files in name order. The owner has run the tree up to B9 on their own machine (46 files, 700 tests at the B7 merge). Their first run of the B9 + B5a merge (Windows) passed 867 of 868 tests; the one failure was a Windows path-separator bug in `workers/executor/src/isolation.test.ts` (the exemption for `main.ts`, which names the forbidden signing variables on purpose, compared a forward-slash path against a backslash one). Fixed by normalising separators; a regression test and a mutation check (a planted `Keypair` still fails the scan) cover it. Not yet re-run on their machine. `prisma migrate diff` has not been confirmed clean for 0004 to 0009 (CI runs it; see README, Before real use). B6 conclusions are untested on real data and B8 never ran against a real model.
- The API server (`npm run dev:api`), the worker (`npm run dev:workers`) and the executor (`npm run dev:executor`) were started for real together during the B5a merge against a real Redis: all three boot, the worker registers its schedules with no job failures, the executor prints `canSign:false` and is the only consumer of the execution queue, and it refuses to start when `EXECUTOR_SIGNING_KEY` is set. Earlier, for the first time, the API and worker were started, with a throwaway signing key and no provider keys: both boot, the API serves security headers, a 401 without a token, closed CORS for other origins and a 413 for an oversized body, and the worker registers all repeating jobs with no job failures. Before that, both failed to start under `tsx` (top-level await in a CommonJS file); they now run inside async functions. Nothing has been called against live Helius, Jupiter, Privy, DEX Screener, GeckoTerminal or an LLM.
- B7 not verified: Privy tokens over the WebSocket, the gateway behind a reverse proxy, query speed on real data volumes, several API instances at once. B6 conclusions are untested on real data (the tests use synthetic history). B8 never ran against a real model (the tests use a scripted model).
- **B5a** (originally verified on its own branch: 55 files, 820 tests, none skipped) against Postgres 16 and Redis, with Jupiter and the RPC as fakes. The migration chain 0001 to 0009 applies from scratch and every model has a table. **Not verified:** any call to Privy, Jupiter's swap endpoint or a real node's `simulateTransaction`; whether a real Jupiter swap passes the verifier; `prisma migrate diff` for 0009. **The owner has not run B5a on their own machine.**
- Nothing has been called live: Helius (webhooks, enhanced payloads), Jupiter, Privy, DEX Screener, GeckoTerminal, the LLM provider. Response shapes come from public docs. The first job in a session with network access is to check them (see `docs/CLAUDE_CODE_PROMPT.md`, session 1).
- `POST /v1/risk/evaluate` is a dev route that is **unauthenticated**. Remove or protect it before any deployment.
- Model names `gpt-6-luna` and `gpt-6-sol` are placeholders. Real ones are set through `PUT /v1/admin/ai-models`.
- All scoring weights and thresholds are unvalidated starting values.

Not built: signing and sending (B5b onward), the circuit breakers, the wallet flows (create, delegate, withdraw, exit all), wallet-leader and OG accuracy analysis, real narrative providers, creator metrics, notification retention, admin dashboards, deployment, observability, and the whole frontend. The full list is `docs/CONTINUATION.md` section 3.

## Next

Backlog order is in `docs/CONTINUATION.md` section 5. **B5 is staged: `docs/SECURITY_REVIEW_PLAN_B5.md` is approved and B5a (dry run) is built and merged. B5b (signing for the owner's wallet only, a tiny hard cap) needs the owner's separate go-ahead after they have read the dry-run output (`docs/B5A_RUNBOOK.md`). Do not write signing, sending or key-handling code before that.** B9 (admin and operations) is built.

## Entitlements checkpoint

See `docs/ENTITLEMENTS.md`. Stages 1–5 implement research entitlements, wallet proof verification, Wyntrax ingestion, research gating and reconciliation. Entitlement operations never change mode, trading permissions, execution controls or risk. This branch verifies only against localhost:5432/narra_ent and Redis /5, with API port 4010; use the guarded `apps/api/scripts/scratch.cjs` runner. Existing rules above remain in force.

### Entitlements Checkpoint C
Checkpoint C was approved with conditions; review evidence is archived outside the repo at `C:\dev\narra-entitlements-review`. Enforcement defaults OFF; age controls default 0. Test-only Ed25519 challenge signing was explicitly approved to verify the real lifecycle; production remains verification-only. Preserve own-data/safety access and trading non-escalation. Stop after the requested cleanup/readiness verification; no push or merge.
