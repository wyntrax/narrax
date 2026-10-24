# Narrax monochrome brand update

Owner direction: rename the visible product Narrax, use a black/white-only palette, and use the attached symbol in both themes.

This records the rebrand before Phase 2. The product placeholder has since been replaced by the [research workspace](PHASE2_HANDOFF.md); its implementation and verification are documented separately.

## Implementation

- **NARRAX** wordmarks and **Narrax** prose across EN/ID navigation, access actions, product placeholder, sample preview, FAQ/trust copy, document titles and social metadata.
- Pure black/white page backgrounds, text, primary buttons and symbol; neutral grayscale supplies surface hierarchy, borders and secondary text. Existing statuses remain distinguished by icons and explanatory labels, not color. Geometry, charts, horizon, focus rings, progress and decorations all inherit monochrome tokens.
- `public/narrax-symbol.svg` is a small vector recreation traced from the owner's attached raster mark, with its diagonal strokes, rounded ends and negative-space breaks. It is the single geometry source for header/footer/signature, social preview and favicons.
- `BrandMark` uses the SVG as a CSS mask: white in dark mode, black in light mode, switching immediately with the existing theme control.
- Exported transparent variants: `public/narrax-logo-dark.svg` (white symbol) and `public/narrax-logo-light.svg` (black symbol). `public/favicon.svg` follows browser dark/light preference; `favicon.ico` uses a white-on-black fallback. Regenerate variants/icons with `node scripts/favicon.cjs` from `apps/web`.
- Social preview embeds the same local SVG; no external logo/font request or new runtime dependency.

The public rename does not migrate technical identifiers: npm workspaces, environment variables, existing preference cookies and translation keys retain compatibility. This pre-launch brand pass also changed the server-issued wallet-link protocol line to **NARRAX wallet link v1**, because that exact text is displayed during proof review. The API and web parsers compare it literally, so both must be released together; a mixed-version window would reject wallet-link challenges for up to five minutes. Auth/API/FSM/proof/signing behavior is otherwise preserved, and the only auth-component edit is its visible placeholder heading.

## Verification

- Whole-repository typecheck and web lint passed.
- **419/419** web tests passed, including proof/auth/controller coverage and production fixture guards.
- Deliberately regenerated all **32** visual baselines for the new brand, then **32/32** comparisons passed without update mode. Thresholds/assertions are unchanged; desktop/mobile, both themes and seven access states are covered. Representative screenshots were visually reviewed.
- **25/25** functional browser tests passed, including mobile navigation, keyboard proof review, theme/locale persistence, four mobile axe scans and CSP/console checks. No axe violations in those scans.
- Source-color inventory contains only achromatic values. Both translation JSON files were mechanically compared with the previous revision: only whole-word `Narra` → `Narrax` values changed.
- Production build passed; its fixture-leak scan passed across **268 files**. First Load JS remains **153 kB landing / 187 kB access**. The existing optional Privy/Farcaster dependency warning remains.
- **6/6** production CSP/console/axe/admission tests passed. Both EN/ID social-image endpoints, the base symbol, dark/light logo variants and favicon endpoints return HTTP 200 with the expected image types. The generated social card was visually reviewed.

Current review images are in `apps/web/e2e/__screenshots__/`. The older `docs/design-captures/` and `docs/design-review/` images and performance measurements remain historical pre-rebrand evidence.
