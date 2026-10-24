# Early radar verification — October 16, 2026

Repository: `C:\dev\narra-entitlements`. Per owner instruction, used installed **PostgreSQL 17.2** and **Memurai Redis API 8.2.10**; no Postgres 16 / Redis 7 verification is claimed.

## Real command results

- `npm install` succeeded: removed one package, audited 1,432 packages. npm reported 49 dependency vulnerabilities; no automatic dependency remediation was applied.
- Created separate `narra_radar_test_20261016` and `narra_radar_shadow_20261016` databases. Started a separate Redis process on `127.0.0.1:16389`, persistence disabled. Supplied database credentials were loaded without printing them. No real `.env` was read or changed.
- `prisma migrate deploy`: all 15 existing migrations, including hand-written 0014, applied successfully to the test database. `prisma generate` succeeded with Prisma 6.19.3.
- Initial and final `prisma migrate diff ... --script` output: **`-- This is an empty migration.`** This is Prisma's empty-diff comment, with no schema-change SQL.
- Initial full Vitest run: 1,011 tests passed, one failed, zero skipped, but 11 files failed. These were obsolete entitlement tests requiring `localhost:5432/narra_ent`, now an application database. Their guards now require explicit `NARRA_TEST_DATABASE_NAME`, a matching local URL and a test-specific database name. `narra` and `narra_ent` are rejected. The contract HTTP test uses isolated port **14010**, preserving refusal of remote targets. No product assertion was removed or relaxed.
- One rerun had 28 skipped tests because the isolated Redis process was unavailable. `check-test-results.mjs` correctly rejected it. After restarting that process: **1,177 passed, zero failures/skips/todo, 91 files passed** before outcome feature work.
- Final suite with outcome tracking: **1,189 passed, zero failures/skips/todo; all 93 files passed**, checked with `scripts/check-test-results.mjs`.
- `socialTokens.integration.test.ts` actually ran all four tests. Its score fixture passed without changing its arithmetic or production scoring.
- Full repository/web `npm run typecheck` passed, including Prisma-dependent workers. Focused outcomes run passed seven pure tests, five new real-Postgres tests and four social-scan tests.

