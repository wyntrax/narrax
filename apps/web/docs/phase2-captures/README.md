# Phase 2 screen evidence

Captured with the compile-time test-auth adapter and mocked research APIs. These are **fixture records**, not production market observations. Each screen passed axe WCAG A/AA checks, console-error checks and document/workspace overflow checks. The workspace scrolls internally, so screenshots show the current viewport rather than every section below the fold.

| Screen | Desktop dark | Desktop light | Mobile dark | Mobile light |
|---|---|---|---|---|
| Overview | [1440](overview-1440-dark.png) | [1440](overview-1440-light.png) | [390](overview-390-dark.png) | [390](overview-390-light.png) |
| Radar | [1440](radar-1440-dark.png) | [1440](radar-1440-light.png) | [390](radar-390-dark.png) | [390](radar-390-light.png) |
| Narrative | [1440](narrative-1440-dark.png) | [1440](narrative-1440-light.png) | [390](narrative-390-dark.png) | [390](narrative-390-light.png) |
| Opportunities | [1440](opportunities-1440-dark.png) | [1440](opportunities-1440-light.png) | [390](opportunities-390-dark.png) | [390](opportunities-390-light.png) |
| Token directory | [1440](tokens-1440-dark.png) | [1440](tokens-1440-light.png) | [390](tokens-390-dark.png) | [390](tokens-390-light.png) |
| Token detail | [1440](token-1440-dark.png) | [1440](token-1440-light.png) | [390](token-390-dark.png) | [390](token-390-light.png) |

Generate these via `e2e/research.spec.ts`. Its screenshot files are written to `test-results/research/`. Screenshots are review evidence, not newly introduced golden-image assertions.
