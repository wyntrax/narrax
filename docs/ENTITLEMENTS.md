# Early access and Wyntrax entitlements

**Status: Checkpoint A approved with conditions; Stages 1–3 implemented for Checkpoint B review. Stage 4 enforcement is not implemented.**
2026-10-07. Baseline: `4120916` (`main`), worktree `C:\dev\narra-entitlements`, branch `entitlements`. CONTRACT v1 supplied by the owner is authoritative. This document proposes NARRA implementation and product mapping; it does not amend that contract.

## 1. Invariants and scope

v1: MEMBER reserved; Wyntrax sends NONE, PRO, ELITE.

### Approved MEMBER reassignment (Checkpoint C work)

The owner approved the proposed table via the in-session question before any map change. The wire contract/schema still accept MEMBER.

| Previous MEMBER feature | Routes / alternate surfaces | Approved live minimum |
|---|---|---|
| research.screener | GET /v1/tokens with filters/sort | PRO |
| research.rotation | GET /v1/narratives/rotation; overview rotation | EARLY_ACCESS |
| research.opportunities | GET /v1/opportunities; overview opportunity; opportunity/decision realtime and chat reads | PRO |
| research.smart_money | GET /v1/smart-money/wallets; search wallet hits; consensus realtime | PRO |

- Tier order: `NONE < EARLY_ACCESS < MEMBER < PRO < ELITE`. BASIC means the features assigned to EARLY_ACCESS below, not another tier.
- Wyntrax alone determines token balances and membership eligibility. Its wire tiers are exactly `NONE | MEMBER | PRO | ELITE`; reject everything else, including EARLY_ACCESS. Chain is exactly `solana` in v1. Addresses remain case-sensitive base58 throughout storage, lookup, audit and response.
- Signed-in users must explicitly join early access and have a verified linked wallet. An imported Wyntrax wallet never creates a NARRA wallet link or user.
- **Entitlement operations cannot write `User.mode`, `TradingPermission`, `RiskProfile`, execution allowlists, the kill switch, trading pause, risk settings, or execution records/queues.** A wallet link grants no custody, delegation or trading authority. It is separate from existing `Wallet` (MAIN/TRADING) and `TrackedWallet` records.
- Authentication, account safety controls, closing positions, exits, withdrawals, and reading/exporting one's own data are entitlement-independent. Existing authentication, ownership checks, risk checks and abuse limits still apply.
- Unknown sources, missing verified matches, revoked grants, expired validity and unknown feature keys grant nothing. Default resolver result is NONE. Enforcement initially being OFF is an explicit rollout switch, not an access source.
- No public endpoint lists memberships, looks up arbitrary membership wallets, or discloses another account's identity. Tier never implies `isAdmin`.

## 2. Repository findings and placement

Read: `CLAUDE.md`, `docs/CONTINUATION.md`, `docs/SECURITY_REVIEW_PLAN_B5.md`, README, API auth/account/admin/app, route implementations, HTTP handling, Prisma schema/migrations, settings/audit usage, pipeline bootstrap, queue schedulers and realtime `EVENT_DEFS`.

| Existing mechanism | Integration decision |
|---|---|
| `makeAuthenticate` verifies Privy and resolves a local user; `makeRequireAdmin` checks `isAdmin` | Reuse these for local endpoints. The Wyntrax webhook has a separate HMAC boundary and never calls Privy authentication. Existing first-login user creation stays in auth, outside entitlement persistence. |
| `SystemSetting(key, value Json, updatedAt)` and `AuditLog(userId?, action, detail?, createdAt)` | Typed, exact-key entitlement settings; transactional mutation plus audit, following `adminOps.ts`. No arbitrary setting-key writer. |
| HTTP errors `{ error: CODE, requestId, ...details }`; route `config.rateLimit`; global 120/min | Return explicit status/error responses. The global error mapper turns thrown 5xx into 500, so webhook 503 must be explicitly sent. Preserve `x-request-id` and `retry-after`. |
| Pipeline `main.ts`, BullMQ `upsertJobScheduler`, workers with concurrency 1 | Register a dedicated reconcile queue/worker/scheduler there only. No pipeline process is started during development verification. |
| Queue factories live in `packages/queue` (outside approved edit scope) | Use existing BullMQ directly in the registration, shared queue-name constant, retention and one-attempt pattern. API enqueues the same dedicated queue through an injected port. No edits to `packages/queue` needed. |
| `EVENT_DEFS` lives in `packages/realtime` (outside approved edit scope) | Add no entitlement event type. REST is authoritative. Existing event delivery needs checks in `apps/api/src/gateway.ts`, including replay, without modifying the realtime package. |
| `@noble/curves` 1.9.7 and `bs58` 4.0.1 already in lockfile through web3.js | Reuse `ed25519.verify` and base58 decoding. Declare these existing packages directly in the consuming workspace; do not rely on accidental hoisting. This needs approval to update root `package-lock.json`. No signing API is used. |
| Existing executor isolation test forbids API/pipeline imports of web3.js or executor | Preserve it. The lightweight verification library avoids that forbidden dependency path. |

Planned locations:

- `packages/shared/src/entitlements/*`: pure resolver, feature registry, wire schemas, admission rules, constants and injectable-fetch partner client; no database, ambient env, queues or trading imports.
- `apps/api/src/entitlements/*`: narrow persistence adapters, wallet verification, webhook, account/admin endpoints, feature hooks and reconcile runner. Reconcile is a framework-independent leaf module imported directly by pipeline registration; it must not import `app.ts`, `server.ts` or the pipeline package (avoid bootstrap cycles).
- `packages/database/prisma`: additive schema and migration only; database package remains a client/schema package.
- `workers/pipeline/src/main.ts`: dedicated scheduled-job registration and shutdown only; no reconciliation logic or changes to existing jobs.
- `docs`: design, checkpoint evidence and continuation notes. README/CLAUDE updates require explicit scope permission because they are outside the user's allowed areas.

## 3. Proposed data model

