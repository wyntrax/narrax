# Membership webhook cleanup report

Verified 2026-10-10 on `cleanup/membership-webhooks`; five numbered commits implement the receiver cleanup.

## Result

Raw-body HMAC still authenticates before JSON parsing, with current/previous secrets, 16 KB limit, strict content type and timestamp checks. MEMBER/PRO/ELITE keys and lowercase Solana wallets are accepted. Each `(membershipId,chain,address)` stores an independent BigInt sequence and expiry; higher sequences apply atomically with event receipts. Test events only record deduplication receipts/audits. Highest active unexpired key wins across verified linked wallets, and proSince/eliteSince preserve continuous eligibility through renewals and overlapping grants. Local expiry cleanup is a standalone scheduled command.

## Migration

Added `packages/database/prisma/migrations/0013_membership_webhooks/migration.sql`. It replaces WyntraxMembership/WyntraxMembershipWallet with WyntraxEntitlement, replaces aggregate receipt fields with membership/chain/address/seq, and removes obsolete reconciliation checkpoints. The owner confirmed no production entitlement data exists. All earlier applied migrations, including `0012_entitlement_age`, remain immutable. Applied to local `narra_ent` and regenerated Prisma.

## Environment

Removed `WYNTRAX_API_BASE_URL`, `WYNTRAX_API_KEY`, `WYNTRAX_ALLOW_LOCALHOST`.

Added no environment variables. Retained `WYNTRAX_WEBHOOK_SECRET` and `WYNTRAX_WEBHOOK_SECRET_PREVIOUS` with blank example placeholders. The current secret is the new creator signing secret copied from Wyntrax. Real environment files were not modified.

## Deleted paths

```text
apps/api/src/entitlements/partner.ts
apps/api/src/entitlements/partnerLocal.test.ts
apps/api/src/entitlements/reconcile.ts
apps/api/src/entitlements/reconcile.test.ts
scripts/wyntrax-reconcile.ts
workers/pipeline/src/entitlementRegistration.ts
```

`partnerLocal.test.ts` and `scripts/wyntrax-reconcile.ts` were untracked before cleanup. `sweepExpired` was extracted into `apps/api/src/entitlements/expiry.ts`, invoked by `scripts/entitlements-expire.ts` / `npm run entitlements:expire`. Schedule this command every minute separately from pipeline/executor workers. Obsolete reconciliation route, bootstrap imports, queue registration and shutdown hooks were removed. Membership storage and entitlement documentation were replaced in place.

## Verification

- Prisma validate/generate/deploy: passed.
- Migration history → schema diff using a scratch shadow database: empty; shadow removed.
- Deployed scratch database → schema diff: empty.
- Whole-project typecheck: passed.
- Full suite: **72 files passed, 1,043 tests passed, 6 skipped, zero failures** (1,049 total). Six existing account tests skipped because the 800 ms database readiness probe timed out during the full run. The isolated `apps/api/src/account.test.ts` rerun then passed **all 8 tests, zero skips**. Thus every test was exercised successfully across these runs; no test implementation was weakened to bypass the readiness check.
- Updated receiver tests retain real PostgreSQL concurrency, transaction rollback, global ID collision, signature rotation, authentication-before-parse, size/media limits, real test-key wallet proof/JWT, linking/unlinking, gating, age, WebSocket and trading non-escalation coverage. Added five lifecycle tests for independent tier fallback, multiple wallets, synthetic tests, expiry/continuity and standalone cleanup.
- Fixed public HMAC contract vector: 300 bytes, offline checker passed. Real localhost:4010 HTTP checker passed valid/duplicate/stale/test events and tampered/unauthorized/unknown-key rejection.
- Cross-repo check: real Wyntrax evaluator/outbox/HMAC → receiver HTTP handler and scratch PostgreSQL → PRO → ELITE → PRO → NONE passed. Sender transport was injected into the HTTP handler, holdings and linked-wallet rows were fixtures; separate receiver tests exercise real test-key wallet proofs.
- Final obsolete live-reference search and `git diff --check`: passed. Historical migrations and this inventory intentionally retain removed names.

## Remaining uncertainty / local work

Live chain holdings, deployment HTTPS/proxy delivery and scheduling were not exercised. Configure the receiver's new creator secret and standalone expiry schedule at deployment, then perform a real-holder renewal/revocation trial. Full-run database readiness can cause existing tests to skip under load; the skipped account cases passed on focused rerun. Real external providers remain unverified as documented in CLAUDE.md. No pipeline/executor process was started for cleanup verification; existing suites exercised their test boundaries. `narra-updated.zip` remains untracked. No push or merge was performed.
