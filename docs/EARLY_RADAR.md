# Radar topics and the early lane (2026-10-16)

## Why the radar only showed Solana

The radar is a **watchlist**, not trend discovery. It searches exactly the topics you configure, and the local config
had one: `[{"name":"Solana ecosystem","query":"solana"}]`. One topic can only produce one narrative.

## Topic packs

Set `TREG_NARRATIVE_PACKS` (comma separated). Packs and `TREG_NARRATIVE_TOPICS` combine; custom topics win a name clash.

| Pack | Topics | For |
|---|---|---|
| `solana` | Solana ecosystem | the previous default |
| `trencher` | Pumpfun meta, Community takeover, Lowcap gems, Viral memes, Agent coins | memecoin trenches |
| `holder` | Solana DePIN, RWA, DeFi, gaming, Builders shipping | longer-term, product-backed |
| `chatter` | Contract drops, Ape calls | posts likely to carry a mint or $TICKER (feeds social discovery below) |

```powershell
$env:TREG_NARRATIVE_PACKS='trencher,holder'
$env:TREG_NARRATIVE_PLATFORMS='x'            # cheapest; add reddit,tiktok later
$env:TREG_NARRATIVE_INTERVAL_MS='3600000'    # 1 hour
# optional: add your own theme on top
$env:TREG_NARRATIVE_TOPICS='[{"name":"Zorblax","query":"zorblax OR $ZORB"}]'
```

Limit: 10 topics per run (`trencher,holder` is exactly 10; `trencher,chatter` is 7; all three is 12 and is refused). Going over is an error, never a silent cut. The worker logs `estimatedCycleCostUsd`.
Catalog estimate: 10 topics on X only is about $0.0075 a cycle (about $0.18/day hourly, $0.36/day every 30 min);
10 topics on all three platforms is about $0.03 a cycle. Estimates, not billing.

**Matching caveat.** A narrative is matched to tokens by comparing its name words (4+ letters) with token names and
symbols. Names such as "Agent coins" or "Community takeover" find tokens that use those words. For a theme you see on
your timeline, add it as a custom topic named after the word tokens will actually use.

## Early lane (market cap under $100K)

`packages/token-intel/src/earlyRadar.ts`, called from `resolveTokens`. For every token matched to a live narrative whose
market cap is under `EARLY_RULES.maxMarketCapUsd` ($100K) it scores two profiles and writes an alert
(`EARLY_RADAR_TRENCHER` or `EARLY_RADAR_HOLDER`, WATCH from 55, IMPORTANT from 70, at most one per token per profile
per 6 hours).

| Rule | trencher | holder |
|---|---|---|
| min liquidity | $3K | $8K |
| min holders | 30 | 150 |
| max top 10 share | 70% | 45% |
| max dev share | 15% (unknown flagged) | 5% (unknown flagged, score capped at 60 = never STRONG) |
| age | 10 min to 72 h | 12 h to 30 days |
| min liquidity / cap | 5% | 8% |

Both exclude: cap at or above $100K or under $2K, honeypot, active mint or freeze authority, suspicious copy, dead narrative,
unknown holders, concentration or age. Flags that cap the score: possible wash volume, manipulated-looking narrative,
price that ran ahead of attention, not the OG or origin unverified (holder), ticker-only match, unknown dev share (holder).

"Community" is a proxy: holder count, holder growth over about 3 h, smart-wallet holders, narrative organic score.

**What it does not do.** It writes alerts only. It writes no opportunity, decision, order or position, and the AI step
still demotes anything under the main floors ($20K liquidity, 50 holders), so no trade can come from this lane.
All weights and thresholds are unvalidated starting values. A high score is not a prediction.

**Known data gap.** The free market sources never report developer holding, so `devHoldingPct` is stored as null for every
token. That is why an unknown dev share cannot exclude a holder candidate (it would never fire) and instead caps it at WATCH.
Real dev-holding data (deployer wallet balance) is the next thing that would raise holder-profile quality.

**Data dependency.** The market-data job only creates launch tokens with at least $5K liquidity
(`launchMinLiquidityUsd`), so a token between $3K and $5K liquidity appears only if wallet activity found it first.

## Publication evidence gate (2026-10-21)

