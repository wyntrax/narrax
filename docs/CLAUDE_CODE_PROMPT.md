# Prompts for Claude Code

Claude Code reads `CLAUDE.md` in the repo root automatically. These prompts add the task for each session. Paste one into Claude Code from the repo root (`C:\dev\narra`).

Before the first session:
1. Put the **original product spec** at `docs/product-spec.md` (it is not in this repo). Without it, Claude Code must ask before building anything the spec defines.
2. Copy `.env.example` to `.env` and fill in only the keys you want Claude Code to be able to test with. Never paste keys into the chat. Claude Code must not commit `.env` or print its values.
3. Run `docker compose up -d`.

Recommended order: **Session 1 (verify and stabilize)**, then **Session 2 (B4)**, then B5 onward, with the frontend track in parallel after B4.

---

## Session 1: verify and stabilize (do this before building anything new)

The earlier phases (B1 to B3) were written by an assistant that had no network, no Docker and no real test runner. They were checked only with fakes. This session replaces that guesswork with real checks.

```
Read CLAUDE.md, README.md and docs/CONTINUATION.md first.

This session builds nothing new. Its job is to find out what actually works and fix what does not.

1. SETUP AND TESTS
   - Run the setup and test commands from CLAUDE.md. Report the exact result: tests passed, failed, and SKIPPED. A skipped integration test is not a pass; if any are skipped, find out why and fix the cause.
   - Run `npm run typecheck`. Fix every error.
   - Fix regressions properly. Do not weaken, delete or skip a test to get green. If a test is wrong, explain why before changing it.
   - Commit `package-lock.json` after `npm install` (workspaces were added in B1 and B3).

2. MIGRATIONS
   - Migrations 0004_tracked_wallets and 0005_position_evaluations were written by hand. Run `prisma migrate diff` as described in CLAUDE.md. If it prints anything, regenerate the migration with `prisma migrate dev`, apply it, and rerun the tests.

3. LIVE CHECKS OF EXTERNAL ASSUMPTIONS
   For each item, call the real service (curl or a small script under scripts/, never committing keys), compare the real response with what the code assumes, and fix the code or the Zod schema if they differ. Add a recorded sample response as a test fixture where useful (remove any secrets). Do not invent an API shape: if you cannot verify something, say so and keep it behind a named option.
   - DEX Screener: GET https://api.dexscreener.com/tokens/v1/solana/<mint> for a real recent mint. Check pairs, priceUsd, liquidity.usd, volume.h24, marketCap, fdv, pairCreatedAt (packages/market-data/src/dexscreener.ts).
   - GeckoTerminal: new_pools?include=base_token and tokens/<mint>/info. Check the holders fields, mint_authority and freeze_authority (find a token whose authority is renounced and see exactly how it is spelled), is_honeypot, and that the keyless tier returns the holder fields (packages/market-data/src/geckoterminal.ts).
   - Helius (needs HELIUS_API_KEY and HELIUS_RPC_URL; ask me before creating or editing a real webhook): list webhooks; confirm the create and edit bodies in packages/solana/src/heliusWebhooks.ts are accepted, that editing accountAddresses REPLACES the list, and that a delivered swap payload matches packages/solana/src/helius.ts (fee payer is the trading wallet; one leg is SOL or wrapped SOL).
   - RPC history: on two or three real wallets and two or three real young tokens, check that getSignaturesForAddress plus jsonParsed getTransaction finds the funding transfer you can see in an explorer, that an exchange funder is skipped by the fan-out rule, and that signatures for a mint actually include the early swaps and the fee payer is the buyer (packages/solana/src/funding.ts, workers/pipeline/src/walletDiscovery.ts).
   - Jupiter: base URL, and whether priceImpactPct is a fraction or a percent (JupiterClient has a priceImpactFormat option).
   - Privy: token claims the verifier expects (ES256, issuer privy.io, audience = app id, subject = user id) in apps/api/src/auth.ts.
   - LLM provider: the request format in packages/ai/src/openai.ts (response_format json_object, reasoning_effort) against the provider I use. Run the position-review prompt and the opportunity pipeline once each on a few hand-made hostile token names and confirm the output stays inside the schemas.
   Record every result in a new docs/VERIFIED.md as a table: item, how it was checked, date, result, what was changed. List anything you could not check and why.

4. SMALL FIXES
   - POST /v1/risk/evaluate is an unauthenticated dev route. Make it admin-only (or remove it).
   - Triage `npm audit`: fix what is safe, list what is not and why.

5. FINISH
   - npm test and npm run typecheck pass, with zero unexplained skips.
   - Update CLAUDE.md "State" and docs/CONTINUATION.md section 2 (tick what is verified, leave the rest).
   - Final message: what passed for real, what you fixed, what is still unverified, and whether it is safe to start B4.
```

