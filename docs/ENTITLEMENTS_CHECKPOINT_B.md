# Entitlements — Checkpoint B security review

**STOPPED after Stages 1–3. Stage 4 requires owner approval.**

Worktree: `C:\dev\narra-entitlements`, branch `entitlements`. Review baseline is Checkpoint A commit `9e8b5ea`; implemented code/test tip is `a010681`. No push, merge or changes to the other checkout were made.

## Review artifacts

- [Full implementation and test diff](ENTITLEMENTS_CHECKPOINT_B.diff): complete, unabridged `git diff 9e8b5ea a010681 -- apps/api packages/database packages/shared package-lock.json`. Includes linking, webhook, state applicator, seats, schema and every new test.
- [Complete README/CLAUDE diff](ENTITLEMENTS_ROOT_DOCS.diff): only appended entitlements sections, 7 added lines total. Programmatic comparison confirmed every original byte of normalized content remains an unchanged prefix.
- [Full test output](ENTITLEMENTS_TEST_OUTPUT.txt): terminal colors removed, otherwise the full scratch-suite output.
- [Design and approved Stage 4 route map](ENTITLEMENTS.md), especially sections 4, 8 and 14.

## Step report

| Step | Status | Evidence |
|---|---|---|
| Isolated checkout | PASS | Branch entitlements in its own worktree; original remains b5a-lookup-tables. An unrelated untracked `narra-docs.zip` appeared there during work and was left untouched. |
| Environment | PASS | Guarded localhost:5432/narra_ent, Redis /5; both PORT and API_PORT set to 4010. No credentials printed or committed. |
| Dependency condition | PASS | npm ci before and after; @noble/curves 1.9.7 and bs58 4.0.1 already resolved at those versions. Only two direct apps/api lockfile entries added; programmatic comparison found no other lock change. |
| Stage 1 | PASS | Migration 0011, restricted local-tier enum, pure resolver/admission; 10 unit tests. |
| Migration verification | PASS | Baseline and post-change full-chain Prisma diff both empty; migrations 0001–0011 deployed successfully to scratch; client generated. Shadow database dropped after each diff. |
| Stage 2 | PASS | Four Privy-authenticated/owner-scoped linking routes, single-use five-minute proof, unique wallet ownership, five-link limit, transaction audits. Lifecycle/concurrency tests use real PostgreSQL and a fake successful proof verifier. |
| Atomic user seats | PASS | Eight simultaneous joins for two seats admit exactly two users; lowering cap retains access; extra wallets/ADMIN source/paid tier do not add seats; unlink releases none. |
| Restricted manual grants | PASS | Service rejects MEMBER/PRO/ELITE/NONE, unauthorized actors and arbitrary setting keys. LocalAccessTier can only store EARLY_ACCESS. Grants/revokes audited atomically. HTTP administration is Stage 4. |
| Stage 3 | PASS | Raw-buffer 16 KB HMAC boundary, rotation, exact vector, strict payload, receipt dedupe, version ordering, rollback and concurrency tests. |
| Non-escalation | PASS | Structural boundary/mutation tests plus instrumented persistence capabilities and real before/after trading/risk/setting snapshots. Existing executor isolation suite passed unchanged. |
| Named always-open checks | PASS | 70 individually named HTTP routes plus private WebSocket replay/live delivery at NONE, enforcement setting ON, resolver throws if consulted. See scope of this evidence below. |
| Targeted tests | PASS | 6 files, 126 tests, no skips. |
| Existing full suite | PASS | **66 files, 995 tests, no failures or skips**, 220.47 seconds. |
| Typecheck | PASS | Guarded `tsc --noEmit -p tsconfig.json`, exit 0. |
| Stage 4 enforcement/field filtering | SKIPPED | Deliberately awaits Checkpoint B approval. Setting enforcement=true has no runtime gating effect yet. |
| Stage 5 reconcile/sweeps | SKIPPED | Not implemented or scheduled. No pipeline/executor process was started. |
| Live Privy/browser wallet/Wyntrax | SKIPPED | No live provider calls; no signing or transaction code added. |

Test output summary:

```text
DATABASE_URL host=localhost:5432 db=narra_ent; confirmed scratch only (Redis /5, API port 4010).
Test Files  66 passed (66)
Tests       995 passed (995)
Duration    220.47s
```