Both discovery routes (narrative name matching and social mints/tickers) previously published from whatever the newest
stored price and holder rows happened to be. On 2026-10-20 that produced a real call whose price and holder evidence was
299.6 minutes old; its frozen outcome is `NO_FRESH_ENTRY_PRICE`.

`createEarlyRadarAlert` (`workers/pipeline/src/earlyRadarTracking.ts`) now re-reads the exact `metricId` and
`holderMetricId` that were used for scoring, inside the same transaction and advisory lock that deduplicates the call.
Nothing is published unless that evidence is present, has a usable positive price, is not in the future, and is recent:

| Evidence | Maximum age | Why |
|---|---|---|
| price/metric row | 15 minutes | same boundary the product already uses for "current" market data |
| holder snapshot | 60 minutes | holders are collected on a 30-minute reuse cycle; 60 minutes allows one refresh/retry window |

Both are operational starting values, not thresholds tuned on returns. A missing exact per-observation source is also
refused (`MARKET_UNVERIFIED`). Publication time is captured after lock acquisition rather than inherited from the job
start, so a slow run cannot publish under an older timestamp.

The gate only withholds a call. It does not relax or change any floor, weight or candidate rule, and it never backfills an
older call from later prices. Rejection reasons are typed: `MARKET_MISSING`, `MARKET_INVALID`, `MARKET_FUTURE`,
`MARKET_STALE`, `MARKET_UNVERIFIED`, `HOLDERS_MISSING`, `HOLDERS_INVALID`, `HOLDERS_FUTURE`, `HOLDERS_STALE`.

Both job summaries report `evidenceSkipped`, counted per reason. Only tokens under the $100K ceiling and not flagged
suspicious are counted, because only those are withheld radar calls; a quiet token that simply does not score is not a
skip. `MARKET_STALE` and `HOLDERS_MISSING` therefore describe an evidence gap, not a threshold decision.

## Safety gate: shadow first (2026-10-22)

The attention score and the safety verdict are separate. `createEarlyRadarAlert` now evaluates a frozen
`radar-safety-v2` snapshot (v1 is historical only) in the same transaction and advisory lock as the alert/outcome, using the exact market,
holder and risk rows behind the call plus the scoring caller's price-growth and manipulation facts. Missing critical
evidence is `UNKNOWN`; it is never converted to `PASS`, and a high score cannot override a blocker.

The default is `RADAR_SAFETY_MODE=shadow`:

- The alert and outcome are still written, but the body ends with `Safety evidence: PASS|UNKNOWN|BLOCK (...)`, and
  shadow calls are marked `Shadow mode: recorded, not enforced`.
- The full snapshot is stored at `SystemSetting` key `research.radarSafety.<alertId>`.
- `resolveTokens` / `scanSocialTokens` summaries count `safetyPass`, `safetyUnknown` and `safetyBlocked`.
- `npm run radar:status` prints the recent counts, latest verdict, common blockers/unknowns and enforced-block count.

`RADAR_SAFETY_MODE=enforce` withholds every non-`PASS` call. A blocked decision is stored, one per token/profile, at
`research.radarSafetyBlocked.<tokenId>.<profile>` so an empty feed remains diagnosable. `off` is for tests/debug only.
An invalid or missing value falls back to `shadow`; a typo cannot silently enforce or disable the gate.

| Critical check | PASS | BLOCK | Missing evidence |
|---|---|---|---|
| market row | positive price, <=15m old | — | `UNKNOWN` |
| holder row | holders + top-10 present, <=60m old | — | `UNKNOWN` |
| risk row | fresh <=60m, no active flag | honeypot, active mint/freeze authority | `UNKNOWN` |
| reported top-10 | `<35%` | `>=35%` | `UNKNOWN` |
| top-10 excluding known pool/locker accounts | `<35%` | `>=35%` | `UNKNOWN` |
| dev holding | trencher `<=10%`, holder `<=5%` | above the profile cap | `UNKNOWN` |
| LP control | locked/burned `>=80%` | unlocked or burn `<80%` | `UNKNOWN` |
| bundle + sniper + insider | `<=20%` combined | above 20% | `UNKNOWN` |
| organic/manipulation | risk `<60` | `>=60` | `UNKNOWN` |
| wash volume | turnover `<=30x` cap | high turnover with `<50` unique buyers | high turnover without unique buyers |
| tradeability | price impact `<=3%` | `>3%` | `UNKNOWN` |

