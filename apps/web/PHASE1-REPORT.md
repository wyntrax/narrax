# Phase 1 verification report

Branch: `feat/web-phase1`, based on `9160bc9`. No push. Phase 2 requires the owner's explicit “go phase 2”.

Finalized 2026-10-12. Implementation and functional verification are complete; performance/SEO budget misses and live-integration limits are recorded below.

## Scope and files

- `apps/web/src/app`, `components`, `config`, `messages`: localized marketing, scoped design system, early-access UI, gated app placeholder, SEO/OG/robots/sitemap.
- `apps/web/src/features/access`: explicit state machine, exact-origin message proof, bounded membership polling, authoritative API-driven admission.
- `apps/web/src/lib` and `components/auth`: zod API boundary, fresh token per request, TanStack Query, lazy Privy adapter.
- `apps/web/e2e`, `production-e2e`, `src/**/*.test.*`, `scripts/lighthouse.mjs`: verification and screenshot/audit artifacts.
- Backend additions: public status route, its tests and one inventory classification. Owner-approved tooling exception: the existing contract-check helper and its test now pass the public fixture secret through process environment. No schema, worker, shared policy or other endpoint changes.

## Environment and operator configuration

| Name | Purpose / verification value |
|---|---|
| `NEXT_PUBLIC_API_URL` | Browser API origin; `http://localhost:4000` locally |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Public Privy app ID; `fixture-app` only in isolated browser tests, blank for unconfigured production checks |
| `NEXT_PUBLIC_WYNTRAX_URL` | HTTPS membership-claim link; tests use `https://wyntrax.example/claim` |
| `NEXT_PUBLIC_SITE_URL` | Canonical public origin; `http://localhost:4010` locally, HTTPS in deployment |
| `NARRA_WEB_TEST_AUTH` | Compile-time test adapter only; `1` selects `.next-e2e`; unset for production |
| `DATABASE_URL` | Process-only scratch URL targeting `localhost:5432/narra_ent`; owner supplied it directly after inheritance was unavailable |
| `REDIS_URL` | Process-only scratch Redis URL, database 5; owner supplied it directly |
| `NODE_ENV` | Managed by Next/Vitest commands; no custom production override |
| `NODE_OPTIONS` | Next wrapper appends its env-free preload for child workers, preserving inherited options |
| `NARRA_ENV_TEST_SENTINEL` | Dummy subprocess-only value in the env-isolation test; no deployment setting |
| `WYNTRAX_WEBHOOK_SECRET` | Existing contract-check helper now reads process environment; its test supplies the public fixture secret to its child process |
| `CORS_ORIGINS` | Existing API configuration; local web origin must be `http://localhost:4010` |

Non-env operator configuration: `entitlements.wallet_link_domain` must equal the exact web origin (scheme and port included); Privy's allowed origin must match. Production requires the HTTPS web origin. `.env.example` assignments remain blank. The agent did not open, print or edit any real `.env`, and did not use the scratch runner. However, Next's development server reported automatic `.env` loading during verification after a file appeared. The server was stopped; all Next scripts now use a tested CommonJS preload that disables env-file loading in the parent and workers. Both Vitest configurations redirect Vite 5 env discovery to an empty directory; `envDir: false` is unsupported in Vite 5 and was corrected. The backend command additionally uses `no-env-files.cjs` to prevent Prisma's optional `.env` discovery. Subsequent checks use process variables only. File contents were not displayed or inspected.

## Endpoint

`GET /v1/early-access/status` is unauthenticated. Successful response has exactly:

```ts
{ enabled: boolean; seatsLeft: number | null; inviteRequired: boolean }
```

60 requests/minute/IP; 30-second per-process cache with concurrent read coalescing; no edge cache. Disabled returns `seatsLeft: null`. Count uses distinct users holding active, unexpired EARLY_ACCESS-tier reservations across sources; cap reductions clamp remaining seats to zero. Refresh failure returns 503 rather than stale availability. Join remains authoritative and atomic.

## Correctness fixes

- Locale detection stays off: explicit URL locale wins; otherwise cookie first, EN fallback. Browser language does not select locale.
- Public availability renders outside the private provider/configuration condition, including with Privy unconfigured.
- Polling observes Retry-After, never polls faster than five seconds, continues after 429, and stops by two minutes.
- Identity-keyed controller remounts erase private state. A per-mount active/epoch scope guards all asynchronous completions and side effects; cleanup invalidates synchronously before passive cleanup. Late reads/signatures cannot populate another identity's cache, dispatch stale UI or submit stale proof.
- Cancel supersedes pending wallet SDK requests; retry is usable. `/app` has an identity-scoped ten-second readiness/data deadline.
- Anonymous config export warnings are fixed. The epoch warning was addressed through lifecycle ownership and regression tests rather than suppressing that warning.

## Backend diff scope

`git diff --stat main -- apps/api packages workers`:

