# Luora-inspired marketing refresh — 2026-10-15

## Reference evidence

Requested target: `https://www.luorasec.xyz/`. Captured with REA 6.5.0's `capture-browser-scenario` CLI using the existing Chromium installation. MCP registration was missing; no client configuration was changed.

- Desktop, 1440×1000: `ev_97db8627989bf0101fbd5322e3889efe7c6603b4f49a423ee593b4141df66c8c`. Initial navigation, a settled frame, two declared PageDown actions and settled frames. Captured screenshots, final DOM/accessibility and console events.
- Mobile, 390×844: `ev_b69c1e68286db0a660b9e871b49525f99534ee0e2dcf544de36635d1683010c2`. Initial navigation, settled hero, declared End key and settled footer.
- Both REA scenarios completed and terminated their owned browser processes. Full evidence and PNG extractions are in `C:\Users\gifar\AppData\Local\Temp\opencode\luora-*`.
- A separate Playwright computed-style inspection observed Outfit typography, a 30px/500 desktop reference headline, 13px pill navigation, graphite gradients and restrained gray borders. This is supplementary browser evidence, not a REA record.

Observed visual language: compact pill navigation, charcoal node panels, fine dotted fields, faint connector paths, dimensional circular elements and spacious sections. Desktop scroll captures show the reference's connected elements changing position. Exact internal animation timings and source implementation were not established.

## Narrax adaptation

- Marketing-scoped Outfit font; existing Narrax symbol and wordmark retained.
- Left-aligned, sentence-case hero, glass-pill controls, dot-grid workflow diagram, graphite cards, soft highlights and restrained section entrances.
- Diagram explains X/Reddit/TikTok → Narrax → narrative research. It is labeled as an illustration, with no invented prices, scores or live status.
- CSS connector motion and orbital breathing pause when the graph is outside the viewport. Reduced motion stops decorative animation. Existing reveal and access-state enhancements remain.
- Early access uses a responsive split layout and a matching glass panel around the existing `AuthBoundary` and `AccessFlow`. EN/ID, light/dark, signing, membership and confirmation behavior remain supported.
- Motion durations are Narrax design choices, not recovered reference constants. Reference artwork, source bundles and brand assets were not incorporated into the app.

## Verification before subsequent ZIP integration

Follow-up integration completed: `docs/ZIP_INTEGRATION_2026-10-15.md`. The refreshed landing is preserved with added Wyntrax attribution; the refreshed early-access layout now includes the incoming public-tier summary.

- Repository/web typechecks, web lint and **447 web tests** passed.
- **25 browser tests** passed with mocked auth/API, one worker: sign-in, exact-message proof, join/leave/unlink, wrong-domain rejection, pending/error states, membership polling, rate limits, keyboard navigation, locale persistence, CSP and reduced motion.
- Eight additional visual checks across 1440/390px, both pages, EN dark/ID light: zero axe WCAG A/AA violations and no horizontal overflow. One mobile capture initially timed out waiting for lazy content; targeting its actual reserve and waiting for hydration passed. PNGs: temporary directory `narrax-refresh-*.png`.
- Runtime check observed connector movement onscreen, pause offscreen and cancellation when reduced motion was enabled.
- Production build passed; production auth scan passed across 302 files. Existing optional Privy `@farcaster/mini-app-solana` warning remains. First Load JS: landing 153 kB; early access 187 kB.
- Real public-page checks passed using local services. No real wallet signature or owner-authenticated session was exercised in this visual update. Old visual snapshot baselines represent the previous design and were not regenerated.
