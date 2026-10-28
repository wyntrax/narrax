# Candidate quote-transfer evidence (preview)

Early-buyer discovery now records `spendEvidence` beside each existing wallet, rank, signature and block time. It uses the **same** parsed RPC transactions already fetched by `scanEarlyBuyers`; no new provider requests or rescans are added. Existing discovery, admission, and review rules continue to operate as before while evidence accumulates.

## What a matched observation means

`MATCHED_TRANSFERS` is deliberately narrow: one incoming target-token transfer and one reciprocal SOL/WSOL transfer in the same inner-instruction group, with the same counterparty owner, mapped token-account ownership, and a target-token amount matching the wallet's net received token amount. The raw quote amount is an integer string in lamports. No current quotes, FDV, or fee-payer native-balance differences are used.

This is evidence of matched transfer legs, **not** validation of a DEX swap instruction, total fees, rent, complete position spend, profitability, or follower execution. Reciprocal transfers can also be non-swap transactions or manipulated activity. Top-level fees/rent/tips are not included; extra legs or unsupported financial instructions within the matched group cause abstention. Unsupported Token-2022 instructions, complex/multi-hop routes, missing account ownership, conflicting token deltas, and unsupported transactions stay `UNKNOWN` with an explicit reason. Coverage may remain low.

Never substitute a first-token quote-leg median for `medianClosedPositionSol`, which measures cumulative spend on observed closed positions. Repeated partial buys and sells have different semantics.

### Temporary WSOL account ownership

An account created and closed in one transaction can be absent from both token-balance snapshots. The extractor can now resolve this narrow case when the transaction explicitly creates a 165-byte account owned by classic SPL Token and subsequently initializes it as WSOL for a named owner **before** the consuming outer instruction. Decoded top-level or inner setup instructions are supported. The transfer leg still supplies the amount: rent, wrap funding and closing refunds never substitute for it.

`recoveredWsolAccounts` retains the account, owner, mint, and outer/inner indexes of the creation and initialization instructions beside the existing transaction signature/time. It is optional on both matched and unknown records. Recovery does not upgrade an unknown swap by itself: other blockers still apply.

Transfers' authority fields, associated-token-account declarations alone, `syncNative`, and close recipients do not prove this mapping. Same-call initialization, account reuse, conflicting balance evidence, ownership changes/closure before or inside the consuming call, and undecoded classic-token lifecycle instructions involving the account remain unsupported. Existing balance mappings are not replaced.

The reduced captured fixture `packages/solana/src/wsol-ownership.fixture.ts` comes from mainnet transaction `2ypTZHmoojTLyiqKYwrhyjVsegZY4TaVyEUVvnacACwQpoF76qjE9MoY6Lb4RAinDTnD9hrPZXTrgXVS2j7twC1S`, observed read-only on 2026-10-27. Its temporary WSOL source is initialized under outer instruction 2, used under instruction 6, and closed under instruction 7. The quote transfer is 1,599,244 lamports (0.001599244 SOL); the separately recorded account creation amount is 1,488,440 lamports. The ownership-only implementation still reported `UNKNOWN / UNSUPPORTED_TOKEN_PROGRAM`. With the checked Token-2022 evidence below, this captured fixture now matches locally. Tests using a classic-token counterpart remain explicitly synthetic. Local replay is not a measurement of production coverage.

### Checked Token-2022 received-token evidence

The received-token leg may use an ordinary Token-2022 `transferChecked` only when its raw amount agrees exactly with both the source-account decrease and destination-account increase. Both sides require token-program, mint, decimals and consistent ownership metadata. Missing destination pre-balance is **not** treated as zero unless earlier instructions in the same transaction explicitly created and initialized that Token-2022 account for its observed owner. Source pre/post balances must always be present.

Matched records retain `token2022Transfers` with account addresses, raw before/after quantities, decimals and whether the destination pre-value came from a snapshot or proved creation. Extra transfers, mint/burn, authority changes, account reuse/closure, and opaque Token-2022 operations touching those accounts prevent attribution. Explicit `transferCheckedWithFee`, confidential transfers and other extension-specific instructions remain unsupported. A net/gross mismatch stays unknown; it is never repaired by guessing a fee. Equality in this transaction does not establish that the mint has no extensions or that future transfers are fee-free.

New reasons: `TOKEN_2022_BALANCE_EVIDENCE_MISSING`, `TOKEN_2022_AMOUNT_MISMATCH`, and `TOKEN_2022_LIFECYCLE_AMBIGUOUS`. These remain in the unknown denominator. The implementation uses existing parsed transactions only, with no additional provider requests, mint lookups, automatic backfills or admission-rule changes. Deploy after the temporary WSOL ownership support, then measure new observations and independently inspect supported and rejected examples.

