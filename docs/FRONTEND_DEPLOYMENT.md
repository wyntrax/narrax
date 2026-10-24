# Frontend deployment on the backend VPS

The frontend now has an **optional** release job in `.github/workflows/release.yml`. It is not live until GitHub, the host, and public domains are configured. No real credentials, domain configuration or application database were changed to implement this.

## Architecture

- Backend: existing image and Compose project, API listening on host `127.0.0.1:4000`.
- Frontend: `docker/Dockerfile.web`, a separate Next.js standalone image, independent `narrax-web` Compose project, host `127.0.0.1:4010` → container `3000`.
- TLS reverse proxy: web hostname → port 4010; API hostname → port 4000. PostgreSQL and Redis stay private.
- Frontend release state lives in `.deploy/web`, separately from backend state. It never runs migrations, starts workers, alters research flags or invokes the backend deployment script.

The container runs as `node`, with a read-only filesystem, dropped capabilities, no-new-privileges, and bounded writable tmpfs mounts. It receives only an explicit frontend environment allowlist, **never** the backend `.env`. Port 3000 binds to `0.0.0.0` inside the container; do not override `HOSTNAME` to `127.0.0.1` (that can break container reachability and Next.js locale rewrites). The host-published port remains loopback-only.

## What release does

After all CI jobs pass, the frontend job—if enabled—waits for `production-web` approval, validates configuration, builds a production image with the actual public settings and runs its smoke tests **before publishing**. It pushes that exact locally tested image to `ghcr.io/<owner>/<repo>-web:<full-commit-sha>` and deploys its registry digest, not a moving tag. It does not reuse the placeholder web bundle built by CI.

The job uses the existing VPS SSH identity, pinned host keys and directory. Only `docker-compose.web.yml` and `deploy-web-remote.sh` are shipped; neither host env file is overwritten. It serializes with the backend deployment job to avoid shared registry login/logout races. Backend and frontend releases are independent, not an atomic coordinated release; keep their API contracts backward compatible. Enabling one deployment flag does not enable the other.

On the host the script:

1. Takes a frontend deployment lock and checks prerequisites.
2. Requires the previous image to exist locally, if a successful release has been recorded.
3. Pulls the digest and validates `.env.web` against the public configuration compiled into that image **before** replacing the running service.
4. Starts only `web`, with `--no-deps --pull never` and no orphan removal.
5. Checks `/api/health` for the expected commit, then requires `/research` to return HTTP 200. Redirects are not healthy pages.
6. Records the successful release and a permission-restricted environment snapshot. If replacement fails, it restarts the previous local image using its previous environment and health-checks rollback. No database rollback is needed or attempted. On the first failed deployment, it stops the failed frontend because no known-good release exists.

This is an in-place restart, **not zero downtime**. Rollback is best effort; a failed rollback is reported for immediate operator intervention. Keep old images and state/config snapshots for the rollback window. Compose changes must remain compatible with previous images. Sudden host/disk failure still requires normal operational recovery and backups.

## GitHub setup

1. Configure the Git remote and push the repository. The workflows have not run remotely in this checkout yet.
2. Create the **`production-web`** environment. Require reviewers and restrict deployment to `main` / approved `v*` tags.
3. Set these repository or `production-web` **variables**:

| Variable | Required value |
| --- | --- |
| `WEB_SITE_URL` | Bare HTTPS canonical web origin, no trailing slash or path |
| `WEB_API_URL` | Bare publicly reachable HTTPS API origin |
| `WEB_PRIVY_APP_ID` | Actual **public** Privy app ID; never an app secret |
| `WEB_WYNTRAX_URL` | Optional HTTPS claim URL; leave empty if not configured |
| `WEB_SEO_INDEXABLE` | `false` until search launch review; then `true` |

4. Provide the existing five SSH secrets at repository scope or copy them into `production-web`: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`. Environment-scoped secrets in `production` are **not** automatically visible to `production-web`.
5. Set repository variable **`WEB_DEPLOY_ENABLED=true` only after host preparation**. This flag must be repository-scoped because the workflow evaluates it before entering the environment. Backend `DEPLOY_ENABLED` remains an independent flag.

The job requests package-write access to publish the separate web package. Keep that package private; the SSH script reads the job's temporary registry token from stdin and logs out afterwards. Approvals and private GHCR availability depend on your GitHub plan/settings. No SSH host key is discovered and blindly trusted during the job.

## Host preparation

Use the same `DEPLOY_PATH` as the backend, for example:

```text
/srv/narra/
  .env                              existing backend configuration; not given to web
  .env.web                          frontend-only configuration, created manually
  docker/docker-compose.prod.yml    existing backend base file
  docker/docker-compose.web.yml     shipped by frontend release
  .deploy/web/                      frontend script, lock, release/config snapshots
