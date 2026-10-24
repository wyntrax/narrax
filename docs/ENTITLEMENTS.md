# Research entitlements

## Mandatory authorization (October 19, 2026)

Owner-approved preview exception: authenticated `GET /v1/market-preview` is tier-independent and exposes only snapshot timestamp, SOL price with stale metadata, narrative heat and two aggregate counts (active tracked wallets / recorded opportunities over 24h). No detail research, identities, flows or private data. The richer intelligence endpoint remains gated. This limited preview powers the topbar at every tier, including NONE.

Research permissions are always enforced. This supersedes rollout/off/shadow instructions elsewhere in this document: legacy `entitlements.enforced` rows cannot disable authorization, and denial logging is only logging. HTTP routes, mixed research envelopes, Agent tools and realtime delivery check resolved feature permissions. Denied UI routes show visible locks without mounting restricted content; the server remains authoritative if a client changes its URL or state. Portfolio, Alerts, Settings and separately authorized Admin access remain tier-independent. Pro is the highest offered tier; legacy Elite memberships/overrides resolve to Pro. No migration is needed for this change. See the latest verification in `docs/CONTINUATION.md`.

## Membership webhook setup

On each Wyntrax membership, enable the existing Solana token gate and set the public HTTPS URL ending `/v1/integrations/wyntrax/events`. Use integration key `MEMBER`, `PRO` or `ELITE`. Wyntrax treats keys as opaque text; Narra interprets these three keys. Copy the creator signing secret to `WYNTRAX_WEBHOOK_SECRET`. During rotation, retain the old value in `WYNTRAX_WEBHOOK_SECRET_PREVIOUS` until in-flight requests complete. Secrets stay in deployment configuration.

There is no production entitlement data. Apply `packages/database/prisma/migrations/0013_membership_webhooks` and regenerate Prisma. This migration discards obsolete aggregate membership state and receipts; previous applied migrations, including `0012_entitlement_age`, remain immutable. Obtain new secrets from Wyntrax and re-evaluate memberships after deploying both sides.

## Wire contract

```json
{"id":"evt_example","type":"membership.granted","occurredAt":"2026-10-09T12:00:00.000Z","data":{"membershipId":"membership_1","key":"PRO","chain":"solana","wallet":"So11111111111111111111111111111111111111112","seq":1,"validUntil":"2026-10-09T18:00:00.000Z","checkedAt":"2026-10-09T12:00:00.000Z"}}
```

Types: `membership.granted`, `membership.revoked`, `membership.test`. Grants require an ISO expiry; revocations and tests require null. Sequence is a positive safe JSON integer and is stored as BigInt. Chain must be lowercase `solana`; wallet is a valid 32-byte base58 address, case-sensitive. Unknown keys, fields, chains and event types return 400.

Headers are `X-Wyntrax-Timestamp` (Unix seconds), `X-Wyntrax-Event-Id` (equal to body.id) and `X-Wyntrax-Signature: v1=<hex HMAC_SHA256(secret, timestamp + "." + rawBody)>`. Raw bytes are authenticated before JSON parsing, using constant-time comparison and current/previous secrets. Timestamp tolerance is five minutes. Duplicate auth headers, changed bytes and bad signatures return 401. Require application/json (optional UTF-8 charset), reject content encoding, enforce 16 KB before parsing, and rate-limit to 120 requests/minute. Storage errors return sanitized 503; absent configuration disables the receiver with 503.

Event ID receipts dedupe globally, including stale events and tests. Transactions serialize by event ID then wallet. Only a higher sequence updates `(membershipId, chain, address)`. A test stores a receipt/audit only, never an entitlement or sequence tombstone. Revoked and expired rows remain to prevent stale resurrection. A duplicate ID with different bytes is audited and ignored. Receipt and grant writes roll back together.

## Resolution and continuity

`WyntraxEntitlement` stores membershipId, chain, address, key, seq, validUntil, status, lastEventId, receivedAt and persisted proSince/eliteSince. No Wyntrax user identity or full wallet replacement exists. Two memberships for the same wallet are independent: revoking ELITE falls back to a still-active PRO grant, then MEMBER, then eligible local EARLY_ACCESS, otherwise NONE. Compute the maximum across all verified linked wallets, never add tiers. Enforce expiry during every access check even if cleanup is down. Wallet proof remains mandatory; ingestion never links a wallet automatically.

