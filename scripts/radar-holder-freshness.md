# Early Radar holder freshness and Telegram feed health

## Incident evidence (read-only, October 29, 2026 UTC)

At 08:04, `narraxfun_bot` was configured, reachable and a member of the configured supergroup, whose default send permission was enabled. The Telegram queue completed every ~30 seconds with zero candidates/errors. Its cursor matched the latest global Early Radar alert (October 27 at 14:52:08 UTC); other narrative alert types are deliberately not sent by this feed.

The 127-token current social-priority cohort contained zero fresh holder rows: 124 stale and three missing. Of these, 95 had a holder-provider retrieval within the last hour, but all 95 source timestamps were older than an hour. The latest social scan around 07:53 had 129 priority candidates and skipped 119 for stale holders, seven for stale market data and three for missing holders. This is an evidence-collection bottleneck, not proof that no qualifying market opportunities exist. Repeated daily skip counters are not distinct tokens or missed trades.

## Bounded fallback

The market job still collects GeckoTerminal data. When `HELIUS_RPC_URL` is configured, the new fallback defaults on; `HOLDER_RPC_FALLBACK_ENABLED=false` disables it. No new provider key is required. Only the current bounded market-refresh set is considered, and a token must have a usable quote within the Early Radar cap/liquidity/age rules for at least one profile. Fresh stored holders skip fallback entirely.

- At most **two tokens per market cycle**, rotating past attempted tokens; no retries within a lookup.
- Up to **four JSON-RPC requests per successful token**, paced at least 500 ms apart across token boundaries. This uses the existing primary RPC quota, not independent quota capacity.
- **15 seconds for the whole token lookup**, including pacing, headers and response body; **2 MiB per response**, **5,000 accounts maximum**. Larger/partial results remain unknown; no unbounded pagination.
- Attempt cursor and 30-minute per-token cooldown are stored before the network call. Rate limiting or an unavailable provider ends the cycle and sets a persisted 15-minute provider cooldown.

The lookup reads a finalized SPL Token or Token-2022 mint, enumerates its accounts with a mint filter and contextual slot, and verifies distinct account addresses, account owner/program, mint, initialized/frozen state and positive balances. The summed raw account balances must equal the mint supply. A second mint read at or after the account slot must match the first mint data. A missing account, changed supply, unsupported layout, withheld/confidential Token-2022 supply that cannot reconcile, invalid mint or oversized response is not accepted.

Holder count is the number of **distinct positive-balance owner addresses**, not people or independent entities. Concentration is the ten largest aggregated owners as a percentage of mint supply, rounded upward to four decimal places; pool/exchange owners are included. Both raw-supply arithmetic and owner aggregation use integers. This basis can differ from GeckoTerminal's indexed figures, so switching source is not treated as holder growth: the three-hour baseline is unknown across RPC/legacy-source boundaries.

`getBlockTime` for the enumeration slot supplies the observation timestamp; it must be no more than five minutes old and not in the future. Retrieval time is stored separately. Accepted rows retain immutable `research.holderMetric.<id>` provenance with slot, program, account count, measurement basis and source time. Cached Gecko observations cannot overwrite newer latest-holder provenance. Developer share remains null and smart-wallet count is not inferred from this enumeration.

Market-run diagnostics expose `holderFallbackAttempts`, `holderFallbackWritten`, `holderFallbackUnknown`, and `holderFallbackThrottled` (provider-backoff events, including unavailable service). Existing admin collection-quality diagnostics include these counters. Data recovery alone is not alert qualification: the 15-minute price/60-minute holder gates, profile floors/scores, six-hour duplicate window and configured safety gate still apply.

## Telegram service notices

When normal delivery has no sends/failures, the worker checks for prolonged silence. After two hours without a global Early Radar alert, it can post a clearly labelled **FEED HEALTH / STATUS ONLY** message with latest collection skip counts. No recorded alert history also produces a status notice. It is not a token signal and creates no Alert or outcome row.

Notices are limited to one per six hours per configured chat, with a five-minute check cooldown. Failed notices back off at least 15 minutes and honor longer Telegram Retry-After values (bounded to seven days). State persists under `integrations.telegram.health.<chat>`; the research-alert cursor is never moved. This shares the existing singleton worker's delivery ownership. As with ordinary Telegram delivery, a crash after Telegram accepts but before state persistence can cause a duplicate; delivery is not exactly-once.

`TELEGRAM_HEALTH_NOTICES=false` disables only these status notices. The CLI/helper defaults remain dry-run. Ordinary alerts still require credentials and fresh eligible rows, and send only to the configured chat.

## Validation and rollout

