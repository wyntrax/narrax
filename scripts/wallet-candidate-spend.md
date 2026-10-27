# Candidate quote-transfer evidence (preview)

Early-buyer discovery now records `spendEvidence` beside each existing wallet, rank, signature and block time. It uses the **same** parsed RPC transactions already fetched by `scanEarlyBuyers`; no new provider requests or rescans are added. Existing discovery, admission, and review rules continue to operate as before while evidence accumulates.

## What a matched observation means

`MATCHED_TRANSFERS` is deliberately narrow: one incoming target-token transfer and one reciprocal SOL/WSOL transfer in the same inner-instruction group, with the same counterparty owner, mapped token-account ownership, and a target-token amount matching the wallet's net received token amount. The raw quote amount is an integer string in lamports. No current quotes, FDV, or fee-payer native-balance differences are used.

This is evidence of matched transfer legs, **not** validation of a DEX swap instruction, total fees, rent, complete position spend, profitability, or follower execution. Reciprocal transfers can also be non-swap transactions or manipulated activity. Top-level fees/rent/tips are not included; extra legs or unsupported financial instructions within the matched group cause abstention. Token-2022, complex/multi-hop routes, missing account ownership, conflicting token deltas, and unsupported transactions stay `UNKNOWN` with an explicit reason. This conservative first version may have low coverage.

Never substitute a first-token quote-leg median for `medianClosedPositionSol`, which measures cumulative spend on observed closed positions. Repeated partial buys and sells have different semantics.

## Emerging snapshot and read-only preview

Each emerging lead now includes `spend`:

- `observedTokens`, `matchedTokens`, `unknownTokens`: distinct first-token observations; unknowns remain in the denominator.
- `medianMatchedQuoteSol`, `minMatchedQuoteSol`, `maxMatchedQuoteSol`: precise decimal strings for matched observations only, or null when none are available.
- `unknownReasons`: legacy records, missing signature/time provenance, invalid evidence, or extractor-specific reasons.

Old records are not reinterpreted as zero spend and are not silently backfilled. Missing block time remains missing; retrieval time never substitutes. The median of a partially observed sample may be biased, so a partial sample remains explicitly partial even if its known legs exceed a preview threshold.

```sh
npm run wallets:candidate-spend
npm run wallets:candidate-spend -- --min-quote-sol=0.05
```

The command requires a supplied `DATABASE_URL`, enforces read-only database connections, makes no provider calls, and reads only the latest emerging snapshot (at most 50 leads). It reports snapshot age, truncation and unknown coverage. The default 0.01 SOL is an **unvalidated preview threshold**, not an admission rule or the closed-position readiness metric. No wallet is accepted, rejected, approved, or deactivated by the report.

After release, compare coverage and unknown reasons over newly scanned tokens before choosing any admission filter. Review matched raw transactions independently before interpreting these observations as swap spend. Keep exploration for unsupported/new wallets explicit rather than silently treating unknowns as dust. Production success has not been verified by local tests.