Use existing Prisma conventions: cuid IDs where appropriate, `DateTime`/TIMESTAMP(3), explicit indexes, foreign keys and cascade deletion for owned records. No backfill from existing Wallet addresses: those rows are not this proof-of-control flow.

| Model | Proposed fields and constraints |
|---|---|
| `LinkedWallet` | `id`, `userId -> User`, `chain`, `address`, `verifiedAt`, `createdAt`; unique `(chain,address)` across all users; index `userId`. Rows represent verified links only. Delete on unlink, retain audit. Chain/address validated before insert; compare exact case. Max 5 enforced transactionally, not by an in-memory count. |
| `WalletLinkChallenge` | `id`, `userId -> User`, `chain`, `address`, `domain`, `nonceHash` unique, `messageHash`, `issuedAt`, `expiresAt`, `consumedAt?`; index `(userId,expiresAt)` and expiry cleanup index. Store hashes rather than signature/nonce/plain message. Verification request returns the exact message supplied by the challenge endpoint; hash and all server-bound fields must match. |
| `WyntraxMembership` | `wyntraxUserId` primary key, `tier` (wire-tier enum), `version` (BigInt in storage; safe integer at JSON boundary), `validUntil?`, `balanceSnapshotAt?`, `sourceUpdatedAt`, `receivedAt`, `lastEventId?`, `lastTransport` (`WEBHOOK`/`RECONCILE`); expiry and source-update indexes. Keep NONE/expired rows and version tombstones so old state cannot restore access. No User foreign key. |
| `WyntraxMembershipWallet` | `id`, `wyntraxUserId -> WyntraxMembership`, `chain`, `address`; unique `(wyntraxUserId,chain,address)`, index `(chain,address)`. Replace the full member wallet set atomically on each accepted higher version. Max 10 from the wire. Do not assume Wyntrax guarantees global uniqueness across different members: match valid records and take their maximum tier. |
| `AccessGrant` | `id`, `userId -> User`, `source` (`EARLY_ACCESS`/`ADMIN`), `tier`, `status` (`ACTIVE`/`REVOKED`/`EXPIRED`), `validUntil?`, `createdAt`, `updatedAt`, `revokedAt?`, `createdBy?`, sanitized `reason?`; unique `(userId,source)` with lifecycle changes preserved in audit; index `(source,status,validUntil)`. Proposed v1 local grants, including ADMIN, are restricted to EARLY_ACCESS (see approval decisions). |
| `WebhookEvent` | `id` = event ID primary key, `wyntraxUserId`, `version`, `bodyHash`, `occurredAt`, `receivedAt`, outcome `APPLIED`/`STALE`; index `(wyntraxUserId,version)` and received time. Only authenticated, schema-valid events are inserted. Duplicate deliveries reuse the original row. No raw payload, signatures or secrets. Keep IDs for v1; retention needs a later reviewed policy. |
| `InviteCode` / `InviteRedemption` (optional Stage 6) | Hash-only high-entropy code, expiry, max uses, disabled flag; redemption unique `(inviteId,userId)` and transactional use count. No table or endpoint until separately approved. |

The partner response's explicit field list omits `balanceSnapshotAt` and `occurredAt`: accept the listed fields without inventing a snapshot timestamp; persist snapshot as unknown/null for a newer reconciliation state unless explicitly provided and validated. Use partner `updatedAt` as sourceUpdatedAt and webhook `occurredAt` for that metadata. Neither timestamp overrides version ordering. This is transport adaptation, not a contract change.

### Settings (all values validated, all admin changes audited)

| SystemSetting key | Default / semantics |
|---|---|
| `entitlements.enforced` | `false`; explicit boolean. |
| `entitlements.shadow_log` | `true`; log would-be denials when enforcement is off; never blocks. |
| `entitlements.feature_overrides` | `{}`; registry feature keys only, values EARLY_ACCESS/MEMBER/PRO/ELITE. Cannot add keys, grant admin/trading rights, or gate always-open data/control paths. Cannot lower a feature below the maximum requirement of the research data it includes. |
| `early_access.enabled` | `false`; turns local early-access eligibility off for resolution as well as admission. Does not revoke Wyntrax. |
| `early_access.seat_cap` | `0`; nonnegative integer, zero admits nobody. Owner must select a capacity before enabling. |
| `early_access.invite_required` | `false`; while Stage 6 is absent, true fails closed for new joins (invite capability unavailable). Existing seats remain valid. |
| `entitlements.wallet_link_domain` | Required trusted, admin-configured application origin/domain; no fallback to request Host. Missing/invalid means challenge creation unavailable. Changed domains invalidate outstanding challenges. Local development value can name localhost:4010. |
| `entitlements.wyntrax_reconcile_state` | Internal-only validated checkpoint: completed watermark, in-progress run upper bound/cursor if needed, last success, sanitized failure code. Not writable through the settings API. Never contains key, URL query credentials or membership payload. |

Missing rollout flags use the documented defaults. Malformed flags/settings are an unavailable configuration for research gates; they must never silently turn enforcement off. Always-open paths do not load entitlement state. A settings read failure cannot be treated as an empty settings table. Unknown override keys/tiers are rejected on write and fail closed on read.

## 4. Resolution, admission and revocation

`resolveEntitlements(snapshot, now)` is pure: no DB, env, clock read, mutation or network. Callers load a consistent snapshot of the authenticated user's verified links, local grants, matching memberships and validated settings.

1. Start at NONE. Deduplicate exact `(chain,address)` keys, only verified Solana links owned by the requested user count.
2. An ACTIVE local EARLY_ACCESS grant counts only if enabled, at least one verified link exists, and `validUntil` is null or strictly later than now. ADMIN grants obey the same eligibility under this proposed v1 policy.
3. Find memberships whose current wallet set intersects those verified links. A membership for an unlinked wallet grants nothing. Known non-NONE tier requires `validUntil > now`; equality means expired. Revocation is tier NONE. Unknown/malformed data is ineligible.
4. Effective tier is the maximum of eligible local early access and eligible matching Wyntrax tiers, never a sum of balances or memberships. Multiple wallets can match multiple members; deduplicate source entries.
5. Return effective tier, sanitized contributing sources/reasons, next expiry and each registered feature's policy `allowed`/`requiredTier`. Report policy access separately from runtime `enforced`/`shadowLog` flags. Do not return other wallets on a matching Wyntrax account to the end user.
6. Admin status confers management permission only; no implicit research-tier bypass. Unknown feature keys fail closed.