---

## Session 2 and later: build a phase

```
Read CLAUDE.md, README.md and docs/CONTINUATION.md, then docs/product-spec.md if it exists. Read the existing code for the area you will touch before writing anything.

Build phase [B4 | B5 | B6 | B7 | B8 | B9 | B10]. If I do not choose, build B4. The phases are defined in docs/CONTINUATION.md section 5. For B4 use the brief below.

Before coding, write a short plan: files to add or change, schema changes and migrations, the tests you will write, and the questions you need answered. Ask me only for things you truly cannot decide (API keys, provider choices, business rules from "Open decisions" below). For everything else, decide, write the decision down, and keep it behind a named constant or a setting.

Follow every rule in CLAUDE.md. In particular: no model output reaches a transaction, fail closed, untrusted text stays untrusted, no keys stored, user limits only stricter, recommendations are not actions, and be honest about what is tested.

Standards: pure logic in packages with unit tests; anything that writes gets an integration test against real Postgres and Redis (random tags, clean up in afterAll); schema changes use `prisma migrate dev`; typecheck and the whole suite pass before you finish; no test weakened.

Work in small steps and tell me when a step is done. Finish by updating README.md (what the phase does, its limits, what is next), CLAUDE.md "State" and "Next", and docs/CONTINUATION.md (move finished items out of section 3). Your final message must list: what was built, what ran for real, what was only simulated, assumptions still unverified, and the recommended next phase.
```

### B4 brief: fan-out, paper trading and semi-auto

Goal: turn a global AI decision into per-user, safe, idempotent outcomes, and create the positions the B3 monitor watches. **Nothing in B4 sends a real transaction.** The Executor stays unwired until B5.

What exists to build on: `AgentDecision` rows are global (`userId` null) and carry action, confidence, suggested size, entry limits and exit rules. `packages/risk` has `evaluateRisk` and the route mapping (SHADOW to LOG_ONLY, PAPER to SIMULATE, SEMI_AUTO to AWAIT_CONFIRMATION, AUTO to EXECUTE). `packages/queue` has `ExecutionJobSchema` and `enqueueExecution`. `workers/pipeline/src/execution.ts` has `processExecution`, which ends in `execution_disabled`, `simulated` or `awaiting_confirmation` and writes nothing. `captureEntryContext` and the monitor are in `workers/pipeline/src/positionMonitor.ts`. `Order`, `ExecutionAttempt`, `Trade`, `Position` and `PortfolioSnapshot` exist in the schema and are never written.

Build:
1. **Entry fan-out job.** For each recent BUY `AgentDecision` (ignore decisions older than a limit), for each eligible user, build an `ExecutionJob` with idempotency key from decision id and user id, then enqueue. Eligibility and sizing come from the user's risk profile, trading permission (AI access on, not paused, not revoked, delegation unexpired for SEMI_AUTO and AUTO) and tradable balance. A missing balance, price or quote means no job for that user. Users in SHADOW get a logged shadow outcome only.
2. **Outcome handlers for `processExecution`.** `simulated` writes a paper `Order`, `Trade` and `Position`. `awaiting_confirmation` writes a pending confirmation. Nothing else is written for `execution_disabled`.
3. **Paper fills.** Price from a fresh Jupiter quote including price impact, plus a fixed fee estimate (named constant, unvalidated). No fresh quote means no fill. Every paper row is clearly marked simulated.
4. **Positions.** When a position opens, call `captureEntryContext` with the decision's exit rules. If it throws, no position is opened. One open position per token per user.
5. **Semi-auto confirmations.** A new table for pending confirmations with expiry. `GET /v1/confirmations`, `POST /v1/confirmations/:id/confirm`, `POST /v1/confirmations/:id/reject`. Confirm re-runs the Risk Governor with a fresh quote and fresh state before enqueueing, and a confirmation can be claimed once even if two requests race. Expired confirmations cannot be confirmed. A user can only see and act on their own.
6. **Exit fan-out job.** For each open position whose latest `PositionEvaluation` is REDUCE or SELL and has not been acted on, enqueue an exit job (idempotency key from the evaluation id). Track partial exits so a take-profit REDUCE is not repeated for the same condition (this fixes the known B3 limit). In PAPER mode simulate the exit and write the closing `Trade` with `realizedPnlSol`.
7. **Realized PnL and snapshots.** Fill `Trade.realizedPnlSol` on sells so the daily-loss check works, and add a job that writes `PortfolioSnapshot` so the drawdown check can fire.
8. **Risk Governor for exits.** Exits reduce risk, so a daily-loss or drawdown limit must not block them. Buys can still be blocked. Add tests for exactly this.
9. **Tests.** Idempotency (same decision and user twice makes one job and one position), race on confirm, expiry, a stale decision, missing balance, paused agent, revoked AI access, SHADOW logging, stricter user limits, paper fill math, partial-exit tracking, exits not blocked by loss limits, and cross-user isolation on every endpoint.

