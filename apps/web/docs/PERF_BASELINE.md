# Production performance evidence

## Method

Windows, Node 24, Chrome shipped with Playwright; Lighthouse mobile defaults, sequential runs, local warmed production server on 4010 and a local availability fixture on 4000. **Five runs per page**, median per metric (not the most favorable run). Privy app ID is blank, matching the accepted Phase-1 benchmark. Real configured Privy/provider costs are not measured by these runs. No builds, browser suites or Lighthouse overlap. Env-free Next wrapper used throughout.

Baseline is the accepted Phase-1 production bundle (the Step-0 scanner verified it contained no fixture auth). Step-1 runs one new production build after safe changes. Raw baseline JSON/HTML: `C:\Users\gifar\AppData\Local\Temp\opencode\narra-design-baseline`. Portable summaries are in this directory's `perf/` subdirectory.

| Stage / route | Median performance | Median LCP | Median CLS | Median TBT | Script transfer |
|---|---:|---:|---:|---:|---:|
| Baseline `/` | 74 | 3,403 ms | 0.000075 | 690 ms | 203,693 B |
| Baseline `/early-access` | 83 | 3,248 ms | 0.019535 | 401 ms | 240,821 B |
| Step-1 fixes `/` | **85** | **2,982 ms** | **0.000075** | **399 ms** | **163,638 B** |
| Step-1 fixes `/early-access` | **88** | **2,665 ms** | **0.009492** | **377.5 ms** | **200,766 B** |
| Final design `/` | **79** | **3,322 ms** | **0.064276** | **504 ms** | **169,959 B** |
| Final design `/early-access` | **77** | **3,646 ms** | **0.005517** | **456 ms** | **206,717 B** |

Accepted Phase-1 single-run 74/80 was not a median. The fresh median is 74/83; this variation is not an improvement attributable to a change.

## Diagnosis with evidence

1. **LCP is text, not an image.** Both reports identify H1 (`.hero-copy > h1` / `.access-heading > h1`). Representative baseline run 3 observed render delays 601/197 ms after TTFB 57/27 ms; simulated mobile LCP medians above include throttling. No oversized raster LCP exists to compress.
2. **Hydration and shared JS.** Shared chunks `87c73c54` and `18` transfer 54,949 + 47,178 B (173,023 + 174,011 decoded). Representative landing scripting: 336.9 + 477.9 ms. Landing `6959` transfers 41,126 B (125,055 decoded), including animation machinery used by Reveal; removing the sole motion/react import avoids this eager dependency. Other initial chunks: `5741` 12,620 B, `2897` 8,973 B, `634` 5,411 B, `3397` 19,342 B, webpack 4,745 B, main-app 1,065 B, marketing page 2,483 B, layout 2,938 B, error 1,406 B. These are network transfer sizes, including response overhead, not identical to Next's gzip estimate.
3. **Cheap canvas, expensive ongoing work.** Initial constellation chunk `4257` is only 1,457 B transferred (1,686 decoded) but accounts for ~1,366 ms total CPU / 635 ms scripting in representative landing run 3. It computes style/geometry and pair distances each frame. Byte size alone misses this cost. Step 1 schedules non-critical canvas loading after paint/idle. The design replacement will cache geometry/style and pause offscreen/hidden-tab work.
4. **Fonts.** Existing fonts already use the Latin subset needed by EN/ID and `display: swap`. Baseline landing loads six WOFF2 files totaling 77,481 B transferred: 16,104 / 9,847 / 16,280 / 9,751 / 16,088 / 9,411 B. No font-display audit savings are reported. Step 1 removes two 500-weight preloads, retaining 400/600 body and 600/700 heading. The design's mono/serif must be scoped/minimal and measured later; no remote font requests at runtime.
5. **Render blocking.** One stylesheet: 7,354 B transferred / 28,244 decoded; Lighthouse attributes ~161/164 ms blocking in representative landing/access run 3. It includes critical above-fold layout; deferring the whole sheet would cause unstyled content and CLS. No speculative CSS removal was used.
6. **Privy/third parties.** No Privy network load occurs in the unconfigured benchmark; it cannot explain these scores. AuthBoundary already dynamically imports the provider only on access routes with an app ID. Deferring initialization until sign-in would change restored-session/readiness behavior, prohibited here. No auth, token or wallet-flow code changed. Real configured costs remain unverified.
7. **Cross-route prefetch.** Access's network includes the landing page/animation chunks despite not rendering the hero, plus access chunks `388` 25,658 B / 96,074 decoded, `311` 5,804 B / 12,943 decoded, access page 7,123 B / 18,150 decoded. Header Link prefetch is a avoidable contributor; the D4 navigation rewrite will turn speculative prefetch off. Prefetch must not be confused with loaded Privy.
8. **Below fold.** Sample preview is already dynamic and IntersectionObserver-gated at 200 px. Static sections are server-rendered. Keep their content available for accessibility/SEO; replace Reveal's eager motion runtime with a tiny native observer/transform-opacity animation. No content is initially hidden.

## Step-1 safe changes

- Native observer/Web Animations Reveal replaces eager motion/react. Reduced-motion bypass; static children always visible.
- Canvas scheduled after paint/idle; preview remains viewport-lazy.
- Four Latin font files rather than six eager weights; no remote runtime assets.
- No FSM, API, proof/signature, authentication or backend changes.

