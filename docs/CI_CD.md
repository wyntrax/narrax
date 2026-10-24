# CI/CD (GitHub Actions)

Written 2026-10-18 and integrated into this checkout on 2026-10-21. **None of these workflows has run on GitHub yet** (this checkout
still has no Git remote). Expect to adjust the first run. What was verified locally, and what was not, is listed at the bottom.

## What exists

| File | Runs | Does |
|---|---|---|
| `.github/workflows/ci.yml` | every pull request; called by `release.yml` on pushes to `main` | seven jobs, below |
| `.github/workflows/release.yml` | push to `main`, `v*.*.*` tags, manual | CI, backend GHCR publish/deploy, optional independent frontend build/verify/publish/deploy on the same VPS |
| `.github/workflows/security.yml` | weekly, and when dependencies, Docker or workflow files change | `npm audit`, gitleaks, optional CodeQL |
| `.github/dependabot.yml` | weekly | npm, GitHub Actions and Docker updates; majors of prisma, next, react, vitest, typescript, tailwindcss are ignored on purpose |
| `docker/docker-compose.deploy.yml` | at deploy | pins the image by digest, blanks the secrets the executor refuses to start with |
| `scripts/deploy-remote.sh` (+ `.test.sh`) | on the host, over SSH | pull, migrate, start, health check, roll back |
| `docker/Dockerfile.web`, `docker/docker-compose.web.yml`, `scripts/deploy-web-remote.sh` | optional frontend release | isolated standalone web image/project, public-config validation, release health check and image/config rollback |

### The CI jobs (`ci.yml`)

| Job | What it proves |
|---|---|
| `static` | no `.env`, key, `.zip` or `backups/` file is tracked; backend/frontend deploy scripts pass simulated tests; `npm run typecheck` (repo and web); web lint |
| `backend` | Postgres 16 + Redis 7 service containers; every migration applies to an empty database; **`prisma migrate diff --exit-code` is empty** (schema and migrations agree); the full Vitest suite runs and `scripts/check-test-results.mjs` fails the job if anything was skipped |
| `web` | serial unit tests, production build/auth-leak scan, production SEO/private-indexing/social-image/accessibility browser checks |
| `e2e` | the Playwright fixture-auth suite against `npm run dev -w @narra/web` on port 4010 |
| `docker` | `docker/Dockerfile` really builds (its header says it never had); no `.env` (including nested ones), key file, `.git`, `backups` or `.github` inside the image; non-root user; the production `prisma migrate deploy` command works from the image; the deploy override merges correctly |
| `web-docker` | frontend standalone image builds and runs non-root/read-only with EN/ID pages, schema, real 404s, PNG previews and release identity; independent Compose project/allowlist checks |
| `ci-passed` | one stable check for branch protection: fails if any job failed, was cancelled or was skipped |

`backend` and `e2e` are separate jobs on purpose: a backend test briefly binds port 4010, which the fixture web server uses.
Every browser spec must use the fixture origin `http://localhost:4010` (the Playwright `baseURL`); do not hardcode another port.
Seven specs had been left on `4012` from a local session where 4010 was occupied; they were normalized back to 4010.

The backend job uses the repo's test-isolation guard (`scripts/test-isolation.ts`) the same way a developer must: `NARRA_TEST_DATABASE_NAME=narra_ci_test`,
a matching `DATABASE_URL`, and `NARRA_TEST_REDIS_URL` (a Redis used only by this job). `REDIS_URL` is ignored by the guard. Without these, integration tests skip and
the results check fails the job, so a misconfiguration cannot pass quietly.

## One-time GitHub setup

For the frontend on this same VPS, see [Frontend deployment](FRONTEND_DEPLOYMENT.md). It has its own `WEB_DEPLOY_ENABLED` flag, `production-web` approval environment, public build variables and host `.env.web`. Backend deployment below remains unchanged and independently controlled.

1. **Branch protection on `main`**: require the check named **CI passed**, require pull requests, block force pushes.
2. **Settings > Actions > General**: workflow permissions "Read repository contents"; the workflows request `packages: write` themselves where needed.
3. **Package visibility**: the first push creates `ghcr.io/<owner>/<repo>` as private. Keep it private. The deploy job pulls it with its own token.
4. **Environment `production`** (Settings > Environments): add **required reviewers**. That is the approval gate for deploys. Restrict it to the `main` branch and `v*` tags.
5. Optional: set variable `ENABLE_CODEQL=true` (free on public repos; private repos need GitHub Advanced Security). Organisation repos need a `GITLEAKS_LICENSE`
   secret for the gitleaks job, or set variable `GITLEAKS_ENABLED=false`.