```text
 apps/api/src/entitlements/contractCheck.test.ts |  2 +-
 apps/api/src/entitlements/inventory.test.ts     |  1 +
 apps/api/src/entitlements/publicStatus.test.ts  | 26 +++++++++++++++++++++++++
 apps/api/src/entitlements/routes.ts             | 22 +++++++++++++++++++++
 4 files changed, 50 insertions(+), 1 deletion(-)
```

The owner expressly approved the `contractCheck.test.ts` exception and corresponding `scripts/wyntrax-contract-check.mjs` change after the env-read guard exposed its unconditional root `.env` read. All existing contract assertions remain intact. The inventory addition classifies only the new public route.

## Unverified integrations

Real Privy login; real Phantom/Solflare message signing; real embedded-wallet creation/signing; live membership webhook delivery; deployment CORS; deployment HTTPS origin and matching wallet-link configuration. Browser auth/API/signatures are explicitly mocked. Automated axe checks do not establish a full manual assistive-technology audit.

## Verification results

- Web unit/component suite: **417 passed, 11 files**.
- Web lint: **passed, zero warnings/errors**.
- Whole-repository typecheck: **passed** (`tsc` for backend/shared/workers, then web).
- Full existing backend/shared/worker suite after baseline dependency restoration: **1,054 passed, 73 files**, real scratch PostgreSQL and Redis database 5. Includes all **5 public-status tests**, route inventory and the unchanged contract/signature assertions with env-free fixture setup.
- Complete fixture Playwright suite: **22/22 passed in one run**, 3.3 minutes. External/embedded adapters, join/leave/unlink, wrong domain, disabled/full/invite-only, 503, ten-second timeout, membership update/deadline, 429 Retry-After, connect cancellation, locale cookie and reduced motion are covered. Auth, wallet signatures and browser API responses are fixtures.
- Production Playwright: **6/6 passed**, using the real production bundle with Privy unconfigured. Both routes in light/dark mobile viewports have **zero axe WCAG 2 A/AA + 2.1 AA violations**, **zero browser console/page errors**, and **zero CSP violations**. Four fixture axe runs also have zero violations. Hydration scripts are nonced; production script policy has neither unsafe-inline nor unsafe-eval. Disabled/full/seat availability renders without Privy.
- Final production build: **passed**, run once after the implementation fixes. First Load JS: landing **192 kB**, access **186 kB**, gated placeholder **180 kB**, shared **105 kB**. Build warnings: Privy's optional `@farcaster/mini-app-solana` import is unresolved; next-intl's computed dynamic import cannot be tracked by webpack's filesystem cache. Neither prevented compilation. Farcaster functionality and configured live Privy remain unverified.
- Lighthouse exposed a favicon 404; added a deterministic `public/favicon.ico` and generator, restarted the same production build, and repeated production checks/Lighthouse. No second production build was run. `next-env.d.ts` was restored to its tracked, build-directory-independent declarations after Next generated its test-directory reference.

Earlier runs were interrupted by harness restarts or Chromium headless-shell navigation stalls. The final fixture run uses Playwright's Chromium channel. A dev-only empty script inserted by tooling made the initial hydration assertion misleading; the test now checks every inline script in the actual server HTML, while separate tests listen for live CSP violations. The 429 fixture now exposes Retry-After exactly as the real API does. These fixes retain the original behavioral assertions.

### Mobile Lighthouse and budgets

Lighthouse mobile defaults against localhost production; API availability is a local fixture, Privy ID blank. These are lab results, not field Core Web Vitals or configured-wallet costs. Final results (the post-favicon run, not the better score selected from earlier runs):

