# Early Radar scorecard

Generated 2026-10-20T13:40:23.887Z. Calls from 2026-10-16T00:00:00.000Z to 2026-10-20T00:00:00.000Z (frozen entry snapshots).

## Read this first

- This measures the calls already made. It does not claim the next call will repeat.
- Medians are the headline; means are printed but are outlier-sensitive. A single +1,000% call can carry a mean.
- Take-profit fills are capped at the target. Stops fill at the first stored close beyond the stop, so gap losses are kept. Only 5-minute closes exist; there is no intra-bar high or low.
- Time exits use the last stored close in the window. When a token stopped trading before the horizon, that close can be stale; the horizon Unknown column is the cleaner measure of missing data.
- UNKNOWN is not zero and is not random. Tokens that rug or stop trading often have no horizon price.
- Below 30 independent events across 15 tokens, a row is descriptive only and is marked INSUFFICIENT.

## Coverage

- Calls: **65** (26 independent after the 24h overlap rule; 39 overlapping calls excluded)
- Each horizon and exit rule uses its own overlap window. A 15m row is not deduplicated against a call two hours later; a 24h row is.
- Distinct tokens: **26**
- Calls with no frozen entry price: **2** (excluded from returns, counted as unknown)
- Newest call: 2026-10-18T07:09:43.607Z
- Oldest call: 2026-10-17T13:10:10.102Z
- Round-trip cost subtracted: **3%** (a guess, not a calibrated fill)

| Day (UTC) | Calls | Tokens |
|---|---:|---:|
| 2026-10-17 | 25 | 16 |
| 2026-10-18 | 40 | 20 |

## Returns by horizon (all calls)

| Horizon | Independent | Known | Tokens | Median | p10 | p90 | Mean | Win rate | Unknown | Pending | Evidence |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 15 minutes | 57 | 53 | 25 | +0.0% | -17.5% | +62.3% | +23.9% | +50.9% | +7.0% | 0 | ok |
| 1 hour | 51 | 32 | 22 | +1.4% | -16.2% | +89.2% | +42.8% | +53.1% | +37.3% | 0 | ok |
| 4 hours | 50 | 24 | 18 | -1.6% | -36.7% | +61.9% | +5.9% | +50.0% | +52.0% | 0 | INSUFFICIENT |
| 24 hours | 26 | 24 | 24 | -48.9% | -92.7% | +12.3% | -32.9% | +16.7% | +7.7% | 0 | INSUFFICIENT |

A positive mean with a flat median means a few calls paid and the typical call did not. Read the median first.

## Peak capture (all calls)

| Window | Independent | n | Median peak | Median close | Median give-back | Median time to peak | Peaks above 0 | Evidence |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| first hour | 51 | 48 | +6.3% | +0.0% | +9.3% | 25m | 37/48 | ok |
| first 4 hours | 50 | 41 | +21.1% | -6.0% | +33.0% | 38m | 38/41 | ok |
| first 24 hours | 26 | 24 | +12.4% | -45.0% | +67.0% | 40m | 17/24 | INSUFFICIENT |

Peak is the highest stored close after the alert. Give-back is the fall from that peak to the window close. If the peak is large and the close is negative, the edge is in the exit, not the hold.

## Exit replay (all calls)

| Rule | Independent | n | Median net | Mean net | Win rate | Median hold | Median benefit when changed | Beat hold | Exit reasons | Evidence |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| Hold 1 hour | 51 | 49 | -3.0% | +1.8% | +36.7% | -3.0% | n/a | +0.0% | TIME 49 | ok |
| Hold 4 hours | 50 | 48 | -3.2% | +21.5% | +39.6% | -3.2% | n/a | +0.0% | TIME 48 | ok |
| Hold 24 hours | 26 | 24 | -48.0% | -34.6% | +16.7% | -48.0% | n/a | +0.0% | TIME 24 | INSUFFICIENT |
| Take profit +25% (4h) | 50 | 48 | +0.5% | -1.9% | +52.1% | -3.2% | +0.2% | +20.8% | TIME 29, TAKE_PROFIT 19 | ok |
| Take profit +50% (4h) | 50 | 48 | -2.9% | +0.3% | +41.7% | -3.2% | -1.7% | +10.4% | TIME 37, TAKE_PROFIT 11 | ok |
| Take profit +100% (4h) | 50 | 48 | -3.2% | +3.0% | +39.6% | -3.2% | +10.6% | +6.3% | TIME 42, TAKE_PROFIT 6 | ok |
| Stop -25% (4h) | 50 | 48 | -9.9% | -4.6% | +33.3% | -3.2% | -5.4% | +12.5% | TIME 34, STOP 14 | ok |
| Trail 25% after +10% (4h) | 50 | 48 | -2.9% | +2.2% | +41.7% | -3.2% | +6.2% | +22.9% | TIME 32, TRAILING 16 | ok |
| TP +50% / trail 25% / stop -25% (4h) | 50 | 48 | -4.2% | +1.4% | +41.7% | -3.2% | +2.8% | +31.3% | TIME 23, STOP 9, TRAILING 6, TAKE_PROFIT 10 | ok |