Warnings do not block but remain in the snapshot: `AUTHORITY_NOT_PROVEN` (the risk row exposes active flags, not raw
authority booleans), `WASH_TURNOVER_HIGH`, `PRICE_ALREADY_EXTENDED`, `PRICE_ALREADY_EXTENDED_3H`, and
`DEPLOYER_HISTORY` when no history is available. A prior deployer rug is a blocker.

**What is still unknown.** RugCheck supplies top-10 excluding known pool/locker accounts, current creator holding, the
largest market's fungible LP locked/burned share when that market has supported evidence, and explicit `RUGGED`/honeypot/mint/freeze facts. It does **not** supply
bundle, sniper or insider supply, unique buyers, or deployer rug history; those checks stay `UNKNOWN`. Small-ticket
price impact comes from a separate Jupiter quote (below). Even with both sources the gate cannot produce a `PASS`
unless every remaining critical fact is present. That is the honest state, not a false negative to be tuned away.

**Bounded evidence enrichment (2026-10-22).** `makeRadarSafetySource` calls the public RugCheck report endpoint only for
candidates that already clear the early-lane screen. It is off with `RADAR_SAFETY_EVIDENCE=off`, otherwise it performs at
most three lookups per resolution/social run (`RADAR_SAFETY_EVIDENCE_MAX_PER_RUN`), caches each mapped result for ten
minutes, times out after six seconds, and turns every failure, malformed body or stale cache into `UNKNOWN`. It never
uses the heuristic RugCheck score as a safety verdict. The mapped facts are passed to the alert transaction so the
frozen snapshot records the exact values used. Both the full pipeline and dedicated market worker inject this source.
The existing attention score and its inputs are preserved; enrichment feeds only the separate safety gate. These are
additional safety calls, capped separately from the unchanged 150 price-token/18 info-call market budgets (up to three
narrative and three social requests per combined cycle; fresh shared cache hits do not spend requests).

**Tradeability evidence (2026-10-23).** `makeTradeabilitySource` asks Jupiter for one live quote buying exactly $50 of
USDC into the candidate mint. The quoted `priceImpactPct` becomes the `TRADEABILITY` fact; the quote timestamp is frozen
as `tradeabilityAt`, separate from the RugCheck provenance. It is capped at three quotes per resolution/social run
(`RADAR_TRADEABILITY_MAX_PER_RUN`), cached per mint for ten minutes, spaced 500 ms apart and abandoned after six seconds
(`RADAR_TRADEABILITY_EVIDENCE=off` disables it). A failed, malformed, mismatched or stale quote stays `UNKNOWN`; a
liquidity-derived estimate is never substituted. This is executability evidence for one small ticket, not a price
prediction, a fill guarantee or a safety verdict. Live check on a $35K-liquidity token recorded a 2.40% impact for $50
and reused the cached value exactly.

**Quote provenance and publication freshness (2026-10-23).** A `TRADEABILITY` check may pass only with a complete,
validated quote record frozen alongside the impact: version, mint, `BUY` direction, the literal 50,000,000 USDC
base-unit input, positive output and minimum output, 50 bps slippage, a non-empty route, the provider timestamp and
`ticketUsdc: 50`. The mint, impact and timestamp must all match the other frozen facts. Freshness (<=10 minutes, not
in the future) is checked again at publication, including after the alert lock is acquired, so a quote that ages out
while waiting cannot pass. Older impact-only cache entries and mismatched or malformed responses produce no evidence
at all rather than a partial record. The six-second Jupiter deadline now also covers reading the response body, so a
stalled stream cannot hang a collector cycle. Historical `radar-safety-v1` snapshots keep their original verdict and
are read without rescoring; a v1 `PASS` without quote provenance simply ages out as stale evidence.

Reports and cache entries must match the requested mint. Concurrent requests for the same mint share one lookup.
Invalid percentages, mismatched reports, future cache times and missing dominant-pool evidence cannot supply a safe
value. A small locked pool cannot substitute for a larger pool with unknown lock status. The source retrieval timestamp
is checked again inside the publication transaction. It is **retrieval time**, not a proven on-chain observation time:
RugCheck can cache its own reports, and `detectedAt` is first detection, not freshness. Creator balance only covers the
named creator wallet; it does not establish related-wallet or insider exposure.

