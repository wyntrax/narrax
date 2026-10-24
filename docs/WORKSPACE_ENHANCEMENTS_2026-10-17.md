# Workspace enhancements (2026-10-17)

Seven owner requests against the existing setup. All changes are in `apps/web` and `apps/api`; no new
external call, no threshold change, and no safety-rule change. Research-only boundaries are unchanged
(early radar still writes alerts and small-token rows only; no Opportunity, AgentDecision, order or
position writes).

## What changed

1. **Tokens vs Opportunities no longer look identical.**
   - Tokens (`features/research/tokens.tsx` + `market-watch.tsx`) stays the raw market screener.
   - Opportunities (`features/research/opportunities.tsx`) is now a research-idea board: an
     idea-card grid, a collapsible "how to review" guide, coverage/decision/linked-narrative counts,
     and a per-idea "current market check" that is explicitly separate from the recorded score. The
     old duplicated market table was removed from this page.
2. **Token market-cap filters and global cap sorting.**
   - Tokens has a "Market cap range" select (`$5K–$50K`, `$50K–$100K`, `$100K–$500K`, `$500K–$1M`,
     `$1M–$10M`, `$10M+`) and a sort select (`low→high`, `high→low`, liquidity, volume, new pools).
   - Filtering and ordering happen on the server across all matching rows, not just the loaded page.
   - API (`apps/api/src/screener.ts`): new `marketCapOnly` flag excludes FDV substitutes and unknown
     valuations; `sort=marketCap` with `order=asc|desc` orders globally. Unknown is never treated as
     zero.
3. **Sign-in page.**
   - The primary "Continue" button is restyled to be visibly contrasted in dark and light themes.
   - The logo (brand mark + NARRAX) now links to the landing page, with a "Back to home" link.
4. **Smart Money rebuilt as a working wallet explorer.**
   - Previously the list only showed wallets that already had a computed profile, so newly tracked
     wallets were invisible.
   - API `/v1/smart-money/wallets` now returns **all active wallets** with a nullable score/profile,
     plus `trackedSince`, `lastTradeAt`, `observedTrades`, and supports `q` (address prefix or label),
     `source` (`MANUAL`/`IMPORT`/`DISCOVERED`) and `sort` (`recent`/`score`).
   - New detail route `/app/smart-money/[address]`: recorded transactions (side filter, Solscan links),
     narrative exposure, funding evidence, cluster, and historical scores under an explicit disclosure.
   - Records with invalid historical addresses are labeled and never linked as chain evidence.
5. **Unread-alert badge.** The Alerts navigation item shows the unread count (capped at `99+`) in the
   desktop sidebar, the collapsed rail and the mobile bottom nav; it updates after marking read.
6. **Right-hand context bar removed.** The redundant "Research context" panel was deleted; the
   workspace is full-width. Access tier + a "Refresh access" control moved to Settings.
7. **End-to-end recheck.** Full test suite, typecheck, lint, browser suite and a read-only contract
   check against the application database (see below).

## Evidence

- Backend suite: **1,191 passed, 0 failed, 0 skipped, 0 todo, 94 files** (`scripts/check-test-results.mjs`).
- Web unit suite: **467 passed, 0 failed** (`npm run test -w @narra/web`).
- Typecheck: repository root + `@narra/web` passed. Lint: `@narra/web` passed.
- Production build: `npm run build -w @narra/web` passed, including the fixture-auth scan (333 files,
  no test-auth markers). The new `/app/smart-money/[address]` route builds.
- Browser (Playwright, chromium, network-mocked): **82 passed**.
  - Validated as two invocations — `e2e/phase1.spec.ts` (22/22) and the other five specs (60/60) —
    because a single 82-test session intermittently stalls on this dev server (each run failed at most
    one *different* early-access/CSP test, all of which pass in isolation; the stalls show empty or
    generic-error page snapshots and are not reproducible against the changed pages).
  - New `e2e/workspace-enhancements.spec.ts` covers cap filters/sorting, the idea board, pending
    wallet profiles + detail/trade routes, the alert badge lifecycle, invalid-address labeling, the
    sign-in contrast/home links (dark+light), and mobile wallet explorer in EN/ID.
- Read-only contract check against `narra_ent` (`scripts/check-workspace-readonly.ts`, read-only
  PostgreSQL connection, injected local identity — not a live Privy login):
  - 50 route responses validated against the web Zod contracts.
  - 60 active wallets; 15 with a profile, 5 pending, 40 invalid historical addresses (now labeled).
  - Cap ranges and ordering returned correct, FDV-free, ascending/descending results.

## Schema

`0015_early_radar_outcomes` is applied to the application database `narra_ent`
(`_prisma_migrations` finished; `EarlyRadarOutcome` and `EarlyRadarMeasurement` exist). The earlier
"deploy before running updated workers" blocker is resolved.

## Not verified