```

Requirements: Docker with Compose v2.17+, Bash, `curl`, `flock` (util-linux), and a deploy user allowed to use Docker. The Docker group is effectively host-root capability; scope and protect the SSH key accordingly. Ensure port 4010 is unused before the first frontend deploy. Do not prune previous images while rollback may be needed.

Create `.env.web` using `docker/web.env.example`; restrict it and `.deploy/web` to the deploy user. Its first four values must **exactly** match the corresponding GitHub variables:

```text
NEXT_PUBLIC_SITE_URL=https://YOUR-WEB-HOST
NEXT_PUBLIC_API_URL=https://YOUR-API-HOST
NEXT_PUBLIC_PRIVY_APP_ID=YOUR-PUBLIC-PRIVY-APP-ID
NEXT_PUBLIC_WYNTRAX_URL=
NARRA_SEO_INDEXABLE=false
NARRA_GOOGLE_SITE_VERIFICATION=
NARRA_BING_SITE_VERIFICATION=
```

The public bundle is compiled for these origins/app ID/claim URL. Changing them requires a **new image build** and a matching host env update. Preflight refuses a mismatch instead of serving stale browser configuration. To change public build settings, update GitHub and `.env.web` together and trigger a release. The old environment snapshot supports rollback even when the new release uses different public settings.

Indexing and ownership tokens are server-only settings; update `.env.web` and recreate the service deliberately (or redeploy the same commit) to apply them. Set the GitHub indexing variable consistently for release smoke checks. The deployment validator refuses **any** `NARRA_WEB_TEST_AUTH` value. Never add a backend app secret, database URL, Helius key or signing key to frontend build arguments.

## Domain, TLS and backend access

Adapt your existing reverse proxy rather than replacing it blindly. A minimal **Caddy example**, using two real DNS names pointing to the VPS, is:

```caddyfile
YOUR-WEB-HOST {
    reverse_proxy 127.0.0.1:4010
}
YOUR-API-HOST {
    reverse_proxy 127.0.0.1:4000
}
```

Replace placeholders with actual hostnames, not full URLs. Open only the proxy's HTTP/HTTPS ports as appropriate; do not expose 4000/4010/3000, Redis or PostgreSQL publicly. Preserve the request Host and set/trust forwarding headers correctly; Caddy handles these defaults. For nginx, preserve Host and X-Forwarded-Proto/Host and proxy to loopback. Redirect any alternate web hostname to the one canonical origin.

On the backend, allow the real web origin in `CORS_ORIGINS`, set the correct `entitlements.wallet_link_domain`, and configure proxy trust securely for the actual topology. Add the web origin to the Privy dashboard allowed origins. These operator settings are necessary for real sign-in/wallet proof; an HTTP health check does not verify them. Keep Helius delivery on the API hostname and research flags off until their separate readiness gates are met.

## Verification after the first deploy

- Inspect the frontend job summary for the deployed commit and digest.
- On the host, `curl -fsS http://127.0.0.1:4010/api/health` must identify that commit; `/research` should return 200 without redirects.
- Through the public HTTPS host, verify EN/ID articles, share images, certificates, canonical URLs and private noindex behavior.
- Exercise real sign-in, entitlement checks and wallet-domain validation separately using approved accounts; do not infer these work from the build or smoke test.
- Finish [SEO launch checks](SEO.md) before switching indexing on. Submit the actual sitemap in Google/Bing after deployment; a release does not submit it automatically.

For manual rollback, read `.deploy/web/previous_release` for the image/commit, confirm the image is still local, and use its `.deploy/web/previous.env` with `docker compose --project-name narrax-web --env-file .deploy/web/previous.env -f docker/docker-compose.web.yml up -d --no-build --no-deps --pull never web`, supplying that digest as `NARRA_WEB_IMAGE`. After checking the restored commit and public page, reconcile `current_release`/`current.env` with the restored state before another automated deployment. Do not edit backend state or run migrations for frontend rollback.

## Verification status

Local checks: 623 web tests /43 files, repository/web typechecks and web lint; standalone production build and auth-leak scan; nine Chromium SEO/accessibility checks against the actual standalone server in each of noindex and indexable runtime modes (18 passing checks). The standalone process was also checked with reverse-proxy Host/HTTPS headers and the release-identity health endpoint. A local test with `HOSTNAME=127.0.0.1` reproduced an English-route redirect loop; the image uses `0.0.0.0` and the rerun passed unchanged assertions.

The 22 simulated frontend deployment checks use fake Docker/curl: success, registry handling, isolation from backend services, old-env rollback, failed start/pull/config, missing rollback image/config, wrong commit, failed/redirecting public page, mutable image refusal, missing token/env and deploy locking. All 25 existing backend deployment checks remain passing. CI adds the real frontend Docker build, non-root/read-only runtime smoke tests and Compose assertions; frontend release runs those image smoke tests on the exact image before pushing it.

**Not run locally:** Docker build/runtime, actual Compose merge, remote GitHub Actions, SSH/GHCR deployment, DNS/TLS provisioning or real Privy login. Docker is not installed, no Git remote is configured, and VPS/domain details are not supplied. The first real CI run must establish the container checks before enabling live deployment. This is an implemented, disabled delivery path—not a claim that the site is already deployed.