Out of scope for B4: any real Executor, Privy delegated signing, Jito, wallet creation, withdraw, exit-all. Those are B5 and need a security review plan first.

### Open decisions (suggested defaults; ask me only if you disagree)

| Decision | Suggested default |
|---|---|
| Exits in SEMI_AUTO | Need confirmation, with a CRITICAL notification. AUTO executes (from B5). PAPER simulates immediately. |
| Confirmation expiry | 5 minutes |
| Agent paused | Stops new buys and automated exits. Alerts continue. Manual exit stays available. |
| Position sizing | Smallest of: decision size percent of tradable balance, profile max per trade, remaining daily allocation |
| Stale decision limit | Ignore a BUY decision older than 10 minutes at fan-out |
| Paper fee estimate | One named constant in SOL, documented as unvalidated |
| Duplicate token | One open position per token per user |

---

## Frontend session (any time after B4)

```
Read CLAUDE.md, README.md and docs/CONTINUATION.md. The design to match is design/prototype/narra-prototype.html (mock data, approved by me). The product spec is docs/product-spec.md.

Build frontend phase [F1 | F2 | F3 | F4 | F5 | F6]. If I do not choose, build F1. Phases are defined in docs/CONTINUATION.md section 5.

Stack: Next.js 15 App Router, React, TypeScript strict, Tailwind, shadcn/ui, Framer Motion (restrained), lightweight-charts, TanStack Table and Query, Zustand only where needed, Lucide, Privy login (Google, wallet, embedded wallet). App in apps/web, shared UI in packages/ui. No long-running logic in Next.js request handlers.

Design: dark first with a polished light theme, tokens as CSS variables, restrained accent (#B8FF4F primary, #78E8FF secondary) used only for important signals, active navigation, status, selected rows and calls to action. Rajdhani for display text and numbers, Barlow for body, tabular numerals for every metric. Brand name from one place (PROJECT_NAME), never hard-coded. App shell: collapsible sidebar, global intelligence bar, workspace, collapsible right panel. Mobile: bottom navigation, stacked cards instead of tables, full-screen agent sheet. A different composition per page, not identical card grids. No glow or pulsing. Contextual empty states, skeleton loading, a LIVE marker on real-time sections, accessible controls and keyboard support.

Data: use the real API in apps/api (routes are listed in docs/CONTINUATION.md). Where an endpoint does not exist, build against a typed client with a clearly marked mock adapter, list the gap in MISSING_API.md, and define response shapes as Zod schemas shared with the API. Never put secrets in the browser. Privy tokens are sent as bearer tokens.

Safety in the UI: emergency controls (pause agent, exit all, revoke AI access, withdraw) stay reachable even when other requests fail, each with a clear confirmation. AI decisions and OG scores are shown with confidence and caveats, never as certainty. Attention-price divergence is a description, never a prediction. Token names, symbols and narrative text are untrusted: render as text only. Show monitor evaluations as recommendations, including what could not be checked (the `unavailable` list).

Write a short plan first (routes, components, data hooks, what is mocked). Finish with: typecheck and lint pass, component and end-to-end tests for the main flows, pages match the prototype on desktop and mobile in both themes, and a final message that says what is real, what is mocked, and which endpoints are still needed.
```