| Route | Performance | Accessibility | Best practices | SEO | LCP | CLS | Script transfer |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/` | **74** | **100** | **100** | **91** | **3.763 s** | **0.000075** | **203,693 B** |
| `/early-access` | **80** | **100** | **100** | **54** | **3.721 s** | **0.019535** | **240,821 B** |

Performance is below 90 and LCP exceeds 2.5 seconds on both routes; CLS is below 0.1. Do not interpret the passed build as passing performance budgets. Lighthouse identifies the text H1 as LCP on both pages. Landing: **528.5 ms total blocking**, **4.5 s main-thread work**, **1.9 s JS execution**, about **849 ms observed element render delay**. Access: **380 ms total blocking**, **6.6 s main-thread work**, **4.7 s JS execution**, about **1,226 ms observed element render delay**. React/client hydration and rendering contribute; the measured script transfer above includes loaded chunks, whereas Next's First Load JS uses a different accounting method. No single-library attribution was experimentally isolated.

SEO: Lighthouse reports missing head meta-description; browser inspection confirms Next 15 streamed the existing description into **BODY**. Early access is also intentionally blocked from indexing by robots/noindex. The low access SEO score is partly expected, but the streamed description audit remains a recorded limitation. Initial pre-favicon scores were 68/91 performance; final 74/80 variation is retained honestly. Raw HTML/JSON audits are at `C:\dev\narra-entitlements-review\web-phase1\production-final\lighthouse`; the portable summary is [verification/lighthouse-summary.json](verification/lighthouse-summary.json).

### Screenshots

All **18 states**, generated by the final complete fixture run, are committed under `verification/screenshots/`:

| State | Screenshot |
|---|---|
| signedOut | [signed-out.png](verification/screenshots/signed-out.png) |
| checking | [checking.png](verification/screenshots/checking.png) |
| noWallet | [no-wallet.png](verification/screenshots/no-wallet.png) |
| connecting | [connecting.png](verification/screenshots/connecting.png) |
| challenge | [challenge.png](verification/screenshots/challenge.png) |
| signing | [signing.png](verification/screenshots/signing.png) |
| verifying | [verifying.png](verification/screenshots/verifying.png) |
| linked | [linked.png](verification/screenshots/linked.png) |
| joining | [joining.png](verification/screenshots/joining.png) |
| active | [active.png](verification/screenshots/active.png) |
| disabled | [disabled.png](verification/screenshots/disabled.png) |
| full | [full.png](verification/screenshots/full.png) |
| inviteOnly | [invite-only.png](verification/screenshots/invite-only.png) |
| waitingSync | [waiting-sync.png](verification/screenshots/waiting-sync.png) |
| syncExpired | [sync-expired.png](verification/screenshots/sync-expired.png) |
| unlinking | [unlinking.png](verification/screenshots/unlinking.png) |
| leaving | [leaving.png](verification/screenshots/leaving.png) |
| error | [503-error.png](verification/screenshots/503-error.png) |

Additional fixture screenshots: [timeout](verification/screenshots/timeout.png), [wrong domain](verification/screenshots/wrong-domain.png), [leave confirmation](verification/screenshots/leave-confirmation.png), [unlink confirmation](verification/screenshots/unlink-confirmation.png), [landing dark mobile](verification/screenshots/landing-dark-mobile.png), [landing light mobile](verification/screenshots/landing-light-mobile.png), [access dark mobile](verification/screenshots/access-dark-mobile.png), [access light mobile](verification/screenshots/access-light-mobile.png), [Indonesian reduced motion](verification/screenshots/landing-id-reduced-motion.png).

Production screenshots: [landing dark](verification/production-screenshots/landing-dark.png), [landing light](verification/production-screenshots/landing-light.png), [access unconfigured dark](verification/production-screenshots/access-unconfigured-dark.png), [access unconfigured light](verification/production-screenshots/access-unconfigured-light.png). **31 screenshots total**. Browser HTML reports remain local under `apps/web/playwright-report/`; earlier traces and original production artifacts are archived under `C:\dev\narra-entitlements-review\web-phase1`.

## Dependencies and lifecycle scripts

See [DEPENDENCY-REPORT.md](DEPENDENCY-REPORT.md) for every high/critical finding, exact copies, reachability, and all **14** pending lifecycle approvals with build necessity. **No lifecycle scripts were approved.** Existing platform binaries/generated Prisma client were available; this is not proof a fresh scripts-disabled install generates all backend artifacts.

Baseline `9160bc9` versus final: **20 graphs, zero changed existing resolution edges**, including backend/shared runtime and peers. Restored Jayson's optional validator **5.0.10 → 6.0.6 → 5.0.10** and pinned **npm 10.9.4**, which preserves the private peer during scripts-disabled lock regeneration. Final lock has 1,591 records, 1,228 added paths, zero removed paths, zero changed retained versions; root Vitest gains 56 optional frontend tooling edges. Installed resolution checks and npm 10 CI dry-run passed; the backend suite passed after restoration.

Safe web-only fix: Next-private **source-map-js 1.2.2**, retaining root/shared **1.2.1**. Full audit: **49 package findings (33 moderate, 14 high, 2 critical)**; omit-dev audit reduced **34 → 33** (28 moderate, 5 high, 0 critical). The two critical entries are shared development **Vitest/Tinypool**. Remaining high findings include Next's pinned PostCSS, Privy-private ws, web glob tooling and backend Prisma tooling; no safe blanket upgrade was applied. This is not a clean security audit.

## Eleven-step history

| Step | Commit | Purpose |
|---|---|---|
| 1 | `7ae2688` | Next workspace and tooling |
| 2 | `e07a9fe` | Scoped tokens, primitives, bilingual layouts |
| 3 | `a9f190c` | Validated API/query boundary and lazy Privy |
| 4 | `0598b2d` | Interactive bilingual landing |
| 5 | `34c3392` | Access state machine and transition tests |
| 6 | `ccf3bc6` | Wallet proof and exact origin checks |
| 7 | `3488de6` | Bounded synchronization and gated placeholder |
| 8 | `4ced5c0` | Metadata, OG image and indexing policy |
| 9 | `6bf228e` | Public status endpoint and seats display |
| 10 | `4e3567b` | Regression/browser coverage and correctness fixes |
| 11 | This report's commit (`step 11: record phase 1 verification and handoff`) | Final evidence, dependency review, favicon and handoff |

The step-11 hash is available with `git log -1 --format=%h -- apps/web/PHASE1-REPORT.md`; a commit cannot contain its own hash. Exactly eleven commits follow `main`; nothing has been pushed. The unrelated `design/reference/` directory is owner work and is not part of these commits.