During development, one new HTTP integration test exceeded Vitest's default 5-second timeout on a cold Windows startup; its explicit timeout is now 20 seconds and subsequent targeted/full runs passed. New structural tests initially misidentified a local `wallet.data` variable as a database delegate and truncated a nested SQL template; those new test matchers were corrected. A fixture-restoration JSON type error was corrected. No existing test was changed, weakened or removed.

## As-built tier-to-route map

**No HTTP route has an entitlement gate at this checkpoint.** The pure registry is implemented; the table below distinguishes that policy metadata from the current route behavior. Existing authentication, ownership, admin, provider authentication and abuse limits continue to apply.

| Registry tier | Existing route surfaces assigned in the approved design | Behavior now / test evidence |
|---|---|---|
| EARLY_ACCESS | GET `/v1/narratives`, `/v1/narratives/:slug`; GET `/v1/tokens` ordinary list and `/v1/tokens/:mint`; GET `/v1/intelligence-bar` | Research remains ungated. Existing `read.test.ts`, `b7.test.ts`; pure registry/resolver in `packages/shared/src/entitlements.test.ts`. |
| MEMBER | GET `/v1/tokens` screener branch; `/v1/narratives/rotation`; `/v1/opportunities`; `/v1/smart-money/wallets` | Research remains ungated. Existing `read.test.ts`, `b7.test.ts`; pure registry tests. |
| PRO | GET `/v1/opportunities/:id/analysis`; `/v1/wallets/:address`, `/v1/wallets/:address/trades`; `/v1/analytics/decisions/summary`, `/v1/analytics/decisions/outcomes` | Research remains ungated. Existing `read.test.ts`, `b7.test.ts`, `analytics.test.ts`. Caller-owned decisions/wallet data must remain available when Stage 4 adds the shared-data checks. |
| ELITE | POST `/v1/chat`; GET `/v1/analytics/signals`, `/v1/analytics/backtest-summary` | New chat/global research remains ungated. Existing `chat.test.ts`, `analytics.test.ts`. |
| Always-open | All named routes below, plus private realtime | `alwaysOpen.test.ts`: NONE with enforcement setting ON never calls the resolver and retains baseline availability. |
| Integration boundary | POST `/v1/integrations/wyntrax/events` | No tier or Privy gate; HMAC required. `webhook.test.ts` and `crypto.test.ts`. |

The existing tests for research routes verify current behavior; they are **not** evidence of future enforced paid denials. Meaningful off/shadow/enforced denial tests, tier quotas and mixed-response filtering remain Stage 4. No false claim is made that an unused enforcement setting already provides security enforcement.

### Every permanently ungated route and its test

Each entry in this block is an individual parameterized case in `apps/api/src/entitlements/alwaysOpen.test.ts` (`ALWAYS_OPEN_HTTP`), comparing enforcement OFF and ON with an explicit NONE user. Where a body/id is intentionally invalid, normal validation/resource errors are preserved; read-list/own-control success paths are also exercised. Existing admin status can report its normal operational status. Authentication is not bypassed by this test; the Privy verifier is a fake and the user/admin rows are real scratch fixtures.

