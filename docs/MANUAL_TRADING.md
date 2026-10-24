# Manual user-signed trading

Status: implemented, locally verified, migrations applied to `narra_ent`, and local environment enabled; **no real swap executed yet**. Default off.

This document covers the separate `/app/trade` flow. It is not the automated executor, not paper trading, and not a recommendation engine. The server builds an unsigned Solana mainnet transaction; the user's verified wallet signs it; the API verifies and broadcasts it. Narrax never receives a private key.

## Separation from paper and automated trading

| Path | What it does | Funds | Storage |
| --- | --- | --- | --- |
| Paper trading (`/app/portfolio`) | Simulated preview/confirm using stored quotes | None | `Order`, `Position`, `Trade` with `simulated` |
| Automated executor | Dry-run only; no signing key accepted | None today | Execution jobs/orders |
| Manual trading (`/app/trade`) | User-approved mainnet swap | Real wallet | `ManualSwap` only |

Manual swaps do **not** create `Order`/`Position` rows, do not change paper PnL, and cannot be triggered by the executor.

## Requirements

1. Migration `20261022120000_manual_swaps` applied to the intended database.
2. `MANUAL_TRADING_ENABLED=true` (default `false`).
3. `JUPITER_API_KEY` for Jupiter Swap V2 `/build`.
4. `HELIUS_RPC_URL` (or another trusted mainnet RPC) for reads, simulation, send and status.
5. A linked, verified Solana wallet whose standard wallet exposes `solana:signTransaction`.
6. `research.tokens` access for the route feature gate.
7. HTTPS web origin and CORS configured for the API.

Never set `EXECUTOR_SIGNING_KEY`, `WALLET_PRIVATE_KEY`, `SOLANA_PRIVATE_KEY` or a seed phrase in the API. The backend deploy guard refuses signing-key variables; manual signing happens in the user's wallet.

## Wallet choice and funding

Logging in with Privy does not automatically link the embedded wallet to trading. The trade desk lists every connected wallet and separates **Ready to trade**, **Needs verification**, and **Cannot sign swaps here**.

- **Needs verification** means the wallet is connected but has not signed the wallet-ownership challenge. The trade desk offers **Verify now**, which signs the same challenge used by Early access. It is a message signature, not a transaction.
- A newly created Privy embedded wallet can be verified in place after it is funded. It still needs enough SOL for network and priority fees.
- Users who prefer another wallet can choose **Connect another wallet** or **Create a Privy wallet**; Narrax does not force the embedded wallet.
- The selected wallet's full address is shown with a copy button. The same panel states that SOL or tokens can be sent to it from any wallet or exchange and that Narrax never holds the funds.
- Only wallets that are both linked to the signed-in account and expose `solana:signTransaction` are selectable for a swap. A verified wallet without that feature is shown with an unsupported-wallet explanation instead of being silently hidden.

The ownership challenge only proves address control. It does not authorize a transaction, and the API never receives a private key or seed phrase.

## API

All routes require authentication and return `Cache-Control: private, no-store`.

| Method and path | Purpose |
| --- | --- |
| `GET /v1/manual-trades/config` | Enabled flag, `solana:mainnet`, caller's linked wallets |
| `POST /v1/manual-trades/research` | Assemble evidence and issue a 5-minute review ticket (`reviewId`) |
| `GET /v1/manual-trades/balances?wallet=&mint=` | SOL and token base-unit balances |
| `POST /v1/manual-trades/preview` | Re-check evidence, build/simulate/verify, create a `ManualSwap` quote |
| `POST /v1/manual-trades/submit` | Verify the signed message, claim the ticket, broadcast once |
| `GET /v1/manual-trades` | Caller's latest 20 swap attempts |
| `GET /v1/manual-trades/:id` | Caller's swap; reconciles `SUBMITTED` through RPC |

`GET /v1/manual-trades/config`, history and status are own-data routes (authentication only). Research, balances, preview and submit require `research.tokens`.

## Evidence and buy blockers

The review is built only from stored, source-backed evidence. It never invents identity, prices, holders, risk flags or smart-money endorsement.

Buy blockers:

- `NOT_INDEXED` — mint is not in the indexed token set
- `BLACKLISTED` — token is blacklisted
- `MARKET_MISSING` — no source-backed price within 15 minutes
- `LIQUIDITY_LOW` — missing or below $20,000
- `HOLDERS_MISSING` — no holder observation within one hour with at least 50 holders
- `RISK_MISSING` — no risk observation within one hour
- `RISK_FLAGS` — recorded risk flags include freeze/mint authority, honeypot or high-tax signals

Notes (shown, not buy-blocking): `CONCENTRATED`, `NARRATIVE_MISSING`, `NARRATIVE_LOCKED`, `SMART_MONEY_MISSING`, `SMART_MONEY_LOCKED`.

