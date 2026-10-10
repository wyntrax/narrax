# Narra web — Phase 1

The owner's Phase 1 brief and subsequent decisions replace the missing product spec **for Phase 1 only**. Marketing uses 16–20px corners, restrained lime glow and motion. Product surfaces reserve the prototype's 6px corners, dense layouts and no glow/pulsing. Phase 2+ needs another decision for screens not covered by the prototype.

## Windows development

From the repository root: `npm install`, then `npm run dev:web`. Next.js listens on **4010**, the API on **4000** (owner-approved port arrangement for this phase). No workers are needed for the web app.

Supply public values through your process environment or a locally managed web env file. The agent never reads or modifies real env files. `.env.example` intentionally has blank assignments only.

| Variable/config | Local setup |
|---|---|
| NEXT_PUBLIC_API_URL | http://localhost:4000 |
| NEXT_PUBLIC_PRIVY_APP_ID | Your public Privy app ID |
| NEXT_PUBLIC_WYNTRAX_URL | Your HTTPS membership claim page |
| NEXT_PUBLIC_SITE_URL | http://localhost:4010 (production: canonical HTTPS web origin) |
| API CORS_ORIGINS | http://localhost:4010, exactly; API refuses `*` |
| Admin entitlements.wallet_link_domain | http://localhost:4010 |
| Privy dashboard allowed origin | http://localhost:4010 |

Production wallet-link domain must equal the **HTTPS web origin**, not the API origin. Before signing, the browser compares the exact `Domain:` string to `window.location.origin`. No message rewriting is permitted.

Scripts: `npm run dev:web`; `npm run build -w @narra/web`; `npm run start -w @narra/web`; `npm run lint -w @narra/web`; `npm run typecheck`; `npm run test -w @narra/web`; `npm run e2e -w @narra/web`.

API credentials are obtained with Privy's `getAccessToken` for each request, never copied to application storage. Wallet proof is a message signature only. No trading or transaction UI exists in this phase.

## Public availability

`GET /v1/early-access/status` is the only backend addition: unauthenticated, 60 requests/minute/IP, with a 30-second per-process cache and concurrent-read coalescing. It returns only `{enabled, seatsLeft, inviteRequired}`. Disabled availability has `seatsLeft: null`; unknown never becomes zero. Counts are distinct users with active, unexpired EARLY_ACCESS-tier reservations across self-service and ADMIN sources. Existing seats survive unlink/disable/cap reduction. Join remains the atomic admission authority. Failed cache refresh returns 503, not stale data. Edge caching is disabled to avoid adding another stale window.