RugCheck's top-holders list includes liquidity-pool token accounts. The adapter removes owners classified as `AMM` or
`LOCKER` and any market/liquidity account before summing the ten largest remaining holders. Live checks on three
October tokens show why this matters: the later RugCheck reports included a single pool account holding about **61%**,
**70%** and **94%**, while the pool-excluded top-ten sums were about **22%**, **22%** and **2%**. These are later observations,
not reconstructed entry-time evidence or a validated comparison with Gecko's holder metric. The reported concentration
gate remains independent: a lower ex-pool sum does not override its blocker. Neither figure establishes wallet-cluster
concentration. Aircoin and KIMCHI had already experienced losses exceeding 60% despite these later reports showing
locked LP and zero creator balance. That does not establish the cause of the losses or prove what was knowable at entry.
Structural checks alone do not demonstrate protection against price collapses.

**What the 35% cap is based on.** In the 25-token, seven-day forensic cut, all ten calls with reported top-10 `>=35%`
had negative 24h outcomes, while all four winners were `<=34.9%`. That is a small in-sample observation, not a
validated predictive rule. `35%` is a conservative starting value; do not tune weights on this cohort. Likewise, a
risk score of 0 is not safety: it only means no known flag fired.

Shadow mode changes no publication, scoring, liquidity, holder or Telegram rule. It makes the missing evidence visible
and gives a prospective record for deciding whether enforcement removes tail losses without removing the rare winners.
Do not describe a shadow call as approved, safe or a recommendation to buy.

### Prospective signal-quality work

The seven-day cohort has not demonstrated a durable edge. Improving research requires three separate measurements:

1. **Structural hazards:** collect source-bound LP control, creator/related-wallet exposure and executable liquidity
   evidence. Missing vectors remain unknown. Review source disagreement explicitly rather than choosing the safer value.
2. **Demand and timing:** record independent buyer/seller activity, net flows, liquidity changes, holder growth and
   attention decay at the call time. Holder totals and raw social volume do not establish independent demand. Price
   extension currently remains a warning, not a validated prediction of a dump.
3. **Forward outcomes:** freeze the policy before collecting the next cohort. Compare admitted and withheld candidates
   prospectively, with token-level independence, missing-price rates and collection outages reported alongside returns.
   Report median returns, severe-loss incidence, maximum adverse/favorable excursion and executable cost assumptions.
   Keep any time/decay/exit experiment as offline research with fees, slippage and failed-exit treatment. A sampled peak
   is not an achievable fill. The 30-event threshold is a minimum reporting gate, not proof of statistical significance.

Complete the remaining evidence sources and restore reliable collection before deciding enforcement. Do not optimize
thresholds or select an exit rule on the same 25-token forensic sample and then call that a demonstrated edge.

### Collection pacing and candidate price top-up (2026-10-21)

The gate exposed two collection problems that the old limits hid:

- **GeckoTerminal throttles bursts, not just totals.** Seven consecutive market runs wrote exactly four holder rows and
  then returned one HTTP 429. A probe at 12-second spacing sustained 11/11 successes after the first throttled call, so
  the documented 30/min figure did not describe a rapid burst. `GECKO_MIN_INTERVAL_MS` is now **15 s** and the per-run
  info cap is **18**, which keeps one refresh near 4.5 minutes. Verified cycles write 14–18 holder rows with no 429.
  The 150-token price budget, the 30-minute holder reuse and every publication gate are unchanged.
- **The rotating price set cannot keep every candidate inside 15 minutes.** A candidate mentioned in social chatter may
  not be in the market job's 150-token selection, so its stored price is often 20–40 minutes old and the gate withheld it
  even when the token was a real candidate. `scanSocialTokens` now refreshes the exact quote for resolved candidates whose
  latest price is older than the gate, bounded to 60 per scan and using the same DexScreener source and
  `storeMarketSnapshot` provenance. Live effect: `MARKET_STALE` fell **49 → 2** and evaluated social candidates rose
  from **0 to 20**; `metricsWritten` was 27–32. This is a bounded evaluation top-up, not an increase to the market job's
  price budget, and it cannot publish anything by itself.

