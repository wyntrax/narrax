# Wallet history scheduling

The history worker still selects at most **two wallets per cycle**, with **three filtered SWAP pages per wallet**. Existing HTTP retry limits remain unchanged. It no longer uses `wallet.research.historyCursor` to choose the next pair.

## Fair selection

- Choose eligible wallets by oldest persisted attempt timestamp, falling back to the history row timestamp and then wallet admission time. Wallet ID breaks ties.
- Exclude inactive/rejected wallets and future admissions.
- Filter completed scans in their 12-hour cooldown **before** allocating the two slots.
- Attempts have a 15-minute cooldown. Failed and interrupted attempts rotate like successful attempts, so one repeatedly failing wallet cannot permanently monopolise the queue.
- New arrivals do not sort ahead of an older unfinished wallet solely because their IDs follow the previous cursor. Continuous admission may still increase waiting time; this is fairness, not a guarantee of instant history completion.

Selection relies on the existing single-concurrency wallet-intelligence worker. It is not a multi-process distributed claim protocol. No additional provider requests, schema migration, or production configuration changes are required.

## Diagnostics and recovery

`wallet.historyAttempt.<id>` records `RUNNING`, `PARTIAL`, `COMPLETE`, or `FAILED`, attempt count, mode (`INITIAL`, `RESUME`, `HEAD`), last attempt/success, requested bounds, consecutive failures, sanitized error code, HTTP status when available, and pages read in the attempt. Attempt counts start when this version first runs; they do not reconstruct previous failures. A stale RUNNING record means the attempt did not record a final result, not necessarily that the provider is still running.

Failures preserve the last successful `wallet.history.<id>` continuation checkpoint. Partial pages in a failed batch are retried; transaction deduplication protects previously stored swaps. Successful history and final attempt status commit atomically. Raw exception messages and provider URLs are never stored in diagnostic error fields.

`wallet.history.<id>` adds:

- `oldestObservedAt` / `newestObservedAt`: provider-row dates within requested windows, not proof that every row parsed into a supported wallet trade.
- `scannedThroughAt`: earliest provider-row date reached in the current fixed scan, potentially beyond its requested lower bound. Empty results leave it unknown.
- `verifiedCoveredFrom` / `verifiedCoveredTo`: bounds of completed filtered-history scans only. During a partial head catch-up they retain the preceding completed coverage. Initial partial scans and legacy partial records have unknown verified bounds.
- `pagesRead`: cumulative successful-batch pages since these diagnostics became available; legacy page counts are unavailable.
- `searchHops`: validated Helius search-period continuations. A specific HTTP 404 can supply a `before-signature` to continue searching; it is not proof of empty history. Each hop consumes one of the existing three page-budget slots. Search-only batches persist a partial checkpoint with unknown observed dates; other 404s and repeated cursors remain failures. Attempt records and cycle results expose their own hop counts; successful-row pages plus search hops stay within the page budget (existing bounded 429 retries are separate).

Legacy `coveredFrom` / `coveredTo` remain requested bounds for compatibility; `capped=true` never proves that range was completed. `COMPLETE` describes pagination completion, not profitable performance or fully parsed swaps. Skipped records remain qualification blockers. Transfers and live holdings remain outside this collector.

The existing authenticated wallet-detail response exposes `historyAttempt` alongside `history`. To inspect without writing or calling providers:

```sh
npm run wallets:history-status -- --limit=100
npm run wallets:history-status -- --wallet=<address>
```

The command requires an explicitly supplied `DATABASE_URL`, forces read-only database connections, and reports the next globally scheduled pair. Compare successive reports: older wallets should receive additional attempts, saved cursors should advance, and requested dates must not be confused with observed/verified dates. No production scheduling/repair is performed by the local implementation workflow.
