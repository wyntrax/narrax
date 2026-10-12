# Narra Phase 1 — unified marketing design specification

Source images opened at native resolution before design: `design/reference/early-access-design.png` (1011 × 735), `landing-page-design.png` (963 × 717). Reference files are read-only. Labels: **R** = from reference, **I** = inferred for responsive/useful product implementation, **E** = enhancement. Status describes the planned implementation; final review records any differences.

## One-page visual language

**One system, two compositions.** Narra is an evidence-first research tool. Near-black canvas, cool ice/cyan atmosphere, a restrained lime action, hairline geometry, and generous negative space connect both pages. Access is the quiet, centered destination; landing is the broad, grid-based introduction. The same logo, nav label font, glass surface, button, line weight, focus ring, spacing rhythm and theme tokens appear on both.

- **I** Grid: 8 px rhythm; 24 px desktop gutters, 32 px tablet, 16–24 px mobile. Maximum marketing width 1280 px. Hero/access heading centered. At 1440, landing flanks use 240 px columns around a flexible 480–640 px graphic. At 834, a two-column lower flank; at 390, stack with headline before artwork and actions. No fixed device frame.
- **R/I** Type: large confident landing uppercase heading, lighter access heading with one serif-italic emphasis. Body Barlow 400/600; display Rajdhani 600/700; **Instrument Serif italic 400** for “crowd” (ID: “ramai”); **JetBrains Mono 400** for nav, labels/meta. Latin subset only, `next/font/google`, self-hosted at runtime. Meaningful small text ≥14 px; body 16–18 px; access heading ~48–80 px; landing heading responsive ~36–100 px, 2–3 lines. Balanced headings, tabular numbers.
- **I** Color mapping: background `--bg` #08090B; surfaces `--s1` #0D0F12 / `--s2` #12151A; text `--tx` #F5F7FA and `--tx2` #A4A9B3; primary action/highlight #B8FF4F (`--ac`), ice #78E8FF (`--ac2`). Fine structural border uses `--bd`, meaningful controls use stronger borders. In light mode background #F6F7F9, surface white, text #0E1116 / #4A505B, dark lime/cyan tokens retain contrast; lime-filled primary still has dark ink. No gold/yellow template identity. Only the decorative bottom NARRA wordmark/barcode may have sub-AA contrast.
- **R/I** Geometry: marketing card radius 20 px, compact glass bar 16 px, pills fully rounded; 1 px hairlines; cool radial bloom behind content, never an opaque overlay. App scope keeps **6 px**, dense, **no glow** tokens. No design rules target `.product`.
- **E** Motion: transform/opacity only; visible static content before enhancement loads; offscreen/hidden-tab canvas suspension; no pointer parallax on coarse pointers; reduced-motion static SVG, no movement required to interpret any state. Intentional cyan focus rings. Buttons and links remain real keyboard controls.

## Reference A: access

**R** Full dark viewport, centered compact vertical stack at x≈505. Badge y≈224, two-line heading y≈255–333, two-line body y≈360–387, horizontal form y≈405–438. Glow rises from a planet horizon around y≈532, black foreground below. Sparse fine star dots occupy the glow; no navigation/footer in source. Content spans ~280–340 px while the atmosphere fills the viewport.

| Visible element / every source string | Status | Implementation and reason |
|---|---|---|
| Dark uninterrupted background | Reproduced (R) | Narra near-black, light variant inferred |
| Cool centered radial gradient/bloom | Adapted (R/I) | Narra cyan/ice, CSS gradients, no raster |
| Fine scattered star dots | Reproduced (R) | Few deterministic SVG circles; decorative |
| Lower spherical horizon + thin white rim | Reproduced (R) | CSS ellipse, cyan rim, soft bloom; reserved bottom space |
| Rounded “Waitlister AI STOCK” badge | Adapted (R/I) | “EARLY ACCESS” / “AKSES AWAL”; template brand omitted |
| “The wait is part of the journey.”, italic “journey.” | Adapted (R/I) | Approved Narra headline, only “crowd” italic; ID emphasis “ramai” |
| “Drive interest, collect emails, and build momentum ahead of your launch.” | Omitted (R) | Approved Narra subcopy, no newsletter proposition |
| “Your email address” input | Omitted (R) | Current 18-state access view in glass card; no email field |
| “Get Notified” button | Adapted (R/I) | “Continue” Privy sign-in; subsequent actions remain current wallet flow |
| Compact translucent form border | Adapted (R/I) | Common status-card anatomy, larger to fit actual proof and controls |
| No header/footer | Adapted (I) | Required Narra logo, locale/theme controls, approved safety lines |