The safe pre-design fixes improve median scores **74 → 85 / 83 → 88**, while reducing script transfer by **40,055 B on each route**. LCP remains above 2.5 s and performance below 90; these are not claimed as budget passes. The observer/canvas scheduling and fonts were measured as a batch, not isolated A/B experiments. Raw after-fix results: `C:\Users\gifar\AppData\Local\Temp\opencode\narra-design-step1`; summaries and representative per-resource evidence are committed in `docs/perf/`. Final-design measurements follow after D1–D6.

Step-1 build passed and scanned **266 production files** clean. Next First Load JS: landing **152 kB** (previous **192 kB**, −40 kB); early-access **186 kB** unchanged. The preview remains a separate lazy chunk. Existing optional Farcaster and next-intl webpack-cache warnings persist; neither is a new runtime integration claim.

## Final design: measured tradeoffs and budget misses

Raw final JSON/HTML: `C:\Users\gifar\AppData\Local\Temp\opencode\narra-design-final`. All ten run summaries: [perf/final.json](perf/final.json); representative run 3 resources/LCP/render-blocking/execution: [perf/final-evidence.json](perf/final-evidence.json); production lazy-chunk sizes: [perf/final-chunks.json](perf/final-chunks.json). These are the first complete final five-run results, with no reruns selected to improve the score. Per-metric medians need not belong to the same run. Performance ranges were 73–88 landing and 73–85 access.

**Targets:** CLS <0.1 passes on both routes. Landing initial JS ≈≤200 kB gzip passes (Next First Load JS **153 kB**; access **187 kB**, shared **105 kB**). Both **LCP <2.5 s and mobile performance ≥90 fail**. Automated accessibility and best-practices scores are 100 in every final run; axe has zero remaining violations across the full state matrix and production route/theme checks. This is automated AA-oriented evidence, not a complete manual conformance claim.

Relative to accepted baseline, final landing is +5 performance points, −81 ms LCP, −186 ms TBT and −33,734 B script transfer. Access is −6 points, +397 ms LCP, +55 ms TBT and −34,104 B script transfer. Relative to Step 1, the reference-led design regresses **85 → 79 / 88 → 77**, adds **6,321 / 5,951 B** script transfer, and increases LCP by **340 / 981 ms**. Do not report the Step-1 improvement as the final result.

### Remaining contributors

- **Text remains LCP.** Final reports identify the landing and access H1. Representative run 3 observed TTFB/render delay is 36/1,185 ms landing and 28/196 ms access; these observed trace values are distinct from Lighthouse's simulated mobile LCP. Access run 3 has 2,503 ms simulated LCP, whereas its five-run median is 3,646 ms, so it cannot stand in for the median.
- **Shared hydration remains material.** Unchanged shared chunks `18` and `87c73c54` still transfer 47,178 + 54,949 B. Representative scripting totals for those two are 924 ms landing and 800 ms access. These are attribution evidence, not an isolated estimate of the design's own cost.
- **More critical CSS.** Landing now transfers two stylesheets totaling **11,308 B**; access three totaling **13,892 B**. Individual blocking durations are approximately 158/308 ms landing and 160/310/310 ms access (overlapping, not additive). The additional sheets contain reference typography, grid/glow/card structure, responsive rules and polish together. No causal claim isolates D5 from D3/D4.
- **Font tradeoff.** Landing loads five local WOFF2 files totaling **73,642 B**; access four totaling **63,647 B** in run 3. JetBrains Mono costs 21,660 B transferred, and access-only Instrument Serif costs 16,132 B. Both use swap and preload off, but visible use still triggers downloading. Landing CLS is attributed to its headline; access traces identify headline font swaps and the availability chip. A precise causal split for landing's 0.064276 CLS was not isolated. There is no remote runtime font request or oversized image LCP.
- **Canvas cost persists despite tiny bytes.** Original geometry chunk `4257` costs **1,434 B gzip / 3,023 B raw** (1,977 B transferred). Representative CPU is 929 ms total / 411 ms scripting, versus baseline canvas 1,366/635 ms. It remains lazy, cached, ~30 fps and visibility/reduced-motion guarded, but is not free. Required rotating geometry was retained; no additional particle engine, continuous rank simulation or motion runtime was added.
- **D5 is small but not claimed free.** Lazy enhancements `185`: **837 B gzip / 1,773 B raw** (1,380 B transferred). Below-fold sample preview `7904`: **1,237 B gzip / 3,014 B raw**; it is absent from initial audit requests. Reveal, poster, menu and loader are included in route/shared bytes. No per-effect benchmark isolates their CPU cost, so aggregate regression cannot honestly be attributed only to enhancements or only to machine variability.
- **Access still includes landing route chunks** in the observed request list despite disabling header/hero prefetch. The change did not fully eliminate cross-route loading; no further saving is claimed. Privy is blank and no provider network load explains these results. A configured provider remains unmeasured.

Final production build passes lint/types and scans **268 files** clean for fixture markers. Six production CSP/console/axe/admission checks pass. Separate from the performance target, Lighthouse reports SEO 91 landing / 54 access: missing meta descriptions on both and intentional access noindex. No SEO completion claim is made.