A SELL is not blocked by missing buy evidence, but still requires a valid route and all transaction checks. Missing or stale evidence is rendered as unavailable; it never becomes a positive rating.

The review ticket is a SHA-256 hash of the exact evidence plus a 5-minute expiry, stored as an audit record (`manual.research.review`). Preview and submit re-run the same assembly and compare the hash. A changed snapshot requires a fresh review.

## Transaction safety

The server fails closed on:

- RPC genesis hash not equal to Solana mainnet
- non-classic SPL mints, Token-2022 or token extensions
- active freeze authority on a buy
- price impact above 3%
- a quote without `ExactIn`, a mismatched input/output mint, amount or slippage
- Jupiter route layouts other than the observed V2 `route_v2` and `shared_accounts_route_v2`
- unknown programs, duplicate compute limits/prices, token instructions outside the allowlist, a SOL transfer that is not the user's wrapped-SOL setup, or accounts outside the resolved static/lookup set
- transaction size above the Solana limit
- an existing wrapped-SOL token account
- fees above the configured ceiling
- quotes older than 60 seconds, an existing unresolved swap for the same user+wallet, a wallet that is not linked to the caller, or a token/mint/side/amount that differs from the review
- a signed message that differs from the unsigned reviewed message, is not signed by the reviewed wallet, or has extra signatures
- simulation failure

The build uses Jupiter Swap V2 `/build`. The route-plan body is treated as opaque; the verifier binds the fixed V2 instruction prefix (amounts, slippage, platform fee) and the account indexes. The full message is compared byte-for-byte after signing, and lookup tables are fetched from chain and re-resolved before simulation.

`ManualSwap.signature` is persisted before `sendRawTransaction`. Replayed submits return the same signature; a second concurrent submit cannot send twice. If the send result is ambiguous, the row stays `SUBMITTED`, the API does not rebuild or resend, and the status endpoint reconciles through RPC. An unknown outcome is never converted into `FAILED` without chain evidence.

## Operator enablement

1. Back up the database.
2. Apply the migration: `prisma migrate deploy`.
3. Set `HELIUS_RPC_URL` and `JUPITER_API_KEY`; keep `MANUAL_TRADING_ENABLED=false`. Restart the API.
4. Check `GET /v1/manual-trades/config` returns `enabled: false`; the UI should show the disabled notice while research still works.
5. Verify a linked wallet and `research.tokens` access through the normal early-access flow.
6. Set `MANUAL_TRADING_ENABLED=true`, restart, and confirm the config now reports `enabled: true` with only the caller's wallets.
7. Perform a small, owner-approved mainnet swap end to end. Record the token, amount, signature, confirmation and any evidence gaps. A quote or simulation is not a completed trade.
8. If anything is wrong, pause first through Admin → trading pause (stops new quotes/submissions), then set `MANUAL_TRADING_ENABLED=false`, restart, and rotate the Jupiter key if needed. Do not mark an uncertain transaction failed without chain evidence.

## Known limits

- Classic SPL only; Token-2022 and extension-bearing mints are refused.
- Active freeze authority blocks buys.
- A wallet with an existing wrapped-SOL balance is refused.
- 3% price-impact cap; no partial fills, limit orders or automated exits.
- An unresolved `SUBMITTED` swap blocks another quote for that user+wallet until reconciliation.
- Manual swaps are excluded from paper PnL and portfolio analytics.
- No USD cost basis or tax reporting for manual swaps.
- Only the two observed Jupiter V2 layouts are accepted. A future Jupiter layout change will fail closed until the verifier is updated and tested.
- No real mainnet swap was executed during implementation verification. Local provider keys and `MANUAL_TRADING_ENABLED=true` are configured, but a real quote/sign/send/confirm cycle remains the next acceptance test.

## Verification

- Full backend **1,427 tests / 126 files**, zero failures/skips/todo, isolated PostgreSQL `narra_radar_test_20261016` and Memurai `127.0.0.1:16389`.
- Full web **623 tests / 43 files**; root/web typechecks and web lint.
- 14 manual-trade integration tests: auth/ownership, evidence review without fabricated smart-money endorsement, missing/stale/future market provenance, buy/sell blocking, operator pause, fresh own review, linked-wallet ownership, invalid signature, concurrent/replayed submit with one send, ambiguous send, terminal status.
- V2 route verifier unit tests: both live layouts plus mutations of amount, slippage, platform fee, account indexes and minimum output.
- Fixture-auth Chromium checks cover the full buy flow at 1440/768/390 px, dark/light, EN and ID, with zero axe violations and no horizontal overflow.

The isolated test database was reset and all migrations applied cleanly. On 2026-10-22 the application database `narra_ent` was backed up with `pg_dump` and both pending migrations (`20261021052916_wallet_research`, `20261022120000_manual_swaps`) were applied with `prisma migrate deploy`; `prisma migrate status` now reports **schema up to date**.