```text
GET /health
POST /webhooks/helius
POST /v1/risk/evaluate
GET /v1/me
PUT /v1/mode
PUT /v1/ai-access
PUT /v1/risk-profile
POST /v1/ai-access/revoke
POST /v1/agent/pause
POST /v1/agent/resume
GET /v1/me/wallets
GET /v1/me/wallets/balances
GET /v1/positions
GET /v1/trades
GET /v1/trades/export
GET /v1/confirmations
POST /v1/confirmations/:id/confirm
POST /v1/confirmations/:id/reject
GET /v1/alerts
GET /v1/alerts/unread-count
POST /v1/alerts/:id/read
POST /v1/alerts/read-all
GET /v1/settings
PUT /v1/settings/profile
PUT /v1/settings/appearance
PUT /v1/settings/notifications
PUT /v1/settings/interests
GET /v1/analytics/me/performance
GET /v1/analytics/me/equity
GET /v1/chat/conversations
GET /v1/chat/conversations/:id
GET /v1/chat/proposals
POST /v1/chat/proposals/:id/apply
POST /v1/chat/proposals/:id/reject
GET /v1/overview
GET /v1/search
GET /v1/admin/connections
GET /v1/admin/dry-runs
GET /v1/admin/executor/kill-switch
PUT /v1/admin/executor/kill-switch
GET /v1/admin/ai-models
PUT /v1/admin/ai-models
PUT /v1/admin/ai-enabled
GET /v1/admin/wallets
POST /v1/admin/wallets
POST /v1/admin/wallets/import
PATCH /v1/admin/wallets/:address
GET /v1/admin/wallets/sync-status
POST /v1/admin/wallets/sync
GET /v1/admin/wallet-candidates
POST /v1/admin/wallet-candidates/:address/approve
POST /v1/admin/wallet-candidates/:address/reject
GET /v1/admin/system-limits
PUT /v1/admin/system-limits
POST /v1/admin/system-limits/reset
GET /v1/admin/trading-pause
PUT /v1/admin/trading-pause
GET /v1/admin/blacklist
PUT /v1/admin/tokens/:mint/blacklist
GET /v1/admin/audit
GET /v1/admin/status
GET /v1/admin/costs
GET /v1/admin/ai-pricing
PUT /v1/admin/ai-pricing
GET /v1/analytics/backtests
GET /v1/analytics/backtests/:id
POST /v1/me/linked-wallets/challenge
POST /v1/me/linked-wallets/verify
GET /v1/me/linked-wallets
DELETE /v1/me/linked-wallets/:id
```

`GET /v1/stream` has its own named test in that same file: authenticate at NONE with enforcement ON, receive an owned replay event and then an owned live event, without a resolver call. This uses a fake stream and real in-process WebSocket; the existing `gateway.test.ts` also passed against real scratch Postgres/Redis.

`POST /v1/integrations/wyntrax/events` is permanently independent of research entitlements and is tested separately in `webhook.test.ts` (valid raw-byte requests with no Privy token, duplicate response, 400/401/413/429/503). The other 16 current route/method entries are the presently ungated research routes explicitly named in the tier table. Automatically generated HEAD/OPTIONS are excluded from these counts.

### Mixed-route protections

At B the routes retain their current complete payloads. Stage 4 must not add a whole-route gate to overview (`me`), search (MY_TRADE), opportunities/analysis (caller-owned decisions/context), wallet detail/history (owned Wallet/LinkedWallet), or the WebSocket connection/private events. Stored chat history/proposals and already-delivered notifications remain readable after downgrade; new chat turns have their own future feature gate. Details and per-field policies are in design section 8. The paid-field/own-field split is documented, **not implemented or claimed tested at B**.

## Seat and admin logic

- **One seat per USER**, represented by at least one ACTIVE unexpired EARLY_ACCESS-tier grant. EARLY_ACCESS and ADMIN sources count together and are deduplicated by user.
- A valid MEMBER/PRO/ELITE membership does not discount or add to that user's existing local seat. A Wyntrax-only user with no local grant consumes zero seats.
- Expired/revoked grants do not consume a seat. Disabling early access suppresses local eligibility but preserves active reservations. Linking extra wallets and unlinking any/all wallets never release or add seats. With no verified link, the user's local benefit is suppressed until a new link exists.
- All grants, revokes and local setting writes acquire the same transaction-level advisory capacity lock. Grant insertion checks occupancy and writes the grant/audit in that transaction. User linking/unlinking is serialized with its own lock; grant admission takes that user lock too.
- Lowering cap below occupancy blocks only new users; existing holders keep access and retries stay idempotent. Tests lower cap to zero after two users win a concurrent admission race.
- Admin service requires an actual `User.isAdmin` actor and a finite future expiry. Its input permits only tier EARLY_ACCESS; the database enum enforces that restriction too. Admin can revoke local EARLY_ACCESS/ADMIN source grants; self-leave cannot revoke an ADMIN source. Revocation never changes a Wyntrax membership or trading control.
- Grant/revoke audits are in the mutation transaction. Idempotent retries produce no second mutation. Domain updates invalidate outstanding challenges under the domain lock, including if a previous domain is later restored.

## Files and commits

Implementation and pre-review documentation diff (before adding this report/artifacts): **30 files, 1,230 insertions, 10 deletions**. The exact file-by-file stat was printed during review; the complete code diff is linked above. Added review artifacts account for additional documentation lines in the final branch stat.

