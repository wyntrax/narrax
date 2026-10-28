# Historical entry-cap coverage audit (read-only)

```sh
npm run wallets:entry-cap-audit
npm run wallets:entry-cap-audit -- --wallet-limit=5 --entry-limit=100 --as-of=2026-10-28T14:47:32.928Z
npm run wallets:entry-cap-audit -- --after-wallet=WALLET_ID --as-of=2026-10-28T14:47:32.928Z
npm run wallets:entry-cap-audit -- --wallet=SOLANA_ADDRESS --after-entry=ENTRY_TRADE_ID --entry-limit=100 --as-of=2026-10-28T14:47:32.928Z
```

Use the deployment's `DATABASE_URL`. The CLI forces read-only PostgreSQL mode, verifies `transaction_read_only` inside a repeatable-read transaction, and uses a 20-second statement timeout / 60-second transaction timeout. It performs no provider calls and exposes no apply option.

## What is measured

The audit recomputes entry coverage from stored trades rather than trusting a stale performance snapshot. It shares the performance accounting implementation:

- An observed flat-to-flat position has one entry. Adds and partial exits are not new entries; a new buy after a full close is.
- Tokens contaminated by invalid trades or unmatched/oversized sells are excluded, just as in performance reporting.
- Both open and closed observed positions are in the entry-cap denominator; closed-position gains are also shown separately.
- Wallet selection includes active, non-rejected tracked wallets of any source. Wallets are paged by ID, not ranked by returns.
- The 30-day window and first 10,000 trades per wallet (`at ASC, id ASC`) match the ranking computation's input cap. `tradesCapped` explicitly warns that later rows may change positions and contamination. This is observed swap history, not complete on-chain holdings or cost basis.

`before` and `afterPreview` have the same position denominator. A preview changes only the in-memory cap/evidence of an eligible entry. `knownPositionGain`, `knownClosedPositionGain`, `smallCapClosedPositionGain`, and percentage-point coverage gain quantify the potential benefit. `impactOrder` orders wallets with a gain by recovered closed positions, then all recovered positions; it is not a profitability or admission ranking. A positive gain is not automatically material or sufficient for review readiness.

## Recovery rules

The audit uses the same `walletMarketLookup` as existing valuation reconciliation. It accepts only stored observations at or before the entry, no more than 15 minutes old, with matching per-metric provenance, positive price, nonnegative liquidity and a positive, non-FDV market cap. Missing provenance, later-only quotes, current prices and historical FDV do not become entry caps.

Lookup examines at most 20 recent rows, falling back past invalid values/provenance. Its existing semantics stop at the first otherwise-valid observation even if it has only FDV or an invalid cap: the audit does not search older rows for a more favorable cap. Reasons include `NO_TOKEN_MARKET_HISTORY`, `TRADE_BEFORE_MARKET_HISTORY`, `NO_MARKET_IN_WINDOW`, `INVALID_MARKET_PROVENANCE`, `INVALID_MARKET_VALUES`, `INVALID_MARKET_CAP`, `FDV_ONLY` and `MARKET_LOOKUP_LIMIT`.

The repair guards also apply:

- A non-null existing cap with unusable evidence stays `EXISTING_CAP_NOT_REPAIRABLE`; frozen valuations are not overwritten.
- Missing cap plus an existing USD valuation requires a matching evidence event timestamp, otherwise `LEGACY_VALUATION_GUARD`.
- Existing USD values do not need to be recovered for a cap-only preview.
- Successful entries include their trade ID/time, metric ID, observation time, cap, source and pair address for review. They become `RECOVERABLE` in this report only.

The performance classifier is not being tightened or recalibrated by this audit. Its existing known entries retain their current classification. The audit validates prospective recoveries against stored metric provenance; it is not a new independent certification of every already-known cap.

## Bounds, continuation and unknowns

| Control | Default | Bounds |
| --- | ---: | --- |
| `--wallet-limit` | 5 | 1–10 wallets |
| `--entry-limit` | 100 | 1–500 eligible unknown entries across the page |
| Market lookup queries | 500 | Fixed total ceiling, in addition to each lookup's 20-row ceiling |
| Trades per wallet | 10,000 | Plus one row to detect truncation |

Eligible entry IDs are ordered ascending within each wallet; lookups are allocated round-robin. This is a deterministic bounded selection, **not a random or representative sample**. Gap proportions must not be extrapolated to the remaining entries or whole cohort.

`unknownEntryReasons` partitions the original unknown denominator. `NOT_EXAMINED` and `BEFORE_ENTRY_CURSOR` remain unknown, never treated as non-recoverable. On a lookup query-budget stop, the interrupted entry is not counted as checked and its cursor does not advance. Ordinary database failures abort the report rather than masquerading as missing evidence.

- `walletPage.nextWalletCursor` advances to other wallets; it does **not** finish pending entries in the current wallets.
- `entryContinuationRequired` and `nextEntryCursor` identify unfinished work for each wallet. Continue with that wallet's address and `--after-entry`. If the cursor is null because no entry was checked, retry that wallet without an entry cursor.
- Keep `--as-of` fixed to compare pages. Each invocation still has its own database snapshot: late imports/repairs can alter the dataset between pages. Counts and percentages must not be blindly added across entry-continuation reports, since they repeat the wallet denominator. Earlier-page recoveries are not applied to later pages' previews.

For a future write proposal, review these entry IDs/provenance alongside `npm run wallets:reconcile-valuations -- ...` in its default dry-run mode. That tool scans all trades with missing valuations, including adds and sells, so its counts are not position-coverage counts. This audit never invokes its write path or schedules jobs.

## Initial production sample — October 28, 2026

A locally built, validated copy of the audit was streamed to a transient Node process in the API container; no files were installed and no production rows/configuration/services were modified. This was execution against production reads, not deployment of the new CLI.

Two disjoint five-wallet pages used the same 14:47:32 UTC cutoff, with 100 entry lookups and 200 lookup SELECTs per page. Across those pages:

- 44,080 observed positions, 31 currently known caps; two wallets hit the 10,000-trade cap.
- **200 unknown entries examined; zero recoverable from the stored evidence checked.**
- 120 trades preceded the first stored token market observation, 78 had no token market history, and two had no observation in the pre-trade window.
- **43,849 eligible entries remained unexamined.** No wallet in this bounded sample showed a preview gain.

This result identifies missing historical observations in the checked entries, not proof that the entire cohort is unrecoverable. Current quotes cannot fill those historical gaps. Continue bounded coverage work while the separate 24-hour worker observation runs; admission policy remains a later decision.
