# Wallet admission priority and capacity preview

```sh
npm run wallets:admission-preview
npm run wallets:admission-preview -- --min-quote-sol=0.001 --min-matched-tokens=3 --min-coverage-percent=75 --exploration-slots=1
npm run wallets:admission-preview -- --min-quote-sol=0.01 --exploration-slots=0
```

Supply `DATABASE_URL` through the existing deployment environment. The command forces a read-only PostgreSQL connection with a 20-second statement timeout, verifies `transaction_read_only`, and reads one repeatable-read snapshot with a 30-second transaction timeout. It makes no provider requests. There is no `--apply`, scheduling hook, admission write, or removal operation.

## Input scope

The source is the latest **persisted Emerging wallets snapshot**, which contains at most 50 wallets. `snapshot.total`, `displayed`, and `capped` disclose truncation: rankings and counts describe only those displayed candidates, not the unseen remainder. New scan observations must first pass discovery's existing one-hour token-age gate, repeat-token check and 48-hour lookback before entering this snapshot. Buffered scan checkpoints are not candidates.

A missing, malformed, future-dated or more-than-one-hour-old snapshot produces no selection plan. Exact one-hour freshness is accepted, matching current intake. Duplicate addresses or inconsistent snapshot totals/capping fail closed. Individual invalid Solana addresses, any already-tracked wallet (including inactive/manual/rejected tracking records), and rejected wallet suggestions are excluded before ranking and slot allocation.

Legacy/missing/inconsistent spend summaries remain explicitly unknown or invalid. Accepted summaries must reconcile observed/matched/unknown token counts, the snapshot's scanned-token count, unknown-reason totals, and a positive matched median when matches exist. Summary evidence inherits stored provenance from discovery; the preview does not replay transactions or certify a DEX swap.

## Scenario controls (unvalidated heuristics)

| Option | Default | Meaning |
| --- | --- | --- |
| `--min-quote-sol` | `0.01` | Minimum matched-only median quote-leg amount; nonnegative decimal with up to nine fractional places |
| `--min-matched-tokens` | `2` | Minimum distinct matched tokens, from 2 to 1,000 |
| `--min-coverage-percent` | `100` | Minimum matched / observed token coverage, integer 0–100 |
| `--exploration-slots` | `1` | Reserve 0–2 of the two per-cycle slots for incomplete/unknown evidence |

Exact threshold values pass. Amount comparisons retain decimal precision, including stored half-lamport medians. A size threshold of zero disables only the size hurdle: it does not turn unknown amounts into known evidence or remove the repeat-match requirement. Relaxing coverage can admit partial evidence to the evidence group, but unknown counts and reasons remain visible.

These knobs do **not** modify the production 0.01-SOL closed-position ranking filter. A first-token transfer-leg median is not cumulative position cost, realised performance, sample consistency, holding duration or follower returns. No scenario grants review readiness or approval.

## Priority and allocation

- **EVIDENCE:** passes all scenario hurdles. Sort by matched coverage descending, then distinct matched tokens descending, then address. Larger capital does not break ties or earn a higher score.
- **EXPLORATION:** fails an evidence hurdle and has missing, invalid or partial/unknown evidence. Preserve the existing snapshot order in this separate allocation. Fully known below-threshold amounts do not enter through exploration.
- **BELOW_PREVIEW:** complete known evidence fails the scenario's size/sample hurdles.
- **EXCLUDED:** identity/admission exclusions apply regardless of spend evidence.

Evidence slots come first, followed by reserved exploration slots. Unused slots in either allocation are **not borrowed** by the other. For example, the default one-plus-one scenario yields only one proposed address if no evidence candidate passes. With one available seat and both groups populated, the evidence candidate gets the preview seat. Per-item `previewRank` describes evidence order followed by exploration order; `proposal.assumingFreeSlots` is the actual two-slot scenario after allocation.

`currentPolicy` compares the existing snapshot order after tracked/rejected exclusions, without spend prioritization. It is conditional on history collection being enabled; this tool neither changes nor executes that setting. Invalid snapshot metadata blocks both comparison plans conservatively.

## Capacity and incumbents

The capacity definition matches current intake: **200 active DISCOVERED wallets whose review is not REJECTED**, with at most two additions per cycle. Exact occupied capacity is counted separately from bounded diagnostic rows.

- `assumingFreeSlots`: hypothetical next candidates for comparison, even when all 200 seats are full. It is empty for unusable snapshots.
- `withinCurrentCapacity`: candidates that fit existing free seats; empty at full/over capacity.
- `incumbentSummary`: bounded (first 500 by ID) counts for existing capacity occupants, with explicit truncation, review states, missing/stale performance, closed-position size, stored cap coverage and marked history status.

Incumbent closed-position sizes are **not directly comparable** to candidate quote-leg sizes. `closedPositionMedianBelowPoint01` is a fixed descriptive diagnostic, not a removal threshold controlled by `--min-quote-sol`. Marked complete history is not proof of current full coverage or review readiness. Missing historical cap counts stay unknown. The tool makes no replacement list and does not treat missing/stale evidence as grounds for removal.

## Production review workflow

Collect scenarios from the same time window and compare candidate coverage, the unknown denominator, and available capacity. The defaults are exploratory rather than calibrated thresholds. Check collection health separately with `npm run wallets:candidate-spend`. Accumulate repeat observations across cycles before deciding an admission or capacity policy; retain timestamped reports for comparison. A successful local test or preview does not demonstrate a better production wallet cohort.

### Initial production-input replay

At 2026-10-28 04:40 UTC, a read-only, repeatable-read capture returned the production Emerging snapshot from 04:35:31 UTC: 42 displayed candidates, uncapped, and all 200 discovery seats occupied. Local replay of those captured inputs produced zero evidence-group candidates under both the default scenario and a relaxed 0.001 SOL / 50% coverage scenario, retaining the two-matched-token requirement. All 42 were assigned to the exploration group. The default allocation showed one hypothetical exploration candidate but **zero capacity-feasible additions**; disabling exploration showed none. This is local evaluation of production inputs, not execution of the newly built CLI in production. Newer scanned tokens still subject to the age gate were outside the captured snapshot.
