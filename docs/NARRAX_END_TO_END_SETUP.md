# Narrax End-to-End Setup and Operations Runbook

Local workstation • GitHub Actions/GHCR • Single-VPS production

Prepared: 22 October 2026. Audience: the owner, deployment operator and future maintainer. Repository: narra-entitlements. Public product name: Narrax. This runbook documents the current implementation, not a claim that any production system is already running.

## 1. Read this first: scope, safety and current status

This guide explains how to prepare a local development environment, validate an isolated test environment, publish the repository to GitHub, configure CI/CD, prepare an Ubuntu VPS, deploy backend and frontend, connect external services, verify the application and operate it safely afterwards. Commands are instructions for the operator; preparing this document did not execute them on a VPS or change application data.

**Mandatory safety rules**

- Never run integration tests against the application database. In this owner's existing workstation, `narra_ent` contains real application data and is not a scratch database. Tests insert fabricated records and can alter queues globally.
- Never use `docker compose down -v`, `docker system prune --volumes`, a database reset or a destructive restore as a troubleshooting shortcut. Preserve application volumes and known-good images.
- Never commit real `.env` files, SSH/private keys, provider tokens, database dumps, local credential-bearing launchers or exported application data.
- Keep `SMART_MONEY_RESEARCH_ENABLED=false` and `SMART_MONEY_HISTORY_ENABLED=false` until the public webhook and evidence-qualification prerequisites are deliberately satisfied.
- Do not enable automated signing or live execution. Keep the executor in `dry_run`; the current implementation refuses signing credentials there. Paper/shadow behavior is not approval for real trading. Manual user-signed swaps are a separate, default-off feature; enable them only after the migration, provider keys, verified-wallet flow and a small owner-approved mainnet test are ready (Chapter 22).
- Telegram is global research-only delivery: `EARLY_RADAR_TRENCHER` and `EARLY_RADAR_HOLDER`, with `userId: null`. Never send user-owned alerts, wallets, positions, PnL or trading instructions through this feed.
- Do not relax scoring, liquidity, holder, freshness or publication gates merely to populate a dashboard. Missing evidence remains unknown.

**Status at preparation**

| Area | Implemented/verified locally | Still required |
| --- | --- | --- |
| Frontend | Standalone production build, auth-leak scan, 623 web tests in 43 files, types/lint and 18 standalone browser checks across both indexing modes | Real container run, real domains and real authentication smoke test |
| Deployment scripts | 22 simulated frontend and 25 simulated backend checks | First actual SSH/GHCR/VPS execution |
| CI/CD | Backend release plus independent same-VPS frontend release; frontend image checks before publish | Git remote, GitHub configuration and successful remote workflows |
| Infrastructure | Production Compose templates and deployment scripts | VPS, Docker/Compose, persistent storage, reverse proxy, DNS/TLS and backups |
| Live intelligence | Evidence gates, collection and diagnostics implemented | Fresh observations, healthy collectors and qualifying real cohorts |
| Manual trading | Separate user-signed mainnet swap flow, evidence review, Jupiter V2 verification, simulation, migrations applied to `narra_ent`, local provider keys and 14 integration tests | Small real-wallet mainnet swap and operator acceptance; automated signing remains off |

Docker was not installed in the local verification environment. Do not describe a parsed YAML file as a successful Compose merge, or a passing Node standalone server as a passing Linux container. The first real CI run must establish the Docker checks. Historical backend suite counts are recorded in `docs/CONTINUATION.md`; rerun the current suite in isolation rather than treating old counts as a new pass.

## 2. Target architecture and identifiers

Use two HTTPS hostnames on the same VPS: a web hostname and an API hostname. The examples use reserved example domains; replace them before deployment. GitHub builds images so production does not need a source checkout or a local npm build.

```text
Browser -> https://narrax.example       -> reverse proxy -> 127.0.0.1:4010 -> web container:3000
Browser -> https://api.narrax.example   -> reverse proxy -> 127.0.0.1:4000 -> api container:4000
Helius  -> https://api.narrax.example/webhooks/helius    -> API -> Redis queues -> pipeline
GitHub  -> GHCR backend image + separate web image -> SSH deploy user on the same VPS
Backend Compose project: narra   -> api, worker, executor, migrate, postgres, redis
Frontend Compose project: narrax-web -> web only
PostgreSQL/Redis -> private Docker network; no public host port in production
```

The frontend does not receive database URLs, backend secrets, signing keys or the backend `.env`. Frontend deployment never runs migrations or restarts backend services. Backend and frontend releases are independent and are not an atomic coordinated upgrade. Preserve backward-compatible API contracts during deployment and rollback.

| Identifier | Example | Meaning |
| --- | --- | --- |
| GitHub repository | `OWNER/REPO` | Replace with the actual private repository |
| Backend package | `ghcr.io/owner/repo` | Lowercase registry path |
| Frontend package | `ghcr.io/owner/repo-web` | Separate package; compiled for public web settings |
| VPS deploy directory | `/srv/narrax` | Same `DEPLOY_PATH` for both deployment paths |
| VPS deploy account | `deploy` | Non-root SSH account with Docker access |
| Web origin | `https://narrax.example` | Exact canonical origin, no path or trailing slash |
| API origin | `https://api.narrax.example` | Exact browser-reachable API origin |
| Application DB in production template | `narra` | Database/user chosen by current Compose example |
| Existing owner's application DB | `narra_ent` | Existing local data; never a test target |

Visible branding is Narrax. Database names, Redis keys, npm workspace names (`@narra/*`), environment variables (`NARRA_*`) and Compose project names still use `narra`, because existing local data and tooling depend on them. Do not rename those to match branding without a separate migration plan.

## 3. Decisions and accounts to collect before starting

Complete this worksheet in a private operator record. Record credential locations or password-manager references, not actual secrets in this document.

| Decision/account | Required preparation | Owner record |
| --- | --- | --- |
| Domain and DNS | Canonical web host; separate API host; access to DNS management | ____________________ |
| VPS | Public IPv4, supported OS, rescue console, backup capability | ____________________ |
| GitHub | Repository owner/name, Actions enabled, package policy, reviewer availability | ____________________ |
| SSH | Operator key, separate CI key, verified host fingerprint | ____________________ |
| Privy | App ID, public verification key, allowed origins, intended login methods | ____________________ |
| Helius | Optional API key/RPC URL and public HTTPS webhook readiness | ____________________ |
| Wyntrax | Optional membership integration and signing secret | ____________________ |
| AI provider | Optional compatible endpoint/model, API key and account spending limits | ____________________ |
| Treg | Optional org/token, topics and approved metered collection budget | ____________________ |
| Telegram | Optional bot and test/production chat ownership | ____________________ |
| Backup/monitoring | Encrypted off-host destination, retention, recovery owner, alert channel | ____________________ |

Recommended VPS baseline: Ubuntu 24.04 LTS, x86-64/amd64, at least 2 vCPU/4 GB RAM and adequate SSD space; 4 vCPU/8 GB provides more operating headroom. These are starting recommendations, not measured capacity guarantees. Database retention, history coverage and queue traffic affect sizing. Builds run on GitHub, not on the VPS. The current workflows do not select an ARM platform; use amd64 unless a separately tested multi-architecture build is implemented.

Current deployment workflows use standard SSH port 22. They do not have a `DEPLOY_PORT` input. If your provider requires a different SSH port, adapt and review the workflows first; adding an undocumented secret will not change their behavior.

Do not enable paid collection merely because a provider account exists. Separate operational readiness from an authorization to spend money or publish research.

## 4. Workstation prerequisites and repository preparation

### 4.1 Install and verify tools

Use Node.js 22, the root-pinned npm 10.9.4, Git, a PowerShell terminal on Windows, and Docker Desktop with Linux containers if you choose containerized local services. PostgreSQL client tools are useful but not required if you use `docker exec` for DB administration. Git for Windows Bash runs the simulated deployment scripts. A real Linux VPS needs Bash, curl, flock and Docker Compose, not PowerShell.

```powershell
node --version
npm --version
git --version
docker version
docker compose version
```

Expected: Node 22.x and npm 10.9.4; Docker reports a reachable Linux engine and Compose v2.17 or newer. A missing Docker command means local container checks cannot run. Do not claim they passed. Update npm through your approved Node installation method if needed, then reopen the terminal. Do not silently rewrite the lockfile with a different npm version.

### 4.2 Open the intended workspace

```powershell
Set-Location C:\dev\narra-entitlements
git status --short
git branch --show-current
git remote -v
```

For a fresh clone, clone the intended repository first and enter its directory. For this existing checkout, preserve the substantial uncommitted work. Do not reset, clean or check out over it. Before any first push, review every staged file and secret scan result.

### 4.3 Install dependencies reproducibly

```powershell
npm ci --no-audit --no-fund
```

The CI/Docker paths use `npm ci` and execute lifecycle scripts. Review those scripts before installing dependencies on an untrusted checkout. If your local policy requires `--ignore-scripts`, that is an intentionally restricted install, not equivalent to CI: identify and run only approved missing generation steps afterwards. Do not use `npm audit fix --force` as setup; assess dependency changes separately.

On Windows, keep the path reasonably short and enable Developer Mode or an approved symlink-capable environment if Next standalone tracing encounters link-permission failures. Do not disable security controls globally to fix a build.

### 4.4 Establish an environment-loading policy

The Next.js launchers disable automatic `.env` discovery. Plain API/worker commands also need configuration in their process environment. Having a populated file on disk does not prove a process loaded it. Prisma and some operator CLIs have additional env-file behavior; the verified no-env preload prevents unintended discovery during controlled local verification.

Create separate, ignored local launchers only if convenient: `local-api.ps1` and `local-web.ps1`. Keep all secrets outside tracked files, do not paste them into chat, and remember that dot-sourcing a launcher changes only that terminal. A `.ps1` configuration file does not start a service unless it explicitly contains a start command.

For a controlled inherited-environment terminal:

```powershell
$env:NODE_OPTIONS='--require=C:/dev/narra-entitlements/apps/web/scripts/no-env-files.cjs'
```

Replace the absolute path if your clone is elsewhere. This preload intentionally makes `.env` reads fail in verification processes. Do not combine it with a command that explicitly requires loading an env file and then assume the file was read.

## 5. Local databases: isolated development and test resources

### 5.1 Choose one development-services approach

Approach A uses new, dedicated Docker containers on non-default ports. This avoids colliding with the owner's PostgreSQL/Memurai services and `narra_ent`. Approach B uses your existing installed PostgreSQL/Redis with a deliberately created development database and isolated Redis instance. Do not start two services on the same port.

The repository's root `docker-compose.yml` is a local-development convenience, not production configuration. It publishes PostgreSQL 5432 and Redis 6379 without loopback restrictions and uses example credentials. Do not run it on the production VPS or expose it on an untrusted network.

### 5.2 Approach A: dedicated Docker development services

The following creates new named resources. If any name already exists, inspect it first rather than deleting it. Replace the password placeholder using a private terminal/password manager. Do not use production credentials locally.

```powershell
$env:POSTGRES_PASSWORD='REPLACE_WITH_LOCAL_ONLY_PASSWORD'
docker run -d --name narrax-dev-postgres `
  --env POSTGRES_PASSWORD `
  -e POSTGRES_USER=narra -e POSTGRES_DB=narra_dev `
  -p 127.0.0.1:15432:5432 `
  -v narrax_dev_pgdata:/var/lib/postgresql/data postgres:16
docker run -d --name narrax-dev-redis `
  -p 127.0.0.1:16379:6379 `
  -v narrax_dev_redisdata:/data redis:7 `
  redis-server --appendonly yes --maxmemory-policy noeviction
