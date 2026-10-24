# Phase 2 — Narrax research workspace

## Delivered scope

The owner approved the prototype and existing API contracts in place of the missing full product spec. This implementation follows the prototype's intelligence bar, collapsible sidebar, central workspace and collapsible context panel, adapted to Narrax's monochrome brand and Rajdhani/Barlow typography. Mobile uses a navigation drawer, bottom navigation, stacked data tables and a context dialog. Existing theme and EN/ID controls remain available.

| Route (also available under `/id`) | Source and behavior |
|---|---|
| `/app` | `GET /v1/overview`: account counts, rules-generated brief, narrative leaders, highest-scoring opportunity and rotation |
| `/app/radar` | `GET /v1/narratives` and `/v1/narratives/rotation`: stage filter, cursor pages, keyboard-selectable score/stage plot and comparison-window control |
| `/app/narratives/[slug]` | Narrative detail: lifecycle stage, recorded social metrics, associated creators and linked tokens |
| `/app/opportunities` | Opportunity cursor pages, selection, page-local sorting, component scores and on-demand structured analysis |
| `/app/tokens` | Supporting directory with server-side name/symbol/mint search and cursor pages |
| `/app/tokens/[mint]` | Latest price/market metrics, holders, recorded risk flags, wallet consensus and linked narratives |

All research routes are noindex. The workspace is read-only. No backend endpoints, migrations, dependencies or trading operations were added.

## Data and access behavior

### Nullable research response fix — 2026-10-15

The local API legitimately returns `narrative: null` on opportunities with no narrative relationship, including the overview's hottest opportunity. The frontend previously required an object, rejected both envelopes with `INVALID_RESPONSE`, and consequently blanked the whole topbar. Both contracts now accept null; the list, detail and overview display localized “No linked narrative” without generating a narrative link.

The topbar distinguishes loading, access restrictions, request failures, missing readings and stale SOL prices. Recorded zeroes still render as zero. Stale SOL prices are labeled rather than presented as a current price; their observation timestamp is available on hover. Failed snapshot requests can be retried from the bar. Research errors distinguish connection, timeout, invalid-response, configuration, rate-limit and service failures instead of blaming every failure on the connection.

Verified: 447 web unit/component tests, repository/web typechecks, web lint, and six focused browser regressions (one worker, mocked APIs/auth), including EN desktop and ID mobile with zero axe violations. Read-only connections to the local database validated real in-process API route responses for overview, opportunities, token list/detail and narrative list/detail/rotation; the verifier was a test adapter, not live Privy authentication. Three inspected opportunity analysis requests returned expected `NOT_FOUND` because no visible decision was available. Owner-authenticated browser rendering remains unverified. Normal API/web services were restarted after the browser tests; Treg was restarted after the harness interruption. The market-data worker is still not running, and legacy research associated with preserved trading/analysis records remains in the database.

- `src/features/research/contracts.ts` validates responses at the client boundary and strips unused fields. Nullable readings remain **Unknown**, distinct from recorded zeroes.
- `src/features/research/api.ts` reuses the existing authenticated transport. The shared transport now accepts query cancellation; access API methods keep their prior signatures and behavior. Tokens are retrieved per request and are never persisted by research code.
- Query scopes remount on auth identity changes. In-flight reads consume the cancellation signal; late previous-account data cannot populate the new account's view. Data is removed immediately on sign-out.
- Entitlements refresh on focus, every 60 seconds and at the scheduled next expiry. A changed access snapshot remounts the research cache; an entitlement error replaces the workspace with a retry state. Explicit refresh/expiry revalidation clears the displayed research while checking.
- Whole-feature gates apply to narrative, rotation and token reads, accounting for rollout enforcement. The server remains authoritative and a server `FEATURE_LOCKED` response is shown even after a locally allowed snapshot.
- Overview and opportunities retain the API's mixed-access semantics: a user with no shared-research entitlement can still see their own account counts and own opportunities/analysis.
- Research queries are stale after 30 seconds and revalidate on focus. This is snapshot data, not a streaming feed. API/auth waits are bounded at 10 seconds; failed, malformed, missing, empty and restricted responses have explicit states.
- Page size is 20, subject to the server's tier cap. Opportunity sorting applies only to the loaded page; the API itself restricts its candidate set to its newest 500 records. Token search follows the API's 64-character limit.
- Research translations are scoped to the workspace layout; 176 EN/ID message keys match. API-authored narrative/analysis text is displayed in its source language.