Local validation passed 99 targeted tests covering RPC rejection/bounds, PostgreSQL persistence and rotation, provider-switch growth, publication/delivery freshness gates, collection coverage and Telegram delivery/status cooldowns. Repository/web typechecks and web lint passed. These checks do not establish production recovery.

Bounded **read-only** production probes ran the bundled collector without any database writes or Telegram sends. At 08:25 UTC, the final paced collector recovered:

| Mint | Accounts | Positive owners | Top-ten owner share | Observation slot | Source time |
| --- | ---: | ---: | ---: | ---: | --- |
| `91RBVuoCLvikHs4qeUGczABotGLd1Tjo84DMfpFUpump` | 3,155 | 534 | 55.7267% | 462812936 | 08:25:53 UTC |
| `E6exteuDy1u6u3FfQV7SvPyU4XPdcBGi4cBnqrusocat` | 2,492 | 416 | 87.1095% | 462812946 | 08:25:55 UTC |

Both reconciled to supply and passed stable-mint checks; lookup duration was ~1.6s and ~2.0s. An earlier unpaced second probe returned unavailable, which motivated pacing. This sample establishes that the method can retrieve current evidence with the existing configuration, not cohort-wide coverage, provider reliability or token eligibility. In particular the second sample is highly concentrated and would fail the existing early-profile concentration limits.

Deploy the worker through the normal release after merging. No schema migration is needed. The two features default on with the existing RPC/Telegram configuration; opt-out environment values are documented in `.env.example`. Deployment/configuration remain operator actions.

After deployment, verify the worker revision, restarts/lease, market-job duration and fallback counters. Inspect new immutable holder provenance and compare `freshPriceAndHolders` in the collection-quality report. Confirm Telegram status delivery independently of research-alert publication. Review failures/cooldowns and primary RPC throttling before raising capacity; the small initial budget cannot refresh every token in the cohort. Do not claim the live feed recovered until production produces fresh evidence and, when candidates pass all rules, successful natural alert delivery.

## Cohort refresh (October 31, 2026 follow-up)

The two-token market-cycle budget was the binding limit, not the RPC method. Read-only production diagnostics on October 31 showed:

- Primary source (GeckoTerminal token info): median holder-observation lag 938 min (~15.6 h), p90 ~1,490 min; only 333 of 7,927 observations (4.2%) were inside the 60-minute gate when read.
- RPC fallback: 38 tokens retained fresh observations, median lag ~0.04 min, but the budget served at most 24 tokens an hour.
- The radar cohort (unexpired social priority list) held 141 tokens, so keeping it fresh needs about 141 observations an hour.
- The market job already spends its `infoCalls` budget of 18 slow-source calls per run (~4.5 min at the source's 15 s pace) and runs every 5 minutes. Widening the fallback inside that run would push it past its schedule.

The cohort is now refreshed by a separate `holder-refresh` job that runs every 60 s in the pipeline worker, independently of the market schedule:

- **Three tokens per run** by default (`HOLDER_RPC_COHORT_PER_RUN`, 1..12), about 180/hour, with a **20 s wall-clock stop** (`HOLDER_RPC_COHORT_DEADLINE_MS`, 5..60 s). The 500 ms pacing and 15 s per-token timeout still apply.
- **Staleness-first order**: candidates are sorted by newest holder observation, oldest first; the persisted cursor only breaks ties between equal ages. Tokens closest to failing the gate are served first.
- **One query** reads the newest observation per candidate (`DISTINCT ON`), instead of one query per candidate.
- **Demand is reported**: `holderFallbackCandidates`, `holderFallbackFresh`, `holderFallbackDeferred` (stale but unserved) and `holderFallbackDeadlineHit`. The job logs one `holder_refresh_complete` line per run with these counters.

The market run still tops up at most two price-lane tokens outside the cohort (`HOLDER_RPC_FALLBACK_PER_RUN`, `HOLDER_RPC_FALLBACK_DEADLINE_MS`), so the two jobs do not compete for the same budget. The 60-minute holder and 15-minute price gates, provenance rules, per-token 30-minute cooldown and 15-minute provider cooldown are unchanged.

Rollout checks: the queue has one consumer; `holder_refresh_complete` appears about once a minute with three attempts; `holderFallbackDeferred` trends to zero (a persistent positive value means demand exceeds the budget — raise the budget or shrink the cohort); `recentSocial` holder freshness rises in `research:coverage`; throttling stays low. Holder freshness alone is not a publication signal.

Known limits: the cohort is capped at 200 tokens, so sustained demand above ~180/hour leaves some tokens past the gate; a cohort token that pumps above the early cap keeps its slot until the next social scan; the two jobs share one progress row and can rarely attempt the same token at once; holder counts include pool accounts.