docker exec narrax-dev-postgres pg_isready -U narra -d narra_dev
docker exec narrax-dev-redis redis-cli ping
```

Expected: PostgreSQL accepts connections and Redis returns PONG. Keep passwords URL-safe or percent-encode them when composing a database URL. Changing `POSTGRES_PASSWORD` on a container with an existing volume does not change that volume's database-user password; perform an intentional credential rotation instead.

### 5.3 Approach B: installed services

Confirm actual service versions and listening ports. The owner's historical local checks used PostgreSQL 17.2 and Memurai 8.2.10; CI and Compose target PostgreSQL 16/Redis 7. Those are not identical environments. Do not downgrade, drop or overwrite an installed service for this guide. Create a new `narra_dev` database with the appropriate local administrator, or keep the existing application target solely for application work after owner approval. Use dedicated test resources regardless.

### 5.4 Create separate integration-test services

Do this only if you need the full backend suite locally. No test should use production, `narra_ent`, `narra_dev`, the application Redis instance or its live queues.

```powershell
# Use a separate local-only test password, not an application credential.
$env:POSTGRES_PASSWORD='REPLACE_WITH_TEST_ONLY_PASSWORD'
docker run -d --name narrax-test-postgres `
  --env POSTGRES_PASSWORD `
  -e POSTGRES_USER=narra -e POSTGRES_DB=narra_local_test `
  -p 127.0.0.1:15433:5432 `
  -v narrax_test_pgdata:/var/lib/postgresql/data postgres:16
docker run -d --name narrax-test-redis `
  -p 127.0.0.1:16389:6379 redis:7 `
  redis-server --save "" --appendonly no --maxmemory-policy noeviction
```

The test DB guard requires a matching explicit `NARRA_TEST_DATABASE_NAME`, a local host, a PostgreSQL URL, and a name matching `narra_...test...`. `narra_local_test` satisfies it. `REDIS_URL` is not the authorization for integration-test Redis; the guard uses `NARRA_TEST_REDIS_URL` specifically. A dedicated instance is safer than sharing the application's instance with a different DB number.

## 6. Local application configuration and migrations

### 6.1 API and pipeline environment

Open an application terminal, not a test terminal. Fill placeholders privately. For the development Docker example:

```powershell
$env:NODE_OPTIONS='--require=C:/dev/narra-entitlements/apps/web/scripts/no-env-files.cjs'
$env:DATABASE_URL='postgresql://narra:REPLACE_WITH_URL_SAFE_LOCAL_PASSWORD@127.0.0.1:15432/narra_dev'
$env:REDIS_URL='redis://127.0.0.1:16379/0'
$env:API_PORT='4000'
$env:PRIVY_APP_ID='REPLACE_WITH_PUBLIC_PRIVY_APP_ID'
$env:PRIVY_VERIFICATION_KEY=Get-Content -Raw 'C:\secure-config\narrax-privy-public.pem'
$env:CORS_ORIGINS='http://localhost:4010'
$env:TRUST_PROXY='false'
$env:HSTS='false'
$env:SMART_MONEY_RESEARCH_ENABLED='false'
$env:SMART_MONEY_HISTORY_ENABLED='false'
$env:TREG_NARRATIVE_ENABLED='false'
$env:TELEGRAM_ENABLED='false'
$env:MARKET_DATA_ENABLED='false'
$env:EXECUTOR_MODE='dry_run'
```

The PEM is Privy's public verification key, not an SSH key or a private signing key. Store it outside the repository and verify it belongs to the selected Privy app. Set a real `ADMIN_PRIVY_USER_ID` or verified-email allowlist when available. AI, Helius and Telegram credentials can remain absent for the initial infrastructure boot; affected features will explicitly remain off.

`MARKET_DATA_ENABLED=false` is a conservative initial boot setting. Enable collection deliberately after the service/provider review; otherwise prices and holders will not refresh. Once enabled, the existing production market budget remains 150 token refreshes and 18 info calls per cycle, with provider pacing unchanged.

### 6.2 Apply schema to the intended application DB

Verify the database host/name without printing its password. A useful check is to parse the URL and print only hostname, port and pathname. Do not run migrations based only on a file name or terminal title.

```powershell
node -e "const u=new URL(process.env.DATABASE_URL); console.log(u.hostname,u.port,u.pathname)"
npx prisma generate --schema packages/database/prisma/schema.prisma
npx prisma migrate status --schema packages/database/prisma/schema.prisma
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
```

Expected target for the fresh example: 127.0.0.1, 15432, `/narra_dev`. Back up any existing data before applying pending migrations. `migrate deploy` applies every unapplied migration, including the wallet-research migration when pending. Do not run `migrate dev`, `db push`, `migrate reset` or generated test seeding against production. Do not rename duplicate-numbered historical migration folders.

### 6.3 Start application processes in separate terminals

| Terminal | Environment | Command |
| --- | --- | --- |
| A: API | Application DB/Redis, Privy verification, exact CORS | `npm run dev:api` |
| B: pipeline | Same application DB/Redis; intended collection/provider flags loaded in this terminal | `npm run dev:workers` |
| C: web | Public browser configuration only, listed below | `npm run dev:web` |
| D: executor, if needed | Separate DB/Redis/quote/RPC settings; no Privy app secret or signing variables | `npm run dev:executor` |

Start one full pipeline process. It already includes narrative and market consumers when configured. Do not add `dev:narratives` or `dev:market` alongside it for the same queues; dedicated consumers are alternatives for a scoped setup. A worker lock helps reject duplicate full pipelines, but it is not permission to launch overlapping consumers.

The executor is a separate execution-queue consumer, not part of the pipeline. It cannot sign/send and refuses signing credentials. Do not reuse an API terminal carrying `PRIVY_APP_SECRET` for the executor; production deployment clears forbidden executor variables explicitly.

### 6.4 Web-terminal public environment

```powershell
$env:NEXT_PUBLIC_API_URL='http://localhost:4000'
$env:NEXT_PUBLIC_SITE_URL='http://localhost:4010'
$env:NEXT_PUBLIC_PRIVY_APP_ID='REPLACE_WITH_THE_SAME_PUBLIC_PRIVY_APP_ID'
$env:NEXT_PUBLIC_WYNTRAX_URL=''
$env:NARRA_SEO_INDEXABLE='false'
Remove-Item Env:NARRA_WEB_TEST_AUTH -ErrorAction SilentlyContinue
npm run dev:web
```

Do not set any provider secret in this terminal. `NEXT_PUBLIC_*` values are public browser configuration. For a local real login, add `http://localhost:4010` to Privy's allowed origins. Use the literal localhost origin consistently: the local wallet-domain setting accepts `http://localhost:4010`, not an arbitrary localhost port or a substituted IP.

### 6.5 First local checks

Open `http://localhost:4010`, `/id`, `/research`, `/methodology` and `/early-access`. Check API `http://localhost:4000/health`. Sign in with the configured Privy app; authentication is a separate check from HTTP 200. Empty research lists on a new DB are normal. Market, social and wallet data are not pre-populated automatically by this guide.

## 7. Local verification without touching application data

### 7.1 Static and frontend checks

```powershell
npm run typecheck
npm run lint -w @narra/web
npm run test -w @narra/web -- --maxWorkers=1 --minWorkers=1
```

Serial web tests reduce resource-contention timing failures. Record actual results, not just the exit code of a later command. Counts may change as development proceeds; zero failures is the requirement, not a permanently fixed count.

### 7.2 Full backend suite in a dedicated test terminal

Stop the web server before the root backend suite: one test temporarily binds port 4010. Never run the suite in an application terminal containing provider credentials or using application Redis.

```powershell
$env:NODE_OPTIONS='--require=C:/dev/narra-entitlements/apps/web/scripts/no-env-files.cjs'
$env:NARRA_TEST_DATABASE_NAME='narra_local_test'
$env:DATABASE_URL='postgresql://narra:REPLACE_WITH_URL_SAFE_TEST_PASSWORD@127.0.0.1:15433/narra_local_test'
$env:NARRA_TEST_REDIS_URL='redis://127.0.0.1:16389/0'
$env:REDIS_URL=$env:NARRA_TEST_REDIS_URL
node -e "const u=new URL(process.env.DATABASE_URL); if(u.pathname!=='/'+process.env.NARRA_TEST_DATABASE_NAME)process.exit(1); console.log(u.hostname,u.port,u.pathname)"
npx prisma migrate deploy --schema packages/database/prisma/schema.prisma
npx vitest run --testTimeout=30000 --reporter=json --outputFile=vitest-results-local.json
if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed; inspect the report.' }
node scripts/check-test-results.mjs vitest-results-local.json
if ($LASTEXITCODE -ne 0) { throw 'Some tests failed, skipped or did not complete.' }
```

Skipped integration tests are not a pass. Fix isolation/connectivity rather than overriding the guard. Preserve reports outside commits if needed. Do not point an inaccessible test suite at the app DB merely to make its connectivity probes pass.

### 7.3 Simulated host deployment checks

Run in Git Bash from the repository root:

```bash
bash scripts/deploy-remote.test.sh
bash scripts/deploy-web-remote.test.sh
bash -n scripts/deploy-remote.sh
bash -n scripts/deploy-web-remote.sh
bash -n scripts/check-web-image.sh
```

These use fake Docker/curl for script logic. They do not prove that Docker works, a real image exists, SSH is configured or a database can be restored.

### 7.4 Fixture browser checks versus real production behavior

Fixture tests use `NARRA_WEB_TEST_AUTH=1`, placeholder public configuration and `.next-e2e`. They mock HTTP and signatures and must never be deployed. Stop the fixture server and remove that variable entirely before a production build; even `NARRA_WEB_TEST_AUTH=0` is forbidden.

```powershell
Remove-Item Env:NARRA_WEB_TEST_AUTH -ErrorAction SilentlyContinue
npm run build -w @narra/web
```

The production build scans for leaked fixture auth. The same-VPS deployment uses the standalone server, not the fixture dev server. `next start` is not the intended standalone-container startup. The image copies public/static assets and launches `server.js` in `/app/apps/web`, with container `HOSTNAME=0.0.0.0`. Do not bind that internal standalone listener to 127.0.0.1; an actual local verification reproduced a locale redirect loop in that mode.

## 8. GitHub repository and first push

### 8.1 Create the remote repository and establish identity

Create the intended repository in GitHub, preferably private. If the local repository already has history, do not initialize an unrelated remote README/license and then force-push over it. Configure your Git author identity and SSH access using your normal approved process. Verify the destination before sending source.

```powershell
git remote -v
git branch --show-current
# Only when no origin exists; replace OWNER/REPO.
git remote add origin git@github.com:OWNER/REPO.git
git remote -v
```

If an origin already exists, verify it instead of overwriting it. The release workflow targets `main` and `v*.*.*` tags. If your current branch is not main, plan the merge/branch policy explicitly rather than renaming or deleting branches blindly.

### 8.2 Audit what will be pushed

Review tracked, untracked and staged files; current work may include many substantial pre-existing changes. `.gitignore` does not remove files already tracked and is not a secret scanner. Public example files are safe templates only when they contain no real credentials.

```powershell
git status --short
git diff --check
git diff --stat
git ls-files
# Stage only reviewed source/docs/config paths intentionally, then:
git diff --cached --name-only
git diff --cached --stat
git diff --cached --check
```

