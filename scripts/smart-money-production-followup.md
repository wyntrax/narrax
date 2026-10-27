# Smart Money production follow-up — 2026-10-27

## Filtered-history HTTP 404

At 07:31Z, wallet `7NNzakXLFv2VfhUuoZ9i4Uy4f63BDJcR96tMCucXa6KL` failed its INITIAL history attempt after one successful page. Its saved diagnostic was `PROVIDER_HTTP`, HTTP 404, and no successful history checkpoint existed.

Bounded read-only provider probes at approximately 08:20–08:24Z reproduced the cause:

- The initial filtered SWAP request returned HTTP 200 with four transactions.
- Requesting the next page returned HTTP 404 with `Failed to find events within the search period. To continue search, query the API again with the \`before-signature\` parameter set to <signature>.`
- Supplying that signature through the existing `before` query parameter returned another search-period 404 with a **different** continuation signature.
- One diagnostic SSH connection interrupted; its unseen response was not treated as evidence.

This is a provider search-window continuation, not a demonstrated invalid address, quota exhaustion, or end of wallet history. The collector previously discarded the entire attempt on this response, preventing it from saving progress through the search interval.

The local fix accepts only this exact error shape and a base58-shaped signature; all other 404s remain failures. Each hop consumes a page-budget slot. Search-only batches remain capped with unknown observed dates and a resumable cursor. Repeated/cyclic cursors fail safely. A later failure preserves the last successful checkpoint. No live records, configuration, deployments, or background jobs were changed by this investigation.

`searchHops` is reported separately from successful response pages in the collector, per-wallet attempts/checkpoints, job results, and read-only history status CLI. Existing three-page/two-wallet limits and bounded 429 retries remain in place.

## Candidate-quality baseline

Read-only PostgreSQL inspection at 08:28Z, with `default_transaction_read_only=on`:

| Stored evidence | Count |
| --- | ---: |
| Active non-rejected wallets / performance snapshots | 126 / 126 |
| Wallets with observed closed positions and median size evidence | 73 |
| Median closed-position spend below 0.01 SOL | 57 |
| Median closed-position spend at least 0.01 SOL | 16 |
| At least 10 closed positions and median spend at least 0.01 SOL | 11 |
| Above combination and positive aggregate realised P&L | 8 |
| Positions with known entry-cap evidence / all observed positions | 192 / 32,013 |
| Unmatched sells in the performance snapshots | 4,861 |

These are overlapping descriptive filters, **not** approval criteria. In particular, ten closed positions is only an audit slice; the existing review rule still requires 20 closed positions, five tokens, seven observed days, and its other checks. The 0.01 SOL threshold remains an adjustable, unvalidated review-size heuristic. Aggregate realised P&L includes partial sales and excludes fees/live unrealised losses; it does not certify a profitable closed-position strategy.

The existing ranking evaluator returned zero review-ready wallets:

- ALL band: 102 wallets with positions; 101 incomplete histories, 102 small samples, 76 incomplete cost bases, 57 small positions. ALL cannot establish small-cap performance.
- SMALL_CAP band: 33 wallets with supported positions; all 33 had incomplete histories and small samples, 25 incomplete cost bases, and 19 unknown median closed-position sizes.

## Next candidate improvement

The 08:16Z discovery snapshot contained 71 repeat-participation leads, with the first 50 listed at two scanned tokens each. Intake still added two provisional wallets. The discovery health snapshot had 177 complete scans, 52 judged tokens, zero winners, 85 missing prices, and 40 stale prices.

Current early-buyer records retain wallet, rank, signature, and observation time. The parser identifies a fee-payer token-balance increase; that alone is not proof of a paid swap. The intake snapshot contains only wallet and repeat-token count. It cannot currently support an honest buy-size admission rule.

The next implementation should collect attributable swap-spend evidence from already requested transactions, retaining the signature/time and explicit unknown reasons for unsupported or ambiguous transactions. Avoid inferring spend from fee-payer native-balance changes, which mix trade amounts, fees, rent, and unrelated transfers. Preview the resulting candidate distribution before choosing an admission-size threshold or allocating evidence-qualified versus unknown exploration slots. Do not use current market caps or token price growth as wallet profitability evidence.

First release the continuation fix and confirm real search-hop progress; production completion remains unverified until a released collector advances this wallet to actual older rows or genuine exhaustion.