The resolver does not allocate a seat. A separate pure admission decision accepts enabled/cap/occupied/hasVerifiedWallet/alreadyJoined/invite state; I/O enforces that decision atomically:

- Explicit join under a transaction-level advisory lock for early-access capacity; all joins, local admin grants/revokes and cap/enable changes take the same lock. Lock/recheck the user's link state before admission. This serializes competing final-seat claims.
- A used seat is one distinct USER with at least one ACTIVE, unexpired **EARLY_ACCESS-tier** AccessGrant, source EARLY_ACCESS or ADMIN. Two sources and five linked wallets still count once. A user who also holds a valid Wyntrax tier **still occupies that one seat**. A Wyntrax-only user with no such local grant occupies zero seats. Revoked or expired grants do not count. An already seated user may retry idempotently at capacity. No hidden unbounded auto-enrollment.
- Reducing the cap stops new admission; it does not evict existing seats. Disabling suppresses local benefits but keeps seat reservations. Unlinking the last wallet suppresses local benefits; the reservation remains until revoke/leave/expiry. This prevents silent churn in who wins seats.
- Leave revokes the caller's EARLY_ACCESS self-join grant; ADMIN grants require an admin revoke. Revoke removes that source, not an unrelated valid Wyntrax grant. No global negative override is introduced.
- Admin-issued grants use the same wallet, enable and seat checks. Finite expiry required for ADMIN grants, reason required; self-join may have null expiry. Rejoining requires admission checks again.
- HTTP resolves fresh per request; no cross-request positive cache in v1. Expiry is checked on reads, independent of whether the sweep job runs.

## 5. Wallet proof flow

Challenge: `{ chain:"solana", address }` under authenticated local user. Validate base58 alphabet, decode to exactly 32 bytes, preserve the original canonical address. Use 32 random nonce bytes, five-minute TTL, one outstanding challenge per user/address, at most five outstanding per user. New challenge invalidates the previous one for that pair.

The UTF-8 message has a fixed format/version and includes **domain, nonce, userId, chain, address, issuedAt and expiresAt**, plus an explicit statement that it only links a wallet for NARRA access and authorizes no transaction. Return `{ challengeId, message, expiresAt }`. Domain comes from trusted configuration, never an inbound host header.

Verify accepts `{ challengeId, message, signature }`, with signature in canonical base58 decoding to exactly 64 bytes. Compare stored message/nonce hashes and bound fields; verify Ed25519 over the exact message bytes with the stated address. Reject malformed points/signatures and use strict verification rather than permissive ZIP-215 acceptance. No message signing or transaction functionality is added.

Inside one transaction, serialize per-user linking, re-read challenge owner/address/domain/expiry, conditionally consume `consumedAt IS NULL AND expiresAt > now`, check the five-link limit and unique address, insert the link and audit. Concurrent attempts cannot reuse a nonce or exceed five links. A failed transaction creates no partial link; failed signature attempts are rate-limited. On unlink, invalidate outstanding challenges for that user/address to prevent an old proof from undoing an unlink. Admin removal also invalidates challenges; the next owner must obtain and verify a fresh challenge.

Already linked to another user: generic 409 `WALLET_UNAVAILABLE`, with no owner information. Ownership moves only after current owner unlink or audited admin removal; never upsert a link's owner based on a new signature or webhook. Cross-user IDs return 404. Every successful link/unlink and admin removal has a transactional audit entry.

## 6. Webhook and shared state application

`POST /v1/integrations/wyntrax/events` is an encapsulated Fastify plugin with its own JSON content parser returning a bounded Buffer before parsing JSON. Limit is **16,384 raw bytes**. Do not replace the app's parser or reserialize the body for HMAC. Refuse unsupported content encoding/media type as invalid payload at this boundary; enforce body size for chunked input as well as Content-Length.

Processing order:

1. Apply route-specific rate limit before expensive work. A missing/empty primary `WYNTRAX_WEBHOOK_SECRET` returns explicit 503; the previous secret alone cannot enable the endpoint. Register it even when unconfigured so callers receive 503 rather than 404.
2. Require single-valued timestamp/event-ID/signature headers. Timestamp must be Unix integer seconds with `abs(nowSeconds - timestamp) <= 300`. Signature syntax is exactly `v1=` plus 64 lowercase hex characters. Wrong/missing timestamp or signature => 401.
3. HMAC-SHA256 over timestamp ASCII bytes, dot byte, exact body bytes. Compute with primary and, when configured, previous secret. Check lengths before `timingSafeEqual`; accept either secret, avoid short-circuit comparison timing between rotation keys. Never log keys/signatures/raw request headers or signed payloads.
4. Parse and validate full state: membership.updated, integer safe version, known tier, ISO timestamps, wallet list max 10, Solana chain and valid 32-byte base58 addresses, body.id equals event-ID header. Non-NONE requires non-null validUntil. NONE accepts null or omission of validUntil per the contract. Empty wallet list is valid and grants nothing. Validate bounded inputs within the 16 KB ceiling without case conversion.
5. Transactional `applyMembershipState`: serialize per wyntraxUserId (including first insert), deduplicate event ID globally, compare version, and atomically replace state/wallets plus event outcome plus audit. Event-ID uniqueness races are handled as duplicates. Record stale event IDs too. Equal version with a different event ID is stale, never a refresh. Gaps in versions are accepted because payloads are full state; timestamps do not break ties.
6. Commit before returning 200 `{ "ok": true, "status": "applied" | "duplicate" | "stale" }`. DB failure rolls back event receipt and state, returns sanitized 5xx so the sender can retry. A reused ID with different authenticated bytes never overwrites state; return duplicate and record a sanitized collision alert/code.

