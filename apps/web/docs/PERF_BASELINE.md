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
