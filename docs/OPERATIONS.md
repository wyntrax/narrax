# Operations runbook

Everything here is about running NARRAX safely. It reflects what is built today: there is no Executor, so nothing can send a transaction, and the controls below govern paper trading, semi-auto confirmations and logging.

## The controls, from gentlest to strongest
| Control | How | Effect | Audited |
|---|---|---|---|
| Blacklist a token | `PUT /v1/admin/tokens/:mint/blacklist` `{blacklisted, reason}` | No new entries in that token for anyone (the fan-out skips it, the Governor rejects it). Open positions are **not** sold; exits stay allowed. The response says how many are open. | yes |
| Tighten a system limit | `PUT /v1/admin/system-limits` `{limits, reason}` | Applies to every user's next job. A user's own limit can only be stricter than this. | yes (before and after) |
| Pause new entries | `PUT /v1/admin/trading-pause` `{paused: true, reason}` | No new entries for anyone in any mode. Exits, the monitor, alerts and outcome tracking keep running. Jobs already queued are rejected by the Governor. | yes |
| Turn AI off | the existing AI settings endpoint | Stops analysis, position review and chat. | yes |

Resume with `{"paused": false, "reason": "..."}`. A pause survives restarts (it is stored in the database).

## System limits
- The numbers in `packages/risk/src/limits.ts` are the **absolute ceiling**. An admin can make the system stricter than the code, never looser. Loosening beyond the code needs a code change and a deploy, on purpose.
- Every limit also has a hard strictest value (`SYSTEM_LIMIT_RULES`), so a typo cannot switch trading off.
- `PUT` replaces the overrides: a limit left out returns to the code default. `POST /v1/admin/system-limits/reset` clears them all.
- A stored value that is malformed or looser than the code is **ignored** (the code default applies) and listed under `ignoredInvalid` and in the status warnings.
- Not built: a second admin's approval, a time-limited override, optimistic locking (two admins editing at once: the last write wins, and both are in the audit log).

## The executor (B5a, dry run) and its kill switch
- **Three processes now:** `npm run dev:api`, `npm run dev:workers` and `npm run dev:executor`. The **pipeline worker no longer consumes the execution queue**: paper fills, shadow logs, semi-auto confirmations and dry runs are all handled by the executor. If it is not running, those orders wait in the queue. The status view warns about this (`Queue execution has N job(s) waiting and no worker consuming it`).
- **The executor cannot sign or send.** It has no signing credential and refuses to start if a signing variable is set (`EXECUTOR_SIGNING_KEY`, `PRIVY_APP_SECRET`, and similar). For an AUTO order, or a confirmed SEMI_AUTO order, from a user on `EXECUTOR_ALLOWLIST_USER_IDS`, it builds the swap, verifies it, simulates it and records a DryRun row. Read them at `GET /v1/admin/dry-runs`; the walkthrough is `docs/B5A_RUNBOOK.md`.
- **Two different stops.** The **trading pause** (above) stops new entries for everyone in every mode, including paper. The **executor kill switch** (`GET/PUT /v1/admin/executor/kill-switch`, a reason is required to turn it off) stops the executor's real-wallet path and is read before every order. An unreadable kill switch counts as ON. Use the pause for an incident, the kill switch for anything touching the executor.
- Real money is not possible in this stage. B5b (signing for one allow-listed wallet with a tiny cap) needs the owner's separate go-ahead after reading the dry-run output.

## What to look at every day
`GET /v1/admin/status` returns database and Redis health, per-queue waiting/active/failed/delayed counts, how fresh each background job's output is, the current controls, counts (users by mode, open positions, pending confirmations), today's token use against the budgets, and a `warnings` list. Treat any warning as something to read. Staleness is only called where the job should be running (market data enabled, paper users exist, and so on).

`GET /v1/admin/costs?days=30` shows tokens by day and source (analysis, position review, chat) and top chat users. Cost in USD appears only for models whose prices an admin entered (`PUT /v1/admin/ai-pricing`). A model with no price shows `null`, never a guess. Position reviews record one combined count, so only tokens are shown for them. The provider's invoice is the source of truth.

`GET /v1/admin/audit?action=&userId=&limit=&cursor=` reads the audit log: system limit changes, pauses, blacklist changes, price changes, chat suggestions applied, confirmations, and every paper fill.

## Deploying
1. `docker/Dockerfile` builds one image; the command picks the process. `docker/docker-compose.prod.example.yml` is a single-host example with a one-shot `migrate` service, the API, the worker, the executor, Postgres and Redis. **Neither was built or run when written. Build once and check `/health` before relying on them.**
2. Order matters: run `prisma migrate deploy` first, then start the API, worker and executor. Migrations are forward-only; take a database backup first.
3. Redis must use `maxmemory-policy noeviction` (an evicted key is a lost job). Persist it (`--appendonly yes`).
4. Put TLS and a reverse proxy in front of the API, set `TRUST_PROXY=true` only behind a proxy you control, `HSTS=true` on HTTPS, and list exact `CORS_ORIGINS`.
5. Secrets go in the host's `.env` (or your secret store), never in the image or the repo. The processes refuse to start on a malformed environment and name the variable, never its value.

## Rolling back
- Code: redeploy the previous image. Migrations are not reversed automatically, and the rollout was written to be additive (new columns and tables), so the previous code runs on the newer schema. Check that before rolling back across a migration.
- A bad system limit: `POST /v1/admin/system-limits/reset`. A bad blacklist entry: `PUT` it back to `false`. Both leave an audit trail.

## CI
`.github/workflows/ci.yml` runs typecheck, applies every migration to a real Postgres, **checks the migrations against the schema for drift** (`prisma migrate diff --exit-code`), runs the whole suite against real Postgres and Redis, and fails if any test was skipped. Written without being able to run GitHub Actions: expect the first run to need a small fix.

## Not built yet (B5 and later)
Circuit breakers for a real Executor, stuck-order reconciliation, key handling and signing (B5b), alert routing (paging) from the status warnings, log shipping and metrics, backups and restore drills, secrets rotation. B5's security review plan covers the Executor-related ones before any code is written.