Validation on 2026-10-28 also fetched the full sample transaction through one bounded read-only production RPC request and replayed it locally. It returned `MATCHED_TRANSFERS` with 1,599,244 quote lamports and 18,807,903,081 received-token raw units. The received-token source moved from 999,821,688,286,948 to 999,802,880,383,867 units; destination creation/initialization was confirmed under outer instruction 5. This confirms the reduced fixture's relevant facts and full-transaction replay, rather than deployed collection coverage.

### Rate-limited collection and checkpoints

Production audit on 2026-10-28 at 02:04–02:08 UTC confirmed API/worker/web revision `65b3d3d` (PR #26). A non-persisting probe using the deployed extractor matched the sample above. However, the 02:01 discovery cycle completed **zero** token scans: one `getTransaction` and four `getSignaturesForAddress` failures were HTTP 429. There were 232 eligible unscanned tokens and no newly persisted observations since the worker's 01:49:51 restart. Four retained prior cycles also had 429 errors. A successful discovery job or fresh emerging snapshot therefore does not establish successful new evidence collection. These observations establish rate limiting, not a measured subscription/quota shortfall.

Discovery now spaces its own RPC attempts at least one second apart. HTTP 429 receives at most **two retries across the entire run**, with 2s/4s backoff and `Retry-After` honored when longer. Every attempt counts against the original ceiling of five tokens × (two signature pages + forty transactions) = **210 calls**. Smaller `maxTokens` bounds shrink that ceiling. A server delay over 30 seconds, exhausted retry allowance or exhausted call budget ends the cycle; sustained 429s do not fan out to the remaining tokens. A persisted cooldown lasts at least 15 minutes, or the longer server-specified delay. Other HTTP/parse failures are not automatically retried. This local pacing does not coordinate other worker jobs or processes sharing the provider.

#### Optional second RPC key

Set these in the worker's deployment environment (the standard host setup loads `/srv/narrax/.env`), then recreate/redeploy the worker to load the values:

```dotenv
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_PRIMARY_KEY
HELIUS_RPC_FALLBACK_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_SECOND_KEY
```

Use full Solana **mainnet** RPC URLs. Leaving `HELIUS_RPC_FALLBACK_URL` empty retains primary-only operation. The worker validates URL syntax, requires the primary, and rejects identical URLs; diagnostics never print their values. Keep keys in the deployment environment rather than the repository.

When configured, a primary HTTP 429 switches the same read (with the same signature or pagination cursor) to the secondary after the normal one-second pacing delay. This consumes one of the **same two retry slots** and the **same 210-call budget**. Primary `Retry-After` is respected by recording an endpoint-specific cooldown; it does not delay reads against the separate secondary. Discovery stays on the secondary for the remainder of that run and starts subsequent runs there while the primary cooldown remains active. The primary is tried again on a later run after its cooldown expires.

If the secondary also returns 429, the remaining retry allowance/backoff applies, then collection pauses and saves progress. It never bounces between keys in a retry loop. Authentication errors, unsupported responses, and null transactions do not trigger failover. Provider account-level limits can cover both keys, so two keys do not establish independent capacity.

This fallback applies to early-buyer discovery's signature/transaction reads. `HELIUS_API_KEY` continues to configure the separate enhanced-history/webhook APIs. `collection.health` exposes `fallbackConfigured`, `primaryRequests`, `fallbackRequests`, `failovers`, and `primaryCooldownUntil`, with no URLs or keys. Existing progress records remain compatible.

`wallet.discovery.scanProgress` stores at most five checkpoints. Each retains a signature-page cursor, only the oldest forty successful signature candidates, the next transaction index, and up to thirty first buyers with their original signature/block time and transfer evidence. Successful reads are checkpointed before proceeding. A resumed scan is prioritized over a new one; no already-read transaction or completed scan is automatically rescanned. A crash between a provider response and its database checkpoint can still repeat that read, within the next run's budget.

Fresh scans still start within the six-hour token window. Once a signature page has anchored the history, its continuation can resume for up to 24 hours from initial selection; it never refreshes the newest page or adds a third page. First-page failures cannot start outside the original six-hour eligibility window. Expired, blacklisted, deleted or already-completed checkpoints are removed without publishing their partial buyers. Invalid stored checkpoint shapes stop collection with `INVALID_PROGRESS` rather than silently resetting it. Completion atomically publishes `TokenEarlyBuyers` and removes the checkpoint, so partial buyer lists do not feed emerging wallets or intake. The existing single-concurrency discovery worker owns this bounded progress record.

`wallet.discovery.scanHealth` persists request/retry/429 counts, resumed/pending/expired counts, safe error codes, cooldown and stop reason. `npm run wallets:candidate-spend` includes these under `collection`, plus buffered-progress counts; it remains read-only and makes no provider requests. Buffered buyers are not usable discovery evidence until their bounded scan is published.

After deployment, check `collection.health` across scheduled cycles for bounded calls and cooldown behavior, checkpoint advancement, newly completed scans and then newly stored matched/unknown observations. Measure aggregate coverage before changing admission rules. No provider-plan upgrade or production rescan is part of this change.

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