**I** Layout reserves common status-card space for all 18 states. Proof text remains exact and scrollable inside its own region; no CSS truncation of signing bytes. The atmosphere stays behind the content and footer even on short/mobile viewports. Stepper is compact: `1 Sign in`, `2 Verify wallet`, `3 Join`. All buttons, confirmations, expiration/error text, availability and tier data remain functional. Skeletons occupy the same anatomy. No timers or wallet actions move into presentation code.

## Reference B: landing

**R** Ignore the outer light-gray device frame. Inside, a near-black rounded canvas with a square grid. Header at top: logo left, small bracketed navigation right. Huge one-line uppercase heading occupies nearly the whole width. A central golden wireframe human head and orbiting forms is flanked by two small text blocks/buttons. Bottom strip carries a geometric logo left and low-contrast two-line brand/barcode right. The source contains only a hero, not the required below-fold product sections.

| Visible element / every source string | Status | Implementation and reason |
|---|---|---|
| Outer light-gray frame + cast shadow | Omitted (R) | Explicit owner rule; full web canvas |
| Interior square hairline grid | Reproduced (R) | CSS grid with radial mask; decorative |
| Geometric logo + “ARK” | Omitted (R) | Original Narra mark and NARRA wordmark |
| `[Home] [Civilization] [Engine] [Consensus] [DAO] [ARKLand] [Go to DApp]` | Adapted (R/I) | `[Home] [How it works] [Product] [Tiers] [FAQ]` + distinct Early access action; real anchors; mobile dialog |
| “CODE THE FUTURE” | Omitted (R) | Approved headline, uppercase via CSS; 2–3 lines at 1440/390 |
| Left: “At ARK DEFAI, the future isn’t controlled by human governance — it evolves through algorithmic models and collective consensus.” | Omitted (R) | Narra approved research/context statement; no governance claims |
| Right: “ARK doesn’t dictate the future; it unlocks it, shifting governance to AI algorithms, trust to open-source code, and decision-making power back to every user.” | Omitted (R) | Approved Narra subcopy/safety statement + access action |
| Two “Join on” buttons + X/Telegram symbols | Adapted (R/I) | Secondary research link / primary access button. Additional social links only with validated configured URLs |
| Golden human head mesh, face, original orbiting artwork | Omitted (R) | Original software-projected geometric node globe/polyhedron; no face/photo/copied asset |
| Orbit rings and small floating glowing geometry | Adapted (R/I) | Original lime/cyan rings and polyhedra, lazy canvas; reduced-motion SVG |
| Low-contrast logo left | Adapted (R/I) | Original Narra mark in decorative bottom signature |
| “ARK”, barcode, “CIVILIZATION” bottom wordmark | Adapted (R/I) | Muted NARRA + CSS barcode pattern, aria-hidden; no template name |
| No lower content | Adapted (I) | Retain how, Sample data preview, shared-policy tiers, trust, FAQ, final CTA and two-line safety footer |

**I** Section order: header → hero headline → original artwork with flank statements/actions → decorative brand signature → how it works → Sample data interactive preview → tiers → trust → FAQ → final CTA → footer. Cards, grid, mono labels and cool atmospheric treatment continue through the entire page. No invented stats/counters, performance claims, testimonials, customer logos, prices or unsupported features. Existing illustrative scores/charts retain explicit “Sample data” / “Data contoh”; requirements remain placeholders, eligibility remains shared policy.

## Component and interaction inventory

**R/I** Header / original brand; bracketed anchor nav; locale and theme controls; access CTA; mobile Radix dialog with focus trap/return; access badge; heading/subcopy; stepper; shared 18-state glass card; signed-out Continue action; proof scroll region; wallet list and current action controls; confirmation dialogs; error/empty illustrations; availability chip; safety footer. Landing adds generative canvas/SVG, social links, decorative barcode, section labels, how cards, lazy sample tabs/ranking/chart, policy tier cards, trust rows, FAQ accordion and final CTA.