Errors: 400 invalid payload, 401 authentication/timestamp failure, 413 oversized body, 429 route throttling, 503 unconfigured (or temporary persistence unavailability). Error body follows `{error,requestId}`. A malformed event-ID/body mismatch is 400 after HMAC authentication. Simultaneous failures may hit an earlier size/rate guard first.

Contract vector was reproduced in Stage 0 with Node `createHmac`: timestamp `1791300000`, literal test secret `test_secret_do_not_use`, body exactly 326 UTF-8 bytes, resulting header:

`v1=6141047924a05e769a4834f1899203a62f4484e2e21c6f61cac9f0aeb2581bd0`

Stage 3 commits the exact compact body fixture and timestamp-injected tests. The vector's validUntil is more than 72 hours after occurredAt: reproduce it unchanged. The contract makes 72-hour capping a **sender obligation**, not a receiver rejection rule; NARRA honors the signed validUntil and expires it on reads. No extra receiver clamp is invented.

## 7. Endpoint list and authorization

All `/v1/me/*` below require Privy auth, are scoped to `req.userId`, and are always-open for entitlements. Admin routes use `makeRequireAdmin` and never depend on a research tier. Rates are proposed initial per-IP limits, supplemented with per-user/database concurrency bounds; tune after observing usage.

| Method / path | Authorization and behavior | Initial rate |
|---|---|---|
| POST `/v1/me/linked-wallets/challenge` | Auth; wallet proof challenge, no automatic grant | 10/min |
| POST `/v1/me/linked-wallets/verify` | Auth; single-use proof and atomic link | 20/min |
| GET `/v1/me/linked-wallets` | Auth; own verified links only | 60/min |
| DELETE `/v1/me/linked-wallets/:id` | Auth; own unlink, audit | 10/min |
| POST `/v1/me/early-access/join` | Auth + verified link + admission policy; idempotent retry | 5/min |
| DELETE `/v1/me/early-access` | Auth; revoke own EARLY_ACCESS source, audit | 5/min |
| GET `/v1/me/entitlements` | Auth; effective tier, own sources/links, feature allowed flags, rollout state | 60/min |
| POST `/v1/integrations/wyntrax/events` | HMAC only; independent of Privy/tier/admin | 120/min dedicated bucket |
| GET/PUT `/v1/admin/entitlements/settings` | isAdmin; exact writable-key allowlist, update reason, atomic audit | 30/min |
| GET `/v1/admin/users/:userId/entitlements` | isAdmin; source-by-source trace, eligibility/expiry reasons | 30/min |
| POST `/v1/admin/users/:userId/entitlements/grants` | isAdmin; manual local grant with reason and expiry; admission checks | 10/min |
| POST `/v1/admin/users/:userId/entitlements/grants/:id/revoke` | isAdmin; revoke local grant with reason, audit | 10/min |
| DELETE `/v1/admin/users/:userId/linked-wallets/:id` | isAdmin; audited removal with reason; cannot assign the next owner | 10/min |
| POST `/v1/admin/entitlements/reconcile` | isAdmin; enqueue bounded reconciliation, audit; 503 if disabled | 1/min |
| GET `/v1/admin/early-access/stats` | isAdmin; counts only (occupied, active, expired, revoked, available), no members/wallets | 30/min |

Secrets remain env-only: `WYNTRAX_WEBHOOK_SECRET`, optional `WYNTRAX_WEBHOOK_SECRET_PREVIOUS`, `WYNTRAX_API_BASE_URL`, `WYNTRAX_API_KEY`. Admin settings and status never echo them.

## 8. Feature-to-tier map: actual route inventory

**Approved target for Stage 4; not yet enforced at Checkpoint B.** Always-open means no entitlement gate, not anonymous access. Existing auth/admin/HMAC requirements remain. Route groups below cover registrations in `app.ts`, including loop-generated account routes. Automatically generated HEAD routes inherit GET behavior; OPTIONS carries no feature data.

