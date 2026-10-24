# Dashboard market evidence and design refresh — 2026-10-16

## Delivered

- Tokens and Opportunities default to a source-backed Solana market watchlist: price, market cap versus FDV, liquidity, 24-hour volume, measured 1-hour price change, volume/liquidity ratio, quoted pool creation time and DEX Screener links. Search and keyset pagination run on the server. Pro screener modes select liquidity, volume or pools under 24 hours; basic token access still gets the alphabetical source-backed list.
- `research.market.<tokenId>` metadata records the provider and **exact metric ID** atomically with each price observation. A legacy metric cannot inherit a newer provider's evidence. Current scans require DEX Screener evidence and metric age at most 15 minutes, excluding future timestamps and blacklisted tokens. Pool-age mode uses the quoted pool's source timestamp rather than a retained token-age proxy. UI polls these snapshots every minute while visible and offers manual refresh.
- Stored token lists, opportunity scores/analysis and token holder/risk/consensus models remain available through explicit historical inspection. Unverified wallet performance, win rates and scores are hidden initially; default Smart Money shows addresses, origin, profile computation time and explorer links. Topbar wallet flow is labeled unverified. No existing account/history rows were deleted.
- Dashboard-wide Outfit typography, graphite panels, pill controls/navigation, finer table surfaces, dotted backgrounds, responsive cards, light theme and reduced-motion support match the landing's styling. EN/ID copy is included.

## Live collector

Run `npm run dev:market` with the owner's supplied process environment (`DATABASE_URL`, `REDIS_URL`, optional provider base URLs). This is a standalone market-data queue consumer, sharing the existing five-minute `refresh` scheduler. It checks for existing consumers before starting. Do not run it alongside a full pipeline consumer of the same queue. The social consumer remains `npm run dev:narratives` with its separately configured 30-minute schedule.

The collector samples GeckoTerminal page 1 of new and trending Solana pools, deduplicates mints, filters liquidity below $5,000 before applying the 20-pool discovery cap, then requests DEX Screener quotes. Existing `MARKET_DATA_LIMITS` retain the 150-token refresh cap, 30-token batches and bounded slow info calls. These are operational starting values, not calibrated trading thresholds. An origin-only GeckoTerminal URL is normalized to `/api/v2`; custom URLs retain their supplied path.

Real scheduled runs wrote 34, 36 and 37 token snapshots in the inspected logs; SOL/USD updated. GeckoTerminal sometimes returned HTTP 429 during holder lookups. Other market observations continued, and unavailable holder values were not fabricated. A later read-only database check verified current rows, evidence matching and distinct next pages for symbol/liquidity/volume/pool-age sorts. Redis reported one market and one narrative consumer. Counts and prices are transient observations, not hardcoded UI values.

## Verification

- 467 web unit tests passed.
- 28 database-free market-provider/evidence tests passed.
- 46 distinct selected Playwright checks passed, workers=1: all 36 research checks, five market-evidence checks and five additional workspace integration checks. The initial 40-test invocation reached 19 passes before its shell timeout; the remaining 21 passed in a separate invocation. Four market tests were subsequently repeated after adding refresh polling, alongside the wallet evidence check and additional workspace checks.
- Browser coverage includes desktop/mobile, light/dark, EN/ID, axe accessibility, overflow, nullable data, missing/error states, lower-tier token access, historical analysis, wallet score concealment and authenticated fixture transports. UI tests intercept APIs; they do not establish a real Privy or Wyntrax session.
- Root/web typechecks, web lint, production build and auth scan (327 files) passed. Existing optional Privy `@farcaster/mini-app-solana` warning remains.
- Real DEX Screener/GeckoTerminal ingestion and read-only database queries verified; no database-writing test suite ran on the application DB. Full backend integration suite still requires isolated Postgres/Redis.
- Normal production web restored on 4010; API on 4000. Health returned 200, unauthenticated current-token API returned 401, and the production browser rendered its sign-in gate. No commit or push.

## Remaining work

1. Owner reviews the authenticated dashboard at `http://localhost:4010/app/tokens` and the Opportunities/Smart Money views.
2. Establish genuine Helius wallet-event provenance and a verified performance window before exposing live wallet rankings/PnL as trustworthy. Manually registered addresses and recently recomputed profiles do not establish that evidence.
3. Improve provider coverage/rate-limit behavior and refresh fairness beyond the existing 150-token cap. The scan is sampled Solana pools, not all launches or a verified memecoin classification.
4. Validate holder/authority coverage and calibrated opportunity scoring on genuine observations. The current watchlist is market research, not a newly generated scored trading recommendation.
5. Isolate backend test services, then run database-writing integration tests. Existing APIs/agent tools still expose stored historical data; the provenance separation delivered here applies to the dashboard's current market scan, not a system-wide purge of all legacy data.

No real `.env` files or `design/reference/` were read or changed. Owner local PowerShell assignments were loaded via AST into child process environments without printing values.
