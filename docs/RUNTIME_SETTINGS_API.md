# Runtime settings API

Settings live in `SystemSetting`. Only keys in `SETTING_SCHEMAS` can be written. Every write uses `updateLocalSettings`: an admin check, transaction, serialized settings update, and `entitlements.setting_changed` audit entries containing before/after, actor and a nonempty reason (up to 300 characters).

| Key | Value | Environment fallback |
| --- | --- | --- |
| `auth.privy_app_id` | Nonempty App ID, letters/digits/underscore/hyphen, max 100 | `PRIVY_APP_ID` |
| `auth.privy_verification_key` | Public P-256 SPKI PEM, max 4096; CRLF and escaped newlines accepted | `PRIVY_VERIFICATION_KEY` |
| `api.cors_origins` | Array of up to 50 exact HTTP(S) origins, max 256 each | Merged with `CORS_ORIGINS`, never replaces it |

Paths, trailing slashes, credentials and wildcards are refused in origins. An empty database origins array removes extras only. HTTP CORS and WebSocket upgrades share the same 20-second resolver cache. Existing sockets are not disconnected when an origin is removed; token expiration/re-authentication still applies. The API's environment origins remain usable if a database refresh fails.

Auth values use database-first, per-field environment fallback. The API can start with auth values entirely in the database; database/Redis connection configuration remains required. The cache is invalidated after committed writes in that process, and other processes refresh within 20 seconds. Database outages return unavailable rather than silently switching an active database auth configuration to different environment credentials.

## Routes

### `GET /v1/public-config`

Unauthenticated; 60 requests/minute/IP. Returns exactly `{ "privyAppId": "<public app ID>" }`, or `null` if unset. Never returns the verification key or settings sources. The response is cacheable with mandatory revalidation (`public, max-age=0, must-revalidate`); the in-process cache owns the 20-second freshness window so caches cannot stack delays. Failures return 503 `RUNTIME_SETTINGS_UNAVAILABLE`, `no-store`.

AuthBoundary fetches this before mounting Privy, using the shared PageLoader while waiting and an error card with Retry on failure. A null value uses `NEXT_PUBLIC_PRIVY_APP_ID` as fallback. Reload a page to adopt a changed App ID; no web rebuild is needed. Changing the fallback itself still requires recompiling Next. `NEXT_PUBLIC_API_URL` remains build-time configuration.

### `GET /v1/admin/runtime-settings`

Admin only; 10 requests/minute/IP. Returns:

```text
privyAppId: { value: string, source: "database" | "environment" }
privyVerificationKey: { value: public PEM string, source: "database" | "environment" }
corsOrigins: { value: merged string[], source: "database" | "environment",
               extra: database string[], environment: environment string[] }
```

The origins source is `database` when an extras row exists; `environment` origins are always included. The only key returned is the explicitly public verification key, to admins only.

### `POST /v1/admin/runtime-settings/check-privy`

Admin only; 10 requests/minute/IP. Body: `{ appId, verificationKey }`. Returns `{ ok: true }` when the public key matches Privy's published P-256 JWKS coordinates for that App ID. Does not save. Uses the same helper as `npm run check-privy`, with a five-second timeout. The HTTP route always contacts Privy's fixed origin; callers cannot supply a URL.

### `PUT /v1/admin/entitlements/settings`

Existing admin route, 30 requests/minute/IP. Body:

```json
{
  "settings": { "api.cors_origins": ["https://app.example.com"] },
  "reason": "Allow the new frontend",
  "overridePrivyCheck": false
}
```

Any auth change validates the resulting effective App ID/key pair against Privy **before saving**. Mismatch or unreachable Privy rejects the entire batch with 400 `PRIVY_KEY_MISMATCH` or `PRIVY_UNREACHABLE`. An explicit boolean `overridePrivyCheck: true` permits those two failures, and records the override and verification outcome in the audit entries. Invalid/non-P-256 key material always returns 400 `INVALID_PRIVY_KEY`; it cannot be overridden. Other schema failures return `INVALID_INPUT`. Non-admins receive 403, missing/invalid authentication 401. Network/provider errors never include key material or response bodies.

`DATABASE_URL`, `REDIS_URL`, credentials for Privy, Helius, Jupiter and AI, webhook credentials, and all executor safety limits remain in environment configuration and cannot be saved here.

## Recovery and identity changes

A correctly paired **different** Privy app issues different user identities. Its users must sign in and be made admin with `npm run make-admin -- <id>`; grants do not migrate automatically. An explicit validation override can break sign-in.

To recover without a working session, in PowerShell with the API's `DATABASE_URL` set:

```powershell
npm run settings -- reset auth
```

This operator-only command deletes both auth rows atomically and writes `entitlements.setting_reset` audits (before/after, fixed recovery reason, `operator-cli` actor). It does not read `.env` or print any key. The running API's valid `PRIVY_*` environment values take effect within 20 seconds. The CLI cannot change an already-running process's environment: if bootstrap values are missing or incorrect, set them in the API terminal, validate with `npm run check-privy`, and restart the API. Reload the browser; clear site data if it retains a session for the other app.

Early-access API and behavior: see [ENTITLEMENTS.md](ENTITLEMENTS.md). Browser verification: see [LOCAL_E2E_TEST.md](LOCAL_E2E_TEST.md).