- Real Privy sign-in and owner-authenticated visual review.
- Genuine live wallet-performance provenance (the retained sample has no stored wallet trades in the
  last 24 hours) and live Wyntrax delivery.
- Wallet ingestion is not confirmed active; Smart Money shows stored records only and says so.

## Runtime state after this work

- Real API on `http://localhost:4000` (`/health` → `{"status":"ok","brand":"NARRAX"}`) and real web on
  `http://localhost:4010`, both started from the owner's `local-api.ps1` / `local-web.ps1` environment
  (no test-auth). `/app`, `/app/tokens`, `/app/opportunities`, `/app/smart-money`, `/app/alerts` and
  `/early-access` all return 200. No worker, market or narrative consumer was started, so no metered
  ingestion ran.

## Follow-up: early-access dots, open-state sync, admin contrast and dashboard (2026-10-17)

Five more owner requests, all in `apps/web` plus one cache fix in `apps/api`. No new external call and
no safety-rule change.

1. **Early-access dots now run.** `.access-atmosphere` (the dotted field behind the sign-in page) was a
   static `radial-gradient`. It now drifts one full 28px tile diagonally (`access-dot-drift`, 8s linear)
   so the field visibly moves, and the animation is switched off under `prefers-reduced-motion: reduce`.
2. **Opening early access now shows on the page immediately.** Root cause was two-layered:
   - The API's public `GET /v1/early-access/status` is cached per process for 30 seconds and the admin
     `PUT /v1/admin/entitlements/settings` never cleared it. `invalidatePublic()` now drops both the
     status and requirements caches after any settings change, admin grant/revoke, or self join/leave
     (`apps/api/src/entitlements/routes.ts`), so the public pages reflect a change at once.
   - The web `usePublicStatus` query now refetches on window focus with a 15s stale time
     (`apps/web/src/lib/queries.tsx`), so switching back to an open early-access tab re-checks.
   - The admin "Save" button is disabled until a reason is entered; that disabled button was previously
     hard to see, so a save could be missed. Disabled controls are now clearly visible and each form
     says *why* it is blocked ("Add a reason to enable saving."). `adminSaved` no longer claims a 30s
     delay.
3. **Disabled admin buttons are visible.** `.admin-card :is(button,.research-control):disabled` keeps
   full opacity with muted text and a dashed edge instead of a 45% ghost; the primary button gets its
   own readable disabled fill.
4. **Space between admin cards.** Stacked admin cards had no gap (only the two-column grid did).
   `.admin-card + .admin-card` / `.admin-grid + .admin-card` now add 22px, with a reset inside the grid
   so its own `gap` still governs the columns.
5. **Admin dashboard UI.** A new overview strip leads the page: an open/closed state pill plus seat
   metrics (used / available / cap / active grants). Seat stats are fetched once at page level (only
   after the admin settings call succeeds) instead of inside the settings card.

### Verification (follow-up)

- Web unit suite: **469 passed, 0 failed** (21 files), including a new
  `src/features/admin/page.test.tsx` (overview open/closed state + seat metrics, and the disabled-save
  hint clearing once a reason is entered).
- Typecheck: repository root + `@narra/web` passed. Lint: `@narra/web` passed.
- Backend suite (isolated test database + isolated Redis): **1,191 passed, 0 failed, 0 skipped,
  94 files**. A first full run had one environmental 10s `beforeAll` hook timeout in `apps/api/src/b7.test.ts`
  (a cold-start Prisma/app build); it passes 25/25 in isolation and the full suite passed cleanly on
  re-run.
- Browser (Playwright): **not re-run for this follow-up.** The suite substitutes the auth adapter at
  compile time (`NARRA_WEB_TEST_AUTH=1`, `.next-e2e`) and must run against a fixture dev server on
  `http://localhost:4010`, which would displace the owner's real Privy dev server that was in use
  during this session. The previous batch's baseline is **82/82**. None of the follow-up changes are
  exercised by the mocked browser suite: the dot drift is decorative CSS, `refetchOnWindowFocus` is not
  triggered by the specs, the admin page is not visited, and the API is mocked.
- The running API must be restarted to pick up `invalidatePublic()`; until then the 30s per-process
  cache still applies. No settings were written on the owner's behalf — the application database
  `narra_ent` currently holds **no** `early_access.*` rows, so early access is closed until the owner
  saves it from the admin page (a reason is required).

### Root cause of "opened it but the page says not open yet"

The application database held no `early_access.*` rows at all, so the admin save had never persisted.
The likely reason is the invisible disabled **Save** button: saving requires a non-empty reason, and the
button was a 45%-opacity ghost, so a click on it looked like nothing happened. The follow-up makes that
button clearly visible, states *why* it is blocked, and (belt and braces) clears the server-side public
status cache the moment a save succeeds, so a successful save shows on `/early-access` immediately.