Renewals retain continuous age. Overlapping memberships on the same wallet inherit the earliest still-continuous qualifying PRO/ELITE age. Revocation or expiry gaps reset that grant's age. Upgrading PRO to ELITE keeps PRO age but starts ELITE age. A feature's `min_entitlement_age_hours` also requires the matching wallet link to be old enough, using the later of verifiedAt and the qualifying since field.

Local EARLY_ACCESS/ADMIN grants remain restricted to EARLY_ACCESS; new grants require a verified link and `early_access.enabled`. Closing admission does not invalidate existing active, unexpired grants; their verified-link requirement still applies. Seat accounting counts distinct active unexpired users independently of Wyntrax tier and wallet count. Admins cannot manually grant paid research tiers. Wallet proof binds domain, nonce, address, user and challenge expiry; unlink immediately removes access and invalidates outstanding proofs.

## Research boundary

`entitlements.enforced` defaults false; `entitlements.shadow_log` defaults true; feature age defaults zero. `packages/shared/src/entitlements.ts` defines feature requirements and page caps, while `apps/api/src/entitlements/gating.ts` inventories gated research routes. Feature overrides are validated by `settings.ts`. Mixed responses filter shared research while preserving the user's own data. Realtime/chat research uses the same decisions. Account, entitlement management, own-data and safety controls remain accessible at NONE. Entitlement operations cannot alter trading mode, permissions, execution, risk, orders or wallets used for trading.

Authenticated routes include `/v1/me/entitlements`, `/v1/me/linked-wallets`, wallet challenge/verify/unlink, `/v1/me/early-access` join/leave, admin entitlement settings, per-user grant/revoke/unlink and early-access stats. Mutations are audited; invalid input and storage failures use sanitized responses. Configuration and status never expose signing secrets.

Public Privy configuration and extra CORS origins are also database-backed and admin-editable. See [Runtime settings API](RUNTIME_SETTINGS_API.md) for schemas, routes, cache behavior, lockout protection and operator recovery.

## Standalone expiry schedule

Run `npm run entitlements:expire` every minute from this repository using cron or Windows Task Scheduler. It runs `scripts/entitlements-expire.ts` once, outside the pipeline/executor lifecycle. Each transaction expires at most 500 local access grants and removes at most 500 consumed/expired wallet challenges older than one day. The seats lock makes concurrent runs safe; access checks enforce expiration independently. No entitlement pull job or partner credentials are needed.

## Verification

The original `scratch.cjs` workflow targets `narra_ent`, which now contains application data: do not use it for tests. Use a separate test/shadow database and Redis instance, set `NARRA_TEST_DATABASE_NAME` to the test DB name and supply its matching `DATABASE_URL`. Tests now reject application DB names. `node scripts/wyntrax-contract-check.mjs --offline` checks the public HMAC vector; online checks target only the isolated listener at `http://localhost:14010`. Current full-suite evidence/setup is in `docs/EARLY_RADAR_VERIFICATION_2026-10-16.md`; older webhook evidence remains in `docs/MEMBERSHIP_WEBHOOK_CLEANUP.md`.

## Admin-editable access levels and early-access limits

Stored in `SystemSetting`, edited on the admin page (Access levels card), every change audited with a reason.

| Key | Meaning | Default |
|---|---|---|
| `access.tier_requirements` | $Wyntrax a holder needs for MEMBER / PRO / ELITE. Must strictly increase. | 500,000 / 1,000,000 / 10,000,000 |
| `access.token_symbol` | Ticker shown next to the amounts | `$WYNTRAX` |
| `access.token_mint` | Solana mint address of the token. Null until the owner fills it in. Informational: nothing reads balances with it yet. | null |
| `early_access.closes_at` | After this time no new early-access seats are issued. Held seats keep working. Null = no end date. | null |
| `early_access.access_days` | Length of a self-joined seat. Null = does not expire. | null |
| `early_access.seat_cap` | Existing seat cap | unchanged |

The amounts are what people SEE (`GET /v1/access/requirements`, public, cached 30 s). Who actually receives a tier is still decided by the Wyntrax membership token gate and its signed webhooks: set the same numbers there. A stored value that fails validation makes the endpoint answer 503 rather than show a different number.
Narrax is shown as powered by Wyntrax (https://wyntrax.xyz); the link is the `POWERED_BY` constant in `packages/shared`.