Inspect any `.env`, key, PEM, ZIP, dump, backup, local launcher or credentials-like file before proceeding. Use the secret scan as an additional control. If a secret was ever committed, removing the file in a later commit is insufficient: rotate the secret immediately and plan history remediation separately. Do not paste raw diffs containing secrets into tickets or chat.

### 8.3 Disable deployment flags before first release-triggering push

In GitHub Settings → Secrets and variables → Actions → Variables, create repository variables `DEPLOY_ENABLED=false` and `WEB_DEPLOY_ENABLED=false` before the first push to main. This lets CI and backend publishing be verified without allowing SSH deployment. Frontend release publishing/deployment is conditional on its separate flag.

After reviewing and committing the intended work, push the intended branch. For main:

```powershell
git push -u origin main
```

This push starts Release, which calls CI and may publish a backend GHCR image after CI. Deployment flags prevent deploy jobs, not all publishing. Pull requests run CI. Arbitrary feature-branch pushes without a PR do not have a general push CI trigger in the current workflow. Use the Actions UI for an explicit manual run if needed.

## 9. GitHub Actions, environments, variables and secrets

### 9.1 Actions permissions and branch protection

Enable GitHub Actions for the repository and allow the actions used in `.github/workflows`. Default workflow permission can remain read-only; specific jobs request `packages: write` when publishing. Verify organization policy permits package creation/push and third-party actions. Do not create a personal access token merely to replace the built-in `GITHUB_TOKEN` without a specific need.

Configure branch protection/rulesets for main: require PR review, block force pushes and require the stable status check named `CI passed`. The first run may need to finish before that check appears in the picker. Security workflow findings are important but are not currently part of that single CI aggregation gate.

### 9.2 Create two protected deployment environments

| Environment | Used for | Required configuration |
| --- | --- | --- |
| `production` | Backend SSH deploy | Required reviewer(s), allowed main/v* refs, SSH secrets if environment-scoped |
| `production-web` | Frontend build/verify/publish/deploy | Required reviewer(s), allowed main/v* refs, public build variables and SSH secrets if environment-scoped |

An environment name in YAML does not automatically create an approval requirement. Configure the reviewers in GitHub, verify your account/repository plan supports the protection you expect, and test that jobs actually wait. Environment-scoped secrets in production are not visible automatically in production-web. Either store shared SSH secrets at repository scope or deliberately duplicate them in both environments.

### 9.3 Repository variables: release switches

| Variable | Initial value | Later action |
| --- | --- | --- |
| `DEPLOY_ENABLED` | `false` | Set true only after backend host/backup/config readiness |
| `WEB_DEPLOY_ENABLED` | `false` | Set true only after frontend host/public-config readiness |
| `ENABLE_CODEQL` | Unset/false unless approved | Set true only when licensing and permissions support it |
| `GITLEAKS_ENABLED` | Leave enabled | If disabling is necessary, record rationale and a replacement control |

Both deployment switches must be repository-scoped. Their job conditions are evaluated before entering the environment. Defining them only inside production/production-web may cause an apparently configured job to remain skipped.

### 9.4 Frontend public build variables

Place these in repository variables or production-web variables. The first four must match host `.env.web` exactly, including an intentionally empty optional claim URL.

| GitHub variable | Image/host variable | Example only |
| --- | --- | --- |
| `WEB_SITE_URL` | `NEXT_PUBLIC_SITE_URL` | `https://narrax.example` |
| `WEB_API_URL` | `NEXT_PUBLIC_API_URL` | `https://api.narrax.example` |
| `WEB_PRIVY_APP_ID` | `NEXT_PUBLIC_PRIVY_APP_ID` | Actual public Privy app ID |
| `WEB_WYNTRAX_URL` | `NEXT_PUBLIC_WYNTRAX_URL` | Empty or approved HTTPS claim URL |
| `WEB_SEO_INDEXABLE` | `NARRA_SEO_INDEXABLE` | `false` until launch review |

Origins must be bare HTTPS origins: no trailing slash, path, credentials or query. The release validator refuses empty/malformed required values and any test-auth flag. It cannot determine whether a syntactically valid app ID actually belongs to your Privy app; verify that independently.

### 9.5 SSH secret matrix

| Secret | Exact expectation | Where it belongs |
| --- | --- | --- |
| `DEPLOY_HOST` | DNS host or IPv4; no scheme, port or shell metacharacters | Repository or both protected environments |
| `DEPLOY_USER` | Non-root Linux username, e.g. deploy | Same visibility as above |
| `DEPLOY_PATH` | Absolute path, e.g. `/srv/narrax`; no spaces or shell metacharacters | Same visibility as above |
| `DEPLOY_SSH_KEY` | Dedicated CI private key, complete contents | GitHub encrypted secret only |
| `DEPLOY_KNOWN_HOSTS` | Verified SSH known_hosts entry for the target | GitHub encrypted secret |

The corresponding CI public key belongs in the deploy user's authorized_keys on the VPS. Do not upload the private key to the VPS. Keep a separate operator/rescue key. Current path/host validation does not support literal IPv6 deploy hosts or a custom SSH port. Public API/domain traffic can still use IPv6 if DNS/proxy configuration is correct.

### 9.6 Other secrets and package access

Backend application secrets stay in `/srv/narrax/.env`, not GitHub build arguments and never NEXT_PUBLIC variables. The frontend job receives only its public build inputs and deploy credentials. The built-in GITHUB_TOKEN handles GHCR publishing and is sent over SSH on stdin for the host pull; it is not a permanent host credential.

The backend package is `ghcr.io/owner/repo`; web is `ghcr.io/owner/repo-web`. Registry paths are lowercase. Check package visibility and Actions access after first creation. Keep packages private and grant the repository the access required to publish/pull. For an organization, the existing gitleaks action may require `GITLEAKS_LICENSE`; CodeQL on private repositories may require a paid security entitlement. Review current plan settings rather than assuming a workflow name grants access.

## 10. Understand CI and release sequencing

| Job/path | What it checks or does | What it does not prove |
| --- | --- | --- |
| Static | Repo hygiene, simulated backend/frontend deploy tests, types, lint | Real VPS/Docker behavior |
| Backend | Isolated PostgreSQL 16/Redis 7, migrations/drift, full no-skip tests | Existing production DB health |
| Web | Serial web tests, standalone production build/auth scan, production SEO browser checks | Real Privy login or live domain |
| E2E | Fixture-auth development browser suite | Real wallet proof or actual provider data |
| Backend Docker | Backend image/runtime/migration/Compose assertions | Compatibility with your existing DB without a backup/review |
| Web Docker | Standalone non-root/read-only image, pages/schema/404/PNG/release identity and Compose isolation | Real DNS, TLS or actual auth settings |
| CI passed | Stable aggregate over all required CI jobs | Scheduled security findings being resolved |

Release starts on main pushes, version tags matching `v*.*.*`, or manual dispatch. Backend image publishing is after CI; backend SSH deployment is after publishing and its flag/approval gate. The optional frontend job is independently after CI and its flag/approval gate. It builds for actual public settings, smoke-tests that exact local image, pushes it, resolves a digest and deploys that digest.

Backend publishing rebuilds the CI-checked commit rather than promoting CI's exact image; bit-for-bit equivalence is not established. Frontend release explicitly smoke-tests the image it then pushes. Do not deploy the CI placeholder bundle (`narrax.example`, fake app IDs) as the real site.

Backend/frontend deploy jobs share the `deploy-production` concurrency group so their registry login/logout operations on the same host do not race. They are serialized but not a single atomic application release. Inspect both job results: a green backend deploy does not imply frontend deployment happened, and vice versa.

## 11. Prepare the VPS operating system and deploy user

### 11.1 Connect using an operator key and verify the machine

Use the provider console or previously verified operator SSH access. Confirm the host identity out of band before accepting an SSH fingerprint. Record OS version, architecture, available disk/RAM and existing services before making changes. Commands below are for an approved fresh Ubuntu VPS; adapt rather than replacing an existing production configuration blindly.

```bash
cat /etc/os-release
uname -m
free -h
df -h
sudo ss -lntp
timedatectl status
```

Expected architecture for current builds: x86_64. Confirm ports 4000/4010 are free or intentionally assigned; do not kill an unfamiliar listener. Use UTC and working time synchronization for a new host. Changing an existing host's timezone requires operational review because schedules/log interpretation may change. Token expiry and evidence timestamps require a correct clock.

### 11.2 Install baseline utilities

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg openssh-server ufw util-linux
```

`util-linux` provides flock. Use the OS package's curl and Bash. Review provider-specific firewall/network requirements. Keep a provider rescue console and a second verified SSH session before changing firewall or SSH authentication policy.

### 11.3 Create a deploy account if it does not exist

```bash
sudo adduser --disabled-password --gecos '' deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo install -d -m 750 -o deploy -g deploy /srv/narrax
sudo install -d -m 750 -o deploy -g deploy /srv/narrax/docker /srv/narrax/.deploy
```

If the account/directory already exists, inspect and reuse it; do not recreate or recursively chown unrelated files. Add the operator public key and the dedicated CI public key to `/home/deploy/.ssh/authorized_keys`, one key per line. The file should be owned by deploy with mode 600. `restrict` key options can disable forwarding/PTY features, but do not apply a forced command that breaks the workflow's SSH/scp operations without an appropriate reviewed wrapper.

Do not disable root/password SSH until you have verified key-based access for the intended operator in a new session and confirmed a rescue path. The CI job cannot interactively type a key passphrase; choose a dedicated automation identity protected by GitHub secrets and appropriate access controls.

## 12. Install Docker/Compose and protect network access

### 12.1 Docker Engine on a fresh Ubuntu host

Follow Docker's official Ubuntu installation guidance for your actual OS release. The example below uses the official apt repository. Do not blindly remove an existing Docker/containerd installation or replace a running provider-managed engine.

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker deploy
```

Reconnect as deploy after adding the Docker group; existing sessions do not automatically acquire it. Docker-group membership effectively grants host-root capability. The account is non-root, but it is still privileged; protect its SSH keys accordingly. Rootless Docker is not the currently documented deployment target.

```bash
docker version
docker compose version
docker info
```

Expected: reachable engine, Linux containers, suitable architecture and Compose >=2.17. Do not expose the Docker daemon's unauthenticated TCP socket.

### 12.2 Host and cloud firewall

On a fresh host using SSH port 22, allow SSH before enabling a default-deny policy. Replace SSH rules intentionally if using a provider-specific arrangement, and remember the current workflows assume port 22.

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status verbose
```

Apply corresponding cloud-firewall rules. If restricting SSH by source IP, account for GitHub-hosted runner egress behavior; do not assume your home IP restriction admits GitHub. A controlled runner/network is a separate infrastructure decision.

Docker-published ports can bypass ordinary UFW expectations. The production templates intentionally publish API/web only on loopback and do not publish DB/Redis. Verify actual bindings using `docker ps`/`docker inspect` and external checks. Do not rely on UFW alone to protect an accidentally exposed database.

## 13. Create and verify the CI SSH identity

Generate a dedicated deployment key on a trusted workstation, outside the repository. Never reuse a wallet key or the GMGN authentication key. Example in PowerShell:

```powershell
ssh-keygen -t ed25519 -C 'narrax-github-deploy' -f "$env:USERPROFILE\.ssh\narrax_ci_deploy"
```

For unattended CI, arrange a noninteractive dedicated key according to your policy. Install only its `.pub` contents in the VPS deploy account. Store the complete private-key contents in DEPLOY_SSH_KEY, not a file path or the public key. Keep the operator key separate so revoking CI access does not remove recovery access.

Obtain the host's ED25519 fingerprint through the provider console or trusted administrator channel:

```bash
# Run on the VPS through a trusted session/console.
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