| Existing routes / group | Class / feature | Notes |
|---|---|---|
| GET `/health`; POST `/webhooks/helius`; POST `/v1/risk/evaluate` | Always-open | Preserve operational/provider authorization. Risk evaluate is currently unauthenticated dev-only code: existing deployment issue, not a paid feature or a change in this phase. |
| GET `/v1/me`; PUT `/v1/mode`, `/v1/ai-access`, `/v1/risk-profile`; POST `/v1/ai-access/revoke`, `/v1/agent/pause`, `/v1/agent/resume` | Always-open | Tier is never consulted by trading or risk control handlers. |
| GET `/v1/me/wallets`, `/v1/me/wallets/balances`, `/v1/positions`, `/v1/trades`, `/v1/trades/export` | Always-open | Entire existing own-data payloads, including position evaluations and prices. |
| GET `/v1/confirmations`; POST `/v1/confirmations/:id/confirm`, `.../reject` | Always-open | Both ENTRY and EXIT stay independent of entitlement; existing execution checks continue. |
| GET `/v1/alerts`, `/v1/alerts/unread-count`; POST `/v1/alerts/:id/read`, `/v1/alerts/read-all` | Always-open | Already-delivered notifications belong to the user, including global-origin notifications. Never remove safety/critical alerts. |
| GET `/v1/settings`; PUT `/v1/settings/profile`, `.../appearance`, `.../notifications`, `.../interests` | Always-open | Own preferences. |
| GET `/v1/analytics/me/performance`, `/v1/analytics/me/equity` | Always-open | Own history, fees, PnL and snapshots. |
| GET `/v1/chat/conversations`, `/v1/chat/conversations/:id`, `/v1/chat/proposals`; POST `/v1/chat/proposals/:id/apply`, `.../reject` | Always-open | Own stored conversations/proposals and existing caution controls; no automatic proposal apply by entitlement code. |
| GET `/v1/narratives`, `/v1/narratives/:slug` | EARLY_ACCESS / `research.narratives` | Existing narrative list/detail. |
| GET `/v1/tokens` ordinary list/text query; GET `/v1/tokens/:mint` | EARLY_ACCESS / `research.tokens` | Includes the currently returned basic token metrics/risk/consensus snapshot; detailed wallet analytics are a different feature. |
| GET `/v1/intelligence-bar` | EARLY_ACCESS / `research.overview` | Existing global summary counts/flow/heat. |
| GET `/v1/tokens` with existing `isScreenerRequest` filters/sort | MEMBER / `research.screener` | Select feature after validated query, not by a client-supplied tier/feature flag. |
| GET `/v1/narratives/rotation` | MEMBER / `research.rotation` | Existing windows 1h/6h/24h/7d. |
| GET `/v1/opportunities` | MEMBER / `research.opportunities`, mixed-data exception below | Shared ranking and global decision hints; preserve caller-owned decisions at NONE. |
| GET `/v1/smart-money/wallets` | MEMBER / `research.smart_money` | Existing tracked-wallet leaderboard. |
| GET `/v1/opportunities/:id/analysis` | PRO / `research.analysis`, mixed-data exception below | Shared AI bull/bear/risk/guardrail analysis. An existing user-specific decision remains readable. |
| GET `/v1/wallets/:address`, `/v1/wallets/:address/trades` | PRO / `research.wallet_detail` | Existing tracked-wallet funding/cluster/performance/history. If address belongs to the caller through an existing user-scoped Wallet or verified LinkedWallet, allow reading its existing detail/history without a tier; no new tracking is triggered. |
| GET `/v1/analytics/decisions/summary`, `/v1/analytics/decisions/outcomes` | PRO / `research.decision_analytics` | Global outcome measurements, not the user's own PnL. |
| GET `/v1/analytics/signals`, `/v1/analytics/backtest-summary` | ELITE / `research.advanced_analytics` | Existing reason-code attribution and saved-backtest headline. Full reports stay admin-only. |
| POST `/v1/chat` | ELITE / `research.chat` | New AI turn, existing tools and budgets. Reading/exporting stored own data needs no chat purchase. Per-tool access checks below prevent override bypass. |
| GET `/v1/overview` | Always-open envelope; research fields use their corresponding features | Preserve `me` counts; see mixed-data handling. |
| GET `/v1/search` | Always-open envelope; research fields use corresponding features | Preserve MY_TRADE results; see mixed-data handling. |
| GET `/v1/stream` | Always-open authenticated connection/private `me`; public research events use corresponding features | Never gate private events or safety alerts. Apply same filtering to live delivery and replay. |
| GET `/v1/admin/connections`, `/v1/admin/dry-runs`; GET/PUT `/v1/admin/executor/kill-switch`, `/v1/admin/ai-models`; PUT `/v1/admin/ai-enabled` | Always-open, isAdmin | Entitlement admin API has no path to invoke these mutations. |
| GET/POST `/v1/admin/wallets`; POST `/v1/admin/wallets/import`; PATCH `/v1/admin/wallets/:address`; GET `/v1/admin/wallets/sync-status`; POST `/v1/admin/wallets/sync`; GET `/v1/admin/wallet-candidates`; POST `/v1/admin/wallet-candidates/:address/approve`, `.../reject` | Always-open, isAdmin | Operations, not paid research capabilities. |
| GET/PUT `/v1/admin/system-limits`; POST `/v1/admin/system-limits/reset`; GET/PUT `/v1/admin/trading-pause`; GET `/v1/admin/blacklist`; PUT `/v1/admin/tokens/:mint/blacklist`; GET `/v1/admin/audit` | Always-open, isAdmin | No dependency on entitlements or entitlement settings. |
| GET `/v1/admin/status`, `/v1/admin/costs`; GET/PUT `/v1/admin/ai-pricing`; GET `/v1/analytics/backtests`, `/v1/analytics/backtests/:id` | Always-open, isAdmin | Preserve existing authorization, including analytics admin paths outside `/admin`. |

No withdrawal/exit-all route exists yet. Their future implementations must join the hard always-open allowlist, never the feature registry. The enforcement test must flag any new unclassified route for deliberate review.

### Mixed-data and alternate-path handling (part of Stage 4 approval)

Never put a blanket `requireFeature` hook on mixed groups. Split queries/response construction by ownership before shared-data access:

- **Overview:** always return `me` and timestamp. At eligible tiers include bar/top narratives (`research.overview` plus narratives), hottest opportunity (`research.opportunities`), rotation (`research.rotation`). Rebuild brief from allowed inputs only. Locked sections are explicitly marked in response metadata and null/empty, not represented as observed zero activity. Skip restricted queries.
- **Search:** MY_TRADE is always queried/returned for the caller. Tokens/narratives/creators need EARLY_ACCESS (respective token/narrative features); wallet leaderboard hits need MEMBER; TRACKED_WALLET transaction results need wallet-detail access, except caller-owned addresses established by user-scoped Wallet/LinkedWallet records. Do not leak restricted results through total counts, cursors or metadata.
- **Opportunities/analysis:** current queries can include `AgentDecision.userId = caller`, even though current pipeline decisions are normally global. Without the research feature, return only caller-owned decisions and their existing associated analysis context; list membership must require such a decision. Never fall back to a global decision for an ineligible caller. Empty own-only lists remain 200; inaccessible global-only detail is FEATURE_LOCKED. Own-data responses get no tier-dependent quota.
- **Realtime:** `notification.created`, `position.evaluated`, `confirmation.created`, `trade.created` retain existing owner isolation and are always delivered. `alert.created` stays open as a safety-notification surface. `narrative.updated` maps to narratives, `opportunity.created` and `decision.created` to opportunities, `consensus.updated` to smart-money, `market.sol` to tokens. In the API gateway, an ordered, bounded asynchronous egress adapter authorizes each research event from fresh state before sending; private/control events do not wait for entitlement reads. Apply at the final socket send boundary so replay, queued replay/live events and later revocation cannot bypass it. Drop denied events without closing private access; fail closed for research if resolution fails. Test ordering, backpressure and expiry while connected. No new EVENT_DEFS are needed.
- **Chat:** gate new turns before model calls. API-side agent-port wrappers check every research tool independently (`listOpportunities`, token/consensus fields, global recent decisions/outcomes, backtestSummary), including when an admin feature override lowers chat's minimum. Own-data tools remain ownership-scoped. Never let model text select a feature or user. Existing apply/reject handlers stay entitlement-independent.
- Already-delivered alerts, notifications and chat history remain user-owned records after a downgrade; do not redact historical own data. Those intentionally open surfaces may contain previously available research hints. Entitlements control fresh research access, not retroactive secrecy.