The remaining holder gap is **selection**, not provider silence. Of 46 linked-and-mentioned tokens with no holder row,
43 had never had a risk row, so Gecko had not been asked; the paced info loop only sees the market job's current
150-token set. The next bounded step is to feed recently evaluated social candidate ids into that loop's priority, inside
the same 18-call budget, rather than raising the Gecko rate.

## Social token discovery (finds tokens from chatter, not from narrative names)

The narrative route only finds a token whose name shares words with a narrative. Memecoins mostly spread by `$TICKER` or
contract address, so a second route reads those directly.

1. **Extraction** (`packages/narrative/src/entities.ts`, called inside `ingestNarratives`). While a post is in memory it is
   scanned for Solana mint addresses (base58 that decodes to exactly 32 bytes) and `$CASHTAGS`. Majors (SOL, USDC, BTC...)
   are ignored. A post naming more than 5 tokens is a list or spam and contributes nothing. Only the extracted reference plus
   the usual hashes are stored in `TokenMention` (migration `0014_token_social_mentions`). **Raw text is still never stored.**
2. **Scan** (`workers/pipeline/src/socialTokens.ts`, `scanSocialTokens`). Runs at the end of the token-resolution job in
   `dev:workers` (no new queue). It keeps references named by at least 3 distinct accounts and 4 posts in 48 h
   (`SOCIAL_RULES`), then resolves them:
   - a **mint** matching a known token resolves directly. An unknown mint becomes a `Token` row only if DexScreener confirms it
     trades and its market cap is under $100K, at most 10 per run (a pool address or fresh spam mint is left alone). The row has
     no price yet; the market-data job fills it, and the next scan evaluates it.
   - a **$TICKER** resolves only when exactly one known token with a recent price carries that symbol. Zero or several matches are
     skipped and counted as `cashtagsAmbiguous`. A ticker-only match is flagged `TICKER_MATCH_ONLY` and capped at 60 because
     anyone can launch a copycat with the same symbol.
3. **Scoring.** The chatter about one token is scored with the same `computeNarrativeMetrics` used for narratives, so it gets
   velocity, a stage, and the copy-paste / burst / new-account manipulation check. Then `evaluateEarlyBoth` runs with
   `relation: 'UNKNOWN'` (flag `ORIGIN_UNVERIFIED`, holder capped at 65) and writes the same `EARLY_RADAR_*` alerts, deduplicated
   per token per profile per 6 hours across both routes. Titles say "from social buzz".
4. `TokenMention` rows older than 7 days are pruned by the scan.

