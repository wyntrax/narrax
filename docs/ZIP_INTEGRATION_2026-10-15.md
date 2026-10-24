# ZIP integration — 2026-10-15

## Follow-up fix — 2026-10-16

The owner subsequently requested live requirements on the landing as well. This supersedes the original placeholder-preservation decision below:

- Landing cards now use `fetchRequirements` and the admin-backed `/v1/access/requirements` endpoint. Removed the compatibility placeholders. The web fetch is uncached; the API retains its existing 30-second cache. Unavailable paid requirements are labeled explicitly.
- Early Access explicitly requires **no token holding** and links to `/early-access`. Member/Pro/Elite link to `/app`, which presents sign-in when signed out. Paid-tier amounts and symbol use the API response and locale-specific number formatting.
- Copy explains that paid entitlements require a verified wallet and valid Wyntrax webhook-backed membership, including status and expiry. Tier-card clicks do not grant access. Existing server membership resolution and workspace entitlement refresh remain authoritative; no rollout settings were changed.
- Fixed stuck graph connectors: the old even-path fixed `stroke-dashoffset` overrode the group's animated value. Animation now runs on every path with staggered delays. Offscreen pause and reduced-motion behavior apply to every path.
- Verification: three tier-card/fetch tests, 14 pure entitlement tests, repository/web typechecks, web lint, three focused browser tests, and production build/auth scan (326 files) passed. The animation regression checks the offsets of all five actual paths, not just their group.
- Real public-page checks compared all three paid amounts against the API in EN desktop and ID mobile, verified token-free early access, followed the paid link to the real `/app` sign-in gate, and found zero axe A/AA violations or horizontal overflow. Screenshots: temporary `narra-live-tier-cards-{en,id}.png`.
- Normal production web restored on 4010 and API on 4000 after the harness restart; narrative worker restored after confirming zero queue consumers. No database-writing tests or live membership webhook events were submitted.

Source: `C:\Users\gifar\Downloads\Chrome\narra-changed-files.zip` (47 files).
Integrated into `C:\dev\narra-entitlements`; the source archive remains intact.

## Merge decisions

- Imported the five workspace routes: Smart Money, Alerts, Analytics, Agent and Settings; their contracts, authenticated writes, navigation and EN/ID messages.
- Imported admin tier requirements, token symbol/mint, early-access closing date and seat duration, plus public `GET /v1/access/requirements` and admission rules.
- Retained the REA-inspired landing markup and animations. An exact pre/post comparison confirms its only page-source additions are the `PoweredBy` import and hero attribution. The shared footer also has attribution.
- Retained the redesigned early-access split layout; manually added the ZIP's public tier summary and Wyntrax link. Paid-tier amounts there come from the API. The landing's existing unknown-requirement placeholders are preserved through a compatibility export, per the requested landing exclusion.
- Preserved the `visual` translation namespace while incorporating incoming EN/ID updates. Existing nullable-narrative and topbar fixes are retained and regression-tested.
- Prevented starting a new chat while its reply is pending, avoiding an old response being appended to a new conversation.
- Tier defaults in the archive are 500,000 / 1,000,000 / 10,000,000 `$WYNTRAX`. These describe requirements; actual paid access still follows verified Wyntrax membership/webhooks. No on-chain balance gate was introduced.

## Backups and evidence

Pre-merge copies of all 30 affected existing files, inventory and the original comparison are at:
`C:\Users\gifar\AppData\Local\Temp\opencode\narra-zip-review-20261015\`.
Staged incoming files were moved into the repository through patches after review; the two older marketing pages remain in that review directory.

Final public screenshots: `C:\Users\gifar\AppData\Local\Temp\opencode\narra-zip-{1440,390}-{landing,access}.png`.
Reference evidence and earlier redesign verification: `apps/web/docs/LUORA_REFRESH.md`.

## Verification

- Repository and web typechecks; web lint; **464 web tests** passed.
- **22 database-free tests** passed: shared tier configuration/admission and API route inventory.
- **37 focused browser tests** passed, one worker: 25 access/navigation regressions, six ZIP-integration tests, six nullable-narrative/topbar/request-error regressions. New tests cover EN desktop/ID mobile, own-data writes, conversation IDs and plain-text replies, attribution, accessibility and overflow. Initial new-test failures were fixture re-login/translation-selector errors; corrected and all six reran successfully.
- Production build succeeded. Production auth scan passed across **326 files**; fixture auth is absent. Existing optional Privy `@farcaster/mini-app-solana` build warning remains.
- Normal production server on **4010** and API on **4000** return 200. Public requirements endpoint returns the configured/default tier amounts, null mint/closing date/seat length. Current early access is disabled in existing local settings; integration did not alter that setting.
- Four final real public-page checks (EN desktop dark, ID mobile light; landing and early access) passed with zero axe A/AA violations and no horizontal overflow.
- Database-writing `tierConfig.test.ts` was imported but **not run**: a separate confirmed test database is still required. No application-data fixtures were inserted by verification. Owner-authenticated end-to-end checks remain for the owner; private browser tests used intercepted fixture APIs.

Normal frontend environment was restored and `npm run start -w @narra/web` serves the verified production build. API was restarted to load the merged routes. The narrative worker was restarted only after Redis confirmed zero consumers; its existing 30-minute schedule was retained.

No commit or push performed.