### Deploy settings (only needed to turn deploys on)

Repository **variable** `DEPLOY_ENABLED=true`, and these **secrets** (preferably on the `production` environment):

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | host name or IP |
| `DEPLOY_USER` | a non-root user that may run `docker` |
| `DEPLOY_PATH` | absolute directory on the host, for example `/srv/narrax` |
| `DEPLOY_SSH_KEY` | a **dedicated** private key for this job only. Use `command=`/`from=` restrictions in `authorized_keys` where you can |
| `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 <host>` taken **from a trusted machine**, not from CI |

Nothing else is stored in GitHub. Application secrets (`PRIVY_*`, `HELIUS_*`, `AI_*`, database password) stay in `.env` on the host.

## Preparing the host

```
/srv/narrax/
  .env                                  your real settings (from .env.example); never committed, never sent by CI
  docker/docker-compose.prod.yml        YOUR copy of docker/docker-compose.prod.example.yml, read line by line and adapted
  docker/docker-compose.deploy.yml      sent by CI on every deploy
  .deploy/                              sent/maintained by CI: deploy-remote.sh, current_image, previous_image
```
Docker Compose v2.17 or newer. Postgres and Redis must not be exposed to the internet (the example compose binds only the API to `127.0.0.1`). Put TLS and a reverse proxy in front of the API.

The same public API origin is what Helius calls for tracked-wallet swaps. Helius requires a publicly reachable **HTTPS** URL, so terminate TLS at the reverse proxy and set `HELIUS_WEBHOOK_URL=https://<your-api-host>/webhooks/helius` (not a bare `http://<ip>:4000` URL). Keep the pipeline worker running so it can create or update the Helius webhook from that value.

The first deploy runs `prisma migrate deploy`, so it applies every pending migration, including `20261021052916_wallet_research`. Review the migration and back up the application database before turning deploys on. The research flags remain off unless the host `.env` explicitly sets them.

The deploy script refuses to run if `.env` contains `EXECUTOR_SIGNING_KEY`, `WALLET_PRIVATE_KEY`, `SOLANA_PRIVATE_KEY`, `PRIVY_AUTHORIZATION_PRIVATE_KEY` or `PRIVY_AUTHORIZATION_KEY`. Signing is
not approved (B5b, see `docs/SECURITY_REVIEW_PLAN_B5.md`). If the owner later approves it, that guard is a deliberate change to `scripts/deploy-remote.sh`, not something to bypass.

## Rollback and migrations

- A failed health check, or an api/worker/executor that is not running, puts the app containers back on the previous recorded image automatically.
- **Database migrations are not reverted.** Prisma migrations only move forward. Keep every migration compatible with the previous release: add a column or table first, switch the
  code, and only remove the old thing in a later release. A migration that fails stops the deploy **before** any container is replaced.
- Manual rollback: on the host set `NARRA_IMAGE` to the digest in `.deploy/previous_image` and run `docker compose --env-file .env -f docker/docker-compose.prod.yml -f docker/docker-compose.deploy.yml up -d --no-build --no-deps --pull never api worker executor`. Retain the previous image locally; do not prune it before the rollback window ends.
- Start and rollback use the locally pulled image (`--pull never`), and no orphan containers are removed. The script explicitly loads the host `.env` for Compose interpolation. Release settings reject SSH-config/shell metacharacters in host, user and path; paths with spaces and literal IPv6 hosts are not supported.
- The publish job rebuilds the same commit after CI; it does **not** reuse CI's tested image. Deployment pins the published digest, but bit-for-bit equivalence of the two builds is not established.

## Findings made while writing this

1. **The executor would crash-loop with the production compose example.** `workers/executor/src/main.ts` refuses to start if `PRIVY_APP_SECRET` (and several signing variables) is set, but
   the example gives every service the same `.env`, and the API needs `PRIVY_APP_SECRET`. `docker-compose.deploy.yml` blanks those variables for the executor only. If you deploy with the example
   compose file directly, give the executor a different env file.