The reference rules are fixed, repeatable starting values, not a recommendation. "Median benefit when changed" covers only calls where the rule exited before the window ended; n/a means the rule never changed an exit. "Beat hold" is the share of all calls where it did better after cost.

## By profile

| Group | Calls | 24h indep. | Tokens | 1h median | 4h median | 24h median | 4h peak median | 4h hold net | TP +50% net |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| trencher | 50 | 26 | 26 | +2.1% | +1.4% | -48.9% | +21.1% | -3.2% | -2.9% |
| holder | 15 | 9 | 9 | +6.9% | -12.2% | -64.9% | +29.8% | -5.4% | -5.4% |

## By tier

| Group | Calls | 24h indep. | Tokens | 1h median | 4h median | 24h median | 4h peak median | 4h hold net | TP +50% net |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| WATCH | 64 | 26 | 26 | +2.1% | +1.4% | -45.1% | +22.5% | -3.1% | -2.7% |
| STRONG | 1 | 1 | 1 | -14.5% | -10.5% | -61.8% | +5.2% | -14.1% | -14.1% |

## By score band

| Group | Calls | 24h indep. | Tokens | 1h median | 4h median | 24h median | 4h peak median | 4h hold net | TP +50% net |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 55 to 59 | 27 | 13 | 13 | +6.9% | -19.7% | -68.1% | +35.3% | -4.7% | +5.6% |
| 60 to 69 | 37 | 20 | 20 | +1.4% | +4.5% | -35.7% | +11.0% | -2.9% | -2.9% |
| 70 to 79 | 1 | 1 | 1 | -14.5% | -10.5% | -61.8% | +5.2% | -14.1% | -14.1% |

If a higher score does not produce a better median, the score is an attention score, not an expected-return score.

## By entry market cap

| Group | Calls | 24h indep. | Tokens | 1h median | 4h median | 24h median | 4h peak median | 4h hold net | TP +50% net |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| under $20k | 23 | 13 | 13 | +0.0% | +3.8% | -29.4% | +6.2% | -3.2% | -3.2% |
| $20k to $50k | 17 | 9 | 9 | +4.4% | +23.9% | -59.6% | +50.2% | +12.9% | +27.8% |
| $50k to $100k | 22 | 12 | 12 | +2.1% | -20.1% | -76.1% | +32.5% | -14.5% | -9.4% |
| unknown | 3 | 2 | 2 | n/a | n/a | n/a | n/a | n/a | n/a |

## What this does not prove

- It does not prove the calls are tradable at scale, or that the entry price was available to a real buyer.
- It does not prove the exit rules work on other market regimes or on tokens the system did not track.
- It does not cover 7-day or longer outcomes, which the separate tracker measures.
- It does not include fees, priority fees or MEV beyond the flat round-trip cost.
- It is in-sample. No parameter was held out.

## Notes

- Medians are shown first. One +1,000% call moves a mean; medians describe the typical call.
- Returns use stored 5-minute closes. There is no intra-bar high or low in storage, so take-profit fills are capped at the target and stops fill at the first close beyond the stop.
- UNKNOWN is not random: a token that stops trading often has no horizon price. The unknown rate is shown next to every sample.
- A bucket needs at least 30 independent events across 15 tokens before any number is treated as a result. Below that it is marked INSUFFICIENT.
- This is in-sample research on a small cohort. It is not a forecast, not financial advice, and it changes no trading limit.