From the trusted workstation, capture the candidate known_hosts line with ssh-keyscan, verify its fingerprint against that out-of-band value, then store the verified full line as DEPLOY_KNOWN_HOSTS. ssh-keyscan alone does not authenticate a host and must not be used to blindly trust whichever endpoint answers.

```powershell
ssh-keyscan -t ed25519 YOUR_VPS_HOST
ssh -i "$env:USERPROFILE\.ssh\narrax_ci_deploy" deploy@YOUR_VPS_HOST 'id; docker version --format "{{.Server.Version}}"'
```

Verify that GitHub's secrets reference the same host spelling used in known_hosts. A rebuilt VPS with a changed host key requires out-of-band verification before updating the secret. Never fix host-key failure by disabling StrictHostKeyChecking.

## 14. Provision production files and backend configuration

### 14.1 Required host layout

```text
/srv/narrax/
  .env                              backend runtime secrets/config, mode 600
  .env.web                          frontend public/server-only config, mode 600
  docker/docker-compose.prod.yml    operator-owned adapted backend base file
  docker/docker-compose.deploy.yml  sent by backend release
  docker/docker-compose.web.yml     sent by frontend release
  .deploy/deploy-remote.sh           sent by backend release
  .deploy/current_image             last successful backend digest
  .deploy/previous_image            previous backend digest
  .deploy/web/deploy-web-remote.sh   sent by frontend release
  .deploy/web/current_release       frontend digest + commit
  .deploy/web/current.env           previous-ready/current frontend config snapshot
  .deploy/web/previous_release      rollback release record
  .deploy/web/previous.env          rollback config snapshot
```

CI does not create or upload the real env files, or replace your backend base Compose file. It ships the deploy override/scripts and the frontend Compose definition. Establish the operator-owned files before enabling either deploy flag.

### 14.2 Transfer templates, not credentials

From the workstation, use the verified operator connection to transfer `.env.example`, `docker/web.env.example` and `docker/docker-compose.prod.example.yml` to clearly named template files under `/srv/narrax`. Do not overwrite existing host files. On the VPS, review templates, create new files only if absent, and edit privately.

```bash
cd /srv/narrax
umask 077
# Only for a new host after the templates have been transferred and reviewed:
cp -n .env.template .env
cp -n .env.web.template .env.web
cp -n docker/docker-compose.prod.template.yml docker/docker-compose.prod.yml
nano .env
chmod 600 .env .env.web
```

The backend base template uses PostgreSQL user/database `narra`, Redis service `redis`, API loopback port 4000 and named persistent volumes. Preserve those defaults for the first supported deployment unless you deliberately adapt and validate them. The backend override clears forbidden variables for the executor; do not omit that override in production startup.

### 14.3 Backend minimum production baseline

This is illustrative content for the host `.env`, not a credential to reuse. Choose a long URL-safe database password, for example a securely generated hexadecimal value. Avoid dollar signs or reserved URL characters in this first template unless you correctly handle both dotenv interpolation and URL encoding.

```dotenv
PROJECT_NAME=Narrax
POSTGRES_PASSWORD=REPLACE_WITH_LONG_RANDOM_URL_SAFE_PASSWORD
DATABASE_URL=postgresql://narra:REPLACE_WITH_THE_SAME_PASSWORD@postgres:5432/narra
REDIS_URL=redis://redis:6379
API_PORT=4000
PRIVY_APP_ID=REPLACE_WITH_PUBLIC_PRIVY_APP_ID
PRIVY_VERIFICATION_KEY='-----BEGIN PUBLIC KEY-----\nREPLACE_WITH_REAL_PUBLIC_KEY_BODY\n-----END PUBLIC KEY-----'
PRIVY_APP_SECRET=
ADMIN_PRIVY_USER_ID=
ADMIN_EMAIL=
CORS_ORIGINS=https://narrax.example
TRUST_PROXY=true
HSTS=true
REALTIME_STREAM_KEY=narra:events
MARKET_DATA_ENABLED=false
SMART_MONEY_RESEARCH_ENABLED=false
SMART_MONEY_HISTORY_ENABLED=false
TREG_NARRATIVE_ENABLED=false
TELEGRAM_ENABLED=false
EXECUTOR_MODE=dry_run
EXECUTOR_ALLOWLIST_USER_IDS=
EXECUTOR_HARD_CAP_SOL=0.01
EXECUTOR_DAILY_CAP_SOL=0.05
EXECUTOR_MAX_OVERHEAD_SOL=0.005
EXECUTOR_MAX_PRIORITY_FEE_SOL=0.001
EXECUTOR_BROADCAST_WINDOW_MS=10000
```

Replace example domains and keys. Literal `\n` sequences in the Privy public-key value are normalized by the API verifier; preserve the full SPKI public key. Do not substitute an app secret or any private key. Set TRUST_PROXY only because the controlled reverse proxy is the sole public entry point; do not expose port 4000 directly. HSTS is appropriate only once external HTTPS is correctly configured.

`POSTGRES_PASSWORD` is additionally required by production Compose interpolation even though the root app env template centers on DATABASE_URL. Compose explicitly overrides app-container DATABASE_URL/REDIS_URL for its internal service names. A local `localhost` URL inside a container points to that container, not the host or PostgreSQL service. Use the effective Compose topology, not assumptions from a local terminal.

### 14.4 Backend secrets and optional settings

| Group | Variables | Requirement/behavior |
| --- | --- | --- |
| Privy verification | `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY` | Effective nonempty app/key required for API startup; DB overrides can take precedence |
| Privy server API | `PRIVY_APP_SECRET` | Server-only when a feature requires it; not a substitute for verification key; cleared for executor |
| Admin authority | `ADMIN_PRIVY_USER_ID`, `ADMIN_EMAIL` | If either is set, environment allowlist is authoritative; DB isAdmin alone cannot override it |
| Helius delivery | `HELIUS_API_KEY`, `HELIUS_WEBHOOK_URL`, `HELIUS_WEBHOOK_SECRET` | All required to enable tracked-wallet webhook sync |
| Helius RPC | `HELIUS_RPC_URL` | Optional until wallet balances/history/discovery are enabled; use approved HTTPS endpoint |
| AI | `AI_PROVIDER_API_KEY`, `AI_BASE_URL`, `AI_MODEL_ID`, `AI_REQUEST_STYLE` | Missing key disables AI; choose actual provider-supported model; saved Admin settings may override defaults |
| Quotes | `JUPITER_API_KEY` | Quote availability/rate limits; missing/refused quotes can stop paper fills and manual quotes |
| Manual trading | `MANUAL_TRADING_ENABLED`, `JUPITER_API_KEY`, `HELIUS_RPC_URL` | Default `false`; all three plus the migration and a verified wallet are required. Never add a private key. |
| Market overrides | `DEXSCREENER_BASE_URL`, `GECKOTERMINAL_BASE_URL` | Leave unset to use supported defaults; only change deliberately |
| Membership | `WYNTRAX_WEBHOOK_SECRET`, `WYNTRAX_WEBHOOK_SECRET_PREVIOUS` | Optional integration; previous supports controlled rotation |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, delivery limits | Disabled until both credentials and intended enablement exist |
| GMGN | `GMGN_API_KEY` | No application adapter wired; not required for deployment or independent intelligence |

Never set `EXECUTOR_SIGNING_KEY`, `WALLET_PRIVATE_KEY`, `SOLANA_PRIVATE_KEY`, `PRIVY_AUTHORIZATION_PRIVATE_KEY` or `PRIVY_AUTHORIZATION_KEY`. The backend deploy script refuses them. Do not bypass this guard to get a deployment green.

The full root `.env.example` remains the source for defaults and optional execution/delivery limits. Production files are not shell scripts: do not `source .env` casually. Let Compose read them, and avoid printing `docker compose config` with full environment values into logs/tickets; use `config --quiet` for syntax checking.

## 15. Provision frontend configuration and verify cross-system equality

Edit `/srv/narrax/.env.web` separately from `.env`. It must not contain backend credentials. The Compose definition passes an explicit allowlist, not the entire file as container env_file.

```dotenv
NEXT_PUBLIC_SITE_URL=https://narrax.example
NEXT_PUBLIC_API_URL=https://api.narrax.example
NEXT_PUBLIC_PRIVY_APP_ID=REPLACE_WITH_PUBLIC_PRIVY_APP_ID
NEXT_PUBLIC_WYNTRAX_URL=
NARRA_SEO_INDEXABLE=false
NARRA_GOOGLE_SITE_VERIFICATION=
NARRA_BING_SITE_VERIFICATION=
```

| Concern | Values that must agree | Common failure |
| --- | --- | --- |
| Web identity | GitHub WEB_SITE_URL; host NEXT_PUBLIC_SITE_URL; canonical web hostname | Wrong links/canonicals or image-config drift refusal |
| API location | GitHub WEB_API_URL; host NEXT_PUBLIC_API_URL; reachable API TLS origin | Browser connection failure/mixed content |
| Auth app | GitHub WEB_PRIVY_APP_ID; host NEXT_PUBLIC_PRIVY_APP_ID; API effective Privy app ID; verification-key app | Access token audience/key mismatch |
| Browser CORS | API effective allowed origins contains exact web origin | Preflight/WebSocket refused |
| Wallet proof | `entitlements.wallet_link_domain` equals exact web origin | Signing blocked before verification |
| Claim page | GitHub WEB_WYNTRAX_URL equals host optional claim URL | Stale browser CTA or preflight drift failure |
| Search launch | Host NARRA_SEO_INDEXABLE and intended WEB_SEO_INDEXABLE setting | Entire site remains noindex, or preview indexed accidentally |

First-four public values are compiled into the browser bundle. Changing only `.env.web` does not recompile JavaScript and is rejected at preflight/startup. Update GitHub and host settings together, then build a new release. Saved backend auth settings can also override env fallback; inspect Admin's effective source before diagnosing apparent mismatch.

Indexing and verification tokens are server-only runtime choices. A controlled recreate/redeploy applies them. Keep indexing false until the SEO launch checklist passes. Runtime-only changes do not remove the requirement for matching public build values.

## 16. DNS, TLS reverse proxy and public routing

### 16.1 DNS records

Create A records for the canonical web and API hosts pointing to the VPS public IPv4. Create AAAA records only if the VPS and firewall/proxy genuinely support IPv6 end to end. Remove stale AAAA records rather than allowing intermittent IPv6 failures. Set a reasonable low TTL during migration, then review normal TTL afterwards.

If a CDN proxy is used, validate TLS mode, WebSocket forwarding, webhook handling and client-address trust. Do not cache authenticated API responses or private pages, do not place an interactive challenge in front of Helius, and do not indiscriminately trust client-supplied forwarded headers. Simpler direct DNS is easier for initial verification.

### 16.2 Install/configure a reverse proxy

Caddy is the example here because it manages public TLS automatically for valid domains. Install it through its current official package instructions appropriate to the chosen OS. If nginx or a provider proxy already exists, adapt that installation instead of adding a second listener on ports 80/443.

Example Caddyfile, after replacing reserved domains:

```caddyfile
narrax.example {
    reverse_proxy 127.0.0.1:4010
}
api.narrax.example {
    reverse_proxy 127.0.0.1:4000
}
www.narrax.example {
    redir https://narrax.example{uri} permanent
}
```

Only include the alternate www site if you control its DNS too. Do not use example.com/example domains literally. Validate the proxy config before reload, e.g. Caddy's `caddy validate --config /etc/caddy/Caddyfile`, then reload through systemd. Preserve existing unrelated sites. Certificate issuance requires correct DNS and reachable ACME challenge paths/ports.

Caddy forwards Host and the relevant scheme/client information by default. For nginx, preserve Host, X-Forwarded-Host and X-Forwarded-Proto and support WebSocket upgrade for `/v1/stream`. Do not terminate TLS and then tell the app the external scheme is HTTP. Keep API/web application ports private even after TLS is working.

### 16.3 Check DNS/TLS separately from application readiness

```bash
getent ahosts narrax.example
getent ahosts api.narrax.example
curl -I https://narrax.example
curl -I https://api.narrax.example/health
```

Before containers are deployed, a proxy 502/503 can be expected even when DNS/TLS is correct. After deployment it is a failure requiring investigation. Do not use `curl -k` as an acceptance test; a certificate verification failure is not fixed by disabling verification.

## 17. Backups and the first backend deployment

### 17.1 Decide whether this is a fresh database or an upgrade

For an existing production database, identify the actual service, database name and storage volume. Take a verified backup before applying migrations, especially the pending wallet-research migration. Do not assume the template database name `narra` refers to the owner's local `narra_ent` data. Those are different targets.

For a genuinely fresh VPS/database, record that it is empty. If desired, start only postgres/redis from the reviewed backend base Compose file to verify storage/readiness before enabling deployment. That does not require building app services:

```bash
cd /srv/narrax
docker compose --env-file .env -f docker/docker-compose.prod.yml up -d --wait postgres redis
docker compose --env-file .env -f docker/docker-compose.prod.yml exec -T postgres pg_isready -U narra -d narra
docker compose --env-file .env -f docker/docker-compose.prod.yml exec -T redis redis-cli ping
```

### 17.2 Example PostgreSQL backup

Run in Bash on the VPS; redirecting a binary dump through older Windows PowerShell can corrupt it. Use an encrypted off-host copy in addition to this local file. The example path is outside the source/deploy context.

```bash
sudo install -d -m 700 -o deploy -g deploy /srv/narrax-backups
cd /srv/narrax
umask 077
backup="/srv/narrax-backups/narrax-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file .env -f docker/docker-compose.prod.yml exec -T postgres \
  pg_dump -U narra -d narra -Fc > "$backup"
test -s "$backup"
docker compose --env-file .env -f docker/docker-compose.prod.yml exec -T postgres \
  pg_restore --list < "$backup" > "$backup.contents.txt"
sha256sum "$backup" > "$backup.sha256"
```

Listing a dump is a structural check, not a successful restore drill. Restore into a separately isolated scratch database/host and verify important rows before claiming recoverability. Keep backups and env files out of web-served paths and Git. Coordinate an approved maintenance window for full storage/Redis recovery; never overwrite a live DB during a routine deploy.

### 17.3 Pre-deployment backend checklist

- The first remote CI run, including migrations/drift and both Docker jobs, is green with no skipped required checks.
- production environment reviewers and SSH secrets are visible to the backend job.
- Host `.env`, reviewed `docker-compose.prod.yml`, Docker/Compose, free ports and storage are ready.
- Privy effective app ID/public verification key are configured so API startup can succeed.
- Existing data backup is verified and the pending migrations reviewed for compatibility with the previous image.
- Signing credentials are absent; research flags and optional paid integrations remain off.
- Canonical API DNS/TLS and secure proxy routing are ready or understood as the remaining first-release verification step.

### 17.4 Enable and run the backend release

Set repository variable `DEPLOY_ENABLED=true`, leaving WEB_DEPLOY_ENABLED=false initially. Run Release on main through the Actions UI, or push an intentionally approved main/tag release. Approve the production deployment when it waits. Inspect the CI, publish and deploy jobs separately.

Backend deploy order: pull image → start data services → run migrations → start api/worker/executor → API health → worker/executor running checks → successful-image state. Migration failure stops before app replacement. A failed new image rolls back app containers when an earlier image is recorded; migrations are not reverted. First deployment has no known-good image to restore.

### 17.5 Check the backend on the VPS

After a successful recorded deploy:

```bash
cd /srv/narrax
export NARRA_IMAGE="$(cat .deploy/current_image)"
docker compose --env-file .env -f docker/docker-compose.prod.yml -f docker/docker-compose.deploy.yml ps
curl -fsS http://127.0.0.1:4000/health
curl -fsS https://api.narrax.example/health
docker compose --env-file .env -f docker/docker-compose.prod.yml -f docker/docker-compose.deploy.yml logs --tail 100 api worker executor
```

Inspect logs privately; redact before sharing. A green API response does not prove provider delivery, wallet qualification, queued processing or customer login. Do not expose full Compose environment output to diagnose it.

## 18. First frontend deployment on the same VPS

### 18.1 Pre-deployment frontend checklist

- The backend is reachable at the HTTPS API origin and its CORS policy includes the intended web origin.
- `.env.web` exists and the first four values match GitHub WEB_* values exactly.
- production-web has actual approval protection and access to the SSH secrets.
- Port 4010 is free for the frontend; the reverse proxy points the web host there.
- WEB_SEO_INDEXABLE and host indexing remain false initially.
- The real frontend Docker job is green; no fixture build or placeholder CI bundle will be deployed.

### 18.2 Enable the independent frontend release

Set repository variable `WEB_DEPLOY_ENABLED=true`. Run Release on main again and approve production-web. Backend may also run if DEPLOY_ENABLED remains true; they share concurrency and execute independently. If you intend a frontend-only release, deliberately set DEPLOY_ENABLED=false first and document that choice. It is not a rollback and does not stop an already running backend.

Frontend order: validate settings → build actual-origin image → run exact-image smoke tests → push → resolve registry digest → SSH ship only deploy files → validate host config using the new image → replace only web → expected-commit health and HTTP-200 research page → record release/environment snapshot.

### 18.3 Check revision, routing and private boundaries

```bash
cd /srv/narrax
cat .deploy/web/current_release
curl -fsS http://127.0.0.1:4010/api/health
curl -fsS https://narrax.example/api/health
curl -I https://narrax.example/research
curl -I https://narrax.example/id/research
curl -I https://narrax.example/app
```

The health JSON must identify the frontend job's full commit. `/research` should be 200, not a redirect loop. Private routes must remain noindex. To inspect Compose, read the recorded image from the release state, export it as NARRA_WEB_IMAGE and use the separate project:

```bash
read -r NARRA_WEB_IMAGE WEB_REVISION < .deploy/web/current_release
export NARRA_WEB_IMAGE
docker compose --project-name narrax-web --env-file .env.web -f docker/docker-compose.web.yml ps
docker compose --project-name narrax-web --env-file .env.web -f docker/docker-compose.web.yml logs --tail 100 web
```

Do not use backend Compose commands to manage web, or use frontend rollback to alter DB state. Frontend startup refuses a public-config mismatch even if the JS bundle could otherwise be served.

## 19. Configure authentication, owner access and entitlements

### 19.1 Privy configuration checklist

- Choose the intended Privy app and login methods in its dashboard.
- Add the production web origin to allowed origins; keep local origins only if intentionally used by the app/environment policy.
- Confirm API effective PRIVY_APP_ID and public verification key belong together, and the frontend public app ID agrees.
- Verify local ES256 token assumptions against the app's actual tokens: issuer privy.io, audience app ID, subject Privy user ID. Do not copy access tokens into config or persist them manually.
- Confirm the clock/NTP before diagnosing repeated token-expiry errors.

Saved SystemSetting auth values take precedence over environment fallback. If an old DB override points at another app, changing only `.env` may not fix it. Use Admin's effective-source diagnostics. For operator lockout, a deliberate `npm run settings -- reset auth` removes audited auth overrides and restores env fallback; run it only after confirming valid env values and the correct DB.

### 19.2 Bootstrap the owner safely

Sign in once on the real web origin so the user exists. List users from the backend container:

```bash
cd /srv/narrax
export NARRA_IMAGE="$(cat .deploy/current_image)"
docker compose --env-file .env -f docker/docker-compose.prod.yml -f docker/docker-compose.deploy.yml \
  exec -T api npm run make-admin -- --list
```

This prints user identifiers/emails, so treat the output as private operational data. Set ADMIN_PRIVY_USER_ID to the intended verified Privy DID in host `.env`, optionally also the verified-email allowlist. Recreate the API with the recorded image, not a moving tag. Once either allowlist variable is set, that environment is the admin authority; toggling isAdmin in the DB cannot bypass it.

If neither allowlist is configured and the owner explicitly chooses DB-flag bootstrap, the operator CLI `npm run make-admin -- TARGET_USER_ID` can set the flag for exactly one matching user. Revoke mistakes immediately. Prefer a durable explicit environment identity after verification; do not guess a DID from a wallet address or typed email.

### 19.3 Configure early access and wallet-proof domain

In `/app/admin`, set `entitlements.wallet_link_domain` to the exact HTTPS web origin, not the API origin. Configure intended early-access enabled state, seat cap, invitation policy, close time and grant duration with a reason. A fresh database defaults to early access disabled and zero seats; sign-in success does not imply enrollment is open.

The browser refuses a wallet proof whose Domain string differs from `window.location.origin`. Never rewrite a signed message to force acceptance. Changing the configured domain invalidates pending challenges. Review and regenerate pending flows after a domain change. Feature entitlement gates remain authoritative; do not globally disable them to make onboarding look successful.

### 19.4 Required expiry maintenance task

Schedule grant/challenge expiry every minute. This is an operator task, not a declared Compose service or a guaranteed pipeline scheduler in the current deployment. Inside the container, invoke the TS script directly with inherited env; do not use a package command that expects a mounted `.env` file.

Example operator-created `/srv/narrax/.deploy/expire-entitlements.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /srv/narrax
export NARRA_IMAGE="$(cat .deploy/current_image)"
exec /usr/bin/docker compose --env-file .env \
  -f docker/docker-compose.prod.yml -f docker/docker-compose.deploy.yml \
  exec -T api npx tsx scripts/entitlements-expire.ts
```

Set owner/mode appropriately, test the script manually and confirm your Docker binary path. Then add to the deploy user's crontab:

```cron
* * * * * /usr/bin/flock -n /srv/narrax/.deploy/expiry.lock /bin/bash /srv/narrax/.deploy/expire-entitlements.sh >> /srv/narrax/.deploy/expiry.log 2>&1
```

Configure log rotation and monitor failures. Do not create competing expiry jobs on multiple hosts. During a planned restore/migration outage, pause or account for scheduled jobs so they do not write into the recovery target.

## 20. Connect collection and optional integrations in phases

### 20.1 Market collection

After reviewing provider terms, rate limits and desired coverage, set MARKET_DATA_ENABLED=true in the intended backend environment and recreate the worker with the recorded image. Run one pipeline consumer. Preserve the 150-token/18-info-call budgets and Gecko pacing; failed/absent observations remain missing rather than zero.

Use Admin Data Health to inspect recent worker completion, source-backed price observations, holder/risk freshness and rejection counters. A recent risk row is not a safety verdict. A current price does not make missing holders current. The coverage view is bounded and is not an entire-chain census.