### Quotas and feature overrides

Propose tier-dependent page ceilings on **existing paginated shared-research lists** only: EARLY_ACCESS 20, MEMBER 40, PRO 70, ELITE 100 rows, further bounded by the route's existing maximum. Apply before queries and preserve correct cursor semantics. Authenticated but ineligible shared-data requests are denied when enforced. Pure resolver exposes these ceilings; always-open and own-only responses keep existing caps. These are page-size quotas, not a claim of daily usage metering.

Existing HTTP abuse limits, query scan ceilings and model token budgets remain safety ceilings at every tier. Per-tier AI daily usage is optional Stage 6 and needs separate approval; no new feature such as trading, wallet creation or report generation is invented to populate a tier.

`requireFeature(key)` executes after authentication and responds **403** `{ "error": "FEATURE_LOCKED", "requestId": "...", "requiredTier": "PRO" }` for a known locked feature. Unknown features/config faults fail closed with a sanitized configuration error rather than inventing requiredTier. Mixed routes use the same policy decision without blocking own fields.

## 9. Reconciliation (Stage 5)

- Enable only when both `WYNTRAX_API_BASE_URL` and `WYNTRAX_API_KEY` are nonempty. Require HTTPS, no URL credentials, no redirects (prevents bearer forwarding). Construct `/api/partner/narra/memberships` from the configured trusted origin. Keys never enter URL, logs, status or exceptions.
- GET uses Bearer auth, `limit=100` (never above 200), optional ISO updatedSince and opaque cursor. Validate items, nextCursor and timestamp/address/tier/version fields before any write. A wallet lookup supports exact case plus `chain=solana` for diagnostics/internal use; no public arbitrary-wallet lookup route.
- Every 15 minutes, concurrency 1; use a DB-level run lock across worker processes. Proposed bounds: 10-second request timeout, 3 attempts per page, exponential backoff with jitter and bounded Retry-After, 100 pages / 5 minutes per invocation, 1 MiB maximum response page. Retry only 429/5xx/network/timeouts. 400/401 are permanent configuration/contract failures and emit sanitized alerts. Repeated cursor/order violations abort, never advance checkpoint.
- Each item enters the **same version-ordered transactional state applicator** as webhooks, with RECONCILE provenance, no invented signed webhook/event ID. Webhook receipt table is only for real event IDs. Newer webhook wins over older page and vice versa; equal version is stale.
- Begin with full scan. For incremental scans, use last completed run's starting timestamp minus a documented overlap (5 minutes), preserve `(updatedAt,wyntraxUserId)` ordering and tie-safe opaque pagination. Advance watermark only after all pages succeed; partial progress is replay-safe. Persist resumable cursor/run state for bounded runs and do not replace the completed watermark with the maximum observed item timestamp. A scheduled periodic full scan repairs clock-skew/missed-update gaps. No deletion-by-absence; NONE is an explicit state.
- Sweep expired local AccessGrants in bounded batches with audits; retain membership version tombstones. Resolver expiry remains correct if job is disabled or crashes. Delete old consumed/expired challenge rows with a bounded retention policy; do not delete webhook dedupe IDs in v1.
- Admin trigger uses the same queue with a time-bucketed job ID, bounded frequency and audit. Queue failures return sanitized 503. Tests inject fake fetch/clock/scheduler/enqueue and never run pipeline/executor consumers.

## 10. Threat model

| Threat | Control / verification | Residual risk |
|---|---|---|
| Webhook spoofing / leaked secret | Raw-byte HMAC, strict headers, constant-time compare, HTTPS deployment, primary/previous rotation, missing primary => 503 | A compromised trusted Wyntrax signer can grant research until expiry; cannot grant trading. |
| Replay / event-ID collision | Five-minute timestamp window plus persistent unique event ID; atomic receipt/state/audit | Indefinite dedupe records grow; retention requires a reviewed policy. |
| Out-of-order / simultaneous events | Per-member serialization and strict increasing version, full wallet replacement, tombstones, same applicator for reconcile | Wyntrax must preserve monotonic version across restores. |
| Challenge nonce replay | Random nonce, exact message/hash binding, expiry, conditional consume in transaction; concurrent replay tests | Compromised session plus wallet signer can link legitimately. |
| Wallet theft/re-link | Strict Ed25519 control proof, trusted domain/user/address binding, unlink invalidates old challenges; admin removal audited | Signed-message phishing and compromised admin remain trust risks. |
| One wallet many accounts / link-cap races | DB unique `(chain,address)`, per-user serialization, five-link cap; no automatic reassignment | One person may own many different wallets; not a proof-of-personhood system. |
| Early-access seat races / abuse | Global capacity lock, idempotent per-user join, verified link, optional invite later | Sybil users can reserve seats; abandoned seats need explicit revoke/expiry. |
| Escalation to real-money trading | Narrow write surface, no trading imports/delegation/execution ports, exact setting allowlist, structural + behavioral + DB non-escalation tests | These are application guarantees, not protection from an attacker with arbitrary DB administration. |
| Own-data lockout / leaked cross-user data | Explicit always-open route manifest, fresh ownership checks, mixed-data filtering, owner-only traces, final egress replay checks | Historical notifications/conversations remain readable by their owner by design. |
| DoS / expensive signature or JSON input | 16 KB raw limit, early IP limits, outstanding nonce bounds, five/ten wallet bounds, bounded scans, cursor checks, bounded retries | IP limits are currently per API process; distributed deployment needs an edge/shared limit before enforcement at scale. |
| Partner SSRF / bearer leak | Trusted HTTPS origin, no user-controlled URL, reject redirects/credentials, timeouts and sanitized errors | Operator configuration and Wyntrax availability remain trusted dependencies. |
| Expiry / stale cache / outage | Read-time expiry, no positive HTTP cache, realtime fresh checks, fail closed on unreadable state | Receiver trusts signed validUntil; the sender must honor its 72-hour lifetime obligation. |
| Admin setting abuse / log leak | isAdmin only; reasons and transaction audit; no arbitrary keys, signatures, nonces, tokens or full member-wallet payloads in logs | Authorized admins may change research policy; logs require normal access controls. |

