# Web design handoff

Branch `feat/web-design` from accepted `feat/web-phase1` (`35f792f`). No push. Phase 2 has not started.

## Scope

The design uses the two read-only references for composition/mood, with original Narra geometry, branding and approved copy. Product/FSM/API/proof/signature/wallet/backend behavior is unchanged. Presentation-only AccessView changes: Continue label, decorative SVGs/data attribute, and keyboard focus on the scrollable exact-message `<pre>`.

- Specification, source-string inventory, omissions/conflicts, gap analysis, and every new EN/ID string: [DESIGN_SPEC_PHASE1.md](DESIGN_SPEC_PHASE1.md).
- Five-run mobile baseline and after-fix evidence: [PERF_BASELINE.md](PERF_BASELINE.md), [perf/](perf/).
- All before/after states: [design-captures/README.md](design-captures/README.md).
- Side-by-side references: [access](design-review/access-comparison.webp), [landing](design-review/landing-comparison.webp). Under 5 MB total.
- Pixel baselines: `apps/web/e2e/__screenshots__` (32 viewport PNGs).

## Verification

- Step 0: actual production Next build command rejects any set test-auth value (`1` and `0` tested). Build command scans `.next` and rejects auth/gallery module/string markers. The capture gallery is exclusively part of the compile-time development auth fixture.
- D2: **114/114** before captures, all 18 access states plus landing × light/dark × 1440/834/390.
- D6: **32/32** `toHaveScreenshot` comparisons pass with reduced motion and animated regions masked. Also checks horizontal overflow and ≤3 hero headline lines at 1440/390. An 8 px decorative-grid overflow was fixed without weakening the assertion.
- Final all-state capture/axe matrix: **114 verified views**. Initial run 108 passed; six challenge variants exposed nonfocusable scrollable proof text. Adding `tabIndex=0` resolved all six targeted checks. No axe rules disabled. Before/after screenshots include every state/size/theme.
- Final fixture browser suite: **25/25 passed** in one run (all original 22 flows plus mobile focus trap, reduced-motion poster and proof keyboard scrolling). Real flow assertions remain; only expected button-label assertions changed to Continue.
- Final web unit/component suite: **419 passed / 12 files**. Includes 294 FSM transition checks and all unchanged auth race/proof/API/polling checks.
- Whole-repository typecheck: **passed**. Final standalone `npm run lint -w @narra/web`: **passed**; final build also validates lint/types.
- Backend execution: **not run** for this task because both inherited DB/Redis variables were absent. Presence checked as booleans only; no credentials guessed or env files opened. No backend source/dependency changes.
- Final production build: **passed**, one full production build after D1–D6 and the accessibility fix. First Load JS: **153 kB landing**, **187 kB access**, 105 kB shared. Build lint/types passed; scan examined **268 files**, zero fixture/gallery markers. Existing optional Farcaster and next-intl cache warnings remain.
- Production Playwright: **6/6 passed** with real production bundle, blank Privy app ID and fixture public API. Four route/theme scans show **zero axe violations, zero console/page errors and zero CSP violations**. Public disabled/full availability remains accessible without Privy. No unsafe-inline/unsafe-eval in production script policy.
- Final five-run mobile medians: **79 / 77 performance**, **3,322 / 3,646 ms LCP**, **0.064276 / 0.005517 CLS**, **504 / 456 ms TBT** (landing/access). CLS and landing initial-JS targets pass; **LCP and ≥90 performance targets remain unmet**. Final scores regress from Step-1 85/88. The reference design adds critical CSS/fonts and shared-client work; ongoing canvas CPU remains material. Evidence and measured limits are in [PERF_BASELINE.md](PERF_BASELINE.md).

## Intentional deviations / omissions

- Template brand names, logos, governance/newsletter copy, gold face artwork and outer device frame are absent from application source. Replaced by NARRA, approved research/safety copy, cyan/lime original mesh, and a full-width web canvas.
- Email field / Get Notified replaced by the current access card and Continue sign-in callback; no new email/newsletter flow.
- Actual status card is taller than a template email bar. Fixed 360/440 px anatomy with accessible internal scrolling accommodates exact proof and existing actions without vertical state jumps. Safety footer uses natural height; the arc does not cover its text.
- Headline is the approved longer copy, not the template slogan. Instrument Serif italic styles “crowd” / “ramai”; JetBrains Mono labels connect both pages. Fonts are next/font Google, Latin, self-hosted at runtime.
- Social buttons render only for configured valid HTTPS `NEXT_PUBLIC_X_URL` / `NEXT_PUBLIC_TELEGRAM_URL`. Both are absent in verification, so buttons are absent.
- No invented statistics, testimonials, prices, customer logos, live counters or unsupported capabilities. Existing preview is explicitly Sample data; tier requirements remain placeholders and eligibility remains shared-policy driven.
- Light/tablet/mobile and all access states are inferred responsive designs because references are desktop-only.