Token artwork in the token list and token detail comes from the same DEX Screener pair observation used for price. Only HTTPS artwork on `cdn.dexscreener.com` or `dd.dexscreener.com` is accepted; an absent, malformed, wrong-token or broken image falls back to symbol initials. The image is decorative and is not a verification badge, logo endorsement or safety signal. The browser CSP allows only those two image origins, and no image URL is fetched by the server.

**Early Radar safety evidence**

For local Windows collection that survives the chat session, use the scoped scheduled task:

```powershell
.\scripts\collector-task.ps1 -Worker market -Action Install
.\scripts\collector-task.ps1 -Worker market -Action Start
.\scripts\collector-task.ps1 -Worker market -Action Status
```

Stop any manually started market consumer before starting the task. Task Scheduler runs the collector under the
current interactive user, checks every minute, ignores overlapping starts and starts it at logon. It survives a
chat/harness restart; it requires the user to be logged on and the machine, database and Redis to be running.
Logs are in `logs/collector-market.log`. `-Action Stop` disables the periodic trigger and stops the task;
`-Action Start` re-enables it. `-Action Remove` stops and unregisters it. Install refuses to replace an existing task.
Stop/Remove capture the task's own process tree and terminate remaining children: Windows may otherwise leave Node
running after its PowerShell wrapper exits. The wrapper checks creation time before terminating a captured PID.
The task loads `local-api.ps1` locally; credentials are not embedded in scheduled-task arguments.
This starts only the scoped collector. It does not start execution, Telegram delivery or the full pipeline.
The market collector also runs the existing bounded, research-only Early Radar outcome tracker after price refresh.
Frozen entries and terminal outcomes are preserved; missing horizon prices become explicit `UNKNOWN`.
The same wrapper supports `-Worker narratives`: use `-Disabled` when credentials are not ready, then run
`-Action Start` after configuring them. Disabled installation is atomic: triggers remain configured, but the task
cannot launch until enabled. Recovery check on 2026-10-23 at 21:25 UTC found one narrative consumer and three
completed runs with 83/73/77 mentions stored and zero provider errors; the earlier HTTP 401 blocker had cleared.
Confirm **recorded collector diagnostics** and a single queue consumer; a running task is not proof of fresh data.

Observed-evidence rows are validated independently. A malformed holder observation cannot invalidate a valid quote
or relabel missing records as invalid. Both evidence panels age cached observations in the browser every 15 seconds;
this changes freshness labels only, never a historical verdict. RugCheck flags remain visible alongside its facts.

```dotenv
RADAR_SAFETY_MODE=shadow
RADAR_SAFETY_EVIDENCE=rugcheck
RADAR_SAFETY_EVIDENCE_MAX_PER_RUN=3
RUGCHECK_BASE_URL=https://api.rugcheck.xyz
RADAR_TRADEABILITY_EVIDENCE=on
RADAR_TRADEABILITY_MAX_PER_RUN=3
```

The full pipeline and dedicated market worker can enrich publication candidates from the public RugCheck report API;
no API key is required. These additional safety requests are capped at three per narrative run and three per social
run, with ten-minute shared caching and six-second request deadlines. The 150 price-token/18 info-call market budgets
and attention scoring inputs are preserved. Set RADAR_SAFETY_EVIDENCE=off to disable this source.

Tradeability comes from one live Jupiter quote for a $50 USDC buy on the candidate mint. It is capped at three quotes
per run, cached per mint for ten minutes, spaced 500 ms apart and abandoned after six seconds. The quoted price impact
is stored as evidence; a failed or missing quote stays UNKNOWN and is never replaced by a liquidity-derived estimate.
No quote is stored as a price, a fill or a recommendation. Set RADAR_TRADEABILITY_EVIDENCE=off to disable it.

New `radar-safety-v2` snapshots require validated quote provenance: the actual 50,000,000 USDC base-unit input,
positive output and minimum output, a nonempty route, matching mints, 50 bps slippage and the provider-response
timestamp. The ticket is **50 USDC**, not a guarantee of a fixed USD value. Freshness is checked again at alert
publication, including after lock acquisition. Missing, future or over-ten-minute quote evidence cannot pass.
The six-second HTTP deadline includes response-body consumption. Older impact-only cache entries are rejected;
old frozen radar snapshots retain their original policy version and verdict.

Opportunities and token detail also show **Latest observed evidence**, read only from stored market/holder/risk rows
and mint-bound RugCheck/Jupiter caches. Each source is labelled recent, stale, unverified, missing or invalid. This
panel makes no provider calls, does not calculate a safety verdict and never rewrites historical radar snapshots.

The source maps reported creator holding, top-ten concentration excluding known pool/locker accounts, supported LP
lock evidence for the largest market, and explicit risk flags. Wrong-mint, malformed, future or stale cache evidence
is rejected. Retrieval time is recorded; it does not prove the upstream report's on-chain observation time. Missing
bundle/sniper/insider, buyer, price-impact and deployer-history evidence remains unknown. A clean provider report is
not a token-safety or return guarantee.

Shadow mode publishes the existing research call with its PASS/UNKNOWN/BLOCK verdict and an explicit non-enforcement
note. The exact safety facts are frozen at research.radarSafety.<alertId>; prior calls are not backfilled. Enforce mode
withholds every non-PASS call, so expect substantial suppression while required evidence is missing. Use npm run
radar:status to inspect frozen snapshots, source counts and collection freshness. See docs/EARLY_RADAR.md for the
policy, source limitations and prospective evaluation plan.

### 20.2 Helius webhooks and RPC

Configure a server-side HELIUS_API_KEY, approved HTTPS HELIUS_RPC_URL, a long random HELIUS_WEBHOOK_SECRET and the actual public endpoint:

```dotenv
HELIUS_WEBHOOK_URL=https://api.narrax.example/webhooks/helius
```

Restart/recreate API and pipeline after env changes. Add/review tracked wallets through Admin; syncing uses the API key, URL and secret to reconcile the active tracked set. Confirm the endpoint is reachable through TLS and not blocked by a CDN browser challenge. The API checks the Authorization header against the configured secret.

Successful sync or an active provider webhook is not proof of event delivery. Inspect Admin's last non-empty receipt, parsing/enqueue counts, worker completion and actual stored observations. An empty provider test only proves transport, not real swaps or qualification. Do not fabricate transactions or encourage a trade solely to produce an alert; wait for genuine supported events or use clearly separated provider test infrastructure.

### 20.3 Treg narrative sampling, only after budget approval

The pipeline already contains this consumer. Do not launch the dedicated narrative worker alongside the full pipeline for the same queues. Treg is optional and potentially metered; CLI login alone does not configure the production worker.

```dotenv
TREG_NARRATIVE_ENABLED=true
TREG_TOKEN=REPLACE_WITH_SERVER_SIDE_ORG_TOKEN
TREG_NARRATIVE_TOPICS='[{"name":"Solana ecosystem","query":"solana"}]'
TREG_NARRATIVE_PLATFORMS=x,reddit,tiktok
TREG_NARRATIVE_MAX_PAGES=1
TREG_NARRATIVE_PAGE_SIZE=20
TREG_MAX_COST_USD=0.01
TREG_NARRATIVE_INTERVAL_MS=1800000
```

Only enable after reviewing current endpoint contracts, available balance and spending limits. TREG_ORG is conditional on token/account setup. The cost ceiling is per call, not a daily cap; topic count, platform count, pages and repeat schedules multiply cost. Preview commands can still make paid calls even if they do not write to the DB. Set team/account budgets externally. Search samples are watchlist coverage, not global trend discovery.

### 20.4 AI provider

Configure only an approved OpenAI-compatible endpoint, actual provider-supported model ID and server-side key. Admin saved model/budget settings may supersede env defaults. Check provider account limits, error handling and the appropriate `standard`, `bare` or `full` request style. Do not invent a model name or describe an empty/missing result as analysis. No AI credential belongs in the frontend image or test environment.

### 20.5 Wyntrax membership

Configure the public HTTPS `/v1/integrations/wyntrax/events` endpoint in the intended Solana memberships, using supported MEMBER/PRO/ELITE integration keys and the creator signing secret in WYNTRAX_WEBHOOK_SECRET. Keep signing secret server-side. The previous-secret variable supports controlled rotation. The frontend claim URL is public and optional; it does not grant membership by itself.

Test legitimate signed integration events in an approved account/test membership, inspect grants and expiry, and verify highest active-tier resolution. Wallet-link proof is still required. Do not create a grant by treating a successful unsigned HTTP request as a membership event.

### 20.6 Telegram research feed

Create a bot, add it to a test chat and confirm its permission to send. Keep the bot token in backend env only. Set intended TELEGRAM_CHAT_ID, TELEGRAM_MAX_AGE_MIN=15, TELEGRAM_MAX_PER_RUN=10 and TELEGRAM_SEND_DELAY_MS=1200; initially keep TELEGRAM_ENABLED=false. Review the dry-run output before an explicit authorized test send to the test chat.

After approving delivery, enable it and recreate the single pipeline worker. No new qualifying call means no message; that can be normal. Do not widen freshness windows or backfill a stale alert simply to demonstrate production activity. Delivery is at-least-once; a crash after send but before cursor persistence can duplicate a message. Never send user-owned data through this global feed.

### 20.7 Smart-money research remains a separate readiness decision

Keep both research flags false during initial infrastructure deployment. A later deliberate enablement requires the public webhook to work, the application migration to be applied, fresh/complete history and reviewed wallets. Review approval does not override missing evidence. Seeds remain provisional.

Qualification requires approved/active status, recent profile (45 minutes), at least 20 closed legs across five tokens and seven observed days, zero unmatched/excess sells, score >=70, positive PnL/median ROI, activity within 24 hours, and complete uncapped fresh 30-day history with zero skipped rows. Flow publication additionally requires independent entities, net-activity minimums, fresh trade/price, liquidity/holders and acceptable risk evidence. Do not change these gates as a deployment step.

GMGN access is not required. Its skills/CLI are not an application integration, and authentication keys stay outside the repository. Do not assume a configured GMGN_API_KEY enables collection or replaces exact DexScreener provenance requirements.

## 21. End-to-end acceptance checklist

Use this as a signed launch record. Assign an operator/date and retain redacted evidence (run URLs, image digests, selected status screenshots), not tokens or full env dumps.

| Check | Expected evidence | Pass/date |
| --- | --- | --- |
| Source/remote | Intended commit pushed; no secret files; correct repository | __________ |
| CI | All required jobs green, no skipped integration checks | __________ |
| Approval | production and production-web actually wait for authorized review | __________ |
| Storage | Correct volumes/DB names, persistent data, no public DB/Redis binding | __________ |
| Backup | Off-host encrypted backup plus isolated restore evidence | __________ |
| Backend release | Intended digest recorded; API healthy; worker/executor running | __________ |
| Frontend release | Intended digest/full commit matches /api/health | __________ |
| Public TLS | Both hostnames verify without insecure bypass | __________ |
| CORS | Exact web origin accepted; unrelated origin rejected | __________ |
| Auth | Real Privy sign-in and /v1/me succeed with intended app | __________ |
| Market display | Fresh rows show current values; older matched rows are labeled last observed with their timestamp; future/unmatched rows show no price | __________ |
| Owner access | Only intended allowlisted identity can access Admin | __________ |
| Wallet proof | Exact-message signing on correct web domain; wrong domain rejected | __________ |
| Entitlements | Intended enrollment/feature gates, membership and expiry task work | __________ |
| WebSocket | Authenticated /v1/stream connection works through proxy | __________ |
| Collection | Intended providers/workers active; fresh observations and gaps visible | __________ |
| Helius | Genuine non-empty receipt and processed supported event when enabled | __________ |
| Telegram | Explicit approved test chat only; production research-only scope | __________ |
| Research flags | Remain false unless separately approved/evidence-ready | __________ |
| Manual trading | Migration applied; config enabled only after approval; small real wallet-signed swap confirmed, or flag intentionally left false | __________ |
| SEO | Real canonical/hreflang, correct robots/sitemap/private noindex | __________ |
| Operations | Monitoring, rotation, expiry, rollback and recovery owner documented | __________ |

