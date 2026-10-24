# Local end-to-end test: sign in, open early access, join, whitelist

Everything below runs on your machine, through the web app. Use three PowerShell terminals from the repo root.
Neither `dev:api` nor the web scripts read `.env` files: set every variable in the terminal that starts that process.

## 0. Privy dashboard (once)

- Add `http://localhost:4010` to the app's allowed origins.
- Enable the login methods email, Google and wallet, and Solana wallets (Phantom).
- Copy the **App ID** and the **verification key** (the PEM public key). The API uses these two. The app secret is not used to verify sign-in.

## 1. API terminal

```powershell
$env:DATABASE_URL = "postgresql://narra:narra@localhost:5432/narra"
$env:REDIS_URL = "redis://localhost:6379"
$env:PRIVY_APP_ID = "<the same App ID the web uses>"
$env:PRIVY_VERIFICATION_KEY = @"
-----BEGIN PUBLIC KEY-----
<paste the key, one line or several>
-----END PUBLIC KEY-----
"@
$env:CORS_ORIGINS = "http://localhost:4010"
# plus any other variables you already set for the API
npm run dev:api
```

## 2. Web terminal

```powershell
$env:NEXT_PUBLIC_API_URL = "http://localhost:4000"
$env:NEXT_PUBLIC_PRIVY_APP_ID = "<the same App ID>"
$env:NEXT_PUBLIC_SITE_URL = "http://localhost:4010"
npm run dev:web
```

## 3. Sign in once

Open http://localhost:4010/app and sign in. This creates your user.
If the page says your session expired, read the API terminal's newest `access token rejected` line. It contains
`reason` and unverified diagnostic `token.aud`, `iss`, `alg`, `kid` only, never the bearer token. A different audience
means the browser uses another Privy app. A matching audience with signature mismatch means the running API's
effective key differs from the issuing key. Check database overrides as well as the launch terminal. Missing token
metadata means old API code is running. Never paste tokens, keys or complete environment dumps into logs or chat.

## 4. Make yourself admin (database terminal, same DATABASE_URL)

```powershell
npm run make-admin -- --list
npm run make-admin -- <your user id from the list>
```

Reload `/app`. An **Admin** link appears in the sidebar.

## 5. Open early access

`/app/admin` > **Early access settings**:

1. Click **Fill in local test values** (opens early access, seat cap 25, wallet link domain = this site).
2. Type a reason and **Save settings**.

The public early-access page can take up to 30 seconds to show the change.

## 6. Join as a user

At `/early-access`: sign in, connect Phantom (or create the Privy wallet), sign the message, then join.
To use the same address for sign-in and for early access, sign in with the **wallet** option using Phantom.

## 7. Whitelist someone

`/app/admin` > **Whitelist a user**: paste their wallet address, user id or Privy id, pick a length, **Grant early access**.
The person must have signed in and verified a wallet first. Grants and revokes show under **Early access grants**.

To see a whitelist change what a user can open, turn on **Enforce feature gates**. While it is off, every signed-in
user sees all research.

## Troubleshooting sign-in

Run `npm run check-privy` in the API terminal. It compares `PRIVY_VERIFICATION_KEY` with the public key Privy publishes for
`PRIVY_APP_ID` and says OK or what is wrong. If the API log says `signature mismatch`, this is the check to run.

If the values were changed, identify stale listeners with `Get-NetTCPConnection -LocalPort 4000,4010 -State Listen`,
stop their owning processes, and restart from correctly configured terminals. For build-time `NEXT_PUBLIC_*` changes,
delete `apps/web/.next` before restarting Next. The runtime settings below remove this rebuild requirement for App ID changes.

## 8. Runtime settings (no restart)

In `/app/admin`, open **Runtime settings**:

1. Each field shows its effective value and database/environment source. Only the public App ID, public verification
   key and extra browser origins are editable. **Check with Privy** validates the entered pair without saving.
2. Enter a reason and save. A wrong pair or unreachable Privy rejects the whole save. The explicit override checkbox
   is audited; it can break sign-in. Invalid/private keys cannot be overridden. See [API details](RUNTIME_SETTINGS_API.md).
3. Reload `/app` after at most 20 seconds. `/v1/public-config` must show the effective App ID. Privy uses that value at
   runtime; the compiled `NEXT_PUBLIC_PRIVY_APP_ID` is only the fallback for an unset public config. Fetch failures show
   an error card rather than silently using a stale App ID.
4. Add an extra exact origin (one per line) and save with a reason. HTTP CORS and new WebSocket connections use the
   merged list within 20 seconds; environment origins stay allowed. Remove the extra again when finished.
5. A different Privy app creates different user identities. Sign in to create the new user, then use `make-admin` to
   promote that user. Existing grants are attached to the old users; changing apps does not migrate them.

Recovery in the terminal with the API's database configuration:

```powershell
npm run settings -- reset auth
```

This deletes both auth overrides and audits the reset. It reads terminal variables, not `.env`. Within 20 seconds
the running API uses its `PRIVY_*` environment values again. If those are missing/wrong, set valid values, run
`npm run check-privy`, and restart the API. Reload the web page (clear site data if an old app session persists).

## 9. Verify closing early access

With one user holding an active grant, disable **Early access is open** and save with a reason. A different user
with a verified wallet must be unable to join (`EARLY_ACCESS_DISABLED`). The existing user's grant stays ACTIVE and
their entitlement stays valid (until expiry, revocation or unlink). After at most 30 seconds,
`GET /v1/early-access/status` reports `enabled: false` and `seatsLeft: null`. Reopen with a reason when done.