JSON reports in `C:\Users\gifar\AppData\Local\Temp\opencode\`: `narra-radar-baseline.json`, `narra-radar-verified.json`, `narra-radar-outcomes-focused.json`, `narra-radar-final.json`. Session environment loader: `narra-radar-test-env.ps1` in that directory. It sets isolated targets without printing credentials. Tests did not take over app ports 4000/4010.

The harness restart after verification stopped the temporary Redis process. Restart that isolated process before future integration runs; the saved passing report describes the completed run, not current service availability. Final review revalidated the saved report with `check-test-results.mjs` and found no whitespace errors in the tracked task diff.

For future runs, provision an isolated DB/shadow DB and Redis, then supply their connection strings in the process environment. Set `NARRA_TEST_DATABASE_NAME` to the exact test database name (for example `narra_radar_test_20261016`). Use `NODE_OPTIONS=--require=C:/dev/narra-entitlements/apps/web/scripts/no-env-files.cjs`. Do not use the old application-targeting `scratch.cjs` test workflow.

## One owner-approved metered preview

Ran the env-free `narratives:treg` entry with `--cli --query 'solana ("CA:" OR "contract address")' --hours 48 --pages 1 --max-cost 0.01 --check-mints`. A Node argv wrapper preserved nested quotes on Windows. One run only; no import or database writes. Raw posts remained in memory. Preview output now contains hashes/extracted references instead of post text.

| Source | Received | Accepted | Outside window |
|---|---:|---:|---:|
| X | 20 | 20 | 0 |
| Reddit | 25 | 0 | 25 |
| TikTok | 20 | 2 | 18 |

- Nine distinct mints and nine distinct cashtags. All nine mints checked; seven returned usable traded-token observations from DEX Screener. Three had reported market cap below $100K without FDV substitution. This checks market existence/quotes, not safety or early-radar eligibility.
- Charge: **1,550 micro-USD = $0.00155**, three calls, zero provider errors. No topic-count or cost-ceiling increase.
- Run ID: `badd16ec-ec10-426e-9b06-bb6d90844537`.
- Call IDs: X `7d118b6befe445beb0e05b2f6d3295f4`; Reddit `70f97120bccd4e2385698019aa06d884`; TikTok `c29441b0283149479b5b428832be7436`.

Distinct accounts are platform-scoped normalized handles, not proof of independent people. Only the first two mints meet the existing three-account/four-post buzz minimum. No threshold was tuned.

| Extracted mint | Accounts | Posts | Usable quote |
|---|---:|---:|---|
| `FEq7W38ugzhdt8yg68fcxLDeCkNufDTHy6kxDGHgpump` | 4 | 4 | yes |
| `7GCMYJcykHZ3qJH3e5vQi4J9qAPdb3Xninkgk6sYpump` | 3 | 8 | yes |
| `9HA51UdNaGT5PHdJ99ocdvZzvFLqA5Nw8wRJgXUWD47V` | 1 | 1 | no usable reading |
| `2fk5eGwAch1wGhsK3XhRUZpopXFGyRbFUn6XL4Yxpump` | 1 | 1 | yes |
| `GvtE621FzrUEACvvfc3fSaBi1TKtLWVBG5SPwQ1dpump` | 1 | 1 | yes |
| `ur5ySEYeCvPP1bdrDDYZtnAECR4Cs7xyEtK2FJPpump` | 1 | 1 | yes |
| `GjkMsvYmuFR37SyKnJoD8DwccLb3HKMQBnNe5Nqbpump` | 1 | 1 | yes |
| `3ZgTWcu5Wxp2F12VvHvNShSP9a1EAQkf1qCRdAhQpump` | 2 | 2 | yes |
| `9HmC4jXxkaFchQHQEy873oA3bCcpGziz1hW7aP14pump` | 1 | 1 | no usable reading |

Cashtag account/post counts: MERGE 2/2, LOOM 3/8, PONKEWIF 1/1, MHDG 1/1, WIFDOPE 1/1, FEDLIENS 1/1, GOAT11 1/1, FORCE 2/2, DRAINLOVE 1/1. No ticker was guessed into a mint.

## Outcome feature and remaining verification

Migration `0015_early_radar_outcomes` was generated by `prisma migrate dev --create-only`, deployed to the isolated test DB and diff-checked. **Update 2026-10-17: it is now applied to the application DB `narra_ent`** (confirmed in `_prisma_migrations`; both outcome tables exist). Regenerate the Prisma client before running updated alert/outcome workers.

Pure logic lives in `packages/analytics/src/earlyRadar.ts`; database writes and cohort loading in `workers/pipeline/src/earlyRadarTracking.ts`. Both narrative and social alert routes capture frozen snapshots atomically. The existing outcome-tracking job runs early measurements after decision outcomes.

Tests use synthetic market/social data with real isolated PostgreSQL/Redis. They cover atomic/concurrent creation, both discovery routes, frozen entry data, 1h/24h/7d measurements, no lookahead, missing and legacy data, immutable terminal results and no early-tracking opportunity/order/position writes. A real CLI report against the test DB returned four synthetic pending observations and INSUFFICIENT DATA; these are not live performance results.

No live alert returns have yet been evaluated. Production scheduling/deployment, long-window coverage and performance remain unverified. Keep market collection running through seven days; outages and refresh limits can leave outcomes UNKNOWN. Missingness is not random for rugged/delisted tokens. Evidence gates are unvalidated minimums, not predictive validation. No scoring thresholds or trading floors changed.

Recommended next step: deploy the migration deliberately, collect genuine cohorts for seven days, inspect unknown rates and sample sizes using `early-radar:report`, then pursue the safety-data backlog. No commit or push.
