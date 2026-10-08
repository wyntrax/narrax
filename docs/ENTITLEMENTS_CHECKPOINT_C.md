# Entitlements — Checkpoint C

Worktree `C:\dev\narra-entitlements`, branch `entitlements`; review baseline **4010bb5** (Checkpoint B). Checkpoint B was approved with conditions; the MEMBER reassignment below was explicitly approved in the in-session question. Stop for owner review at C; no push or merge.

## Delivered

| Requirement | Implementation / evidence |
|---|---|
| Close B gaps before gating | Commit `de7011a`; all a–n answers and proving test names in [B addendum](ENTITLEMENTS_CHECKPOINT_B.md#checkpoint-b-addendum). Real proof/JWT/DB lifecycle, two-user same-wallet race, parallel member versions, early chunked limit, invalid payload no-write assertions. |
| Real proof lifecycle | `addendum.test.ts`: “real challenge -> ed25519 verify -> link -> webhook -> entitlement, with real JWT verification and no faked proof”. Seven tests include wrong key/message/user/domain/address, expiry, replay and immediate unlink loss. Signing exists only in the explicitly approved test fixture. |
| Approved route gates | `entitlements/gating.ts`, `access.ts`; auth-first 403 `FEATURE_LOCKED` with requiredTier. Off/shadow/enforced behavior, exact named denials and page/cursor quotas tested in `gating.test.ts`. No generic global entitlement hook. |
| Mixed/own-data | `read.ts`, `overview.ts`, `intel.ts`: owned decisions/context, wallet detail/history, search MY_TRADE, overview `me`; denied shared queries are filtered/skipped. Tests include another user's denied access and actual owned trade matches. |
| Alternate paths | `chatAccess.ts` checks per-tool access independently of chat minimum. `egress.ts` is a bounded ordered research lane at final WebSocket send; private/control events bypass it. Tests exercise real DB expiry, research ordering, overflow resync and private bypass; existing private replay/live gateway test remains. |
| Age controls | Migration `0012_entitlement_age`, applicator continuity timestamps, per-feature `min_entitlement_age_hours` default 0. Tests cover renewal, expiry, NONE, relink age and ELITE upgrade. |
| User/admin endpoints | `routes.ts`: own entitlements, join/leave, exact-key settings, traces with reason codes, EARLY_ACCESS-only grants/revokes, audited admin unlink, reconcile request and counts-only stats. All 11 new route/method entries have named NONE/enforced tests. |
| Reconcile/client | `partner.ts`, `reconcile.ts`: same state applicator, unique version ordering, lease, pagination/resume, incremental overlap/daily full scan, bounded retry/timeout/body size, expired-grant/challenge sweep. Fake-fetch + real scratch DB tests. |
| Registration | `workers/pipeline/src/entitlementRegistration.ts` plus bootstrap registration only. Queue schedule and manual job IDs tested with fakes. Both env values required; no worker process started. |
| Contract script | `scripts/wyntrax-contract-check.mjs`; fixed vector offline and seven HTTP cases on real localhost:4010, redirects/remote targets refused. API receiver automatically closed afterward. |
| Rollout | [Rollout](ENTITLEMENTS.md#rollout): env-only secrets, receiver before enforcement, shadow review, named gates, audited rollback via `entitlements.enforced=false`. README/CLAUDE append-only. |

## MEMBER table — approved and applied

The wire enum and database still accept MEMBER. **v1: MEMBER reserved; Wyntrax sends NONE, PRO, ELITE.** Proof of the same wallet on NARRA remains mandatory; a partner state never assigns wallet ownership to a NARRA account.

| Previously MEMBER | Route / related feature surfaces | Approved replacement |
|---|---|---|
| research.screener | GET `/v1/tokens` filters/sort | **PRO** |
| research.rotation | GET `/v1/narratives/rotation`, overview rotation | **EARLY_ACCESS** |
| research.opportunities | GET `/v1/opportunities`, overview opportunity, opportunity/decision realtime, chat opportunity reads | **PRO** |
| research.smart_money | GET `/v1/smart-money/wallets`, search wallet hits, consensus realtime/chat fields | **PRO** |

## Verification artifacts

**Final results: 71 test files, 1,049 tests passed, zero failures/skips (236.76 s). Typecheck passed. Deployed scratch migration diff is empty.** The final full run includes the real WebSocket replay/live/expiry test and successful audited HTTP admin grant/revoke/unlink test. The separate verbose boundary run passed 143 tests in five files, including all seven real-signature addendum tests.

```text
DATABASE_URL host=localhost:5432 db=narra_ent; confirmed scratch only (Redis /5, API port 4010).
Test Files  71 passed (71)
Tests       1049 passed (1049)
Duration    236.76s
Typecheck   exit 0
Prisma diff -- This is an empty migration.
```

- [Full source/migration/test/script/registration diff](ENTITLEMENTS_CHECKPOINT_C.diff) from 4010bb5 to 3e2d55c, including gating and reconciliation.
- [Complete append-only README/CLAUDE diff](ENTITLEMENTS_C_ROOT_DOCS.diff) from 4010bb5.
- [File-by-file implementation diff stat](ENTITLEMENTS_C_STAT.txt).
- [Full final suite output](ENTITLEMENTS_C_TEST_OUTPUT.txt) with counts and actual localhost contract-check statuses/bodies.
- [Verbose real-signature/addendum and boundary output](ENTITLEMENTS_C_SIGNATURE_OUTPUT.txt).
- [Typecheck and deployed schema diff output](ENTITLEMENTS_C_CHECKS.txt).

| Commit | Concern |
|---|---|
| `de7011a` | B gap closure, real proof lifecycle and approved MEMBER proposal record |
| `75eec90` | Age migration, fresh resolver/settings policy, approved tier reassignment |
| `f60195d` | Named gates, owned-data filtering, chat/realtime boundaries and audited HTTP administration |
| `62ec979` | Partner client, resumable reconciliation, sweeps, queue registration and fake-fetch tests |
| `3e2d55c` | Localhost contract script and real HTTP verification |

The final documentation commit adds this report, evidence artifacts and append-only root sections. No runtime source changed after the final passing suite.

Implementation/test/script/registration diff stat (4010bb5 → 3e2d55c): **31 files changed, 898 insertions(+), 30 deletions(-)**. The final branch also includes the review documentation/artifacts. No dependency or lockfile changes since B; README and CLAUDE each append three lines, verified by unchanged-prefix comparison. Archived source diff was verified byte-for-byte against Git output.

The B always-open tests were corrected openly for the Stage 4 mixed-route design: overview/search now must consult the resolver for shared fields. Their resolver is still made to throw; they must return 200 with own fields intact and shared fields absent. Every other previously named safety/control/own route still asserts zero resolver calls. Mock-call counts are reset per case, preventing a mixed-route call from contaminating later cases. No existing production behavior test was removed or disabled.

## Isolation and scratch changes

- Only `localhost:5432/narra_ent` was touched during C. Applied additive migration `0012_entitlement_age` and generated Prisma client. The C schema check compares the deployed scratch schema to Prisma directly, using `scratch.cjs deployed-diff`; it does not create/connect to another database. B's earlier full-chain shadow check remains historical evidence.
- Redis remains /5. Only the contract-check receiver listens, on localhost:4010; no pipeline/executor processes or live partner/provider calls. Existing full-suite queue handlers use their test fakes.
- Local ignored `.env` holds the public contract-test secret and API_PORT=4010. Contract checks intentionally leave public `evt_test_0001`/`wx_user_1` and stale receipt fixtures in scratch; no production settings are enabled. Other new test data/settings are restored/cleaned where scoped.
- No new dependency or lockfile changes after B. The only root script is the owner's explicitly requested contract check. Worker edits are registration/shutdown wiring only; implementations remain in API. No trading, risk, solana, tx-verify, executor, queue or realtime package edits.
- Original checkout remains `b5a-lookup-tables`; unrelated `narra-docs.zip` was left untouched.

## Residual risks / unverified

1. **Live Wyntrax and Privy round trips remain unverified.** Local proofs/JWT cryptography are real; provider issuance, wallet-browser UX, partner delivery, reverse-proxy behavior and production deployment are not exercised.
2. **Partner page shape/order/cursor lifetime needs live confirmation.** The implementation strictly validates the documented full-state page shape. Permanent cursor invalidation currently requires operational reset of internal reconciliation progress after diagnosing the failure; it never advances the completed watermark on error or revokes by absence. An arbitrary-wallet diagnostic partner lookup was not implemented/exposed.
3. **Age is observed continuity.** It cannot detect temporary balance changes Wyntrax never reports. Existing rows with null timestamps must receive a fresh newer update before an age-gated feature unlocks. Wallet-set changes conservatively reset the whole member's age.
4. **Performance/distributed operation unbenchmarked.** HTTP uses fresh repeatable-read snapshots; each research WebSocket event resolves fresh state. Locks/lease protect correctness in tests, but production load, DB pool pressure and multi-worker deployment have not been load-tested. Per-process HTTP rate limiting follows the repository's current pattern.
5. **Realtime buffering is bounded.** At 128 pending research messages additional research is dropped with `resync:slow`; own/control delivery continues. Research can be denied between replay enumeration and egress on expiry/revocation, intentionally. A real in-process WebSocket test proves paid replay/live delivery followed by expiry denial with continuing private delivery; the stream is a fake, while membership persistence/resolution is real PostgreSQL. Existing gateway tests also pass against real scratch Redis. A production proxy is unverified.
6. **Cleanup/receipts.** Sweeps run after a successful configured reconciliation and are bounded to 500 each. Expiry reads remain authoritative during outages. Receipt/version tombstones are durable; no dedupe retention deletion is introduced. Contract-script public test receipts remain in scratch intentionally.
7. **Upstream/admin trust remains.** A compromised Wyntrax secret can grant research until signed expiry; the unchanged contract's 72-hour sender obligation is not a receiver clamp. Authorized admins can alter research policy, never trading authority through these APIs. Historical notifications/chat and owned decision context remain readable by design.
8. Existing npm audit findings from B remain; no dependency remediation was included. Optional invites and daily chat quotas remain separately approved later work.

Implementation choices: partner progress uses an internal SystemSetting and a bounded expiring DB lease rather than a long-running transaction across network fetches. Registration is shared through the existing worker package boundary, avoiding a new dependency or edits outside the approved areas. Rollout remains manual; all feature ages default 0 and enforcement defaults false.

**Owner review requested at Checkpoint C.** No merge, push or production enablement is performed.
