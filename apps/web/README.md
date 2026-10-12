# Narra web — Phase 1

The owner's Phase 1 brief and subsequent decisions replace the missing product spec **for Phase 1 only**. Marketing uses 16–20px corners, restrained lime glow and motion. Product surfaces reserve the prototype's 6px corners, dense layouts and no glow/pulsing. Phase 2+ needs another decision for screens not covered by the prototype.

## Windows development

Use the root-pinned **npm 10.9.4** with `npm ci --ignore-scripts`, then `npm run dev:web`. Review lifecycle scripts separately. npm 11.16.0 was observed incorrectly deduplicating Jayson’s optional ws 7 validator against an incompatible ws 8 peer; `node apps/web/scripts/check-backend-lock.cjs` checks baseline resolution preservation. Next.js listens on **4010**, the API on **4000** (owner-approved port arrangement for this phase). No workers are needed for the web app.

Supply public values through the inherited process environment. The Next scripts explicitly disable automatic env-file loading, including forked workers. `.env.example` intentionally has blank assignments only.

| Variable/config | Local setup |
|---|---|
| NEXT_PUBLIC_API_URL | http://localhost:4000 |
| NEXT_PUBLIC_PRIVY_APP_ID | Your public Privy app ID |
| NEXT_PUBLIC_WYNTRAX_URL | Your HTTPS membership claim page |
| NEXT_PUBLIC_SITE_URL | http://localhost:4010 (production: canonical HTTPS web origin) |
| NEXT_PUBLIC_X_URL | Optional credential-free HTTPS Narra profile; no social button when absent/invalid |
| NEXT_PUBLIC_TELEGRAM_URL | Optional credential-free HTTPS Narra community; no social button when absent/invalid |
| API CORS_ORIGINS | http://localhost:4010, exactly; API refuses `*` |
| Admin entitlements.wallet_link_domain | http://localhost:4010 |
| Privy dashboard allowed origin | http://localhost:4010 |

Production wallet-link domain must equal the **HTTPS web origin**, not the API origin. Before signing, the browser compares the exact `Domain:` string to `window.location.origin`. No message rewriting is permitted.

Scripts: `npm run dev:web`; `npm run build -w @narra/web`; `npm run start -w @narra/web`; `npm run lint -w @narra/web`; `npm run typecheck`; `npm run test -w @narra/web`; `npm run e2e -w @narra/web`.

API credentials are obtained with Privy's `getAccessToken` for each request, never copied to application storage. Wallet proof is a message signature only. No trading or transaction UI exists in this phase.

## Public availability

`GET /v1/early-access/status` is the only backend addition: unauthenticated, 60 requests/minute/IP, with a 30-second per-process cache and concurrent-read coalescing. It returns only `{enabled, seatsLeft, inviteRequired}`. Disabled availability has `seatsLeft: null`; unknown never becomes zero. Counts are distinct users with active, unexpired EARLY_ACCESS-tier reservations across self-service and ADMIN sources. Existing seats survive unlink/disable/cap reduction. Join remains the atomic admission authority. Failed cache refresh returns 503, not stale data. Edge caching is disabled to avoid adding another stale window.

## Verification

Unit/component tests: `npm run test -w @narra/web`. Whole-repo types: `npm run typecheck`. Existing backend/shared/worker suite: `npm test`, using process `DATABASE_URL` (`localhost:5432/narra_ent`) and `REDIS_URL` (database 5). For verification, set `NODE_OPTIONS=--require=C:/dev/narra-entitlements/apps/web/scripts/no-env-files.cjs` to disable Prisma's optional env-file discovery too. Never use the env-reading scratch runner for this workflow. Vite 5 env discovery is redirected to the empty `no-env-files` directory.

The network-mocked browser suite substitutes an auth adapter **at compile time**, using `NARRA_WEB_TEST_AUTH=1` and isolated `.next-e2e` output. Set public fixture values in the process environment: API `http://localhost:4000`, Privy `fixture-app`, site `http://localhost:4010`, Wyntrax `https://wyntrax.example/claim`. Start `npm run dev -w @narra/web`, then `npm run e2e -w @narra/web`. Browser API routes and signatures are fixtures; these tests do not authenticate with Privy or a real wallet. Do not deploy `.next-e2e`.

For the final production check, stop the fixture server, unset `NARRA_WEB_TEST_AUTH`, leave the public Privy ID blank, and build/start normally with API/site origins above. Run `npx playwright test --config playwright.production.config.ts` from `apps/web`. This tests the real production nonce policy, console errors, accessibility and public availability with Privy unconfigured. Run `node scripts/lighthouse.mjs` from `apps/web` for mobile Lighthouse; it temporarily serves fixture availability on API port 4000, which must be free.

Live screenshots/reports are under `apps/web/test-results/` and `apps/web/playwright-report/`. Each browser run replaces its own output directory; retain artifacts before another run. Final screenshots and Lighthouse summary are committed in `verification/`. Final results and limits are recorded in `PHASE1-REPORT.md`; dependency details are in `DEPENDENCY-REPORT.md`. Stop the web server before the root suite: its existing contract-check test temporarily binds port 4010.

Locale detection remains disabled. Explicit locale URLs win; unprefixed URLs use a valid `NARRA_LOCALE` cookie, otherwise EN, regardless of browser language. The toggle remembers the choice before navigation. `NARRA_THEME` stores the selected color scheme. Neither cookie contains authentication data.

## Reference-led design branch

`docs/DESIGN_HANDOFF.md` is the current design verification index; `docs/DESIGN_SPEC_PHASE1.md` records reference interpretation, intentional omissions and the EN/ID copy ledger. `docs/PERF_BASELINE.md` records five-run production medians. All before/after state/viewport/theme images are indexed in `docs/design-captures/README.md`; compact side-by-side reference comparisons are under `docs/design-review/`.

Production builds **reject any set `NARRA_WEB_TEST_AUTH` value**, including `0`, and automatically scan `.next` for fixture auth/gallery leaks. Unset the variable for build/start. Test safety is documented in `docs/TEST_AUTH_SAFETY.md`. The design gallery is compile-time fixture code only, never a production route.

From `apps/web`, `npx playwright test --config playwright.visual.config.ts` checks 32 committed visual baselines. Deliberate full capture uses `playwright.capture.config.ts` with `NARRA_DESIGN_CAPTURE_DIR` set to an output directory and `NARRA_DESIGN_AXE=1` for all-state axe checks. Warm routes first; keep one worker and one heavy verification process at a time. `node scripts/lighthouse.mjs <output-directory> 5` runs five sequential mobile audits per route and writes medians.