2. **`docker/Dockerfile` had never been built.** The `docker` job builds it on every pull request.
3. **`.dockerignore` did not exclude `backups/`**, which holds exported database rows, while the Dockerfile does `COPY . .`. A local `docker build` would have baked them into the image. Fixed
   (also `*.pem`, `.next*`, test output), and the `docker` job fails if `backups` is inside the image.
4. A bug in the first draft of `scripts/deploy-remote.sh` (a `read` fallback that discarded the registry token when it had no trailing newline) was caught by `scripts/deploy-remote.test.sh` and fixed.
5. **A nested `.env` could be baked into the image.** The original `.dockerignore` excluded only the root `.env`; `COPY . .` would still have copied `apps/web/.env`. Added `**/.env` / `**/.env.*`, and the `docker` job now scans every non-`node_modules` file for `.env*`, `.pem`, `.key`, `.p12` and `.pfx`.
6. **Browser specs disagreed about the fixture port.** Seven specs hardcoded `4012` while `playwright.config.ts` and the CI server use `4010`. They now all use `4010`; the CI starts one fixture server.
7. **The backtest browser fixture claimed admin only in `/v1/me`.** The entitlement payload still intentionally denied advanced analytics, so the correct access gate prevented mounting the page. Its fixture now also carries the real admin-entitlement flag; production access checks were not changed.
8. **Local launchers can contain credentials.** `.dockerignore` now excludes `local-api.ps1`, `local-web.ps1`, nested secret/key files, dumps and exports. The Docker job checks the launchers are absent. `.gitattributes` preserves LF for shell scripts and YAML on Windows checkouts.

## Not covered

- **Live frontend deployment is not configured yet.** A same-VPS CD path is implemented but disabled until `WEB_DEPLOY_ENABLED`, `production-web`, actual public build variables, host `.env.web` and proxy/DNS are prepared. Its exact-image checks run before publishing; placeholder CI builds are not deployed. See [setup and limitations](FRONTEND_DEPLOYMENT.md).
- Playwright **visual baselines** (captured on Windows), Lighthouse, and the production Playwright config stay manual.
- No staging environment, no blue/green or zero-downtime switch (containers restart in place), no deploy notifications.
- Actions are pinned to major versions (`@v4`), not commit SHAs. Dependabot updates them weekly; pin to SHAs if your threat model needs it.

## Verification status

Frontend CD follow-up (2026-10-22): standalone production build/auth scan, 623 web tests /43 files, types/lint and eighteen standalone Chromium SEO checks (nine in each indexing mode) passed locally; 22 frontend and 25 backend simulated deploy checks pass. Docker is absent locally, so container execution and Compose merging are CI checks pending their first remote run. Details and local redirect-loop finding: [Frontend deployment](FRONTEND_DEPLOYMENT.md). The older integration verification below is historical, not the current web-test count.

Current local verification (2026-10-21): workflow/compose YAML parses; Bash syntax checks and **25 stubbed deploy checks** pass; root/web typechecks and web lint pass; **576 web tests / 40 files** pass with one worker. The initial resource-contended web run had two failures; the unchanged tests pass serially. Vitest 2.1.9 JSON reporter syntax was exercised with one database-free root test and the no-skip checker.

Browser checks use Chromium with development fixture auth and mocked HTTP, not real Privy, wallets, providers or production. Six corrected specs pass all 24 cases (error card, smart money, paper trading, portfolio, admin features and backtests). The access-lock spec initially passed 3/4, with one Windows Chromium `ERR_NETWORK_IO_SUSPENDED` / teardown timeout; that failed case passed a targeted rerun on the same assertions. All seven changed specs have passing cases, but there is no clean combined full-suite run. The fixture server was stopped afterwards.

The tracked/prospective-file guard passes without staging user work. `.gitignore` now excludes the local `narra-full.zip`. The existing 1,399-test backend baseline was **not rerun** during this CI/CD integration; no application database or Redis was used.

**Not run:** any workflow on GitHub, `actionlint`, a Docker build, `docker compose config`, `prisma migrate diff`, the Playwright suite in CI, or a real deploy. Likeliest first-run problems:
the `e2e` job (dev-server compile time and route warm-up), the Dockerfile build, the compose merge assertions in the `docker` job, and the `migrate diff` step (the repo notes it was not confirmed for every hand-written migration).