## Prototype adaptations and API gaps

| Prototype concept | Implemented with available data |
|---|---|
| Rich price history and event overlays | One explicitly labeled latest-price observation. Historical candles and token event history are unavailable; no fabricated candles, price path or events |
| Full lifecycle timeline | Current ordered lifecycle stage and first-detected/updated timestamps. Transition history is unavailable |
| Radar progression | Categorical lifecycle stage versus recorded score. Markers have constant size; this is not elapsed time or a prediction |
| Market intelligence narrative | Existing rules-generated brief, labeled accordingly; no invented AI brief |
| Research/context assistant | Access tier, workspace explanation, refresh and access-management controls; conversational research is outside this phase |
| Rich social/creator feeds | Only the associated creators and latest social metrics exposed by narrative detail |

The SVG snapshot chart is dynamically loaded. Unknown historical data is explained directly in the relevant screen. Model recommendations, OG estimates, rotation thresholds and source uncertainty retain contextual explanations.

## Verification — 2026-10-12

- **434 web unit/component tests passed**, including new schema, cancellation and cross-identity isolation coverage. The auth-boundary tests were rerun after the fallback-landmark change.
- **57 functional browser tests passed**, one worker: the existing 25 marketing/access/wallet tests and 32 new research tests.
- The research suite checks all six routes at **1440 and 390 px, dark and light**: **24 views with zero axe WCAG A/AA violations**, no console/page errors and no document or workspace horizontal overflow. The fixed-height workspace has no accidental document vertical overflow.
- Covered read-only authenticated requests, linked navigation, keyboard radar selection, filters/cursors/search, structured analysis, NONE-tier own records, server-authoritative locks, access downgrade, sign-out, invalid responses, retry, missing records, loading, mobile dialogs and EN/ID/theme switching.
- Fixed keyboard access to scrolling intelligence/lifecycle sections and a positioned hidden table header that previously escaped the workspace scroll container.
- **8 production browser checks passed**, including accessible EN/ID unconfigured-workspace fallbacks, private-route noindex, existing public admission behavior, nonce CSP and console checks.
- Whole-repository typecheck and web lint passed. Production build passed; fixture-auth scan passed across **297 files**. No auth/gallery fixture bypass is shipped.
- Production First Load JS: landing **153 kB**, early access **187 kB**, research routes **187–189 kB**. These bundle sizes are not Lighthouse or runtime performance measurements.
- The build retains the existing optional Privy warning about `@farcaster/mini-app-solana`; no dependency workaround was introduced.
- [24 retained screenshots](phase2-captures/README.md) use network-mocked records and compile-time fixture authentication. They are UI verification evidence, not live market data.

### Reproduce

Use the env-free scripts and process-provided public values documented in `../README.md`. Start the isolated fixture dev server, warm the routes, then run:

```text
npm run test -w @narra/web
npm run typecheck
npm run lint -w @narra/web
npm run e2e -w @narra/web -- --workers=1
```

Stop the fixture server, **unset** `NARRA_WEB_TEST_AUTH`, build/start the production app with the Privy ID blank, then run `npx playwright test --config playwright.production.config.ts --workers=1` from `apps/web`. The build automatically performs the production-auth scan.

## Remaining live verification

The browser suite uses mocked APIs. Live Privy login, real wallet signing, real research records, configured production origins/CORS/HTTPS and membership webhook sync have not been verified here. Database/Redis-backed backend tests were not rerun without inherited service credentials. No real `.env` was read or changed.

The Phase 1 performance report remains historical; its unresolved mobile performance targets were not remeasured or claimed resolved in Phase 2. No Phase 2 Lighthouse result is claimed.

Existing user-authored wallet-proof clock-skew and bounded expiry-refresh changes were preserved. Phase 2 reuses the bounded scheduler. The working tree also contains the prior uncommitted Narrax rebrand; this delivery has not been committed or pushed.