## Enhancements and limits

Lazy card transitions/success, fine-pointer magnet/spotlight, step check/announcement, transform-only skeleton shimmer, original inline error/empty SVGs, paused original hero canvas, static reduced-motion poster, native reveals, decorative preview crosshair and staggered tab-rank entrance, and native theme crossfade. No content or decision requires animation. Rank motion is illustrative tab-selection presentation, not invented live movement.

Enhancements were measured together with the completed visual system, not separately isolated causal experiments. Their chunk bytes and aggregate Lighthouse impact are in PERF_BASELINE. No global heavy animation library was reintroduced; underlying flow behavior remains intact.

Lazy gzip sizes: original geometry **1,434 B**, enhancements **837 B**, sample preview **1,237 B**. Required geometry is retained with static reduced-motion fallback; extra particle engines, continuous rank simulation and heavy motion dependencies were omitted. The current design does not meet every performance budget, and the handoff explicitly records that limitation rather than claiming the effects are costless.

Source-scope check: `git diff --stat feat/web-phase1 -- apps/api packages workers package-lock.json apps/web/src/features/access/controller.tsx apps/web/src/features/access/machine.ts apps/web/src/features/access/proof.ts apps/web/src/features/access/sync.ts apps/web/src/lib/api.ts apps/web/src/components/auth` returned **no changes**. Both EN/ID message files retain every preexisting namespace byte-equivalent after JSON parsing; the only new namespace is `design`, fully listed in the spec.

Final artifact/scope validation additionally confirmed 228 unique capture files with matching manifest byte sizes, all tracked branch changes confined to `apps/web`, and unchanged web dependency/devDependency maps. The generated `next-env.d.ts` was restored to its tracked build-directory-independent declaration. `git diff --check` passed. The owner’s untracked `design/reference/` directory is preserved and excluded from staging.

Artifact sizes: **228 portable full-page before/after WebP copies, 11,070,210 bytes total**, separate from the small reference-review directory; all 114 original PNGs per phase remain local. Pixel baselines are 32 original PNGs (~7 MB total, ~220 KB each on average), not lossy review copies. The two reference comparison WebPs are ~94 KB combined. Final production screenshots are additionally in `apps/web/test-results/production-screenshots/`.

## Reproduce

Keep heavy processes sequential. Start fixture dev with `NARRA_WEB_TEST_AUTH=1` and the documented public fixture variables; warm routes. Run:

```text
npm run e2e -w @narra/web
npx playwright test --config playwright.visual.config.ts
NARRA_DESIGN_CAPTURE_DIR=<external path> NARRA_DESIGN_AXE=1 npx playwright test --config playwright.capture.config.ts
```

The last two commands run from `apps/web`; set variables with PowerShell syntax on Windows. Do not use `--update-snapshots` during verification. For production unset test-auth (even a set `0` is rejected), stop dev, build once, start and warm, run production Playwright, then Lighthouse sequentially. `node scripts/lighthouse.mjs <output> 5` runs five per route. Existing env-free wrapper protects automatic env loading. Capture env variables are test tooling only, never auth or deployment settings.

## Unverified integrations

Real Privy login/session restoration with a configured app, Phantom/Solflare or embedded signing, live webhook membership sync, deployed CORS/HTTPS origin, configured social destinations, cross-browser manual assistive technology. Browser auth/API/signatures are fixtures; production benchmark uses blank Privy ID. Existing optional Farcaster and next-intl cache warnings are not evidence of verified integrations.

## Commit history

| Step | Commit |
|---|---|
| 0 | `f045a7a` |
| 1 | `d7361dd` |
| D1 | `249226d` |
| D2 | `c76749f` |
| D3 | `3a4fe9f` |
| D4 | `5a20dc4` |
| D5 | `41243bd` |
| D6 | `109d97f` |
| 3 | This handoff's final verification commit |

Stop here and wait for the owner. No Phase 2 work is authorized by this task.