For CORS verification, use a public/appropriate endpoint with Origin headers or an OPTIONS preflight for a protected route. An unauthenticated protected GET may return 401 even when CORS is correct. Do not post tokens into a troubleshooting command. For realtime, inspect the authenticated browser's Network/WebSocket panel and expected upgrade behavior; do not weaken authentication to obtain a 101 response.

API/web health alone is not this entire checklist. Empty qualified flow cohorts and no Early Radar publications can be valid evidence-gated behavior on a new installation. Infrastructure readiness is not proof of intelligence quality or profitable outcomes.

## 22. Manual user-signed trading (optional, high risk)

This chapter covers the separate `/app/trade` workspace. It is **not** the automated executor and it does not create paper orders or positions. The server builds an unsigned Jupiter Swap V2 transaction, the user's own verified Solana wallet signs it locally, and the API re-verifies the signed message before broadcasting. Narrax never receives the private key. Keep `MANUAL_TRADING_ENABLED=false` until every prerequisite and the small real-wallet test below are complete.

### 22.1 Prerequisites and configuration

1. Back up the application database using the procedure in Chapter 17.
2. Apply migration `20261022120000_manual_swaps` with `prisma migrate deploy` against the intended application database. Confirm `ManualSwap` exists. This migration is additive and separate from automated `Order`/`Position`.
3. Set a mainnet `HELIUS_RPC_URL` (or another trusted mainnet RPC) and a `JUPITER_API_KEY` in the API environment. The engine is not constructed without both. Do not put any private key or seed phrase in the API environment.
4. Keep `MANUAL_TRADING_ENABLED=false` and restart the API. `GET /v1/manual-trades/config` must report `enabled: false`; the UI must show that live trading is not enabled while research remains usable.
5. Confirm the intended accounts have `research.tokens` access, and that the web origin is allowed by CORS. The wallet must be linked to the signed-in account and verified by the wallet-ownership message; the trade desk offers **Verify now** for a connected wallet using the same flow as Early access.
6. Confirm the web build serves the Trade route over HTTPS. Signing from an insecure or unexpected origin should be treated as a failure.

The relevant API variables are:

| Variable | Purpose |
| --- | --- |
| `MANUAL_TRADING_ENABLED` | Default `false`. Routes report disabled until exactly `true`. |
| `JUPITER_API_KEY` | Jupiter Swap V2 build/quote access. Missing key means no engine. |
| `HELIUS_RPC_URL` | Mainnet RPC for mint/account reads, simulation, send and status. The genesis hash is checked. |
| `system.trading_paused` setting | Operator pause for new quotes and submissions. Set through Admin → trading pause, with a reason. |

### 22.2 User flow and safety model

1. The user opens a token page and selects **Trade**, or opens `/app/trade` and pastes a mint. The server assembles stored evidence: identity, market, holders, risk, narratives and qualified-wallet flows. Missing or stale evidence is displayed as unknown and cannot be converted into a positive recommendation.
2. Buy blockers include: token not indexed, blacklisted, missing/stale market, liquidity below $20K, missing/stale holders below 50, missing/stale risk, recorded risk flags, or locked token/narrative/smart-money research. A sell is not blocked by missing buy evidence, but still needs a valid route and all transaction checks.
3. The user explicitly continues to the swap, chooses a verified wallet that exposes `solana:signTransaction`, enters an amount and slippage, and requests a quote. The wallet panel shows every connected wallet, distinguishes **Needs verification** from **Cannot sign swaps here**, and lets the user **Verify now**, **Connect another wallet**, or **Create a Privy wallet**. A Privy login does not automatically link the embedded wallet.
4. The selected wallet's full address is shown with a copy button and a note that SOL or tokens can be sent to it from any wallet or exchange; Narrax never holds the funds. Verifying ownership is a message signature, not a transaction authorization.
5. The API re-checks the evidence hash, access, wallet link, pause state and configuration; builds an unsigned transaction; simulates it; binds the route instruction; and returns a short-lived ticket. The client cannot supply a quote, fee, destination or identity.
6. The wallet displays the transaction and the user approves it. The API verifies that the signed message is byte-for-byte the reviewed message for the same wallet, then broadcasts. No auto-retry or automatic rebuild after an ambiguous send.
7. The UI then checks status. A confirmed signature links to Solscan. An unknown result is shown as uncertain and must be checked before another swap.

Safety checks that fail closed include: mainnet genesis hash; classic SPL only (no Token-2022/extensions); active freeze authority blocked on buys; price impact above 3% blocked; exact amount/slippage/account binding for the observed Jupiter V2 layouts; unknown route layouts rejected; lookup tables fetched from chain; transaction size and simulation limits; existing wrapped-SOL account blocked; fee ceiling; 60-second quote expiry; one unresolved swap per user+wallet; signature persisted before send; idempotent replay; and RPC reconciliation that never invents a failure.

### 22.3 Enable and test deliberately

Only after the above checks:

1. Set `MANUAL_TRADING_ENABLED=true` for the API, restart it, and confirm `GET /v1/manual-trades/config` reports `enabled: true` and only the caller's verified wallets.
2. Use a small, owner-approved mainnet amount. Review the evidence, quote, minimum received, fees and price impact in the UI; approve in the wallet; wait for confirmation; verify the signature on Solscan.
3. Record the date, token, amount, signature, confirmation status and any evidence gaps. Do not describe a quote or simulation as a completed trade.
4. If anything is unexpected, use Admin → trading pause first (new quotes/submissions stop), then set `MANUAL_TRADING_ENABLED=false`, restart, and revoke/rotate the Jupiter key if needed. Do not mark an uncertain transaction failed without chain evidence.

### 22.4 Known limitations

- Classic SPL tokens only; Token-2022 and tokens with extensions are refused.
- Tokens with an active freeze authority cannot be bought.
- Wallets with an existing wrapped-SOL balance are refused by the current route.
- Price impact above 3% is refused; there are no partial fills, limit orders or automated exits.
- An unresolved `SUBMITTED` swap blocks another quote for that user+wallet until reconciliation resolves it.
- Manual swaps are not included in paper PnL or portfolio analytics.
- No real mainnet swap was executed during the implementation verification because no provider keys were supplied.

## 23. SEO publication and search-engine setup

Initially keep indexing false on production and all previews. Once the public domain/content, canonical origin, TLS and private noindex rules are verified, enable WEB_SEO_INDEXABLE=true in GitHub and NARRA_SEO_INDEXABLE=true in `.env.web`, then deliberately recreate/redeploy web. Keep public build values unchanged unless you rebuild the image.

Verify these on the actual public host, not localhost with an example canonical:

- `/`, `/id`, `/research`, `/id/research`, `/methodology` and guide pages have one intended H1 and page-specific title/description/canonical metadata in initial HTML.
- Reciprocal EN/ID/x-default hreflang points at the actual canonical host.
- `/robots.txt` permits production crawling; `/sitemap.xml` contains twelve authored public URLs, not app/access URLs.
- `/app` and `/early-access`, including localized descendants, remain noindex in metadata/headers. Authentication remains the access boundary; robots is not security.
- Unknown guide slugs return actual HTTP 404, not soft-404 HTTP 200.
- Localized Open Graph images render as valid 1200x630 PNGs; article/breadcrumb/organization markup is truthful and escaped/CSP-nonced.
- Alternate hostnames redirect consistently to the chosen canonical hostname; query tracking parameters do not become canonical identities.

Verify ownership in Google Search Console and Bing Webmaster Tools with DNS or optional meta-verification tokens. The tokens are public proof-of-ownership values, not API secrets. Submit the actual HTTPS sitemap in each service and inspect representative URLs. Rich-result validation is useful but markup does not guarantee a rich result. Do not promise ranking, indexation speed, trading quality or field Core Web Vitals from a synthetic local audit.

After launch, inspect index coverage, impressions/clicks and query/page pairs for English/Indonesian separately. Maintain source-backed guides and current methodology. Do not generate thin token/ticker pages, fabricated reviews/performance claims or keyword spam to inflate the sitemap.

## 24. Routine operations, updates and monitoring

### 24.1 Daily and weekly checks

- Daily: verify public/API health, disk/RAM, restart counts, recent worker completions, queue backlog/failures, provider errors/costs, backup outcome and expiry scheduler.
- Review Admin Data Health, not just process uptime. Freshness, missing holders, unknown outcomes and source provenance matter.
- Run the read-only daily research scorecard in the intended backend environment when appropriate: `npx tsx scripts/radar-scorecard.ts --days 1 --no-save`. A read-only report does not grant permission to change gates or publish weak evidence.
- Weekly: review GitHub Security/dependency findings, SSH access, package access, provider budgets and certificate status; plan approved dependency updates rather than blind major upgrades.
- Regularly: perform isolated restore drills, review off-host backup retention and check available disk before adding collection/history coverage.

The report commands may write files under reports unless `--no-save` is supplied; the production image is read-only. Use no-save/stdout or an explicitly reviewed writable output location. Never mount the entire source directory writable merely to save a report.

### 24.2 Application update procedure

Review changes → isolated tests → backup if backend/schema is affected → reviewed commit/PR → all required CI → approved release → inspect both release jobs → public/real-auth smoke checks → retain digests and rollback assets. Keep schema migrations compatible with the previous backend image; code rollback does not reverse migrations.

Frontend public setting changes require a new image and matching host/GitHub values. Backend env changes require deliberate recreation of affected services; merely editing a file does not change a running container. State recorded as successful by a previous release is not proof that a later manual edit is safe.

### 24.3 Monitoring and log retention

Monitor both public HTTPS endpoints and loopback/container health where appropriate. Alert on repeated worker failures, missing consumers, stale successful-run timestamps, large queues, memory pressure, disk pressure, backup failure, certificate errors and authentication outages. Configure Docker/cron/proxy log rotation. Default logs can exhaust disk even if application code is bounded.

Do not log bearer tokens, SSH keys, bot-token URLs, complete database URLs, private membership payloads or actual env files. Redact any shared evidence. The Docker group, GHCR credentials, database backups and provider budgets are operational trust boundaries, not just configuration conveniences.

## 25. Rollback and disaster recovery

### 25.1 Backend application-image rollback

The deploy script automatically attempts a known previous image on failed application health. For a deliberate manual rollback, confirm the recorded previous image exists locally, confirm schema compatibility and use the production base plus deploy override. No registry pull is required during rollback.

```bash
cd /srv/narrax
export NARRA_IMAGE="$(cat .deploy/previous_image)"
docker image inspect "$NARRA_IMAGE" >/dev/null
docker compose --env-file .env -f docker/docker-compose.prod.yml -f docker/docker-compose.deploy.yml \
  up -d --no-build --no-deps --pull never api worker executor
curl -fsS http://127.0.0.1:4000/health
```

