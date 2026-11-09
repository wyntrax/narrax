# Smart Money evidence quality

## Ranking controls

The leaderboard opens on **Ready for review**. **Observing** and **All evaluated wallets** remain available. These are research states, not operator approvals; membership and admin access rules are unchanged.

The adjustable minimum median closed-position spend defaults to **0.01 SOL**. This is an unvalidated research heuristic to flag dust-dominated samples, not a claim about profitable position sizes or execution costs. The API accepts `minMedianPositionSol=0..1000` and `status=ALL|REVIEW_READY|OBSERVING`; filtering occurs before the result limit. Other readiness requirements still apply. The API default status remains `ALL` for existing clients.

- **Median first buy:** first BUY amount of each valid observed position in the selected entry-cap band.
- **Total buy turnover:** all buys in those positions, including repeated capital use. It is not unique capital or maximum simultaneous exposure.
- **Median closed-position spend:** accumulated buys per closed position, excluding open positions.
- **Wallet entry-cap coverage:** known / total valid observed positions across all bands, not just the selected band. Incomplete-cost-basis tokens remain excluded from performance calculations.

Legacy performance snapshots have unknown size evidence and remain observing until the worker recomputes them. Gross P&L still excludes unrecorded fees; open losses are not marked to market.

## Market observations

The existing 150-token refresh budget now includes up to 10 rotating slots for tokens traded by active, non-rejected tracked wallets during the preceding 24 hours. Outcome/discovery reservations remain ahead of this lane; at most half of the remaining slots go to wallet tokens. Diagnostics expose `priceCoverage.wallets`. Throttled requests do not advance its cursor. This improves forward collection, but does not guarantee a pre-trade observation for a newly discovered token.

Evidence lookup checks at most 20 newest observations within the 15 minutes at or before a trade, skipping invalid values/provenance. FDV remains explicitly distinct from market cap. New missing-value reasons distinguish absent token history, trades preceding collection, stale-window gaps, unusable values, invalid provenance, FDV-only data, and lookup limits. Older records retain their generic explanation until reconciled.

## Bounded reconciliation

Run with an explicitly configured database connection; the command does not load `.env` files:

```sh
npm run wallets:reconcile-valuations -- --limit=100
```

This is a database-enforced **read-only preview**, with no provider requests. The result includes recoverable cap/USD counts, reason counts, and `asOf` / `nextCursor`. To continue the same 30-day audit window, pass `--as-of=<asOf> --after=<nextCursor>`; an optional `--wallet=<address>` scopes the audit.

`--apply` explicitly enables writes for that page. Re-run without `--after` to apply the first page after previewing it. Only missing valuations can be filled; already-recorded cap/USD values and their observations are preserved. Rows with existing valuations but missing/mismatched event-time provenance are reported as `legacySkipped`. Conditional writes report concurrent modifications as `conflicts`. Reruns are idempotent. Performance updates on the next normal evaluation cycle.

Reconciliation can also improve missing-value explanations, but cannot reconstruct absent historical market data. Current quotes and post-trade observations never substitute for historical evidence. No production repair or deployment is performed by the local implementation workflow.