Changed areas: `apps/api/package.json`, API app/server wiring, `apps/api/scripts/scratch.cjs`, `apps/api/src/entitlements/*`, database schema and `0011_entitlements`, shared resolver/tests/export, the two approved root lockfile entries, additive README/CLAUDE sections, and entitlement/continuation documentation. No changes in tx-verify, solana, trading, risk, executor, realtime, queue or pipeline.

| Commit | Concern |
|---|---|
| `2314624` | Schema/migration, pure resolver/admission and isolated verification runner |
| `0696a81` | Reuse exact locked verification dependencies and proof helper |
| `63420e8` | Atomic early-access seats, restricted grants and exact-key local settings |
| `7bf2a93` | Single-use wallet linking services/routes |
| `6b00f84` | Raw authenticated webhook, versioned state store and API wiring |
| `a010681` | Security, concurrency, HTTP, non-escalation and always-open tests |

The final documentation commit contains this report, the complete review artifacts, and the additive root sections.

Dependency stat requested by the owner:

```text
git diff 9e8b5ea --stat -- package-lock.json
 package-lock.json | 2 ++
 1 file changed, 2 insertions(+)
```

## Database and verification details

Only `narra_ent` was migrated/tested. Maintenance connections to `postgres` exclusively created/dropped `narra_ent_shadow` for Prisma diff. No `narra` database connection was used. The scratch DB contains migrations and may retain fixtures from existing legacy tests; new entitlement fixtures are tagged and cleaned up. No server was started on port 4000, no pipeline/executor service was launched, and new membership jobs use no live queue consumer. Existing queue/stream integration tests used Redis /5.

Commands run through the guard (each prints host/db and asserts scratch target before subprocess execution): `diff` (baseline and new schema), `deploy`, `generate`, `test packages/shared/src/entitlements.test.ts`, `test apps/api/src/entitlements packages/shared/src/entitlements.test.ts`, full `test`, and `typecheck`.

## Residual risks and open questions

1. **Real wallet round trip unverified.** Lifecycle tests fake a successful proof; the actual strict Ed25519 function is tested separately with published valid/invalid vectors. A real browser wallet signing the exact challenge must be verified before launch. No signing implementation was introduced to create fixtures.
2. **Live integration unverified.** HMAC/Privy boundaries use fixtures/fakes; no live Wyntrax delivery, provider token or reverse-proxy behavior has been exercised. The exact contract HMAC vector passes.
3. **Enforcement not active yet.** Mixed-field filters, feature overrides, deny logging and quotas need Stage 4; the current tier registry alone does not protect shared research. The named always-open tests are a baseline/regression guard, not proof of a future gate implementation.
4. **Reconciliation and cleanup await Stage 5.** Expiry is already enforced by the pure resolver, but no scheduled reconciliation, grant-expiry sweep or expired-challenge cleanup runs. Webhook receipt/version tombstones intentionally remain durable; receipt retention is a later reviewed policy.
5. **Per-process rate limits and lock contention.** Route rate limits use the repo's current per-process limiter. The global capacity lock and global challenge-domain lock preserve correctness but may become contention points at scale. Only bounded test concurrency has been exercised, not production load or multi-API deployment.
6. **Upstream trust/availability.** A compromised Wyntrax secret can grant research until signed validUntil. Its 72-hour validity cap is a sender obligation; the receiver does not alter the authoritative vector's longer validity. Provider compromise cannot change trading authority through these modules.
7. **Seat abuse.** Verified wallet control is not proof of a unique human; many accounts/wallets can reserve seats. Invites and per-tier daily chat quotas remain separately approved Stage 6 work. Launch seat cap and trusted wallet-link domain still need operational configuration.
8. **Dependency findings remain.** npm ci reported 14 existing audit findings and pending optional/install scripts. No package versions or dependency remediation were changed in this task.

Contract deviations: **none**. Implementation sequencing note: atomic seat/admin services were built before Stage 4 to satisfy the owner's Checkpoint A conditions; their HTTP endpoints remain deferred. No route gating or reconciliation implementation was advanced past Checkpoint B.

**Owner decision requested:** approve Checkpoint B before Stage 4. No further stage proceeds automatically.