Run `dev:narratives` (or the pipeline's narrative job) to collect, `dev:market` for prices/holders/risk, and `dev:workers` for the
scan. The scan needs the market data to exist; without it nothing is evaluated (fail closed).

To collect more mints and tickers use `TREG_NARRATIVE_PACKS='trencher,chatter'`. The chatter topics also appear as narratives in the Radar.

Limits: search is sampled, and a coordinated shill still looks like several accounts (the organic check catches copy-paste and
bursts, not paid accounts with varied text). Creator account age is unknown from Treg, so the new-account check is inactive.
Thresholds in `SOCIAL_RULES` are unvalidated starting values.

## Outcome tracking (implemented October 16)

`EarlyRadarOutcome` freezes profile, score tier (`WATCH`/`STRONG`), discovery route (`NARRATIVE`/`SOCIAL`), match kind (`NAME`/`MINT`/`TICKER_ONLY`), score, entry metric ID, time, price and valuation with every new early alert. Valuation basis/source remain null unless exact metric-ID provenance exists. `createEarlyRadarAlert` creates the alert/snapshot/three measurement rows atomically and serializes token/profile creation across both discovery routes for the six-hour dedupe window.

`EarlyRadarMeasurement` records target/observed time, metric ID, price, market cap/FDV basis and gross return at **1h, 24h and 7d**. Entry must be at/before alert time and within 15 minutes. Horizons use the first positive stored price at/after target, no more than 30 minutes late and never beyond the evaluation clock. Missing/invalid prices remain null; missing market cap is independent of price. No fill/PnL is inferred.

`trackEarlyRadarOutcomes` runs in the existing outcome-tracking job, up to 200 due measurements per run, pending rechecks every five minutes. Missing observations remain PENDING while the window is open, then UNKNOWN. Known horizon readings with missing entry retain price/cap but no return. Terminal results, including UNKNOWN, are immutable: later backfills cannot silently select winners. Up to 50 legacy alerts are registered per run with UNKNOWN attribution/tier and `LEGACY_NO_SNAPSHOT`, without parsing prose or borrowing today's price.

Run **`npm run early-radar:report -- --from <ISO> --to <ISO>`** for a read-only cohort report (default last 30 days). Each profile/tier/route/match-kind group includes all three horizons, raw/independent/overlap-excluded counts, known/pending/unknown counts, unknown rate, return statistics and existing evidence gates. Same-token overlaps are removed before missing outcomes are filtered, using the respective horizon. Gates require 30 independent known events across 15 tokens; below that reports explicitly say INSUFFICIENT DATA. Passing a gate does not establish predictive power. Reads are capped at 5,000 rows; truncation is disclosed and suppresses sufficiency. Cohorts can share tokens and are not independent experiments.

Migration `0015_early_radar_outcomes` was generated with Prisma migrate dev and verified on isolated services. As of 2026-10-17 it **is applied to the application database** `narra_ent` (confirmed in `_prisma_migrations`; both `EarlyRadarOutcome` and `EarlyRadarMeasurement` exist). Keep market ingestion active throughout the seven-day window; the outcome job reads stored observations, with no candle backfill or live fetch. Genuine long-window performance remains unverified.

### Refresh priority for open measurements (2026-10-17)

The market-data job refreshes at most 150 tokens a run, taking ids in order, and its own comment warned the tail can starve.
New tokens have the highest ids, so once more than 150 tokens were active the newest early-radar tokens could miss their
refresh, drop out of the 24 h "recently priced" window, and end with UNKNOWN 24h and 7d outcomes. `refreshMarketData` now
refreshes tokens that still have a `PENDING` `EarlyRadarMeasurement` first (nearest-due first, at most
`maxEarlyRadarTokensPerRun` = 100 of the 150, so they cannot crowd out everything else). Check coverage with
`early-radar:report`: a high unknown rate on 24h/7d means this or the market job itself is still missing readings.

## Current verification

Full actual results, original failures/fixes, isolated-service details, live call receipts and per-token account counts: [EARLY_RADAR_VERIFICATION_2026-10-16.md](EARLY_RADAR_VERIFICATION_2026-10-16.md).

- Installed versions per owner: PostgreSQL 17.2 and Memurai Redis API 8.2.10, separate test/shadow databases and Redis process.
- All migrations applied to the test DB; generated Prisma client and schema diff passed (`-- This is an empty migration.`).
- Final full suite: **1,189 tests passed, zero failed/skipped/todo, all 93 files passed**. Full repository/web typecheck passed. All four social-token integration tests ran; their scoring fixture needed no change.
- One approved live preview: 22 accepted posts, nine mints/nine cashtags, seven usable market quotes, three reported caps below $100K. Cost **$0.00155**, no import, no raw text persisted, no threshold/cost/topic increase.
- Outcome tests used synthetic observations with real isolated services. There is no live performance conclusion yet.

## Original sandbox verification (historical, superseded above)

Honest status. The sandbox this was built in had no `node_modules`, no Postgres and no network.

- **Ran and passed** through a minimal stand-in test runner (not vitest): 12 early-radar, 7 topic-pack, 8 extraction / buzz-grouping tests.
- **Strict `tsc`** (no errors) on `entities.ts`, `tokenBuzz.ts`, `topicPacks.ts`, `earlyRadar.ts` and their tests.
- **Syntax-parsed only**, not typechecked or run: `socialTokens.ts`, `tokenResolution.ts`, `narrativeIngestion.ts`, `main.ts`,
  `narrativesMain.ts`, `tregConfig.ts`, and the new tests in `treg.test.ts` (needs zod).
- **Written but never run:** `socialTokens.integration.test.ts` (needs Postgres; its first assertion relies on a hand-computed score of
  about 66 against a 55 threshold, so a failure there may be the test's arithmetic, not the code).
- **Hand-written migration** `0014_token_social_mentions`: verify with the `prisma migrate diff` command in CLAUDE.md, then run
  `prisma generate`. Until generated, `db.tokenMention` does not typecheck.
- **No live Treg, DexScreener or GeckoTerminal call was made.** Whether real posts yield enough mints is unknown.
- Run the integration tests against a **separate** test database, never the application database (see CLAUDE.md).

## Next

1. Deploy the generated outcome migration and collect genuine alert cohorts through seven days. Inspect missingness and sample sizes before considering any threshold changes; outcome tracking itself is now implemented and tested.
2. Safety data for small tokens: RugCheck now fills top-10 excluding pool/locker, dev holding and LP lock; Jupiter fills small-ticket price impact. Still needed are bundled/sniper/insider supply, unique buyers and deployer rug history. The `radar-safety-v2` gate and shadow snapshots are implemented; until those facts exist, calls remain explicitly `UNKNOWN` and no source is invented.
3. Holder history series and DexScreener buy/sell counts. Smart-money overlay for small tokens.
4. Pre-graduation pump.fun tokens (needs another source; today only tokens with a pool are visible).
5. An Early Radar screen in `apps/web` (filters, score breakdown, flags, why-excluded).
# Research coverage and discovery reliability

Added 2026-10-21. The social scan can identify a small token and then skip it for missing holders, while the market worker's general selection never reaches it. It now records a scheduling handoff **before** that evidence rejection. This does not bypass scoring or publish anything.

- Up to 200 IDs from qualified social buzz with a recorded, non-future small-token market cap; no guessed ticker resolution. `holderPriorityOmitted` reports truncation. The latest successful scan replaces the snapshot; an empty scan clears it. TTL: 60 minutes. A failed scan leaves its previous hint to expire.
- Up to 12 of the remaining 150 market price slots; up to 6 of the 18 info calls, no more than half the info budget. Unused slots go to existing groups. Outcome/discovery price reservations stay ahead of social hints. Price and info cursors rotate independently; missing data stays missing, non-throttle failures advance, throttling stops the relevant loop without advancing that batch's cursor. Blacklisted tokens are excluded. Info reuse remains 30 minutes and provider pacing stays 15 seconds.
- Internal `maxTokens` overrides used by isolated tests remain available; production entrypoints use the unchanged fixed defaults. Hints do not create tracked wallets, approvals, alerts or opportunities. Existing scoring and publication logic alone decides those outputs.

## Operational evidence

`research.coverage.run.<market|social|narrative>.latest` and `.day.YYYY-MM-DD` retain counters in SystemSetting. Daily updates use a transaction/advisory lock; eight UTC days are retained. They sum completed scan attempts and may count the same token repeatedly. Rejection counts include preflight and publication failures, not guaranteed missed alerts. Whole failed runs are not included; use worker diagnostics and stale timestamps to detect gaps. Provider error text is not stored in these records.

Admin Data Health reads at most 2,000 non-blacklisted tokens linked to active narratives or in the recent social handoff. Coverage is explicitly capped and does not represent the entire chain. Price freshness requires an exact `research.marketMetric.<id>` DexScreener receipt matching the row timestamp; holder/risk freshness uses their recorded timestamps. Windows remain 15/60/60 minutes. Missing, future-dated, stale and unverified are distinguished. A fresh risk row is **not** proof of safety. No diagnostics is UNKNOWN, never a healthy zero.

## Daily review

```text
npm run radar:daily
npm run radar:daily -- --json --no-save
npm run radar:scorecard -- --days 7
npm run radar:status -- --json
```

Load the appropriate process environment explicitly. Daily reports save under `reports/` unless `--no-save` is used. They combine the existing frozen-entry return cohort with a **separately timestamped current** coverage snapshot. UTC-day run counters and trailing-24h publication counts have different windows, stated in the output. Do not interpret them as an attributed conversion rate, backfilled history or evidence of profitability. Pending/UNKNOWN horizons retain their existing behavior.

After deployment, compare missing holders, fresh price+holder pairs, rejected evidence and real publications across successive cycles. Score changes or expanded provider budgets require separate evidence; this handoff is not permission to relax any gate. Local tests use fixture providers and an isolated database, so they do not establish improved live coverage.