**E** Step check morph + polite announcements, transform/opacity state intro/success, fine-pointer CTA magnet/card spotlight, hero intro/parallax, once-only scroll reveals, skeleton shimmer, keyboard sample tabs/crosshair, theme crossfade. Drop or simplify an enhancement if it causes LCP/CLS/JS regressions; measured outcomes belong in PERF_BASELINE and final review.

## Conflicts and decisions

1. **Prototype tokens**: marketing reference composition/radii/glow wins; app 6 px/no glow/dense unchanged.
2. **Earlier briefs**: left-aligned marketing hero and older lime atmosphere adapt to centered wide reference composition and cool cyan atmosphere. Required lower sections, shared tier policy, original copy, exact proof boundaries and safety footer remain.
3. **Approved messages**: headline, subcopy, disclaimers/privacy remain verbatim in each locale; uppercase/italic are presentation only. Signed-out button changes visible `Sign in` → `Continue` (ID `Lanjutkan`), with an accessible sign-in purpose. New navigation/mobile/social labels are bilingual. No template copy is reused. Exact copy-change ledger will be appended as implementation lands.
4. **Desktop-only references**: light, 834, 390 and all status states are inferred. No unsupported reference imagery/branding/copy is treated as Narra capability.
5. **Privy deferral**: established restored-session recognition and ready-state timing must remain intact. Loading the provider only after a click would alter that behavior; retain the existing lazy auth boundary rather than changing the wallet flow.

## D2 gap analysis

**114/114 captures passed** before visual changes (after Step-1 performance fixes), one Playwright worker, routes warmed. Original PNGs: `C:\dev\narra-entitlements-review\web-design\before\{state}-{theme}-{width}.png`. States are the exact 18 `STATES` identifiers plus `landing`; themes dark/light; widths 1440/834/390, height 1000, full page, reduced motion. The gallery renders the real AccessView with deterministic visual fixtures via the existing dev-only auth alias; it does not simulate backend success or replace functional-flow tests. The production scanner also rejects gallery markers.

| Severity | Observed pre-design gap | Planned resolution |
|---|---|---|
| High | Access is a conventional tall marketing page, with a large footer and no planetary atmosphere | Centered access composition, cool radial glow, original horizon/stars, compact safety footer |
| High | Access heading is condensed/bold with no serif emphasis | Light body-family heading and Instrument Serif italic emphasis, approved string unchanged |
| High | Landing hero is left aligned; fine constellation sits behind rather than as centerpiece | Uppercase wide heading, original central globe, two flank blocks, decorative lower signature |
| High | No bracketed nav/grid/mono vocabulary | Unified mono labels, hairline masked grid, real anchor nav and mobile dialog |
| High | Status card heights vary strongly by state | Fixed/reserved card anatomy with accessible internal overflow for long proofs/actions |
| Medium | Primary access button says Sign in rather than requested Continue | Bilingual Continue; preserve login callback and update exact-label tests deliberately |
| Medium | 834 has desktop links and sparse hero, 390 header wraps into two rows and headline is narrow | Intentional tablet/mobile stacking; accessible mobile nav; 2–3 hero headline lines |
| Medium | Small badges, stepper, footer and preview labels are below requested 14 px | Marketing-only size overrides; maintain contrast in both themes |
| Medium | Light access is flat white/gray without atmospheric depth | Light-compatible ice glow, clear glass boundaries and dark meaningful text |
| Medium | No original rotating 3D wireframe/orbit forms, no bottom barcode | Original software projection with static SVG fallback and CSS signature |
| Low | Existing sections use lime-heavy labels and rounded pills unrelated to the reference grid | Shared mono labels, cyan atmosphere, restrained lime actions/highlights |
| Intentional | No template email field, brand names, face, gold palette or governance text | Remain omitted per hard rules; replaced by Narra branding, approved copy and wallet-access card |

Representative screenshots inspected at full resolution: `signedOut-dark-1440.png`, `signedOut-light-390.png`, `landing-dark-834.png`; all 114 state/viewport artifacts are preserved for final before/after comparison. Capture script visits the lazy preview and returns to the top before screenshotting, avoiding the old sticky-header capture offset.
