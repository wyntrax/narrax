# Pipeline transaction deadlines — October 29–30, 2026

## Production evidence and scope

The read-only review of October 28 14:08:30 through October 29 14:08:30 UTC found seven wallet-intelligence failures, seven market-data failures, one narrative-ingestion failure and one discovery-checkpoint persistence failure. The longest gap between persisted scoring timestamps was ~45 minutes. All inspected failed jobs had zero recorded stalls; available logs did not establish a repeat of the earlier 90-second lease-loss restart loop.

Sanitized retained errors establish the transaction deadline:

- All seven wallet-intelligence failures: rollback attempted after the **5,000 ms** transaction deadline (5,010–5,249 ms elapsed).
- Six market-data failures: query attempted after that deadline (5,080–5,669 ms); one commit after 7,938 ms. Stack frames identify the small atomic `storeMarketSnapshot` publication.
- Narrative ingestion: rollback after 5,013 ms.
- Outside the window, market-data at October 29 14:32:46 UTC failed to start a transaction in the allowed time.
- The discovery error discarded the original database category. Its exact cause cannot be reconstructed from that message; the change now retains only a validated Prisma `Pdddd` code, never the raw database/provider context.

Point-in-time PostgreSQL inspection found 15/100 connections, no currently blocked sessions and no cumulative deadlocks. Redis had no evictions or rejected connections. These readings do not rule out transient contention or event-loop delays at the historical failure times.

The scoring job fetched hundreds of thousands of rows in one driver/compiler response and published approximately a thousand lazy Prisma operations in one transaction. The narrative job similarly issued one role upsert per creator. Long decoding pauses can delay unrelated small transactions in the same Node process; many sequential publication statements leave little margin under the five-second deadline. This is a supported bottleneck explanation, not a production CPU/lock trace proving every individual failure's cause.

## Changes

### Bounded consistent reads

`readIntelligenceInputs` reads 2,000 rows per page, ordered by `(at,id)` with a unique cursor. It yields between pages. Every page and the active-wallet list use one Repeatable Read transaction, so concurrent history backfills cannot move rows between pages or change the active cohort halfway through the read.

The read-only workload has an explicit **60-second total transaction deadline**. It makes no writes or provider calls and releases its snapshot before computation/publication. A read failure aborts the run before publication. This is a bounded budget for a deliberately paged read, not an increase to publication transaction deadlines. Total retained rows/memory are not capped by pagination; existing accounting input caps and rules still apply.

Migration `20261029160000_wallet_trade_read_pages` adds the `(at,id)` WalletTrade index to support paging without repeated full-window sorts. Apply through the normal migration/release workflow; no production migration was run during this investigation. It is an ordinary index build and can briefly block writes while building.

### Fewer atomic publication statements

- Wallet settings, profiles and metrics are written in batches of at most 100 rows. All batches, cluster replacement, relationship writes, profile removal and consensus publication remain in **one transaction**.
- Singleton-owned SystemSetting keys are deleted/recreated in bounded batches within that same transaction. These keys have no referencing foreign keys. Readers do not see a committed intermediate deletion. Prisma's JSON codec is retained: a raw JSON replacement initially exposed tiny floating-point serialization differences, so the final implementation uses Prisma `createMany` for settings.
- Profile upserts and narrative creator-role upserts use parameterized recordsets. Existing row IDs and profile fields outside the recomputed fields are preserved. Newly inserted IDs are UUID strings, compatible with the existing unrestricted string columns.
- Narrative stage/metric/creator-role/alert publication remains atomic.
- Write transaction deadlines remain at their existing settings. No retry is added around an unknown commit result, and failed checkpoint publication remains resumable.

The successful evaluation pipeline setting and `wallet_intelligence_complete` log now include load/compute/publication milliseconds, read-page count, publication-operation count and input-trade count. Existing failed-job retention provides failure evidence; these latest-only timings are not a complete durable 24-hour telemetry ledger.

## Validation

### Captured production-input replay

The previously saved October 28 11:02:27 UTC capture contains 255,263 input rows; 255,253 qualify for the existing intelligence trade list. It was replayed locally, with no production writes or provider calls.

- Before: **938** publication operations.
- After: **24** publication operations.
- Both: 165 scored wallets, 35 unscored, three timing clusters, zero consensus signals.
- Normalized logical publication hash matched: `c943316215ca2e45127169c35fa730e3981515145ce21aa02d76d7a550b97d61`.

On a dedicated scratch PostgreSQL database populated with the required captured wallet identities:

| Measurement | Before | After |
| --- | ---: | ---: |
| Publication elapsed | 4,149 ms | 1,531 ms |
| Stored settings/profiles/metrics | 600 / 165 / 165 | 600 / 165 / 165 |
| With synthetic 8-ms per-statement delay on settings | P2028; fully rolled back | 1,726 ms; committed |

The delayed old transaction returned after 7,622 ms including preparation/error handling; its actual transaction deadline remained five seconds. It left zero settings, profiles or metrics. The delay was a **local synthetic experiment**, not a measurement of production query latency.

Stored settings/profile/metric values matched exactly, excluding generated IDs and write timestamps: SHA-256 `3b0f47d3773f348ec16fcc51b8365d2786c9f27db7a988c98149ea92d96b6dfe`. Existing integration tests also verify cluster/relationship/consensus behavior.

### Driver decoding replay

Using 255,253 qualifying captured trades seeded into the dedicated local database:

| Measurement | Unbounded read | Paged read |
| --- | ---: | ---: |
| Elapsed read time | 6,159 ms | 15,524 ms |
| Longest 10-ms timer gap | 3,954 ms | 259 ms |
| Pages | 1 | 128 |

Read results matched exactly: `d06c5f0812261f0ca472871feb5c9f9310d808f1f924808e4a60eca8d60a5fa5`.

**Tradeoff:** pagination increases total load time/round trips while sharply reducing the worst observed event-loop pause. These local timings used Node 24; production used Node 22 during diagnosis. They are evidence of bounded work and equivalence, not a promised production latency.

The migration was applied only to guarded local scratch databases. Targeted tests cover real database rollback, JSON-number codec equivalence, preserved profile identity/fields, tied-timestamp pagination with a concurrent backfill, event-loop yields, scoring/accounting, market provenance, narrative ingestion and checkpoint recovery. Typechecks and web lint pass. Full Linux CI is required before merging.

## Operator validation after deployment

1. Verify the deployed revision and successful index migration. Record container start/restart/OOM state and pipeline lease.
2. Observe at least two completed wallet-intelligence cycles; inspect `wallet.evaluation.pipeline.intelligence` and `wallet_intelligence_complete` for page count and all three timings. Confirm that publication has comfortable margin below five seconds and loading below its 60-second bound.
3. Verify advancing performance snapshots and discovery checkpoints, and check the retained failed queues for new P2028/transaction-start failures in wallet intelligence, market data and narrative ingestion. Checkpoint errors now distinguish Prisma codes from UNKNOWN.
4. Confirm unrelated market jobs and lease renewals remain responsive during the large read. A faster local publication does not establish production stability.
5. Start a new durable 24-hour observation after recovery is verified. Preserve samples outside the interactive session and across container replacement. Admission-cap changes and Backtest enhancement remain pending quality/stability review.

## Follow-up: seek directly to each page boundary (October 30)

### Deployed PR #40 result

Revision `40e1b7228ed66f4c4c6350d86df801e6cf98ce22` and the valid/ready index were verified in production. Sixteen read-only samples from October 29 23:43 through October 30 00:14 UTC showed a healthy worker lease and zero restarts/OOM or observed lock-renewal failures.

The first evaluation completed at 23:48:08 UTC: **413,060 trades / 207 pages**, load **51,941 ms**, compute **21,592 ms**, publication **2,900 ms**. All 200 performance snapshots refreshed. Its 381 publication operations reflect a different workload, including additional consensus writes, from the earlier captured replay.

The second evaluation failed before publication: the read transaction attempted to commit after **60,440 ms**, exceeding its **60,000-ms** deadline. Market, discovery and narrative jobs continued successfully during observation. This failed the stability check; the prior snapshot remained intact.

### Production query-plan evidence

At October 30 03:29:31 UTC, a bounded read-only `EXPLAIN (ANALYZE, BUFFERS)` compared the generated cursor predicate with an explicit tuple seek at the same late-page boundary, within one Repeatable Read snapshot. Each query returned 2,000 rows; statement timeout was 10 seconds.

| Observation | Prisma cursor + skip | Explicit `(at,id) > (lastAt,lastId)` |
| --- | ---: | ---: |
| Server execution | 1,187.050 ms | 21.457 ms |
| Root shared-buffer hits / reads | 245,286 / 35,686 | 236 / 301 |
| Earlier rows removed by trade-index filter | 419,423 | No such rescan |

The generated cursor expression used OR branches and three scalar subqueries. PostgreSQL scanned the chronological index from the beginning of the time window and filtered earlier pages. The explicit tuple predicate became an index condition. For this late boundary, PostgreSQL chose a bounded bitmap scan of the remaining 5,000 rows followed by a join/sort. The sequential probe order can affect caching, so the timing ratio is not a controlled speedup claim; the plan establishes the repeated-prefix scan directly.

### Follow-up change and validation

`readIntelligenceInputs` now uses parameterized SQL with an exclusive tuple boundary and the existing `(at,id)` index. Page size remains 2,000 and all pages/active-wallet selection still share a Repeatable Read snapshot. The 60-second read bound, five-second publication deadline, selected fields, inclusive time range, active-wallet filter, ordering and event-loop yields retain their existing semantics. No additional migration is needed.

The expanded database regression compares **all selected fields** with Prisma `findMany`, including BUY/SELL values, exact decimals, nullable numerics/JSON, Date values, tied timestamps and an inclusive upper-bound page. A concurrent backfill remains invisible to later pages; inactive wallets and out-of-window rows are excluded. An empty-range regression verifies termination.

A local same-process comparison on 255,253 captured qualifying trades returned 128 pages with identical serialized results:

- Existing cursor reader: **11,686 ms**, maximum timer gap **92 ms**.
- Tuple-seek reader: **3,916 ms**, maximum timer gap **82 ms**.
- Both row hashes: `d06c5f0812261f0ca472871feb5c9f9310d808f1f924808e4a60eca8d60a5fa5`.

A single **read-only production probe** of the revised loader at **03:36:44 UTC** read **425,094 trades / 200 wallets / 213 pages** in **10,506 ms**, with a maximum timer gap of **341 ms**. It ran in a separate API-container Node process, with PostgreSQL default read-only mode and a 10-second statement timeout, rather than replacing the scheduled worker. No production settings, records, queues, deployments or Telegram messages were changed by the probes.

This provides production-scale read evidence, not scheduled-worker recovery. After deploying the follow-up, repeat the two-cycle checks above and then begin a new durable 24-hour observation if they pass. Preserve the failed PR #40 follow-up as part of the evidence history.