## 11. Migration and isolated verification plan

Next migration: **`packages/database/prisma/migrations/0011_entitlements/migration.sql`**, after the actual `0010_executor_dry_run` folder. Older prose still says 0009; do not rename historical migrations (including the two 0007 folders).

Follow the observed hand-written SQL convention with Prisma-compatible indexes/FKs/enums, then verify with `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --shadow-database-url ... --script`; expected output is empty or `-- This is an empty migration.` Deploy only into `narra_ent`, generate client, test constraints/concurrency and repeat diff for the new schema. Baseline drift must be reported, not silently repaired in entitlement migration. No schema changes before A.

Environment:

- Original checkout remains on b5a-lookup-tables. Worktree was created from main and `npm ci` completed.
- `.env` copied privately, git-ignored; PORT=4010, DATABASE_URL host localhost:5432/db narra_ent, Redis DB 5. Never echo the connection string or credentials.
- Before **every** DB-touching command, print host/port/db without password and assert exact localhost:5432/narra_ent. Creation/drop uses a maintenance connection to `postgres`, exclusively for the named scratch databases; never connect to narra.
- Newly created narra_ent is empty at Stage 0. The shadow DB was created and is cleaned up for the design checkpoint; recreate narra_ent_shadow for migration diff after A and drop it in finally/cleanup afterward.
- Explicitly load the isolated env into test subprocesses rather than assume tools source `.env`. No API on 4000; no live pipeline/executor workers or provider calls. Fake jobs/fetch for new reconciliation tests.
- Integration files run serially, random tagged fixtures and cleanup. Skipped tests are not passes. Full suite may run only with verified scratch target and isolated Redis; report unrelated baseline failures honestly.

## 12. Test and rollout gates

| Stage | Required evidence before advancing |
|---|---|
| 0 | Design, source-based inventory, contract-vector reproduction, isolated environment; Checkpoint A owner approval. |
| 1 | Additive schema/migration; pure resolver/admission tests for max sources, multiple wallets, unlinked wallets, revoked/expired/disabled, seat cap/idempotent admission; real scratch constraints and clean migration diff. |
| 2 | Linking: single-use/expired nonce, wrong user/message/domain/signature/address, invalid base58/decoded size, other-owner conflict, five-wallet cap, concurrent claims, unlink/relink and stale pre-unlink proof. Real scratch writes and transactional audits. |
| 3 | Exact vector, wrong/previous secret, tampered raw bytes, too-old/future boundary timestamps, missing/duplicate headers, nonhex/wrong prefix/length without crash. Payload replay/stale/equal-version-different-ID/unknown tier/missing validUntil/expired validUntil/11 wallets/wrong chain/invalid base58/case preservation. Concurrency and fault rollback tests for receipt/state/audit. **Checkpoint B: stop, full linking/webhook/test diffs, diff stat, residual risks and report.** |
| 4 | Off versus shadow versus enforced, FEATURE_LOCKED shape/requiredTier, all feature tiers/overrides/page caps, missing or damaged config, mixed-data and chat bypass checks, live/replay downgrade/expiry, admin authorization/trace redaction, seat races. Explicit always-open route manifest tested at NONE with enforcement on and entitlement store unavailable. |
| 5 | Fake fetch: HTTPS/auth/query/cursor/tie ordering, page limits/timeouts/retries, permanent failures, absent config, checkpoint rollback/resume, newer webhook versus older reconcile, expiry sweep, fake scheduler/enqueue lifecycle. Required scratch integration and existing full suite/typecheck. |
| 6 | Ask first: invites and per-tier daily AI chat quotas. No implicit approval from A/B. |

### Mandatory non-escalation proof

Build a new test in an allowed area (do not weaken the executor test):

1. Structural checks over the entitlement modules and their dependency graph: no imports of trading/risk/solana/tx-verify/executor, no execution queue/confirmation/proposal-apply ports, no writes to User or trading/risk/Wallet records. Only the defined entitlement tables, audited exact setting keys and AuditLog are writable. Normalize Windows path separators. Include a mutation fixture to show a planted forbidden call/import is detected.
2. Exercise link/unlink, join/leave, every webhook tier including ELITE/NONE, duplicate/stale events, manual grants/revokes, setting writes, reconcile and sweep using instrumented adapters that throw on every forbidden operation. Entitlement changes must never call account-control or chat apply handlers. Authentication setup is tested separately; no entitlement operation creates a trading wallet or sets mode.
3. Real scratch DB snapshots before/after those operations pin User.mode, TradingPermission, RiskProfile, risk/trading/kill-switch settings, existing Wallet rows and execution records. Assert equality and no execution enqueue. Attempts to write forbidden settings via the entitlement settings API return 400 and leave snapshots intact.
4. Parameterized route manifest proves that own positions/trades/export/wallets/analytics/chat history/notifications/confirmations and pause/revoke/risk/mode controls do not call the resolver. Own portions of mixed routes survive entitlement-store failures. Future close/withdraw routes must be explicitly classified always-open.

Rollout: deploy additive schema and ingestion with `enforced=false, shadow_log=true`; observe sanitized would-deny logs (request ID, user ID, feature, tiers, reason only; rate/sample them to bound cost). `false,false` is observation OFF; `false,true` is shadow; `true,*` enforces regardless of shadow. `/me/entitlements` always reports policy truth. Enable early access only after choosing capacity. After B and Stage 4 verification, owner can enable enforcement by audited setting; rollback is that setting OFF, without modifying memberships or any trading control. Shadow mode never suppresses response fields or events and never imposes tier page limits.

## 13. Checkpoint A decisions and current evidence

Approval requested for:

1. The route/field/event mapping, ELITE new chat turns, research-only page ceilings, mixed-data exceptions and rollout semantics above.
2. Local ADMIN grants restricted to EARLY_ACCESS, subject to enabled/wallet/cap and finite expiry. This preserves the owner-approved formula that paid tiers come from Wyntrax. If higher-tier manual overrides are desired, obtain an explicit product decision before implementation; never change the wire contract.
3. Capacity semantics (admission-only cap, reservations retained on disable/last unlink), initial cap 0 and trusted challenge domain configuration. Production domain and launch capacity can be supplied later through settings.
4. Permission to update root `package-lock.json` to declare/reuse already-installed `@noble/curves` and `bs58`, and README/CLAUDE documentation when implementation phases finish. No dependency or root-file change has been made at Stage 0.
5. Invite requirement remains fail-closed/unavailable until separately approved Stage 6. Daily per-tier chat quotas also wait for Stage 6.

| Step | Status | Evidence |
|---|---|---|
| Original status/branch checked | PASS | Clean status; branch b5a-lookup-tables; no switch/commit there. |
| Isolated worktree/dependencies | PASS | entitlements from main at 4120916; npm ci added 265 packages. |
| Private environment | PASS | Git ignores .env; port 4010; localhost:5432/narra_ent; Redis /5. |
| Scratch creation/cleanup | PASS | New empty narra_ent and narra_ent_shadow created via maintenance postgres; shadow subsequently dropped. No application migrations/data writes. |
| Contract vector | PASS | Node HMAC produced exactly the required 64-hex signature; 326-byte body. |
| Design/source inventory | PASS | This document and a checkpoint pointer in CONTINUATION.md; no implementation files changed. |
| Automated implementation tests/typecheck | SKIPPED | Design-only checkpoint; no implementation or generated Prisma client verification. Manual vector computation is not a Vitest pass. |
| Migration deploy/diff | SKIPPED | Stage 1 awaits approval; scratch remains empty. |
| Live Privy/Wyntrax/Solana or workers | SKIPPED | No live calls or workers started. |

Install output also reported 14 dependency audit findings (7 moderate, 5 high, 2 critical) and pending install-script approvals; no dependency remediation or script-approval configuration was changed. Contract deviations: none. No contract/repository incompatibility was found requiring a wire change. The reconcile field omission, sender-only 72-hour rule, old migration prose and out-of-scope root edits are explicitly handled above rather than assumed away.

Checkpoint A was approved with conditions: atomic user seats, EARLY_ACCESS-only manual grants, named always-open route tests, exact-version direct dependencies in apps/api only, additive README/CLAUDE sections, and continued scratch isolation. Stage 4 waits for Checkpoint B.

## 14. As built at Checkpoint B

Schema `0011_entitlements`, pure resolver/admission policy, four authenticated linked-wallet endpoints and the HMAC webhook are implemented. Local settings/grant/revoke **services** implement the approved seat/admin rules now so their concurrency and non-escalation can be reviewed; their HTTP admin/join endpoints remain Stage 4. Feature metadata is pure and has no HTTP enforcement hook yet. A stored `entitlements.enforced=true` therefore does not activate enforcement in this build.

| Tier / surface | Implemented policy metadata | HTTP behavior at B |
|---|---|---|
| NONE / always-open | Resolver defaults to NONE; no implicit admin tier | Existing auth/ownership/abuse checks; no feature gate |
| EARLY_ACCESS | Narratives, tokens, overview; 20-row research page metadata | No feature gate or tier page clamp yet |
| MEMBER | Screener, rotation, opportunities, smart-money; 40-row metadata | No feature gate or tier page clamp yet |
| PRO | Analysis, wallet detail, decision analytics; 70-row metadata | No feature gate or tier page clamp yet |
| ELITE | Advanced analytics, new chat turns; 100-row metadata | No feature gate or tier page clamp yet |
| Linked wallets | Challenge, verify, list, unlink | Privy authentication and owner scoping; no tier check |
| Wyntrax events | State ingestion only | Raw-body HMAC, own rate/body limits; independent of Privy |

`apps/api/src/entitlements/alwaysOpen.test.ts` names the always-open HTTP routes individually and checks their availability against enforcement OFF and ON with an explicit NONE user and a resolver that throws if called. It also proves private WebSocket replay/live delivery. The existing routes' normal validation/resource errors remain valid (for example a missing owned record is 404); the test does not claim every invalid request succeeds. Mixed-data filtering, meaningful enforced research denials and quota clamping remain Stage 4. Each mixed surface is documented in section 8: overview, search, opportunities, opportunity analysis, owned wallet detail/history, realtime and chat research-tool data.

The schema's `LocalAccessTier` enum contains only EARLY_ACCESS; even a direct database insert cannot store MEMBER/PRO/ELITE in AccessGrant. `grantEarlyAccess`, `revokeLocalGrant` and `updateLocalSettings` share the transaction-level `narra-entitlements:seats` advisory lock. Grants also serialize against linking/unlinking with the user's lock. Lowering the cap retains existing access, unlinking never mutates a grant, and every actual grant/revoke mutation is audited in the same transaction. Idempotent retries do not create another grant/audit mutation. Tests launch eight competing joins for two seats and three competing proof claims for one remaining wallet slot.

Dependencies: direct declarations are restricted to `apps/api/package.json`: `@noble/curves` **1.9.7**, `bs58` **4.0.1**. The lockfile adds exactly these two entries under apps/api; no resolved package/version changes. `npm ci` ran before and after. Pure resolver stays in shared; base58 boundary validation lives in API to avoid introducing a shared dependency outside the approval.

Verification limits: wallet lifecycle/concurrency integration tests use a fake successful signature verifier; real Ed25519 verification is independently exercised with the published RFC 8032 vector, including wrong key/message/signature/encoding rejection. No test or production wallet-signing code was added. Real Privy, a real browser wallet challenge round trip and live Wyntrax delivery are unverified. See `ENTITLEMENTS_CHECKPOINT_B.md` for the full report, remaining risks, commands and diff artifacts.
