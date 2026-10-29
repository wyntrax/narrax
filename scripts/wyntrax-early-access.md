# Wyntrax-managed Early Access

Narrax accepts `EARLY_ACCESS`, `MEMBER`, `PRO` and legacy `ELITE` membership keys on the existing signed webhook. Early Access grants research access at the Early Access tier (20-row page limit), subject to the same configurable feature tiers. Admin access remains independent.

## Deploy and configure

1. Deploy the additive Prisma migration `20261029120000_wyntrax_early_access` and updated API/web images before enabling Early Access deliveries. The normal backend release runs migrations. The migration adds one enum value; it does not alter grants, settings or membership records.
2. In the Wyntrax Early Access membership integration, use:
   - Webhook URL: `https://api.narrax.fun/v1/integrations/wyntrax/events`
   - Integration key: `EARLY_ACCESS` (exact uppercase).
3. Configure Narrax API `WYNTRAX_WEBHOOK_SECRET` with the corresponding Wyntrax signing secret and recreate the API. The receiver supports one current secret and one previous rotation secret; multiple memberships must use the shared integration signing-secret configuration. Independently generated per-membership secrets require additional receiver support, not overwriting an existing working secret.
4. Configure the existing frontend build/runtime variable `NEXT_PUBLIC_WYNTRAX_URL` with the actual public Wyntrax membership page (the release workflow reads GitHub variable `WEB_WYNTRAX_URL`). Rebuild/redeploy the web image: this value is baked into the client bundle. The access page shows an Open Wyntrax link when a valid HTTPS URL is configured. No wallet or user information is appended.
5. Send a signed `membership.test` delivery, then verify a real Early Access grant with a test user's same verified Solana wallet. A test delivery alone records a receipt and grants no access.
6. When real grants/renewals/revocations work, turn off **early_access.enabled** in Narrax admin settings. This closes local signup; it does not disable existing grants or Wyntrax membership access. Production settings are an operator action, not part of this migration.

## Event contract

The raw-body HMAC authentication, headers and event envelope are unchanged. `data.key` now also accepts `EARLY_ACCESS`. Every event requires an ID, occurrence time, membership ID, Solana wallet, positive safe-integer sequence and checked time.

- `membership.granted`: a non-null ISO `validUntil`; later sequences renew or change the membership. A past expiry never unlocks access.
- `membership.revoked`: `validUntil: null`; applies to that membership/wallet, not independent memberships or local grants.
- `membership.test`: `validUntil: null`; stores a test receipt without changing membership state.
- Retries retain the event ID/body; sequence numbers increase per membership/wallet. Duplicate, older or equal-sequence deliveries cannot overwrite newer state.

Narrax stores these events synchronously. The outbound on-chain-holding notification queue is a separate Member/Pro mechanism; Early Access does not require token holdings or create outbound holding events.

## Existing users and expiry

Existing Narrax grants retain their exact expiry and status. Finite grants expire normally; grants with no expiry continue until revoked. No bulk expiry, revocation, copying to Wyntrax or backfill is performed. A user with both sources retains access while either is valid; revoking a Wyntrax membership does not revoke the local grant. Local Leave only removes the user's local signup grant.

External memberships do not consume Narrax's local early-access seat cap and do not inherit its access-days/closing-window settings. Configure external capacity and expiry on Wyntrax. A grant can arrive before wallet linking; it takes effect only after that same wallet is verified. Unlinking the wallet removes that source from effective access. The access page checks for membership updates for up to two minutes even when local signup is disabled/full/invite-only; users can refresh afterward.

## Verification after rollout

Check the Wyntrax delivery result, then `/v1/me/entitlements` for `effectiveTier: EARLY_ACCESS`, an eligible membership with `key: EARLY_ACCESS`, and a `WYNTRAX` source. Confirm an Early Access feature opens and higher-tier features follow their configured requirements. Verify renewal, expiry and revocation on a user without a surviving local or higher-tier grant, then verify an existing local user still has access after signup is disabled.

The repository tests cover the Narrax receiver and client with scratch PostgreSQL and fixtures. Actual Wyntrax sender behavior and production delivery remain to be verified after operator configuration. If rolling back, pause new Early Access deliveries and retain the migrated database; older application versions do not support the new membership key.