This does not undo DB migrations or restore old backend env values automatically. Preserve/recover the matching operator-managed env configuration when required. After manual intervention, reconcile current/previous state records with what is actually running before the next automated deploy. Never use `migrate reset` as an image rollback step.

### 25.2 Frontend image and environment rollback

Read `.deploy/web/previous_release` and use `.deploy/web/previous.env`, not today's changed public config. Both must still exist and the old image must be cached locally.

```bash
cd /srv/narrax
read -r NARRA_WEB_IMAGE WEB_REVISION < .deploy/web/previous_release
export NARRA_WEB_IMAGE
docker image inspect "$NARRA_WEB_IMAGE" >/dev/null
docker compose --project-name narrax-web --env-file .deploy/web/previous.env \
  -f docker/docker-compose.web.yml up -d --no-build --no-deps --pull never web
curl -fsS http://127.0.0.1:4010/api/health
curl -I http://127.0.0.1:4010/research
```

Confirm the restored commit, public page and domain behavior. Preserve evidence, then reconcile current_release/current.env and host `.env.web` intentionally; otherwise the next deploy may validate against or roll back to the wrong state. Do not rotate/delete the previous records blindly or modify backend state. Compose updates must remain compatible with old images for this rollback to work.

### 25.3 Full recovery after data/host loss

Image rollback is not a database restore. Identify the incident and stop/contain writers (pipeline, executor, scheduled expiry and relevant API access) before planning a consistent recovery. Restore into a separate target first, validate DB schema/data, recover required Redis state using a tested consistent backup procedure and preserve known-good deployment/config records. Only then switch traffic and resume writers under an approved plan.

Do not copy a live multi-file Redis AOF directory mid-write and call it a consistent backup. Use a documented Redis/volume snapshot procedure or planned stop with the required files and permissions. Keep recovery credentials/config encrypted off-host. A brand-new empty Redis instance is not guaranteed to be an acceptable replacement for live queues/cursors; document the application impact and reconciliation.

## 26. Troubleshooting matrix

| Symptom | Likely cause | Safe next action |
| --- | --- | --- |
| No Actions run after a feature push | No PR/main/tag trigger | Open PR or manually run the intended workflow; inspect ref |
| Deploy job skipped | Repository flag false/missing, unsupported ref | Check repository-scope flag and main/v* condition; do not bypass CI |
| No approval pause | Environment reviewers not configured/available | Verify protection rules and plan support |
| Frontend cannot see SSH secret | Secret exists only in production | Add repository-scope or production-web-scoped value intentionally |
| GHCR push/pull denied | Package/organization Actions permissions | Check package access, job permissions and correct repository/package |
| SSH permission denied | Wrong username/key/public key/ownership | Check dedicated identity and authorized_keys through trusted operator access |
| SSH host key mismatch | Host rebuilt, spelling mismatch or attack | Verify new fingerprint out of band; never disable checking |
| Docker permission denied | Deploy session lacks Docker group | Reconnect; verify id/groups; remember privilege implications |
| Compose says POSTGRES_PASSWORD missing | Host env incomplete/interpolation not loaded | Verify .env exists and `--env-file .env`; do not print the secret |
| API fails before listening | Missing/effective Privy config, DB/Redis URL, malformed env | Read private startup errors; inspect effective source without exposing values |
| Executor crash-loop | Forbidden signing/Privy secret, wrong override/config | Use deploy override; remove forbidden credentials; never bypass guard |
| Migration/drift CI fails | Schema and migration history disagree | Reproduce only on isolated test/shadow DB; review proper migration fix |
| Backend tests skip | Isolation name/URL/Redis mismatch or services unreachable | Fix test target/connectivity; never switch to app services |
| Frontend preflight drift refusal | Host public values differ from image build | Update GitHub + host consistently and rebuild; keep old-env rollback |
| Browser uses old API/app ID | Public setting changed without rebuild or stale assets | Build correct image; verify digest/config; avoid editing only runtime env |
| English routes redirect endlessly | Standalone bound to 127.0.0.1 or proxy host/scheme wrong | Keep container HOSTNAME=0.0.0.0; verify forwarded headers and actual 200 |
| Proxy 502 after deploy | App not healthy, wrong loopback port or listener | Check local health, Compose ps/logs and proxy target; keep DB ports private |
| Login 401 | Wrong Privy app/key/audience or stale DB override | Compare effective auth source and intended app; check clock |
| Sign-in says it is taking longer than expected | Privy/provider initialization is slow, the saved session is stuck, or an authenticated identity has not resolved | Use **Reload sign-in** first; if it repeats, use **Sign out and try again**. Check API `/v1/public-config`, Privy allowed origins and exact CORS web origin (including the `authorization` and `x-privy-identity-token` allowed headers). Do not bypass authentication. |
| Most tokens show unknown/unverified price | Collection is bounded to 150 tokens per market cycle, so many tokens have no recent snapshot | Last observed values are labeled with their source timestamp and are not current quotes; only fresh evidence can qualify a buy. Inspect collector coverage instead of backfilling or weakening gates. |
| CORS/WebSocket refusal | Origin mismatch/wildcard/missing upgrade | Configure exact web origin and proxy upgrade; do not disable auth |
| Wallet signing blocked | Domain is API origin, stale domain or wrong localhost spelling | Set exact web origin; regenerate challenge; never rewrite signature text |
| Early access unavailable | Disabled/zero seats/invitation/expiry rules | Review intended audited settings and enrollment state |
| Worker already running | Existing pipeline lease/another consumer | Identify owner/process, stop intentionally; do not delete locks casually |
| No market/holder freshness | Disabled worker/flag, provider throttle or bounded selection | Inspect job diagnostics and coverage; preserve budgets/gates |
| Helius active but no events | Stale URL, auth mismatch, no genuine supported event | Check non-empty receipts and queue processing; do not fabricate swaps |
| Treg 402/429/no narrative data | Balance/budget/rate limits/topic sampling | Inspect receipts and current provider limits; no uncontrolled paid retry |
| Telegram sends nothing | Disabled/missing config/no fresh qualifying alert | Check delivery diagnostics and test-chat permissions; no stale replay |
| Entire site noindex | Default-safe indexing flag or wrong origin | Finish launch review, then update host/GitHub setting deliberately |
| Local Lighthouse flags canonical | Serving localhost with example/public canonical | Audit actual deployed origin; do not break canonical config for a local score |
| Rollback cannot start old web image | Missing cache or config snapshot, incompatible Compose | Preserve state; use rescue/operator procedure; do not prune further |
| Disk fills | Logs, backups, Docker build/image retention, DB growth | Identify usage; retain rollback/DB assets; rotate safely, no broad volume prune |

## 27. Go-live, handoff and ownership worksheet

Complete before calling the system production-ready. Keep this signed worksheet privately with redacted evidence.

| Item | Operator/owner | Evidence/reference |
| --- | --- | --- |
| Canonical web/API hosts and DNS/TLS verified | ____________________ | ____________________ |
| GitHub owner/repo and protected refs | ____________________ | ____________________ |
| Main CI run URL and commit | ____________________ | ____________________ |
| Backend digest and successful deploy URL | ____________________ | ____________________ |
| Frontend digest/commit and successful deploy URL | ____________________ | ____________________ |
| SSH rescue access and host fingerprint | ____________________ | ____________________ |
| Privy app/allowlisted owner/effective key source | ____________________ | ____________________ |
| Entitlement config and expiry scheduler owner | ____________________ | ____________________ |
| Provider-budget authorization and monitoring | ____________________ | ____________________ |
| Research/Telegram enablement decision | ____________________ | ____________________ |
| Backup destination/retention and last restore drill | ____________________ | ____________________ |
| Rollback image retention and recovery operator | ____________________ | ____________________ |
| SEO flag, verification and sitemap submission | ____________________ | ____________________ |
| Incident escalation/contact and maintenance window | ____________________ | ____________________ |

Release acceptance: infrastructure health, real authentication, correct access controls, durable storage and recovery procedures are confirmed. Research acceptance: real evidence coverage and prospective outcomes are measured separately. Neither form of acceptance is a promise of token safety or financial returns.

## 28. Source references and document maintenance

This runbook was checked against the current repository templates and entrypoints. If source behavior changes, update the Markdown source and regenerate the DOCX rather than editing only the binary deliverable.

| Repository reference | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Required checks, versions, isolated services, web/image checks |
| `.github/workflows/release.yml` | Deployment flags, environment names, variables/secrets, job order |
| `.github/workflows/security.yml` | Audit/gitleaks/CodeQL behavior and licensing switches |
| `.env.example` | Backend setting names and safe research/executor defaults |
| `apps/web/.env.example` | Public browser and server-only SEO settings |
| `docker/web.env.example` | Host frontend configuration template |
| `docker/docker-compose.prod.example.yml` | Backend services, internal URLs, storage and ports |
| `docker/docker-compose.deploy.yml` | Digest override and forbidden executor-variable clearing |
| `docker/docker-compose.web.yml` | Independent frontend project, allowlist and loopback port |
| `docker/Dockerfile`, `docker/Dockerfile.web` | Backend and standalone frontend image construction |
| `scripts/deploy-remote.sh`, `scripts/deploy-web-remote.sh` | Actual host deployment/rollback behavior |
| `scripts/check-web-image.sh` | Exact-image runtime smoke checks before web publication |
| `apps/web/scripts/check-deploy-config.cjs` | Build/runtime public-config validation |
| `scripts/test-isolation.ts`, `scripts/test-database.ts` | Integration-test safety gates |
| `apps/api/src/server.ts`, `runtime-settings.ts`, `auth.ts` | Effective startup/auth/CORS behavior |
| `scripts/make-admin.ts`, `scripts/entitlements-expire.ts` | Admin bootstrap and expiry maintenance |
| `workers/pipeline/src/main.ts` | Full-pipeline consumers, flags and singleton lease |
| `docs/FRONTEND_DEPLOYMENT.md`, `docs/CI_CD.md` | Focused deployment references and limits |
| `docs/SEO.md`, `docs/TELEGRAM.md`, `docs/SOCIAL_TREG.md` | Integration details; historical evidence is dated |
| `docs/CONTINUATION.md` | Current work state, verified results and unresolved gaps |
| `docs/MANUAL_TRADING.md` | Manual user-signed swap flow, safety model, enablement and limits |
| `scripts/docs/build_setup_docx.py` | Regenerates this DOCX from the Markdown source |

External installation/product references should be checked for current changes before execution: Docker Ubuntu installation at https://docs.docker.com/engine/install/ubuntu/ ; Caddy installation at https://caddyserver.com/docs/install ; GitHub Actions/Environments documentation at https://docs.github.com/actions ; and the selected provider dashboards/docs. No live vendor-policy, pricing or licensing check was performed merely by generating this document.

Document generation: `scripts/docs/build_setup_docx.py` reads this Markdown source with python-docx. Use a dedicated documentation environment:

```bash
python -m venv .venv-docs
. .venv-docs/bin/activate          # Windows: .venv-docs\Scripts\activate
python -m pip install -r scripts/docs/requirements.txt
python scripts/docs/build_setup_docx.py \
  --source docs/NARRAX_END_TO_END_SETUP.md \
  --output docs/NARRAX_END_TO_END_SETUP.docx
```

The generator validates that the DOCX reopens, contains the required final chapter and enough tables/paragraphs. The DOCX contains a table-of-contents field plus page-number fields; Word may show an “update fields” prompt on open, and you can right-click the contents area and choose **Update Field** if its page numbers are empty. The Markdown is always the source of truth.
