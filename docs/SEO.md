# Narrax search visibility

## Implemented scope

Narrax has six public English pages and their Indonesian equivalents:

| English path | Purpose |
| --- | --- |
| `/` | Solana narrative and smart-money research overview |
| `/research` | Public educational guide hub |
| `/research/solana-narrative-research` | Original sources, exact mints and prospective narrative research |
| `/research/smart-money-wallet-research` | History completeness, wallet qualification and independent entities |
| `/research/early-token-risk-checklist` | Liquidity, holders, authority gaps and freshness |
| `/methodology` | Evidence policy, source limitations, outcome semantics and editorial responsibility |

Indonesian URLs use `/id` with the same guide slugs. English URLs have no `/en` prefix; next-intl redirects the redundant prefix. The homepage, hub, breadcrumbs, related-guide links and footer provide crawlable internal links. The content is server-rendered, readable without authentication, and does not require an API to populate its article body.

This is an educational content cluster, not a token recommendation directory. There are no fabricated live signals, performance claims, reviewer identities, customer counts, ratings or legal policies. Public copy explicitly distinguishes discovery from qualification and acknowledges that research availability depends on evidence and deployment readiness.

## Technical behavior

- Each public page owns its title, description, canonical URL, reciprocal EN/ID/x-default hreflang, Open Graph URL/title/description and large-image Twitter preview. Shared layouts no longer give every route the homepage canonical.
- `htmlLimitedBots: /.*/` keeps metadata in the initial `<head>` for all clients. Streaming descriptions into the body was reproducibly missed by Lighthouse. This trades metadata streaming for predictable initial HTML; measure live TTFB after deployment.
- JSON-LD describes the organization/website, guide articles and visible breadcrumbs. It uses CSP nonces and escapes HTML delimiters before serialization. It invents no publication dates, ratings, prices, search actions or performance data. No FAQ-rich-result promise is made.
- Localized PNG share images render at 1,200 × 630. They are site-level images, not fabricated token charts. The page title and description remain specific to the shared guide.
- The sitemap contains only the twelve authored public URLs, with localized alternates. It does not pretend every request is a content update by emitting a current `lastmod`.
- Unknown guide slugs return real HTTP 404s with noindex, not HTTP 200 soft-404s. Loading boundaries were moved from the locale root to the workspace and early-access routes so public error status is not committed before the page resolves. The existing loaders remain available where they are needed.
- `/app` and `/early-access`, including localized descendants and redirects, carry `noindex, nofollow` in metadata and `X-Robots-Tag`. They have no homepage canonical. When production indexing is enabled, robots.txt lets crawlers see those noindex directives; authentication remains the access-control boundary. Robots.txt never protects private data.

## Launch configuration

The web launchers read **process environment**, not local `.env` files. `apps/web/.env.example` documents the values; it does not load them.

```text
NEXT_PUBLIC_SITE_URL=https://YOUR-ACTUAL-CANONICAL-HOST
NARRA_SEO_INDEXABLE=true
NARRA_GOOGLE_SITE_VERIFICATION=optional-verification-token
NARRA_BING_SITE_VERIFICATION=optional-verification-token
```

Use a bare origin without a trailing slash, path, query or credentials. Pick one HTTPS hostname and redirect all public alternatives to it at the hosting/proxy layer. `NEXT_PUBLIC_*` values are build-time browser configuration: rebuild the web deployment for its actual origin, then pass matching configuration at runtime. Never deploy the example-host verification build as the real site.

**Default safety:** without the explicit `NARRA_SEO_INDEXABLE=true` opt-in, pages are noindex, responses carry `X-Robots-Tag`, robots.txt disallows crawling and the sitemap is empty. Localhost and HTTP origins cannot opt into indexing. Keep the flag false on **every** preview/staging deployment, even if it has a public HTTPS URL. This is an operator-controlled opt-in, not automatic staging-host detection. Restrict sensitive previews with actual access controls.

Only set indexing true after the canonical domain, TLS and public content are ready. Then:

1. Inspect `/robots.txt`, `/sitemap.xml` and the initial HTML of the homepage and one guide in each language.
2. Verify canonical URLs resolve to the same actual public host, and redirects preserve intended paths.
3. Confirm private pages and unknown slugs remain noindex/404 and that neither private URLs nor auth artifacts appear in the sitemap.
4. Verify ownership in Google Search Console and Bing Webmaster Tools using DNS or the optional meta tokens. Tokens are public verification values, not API keys.
5. Submit the actual `https://YOUR-HOST/sitemap.xml` and inspect representative URLs. Deployment does not itself submit anything or guarantee indexing.
6. Check social link previews and Google's Rich Results Test/Schema Markup Validator on the deployed HTML. Article/breadcrumb markup is eligible for interpretation, not a guarantee of a rich result.

The release workflow now has a separate, **disabled-by-default same-VPS frontend deployment job**. A successful backend deployment alone does not publish these pages. Configure the frontend's own flag, environment and public build variables using [Frontend deployment](FRONTEND_DEPLOYMENT.md). No domain, Search Console account, DNS setting or live indexing configuration was changed by this implementation.

## Verification and regression checks

```text
npm run typecheck
npm run lint -w @narra/web
npm run test -w @narra/web -- --maxWorkers=1 --minWorkers=1
npm run build -w @narra/web
npm run start -w @narra/web
npx -w @narra/web playwright test e2e/seo.spec.ts --workers=1
```

Supply the same process configuration to build, server and browser runner. `NARRA_WEB_TEST_AUTH` must be **unset**, not set to false, for production builds. The SEO suite also runs against the fixture dev server in the existing browser job; the web CI job now checks the actual production build with explicit test-host indexing enabled and no backend dependency. Remote CI has not run until a Git remote is configured.

Local verification for this phase:

- 600 web tests across 41 files passed; types and lint passed.
- Production build and 357-file auth-leak scan passed. Build warnings remain for Privy's optional `@farcaster/mini-app-solana` import and next-intl webpack cache analysis; no dependency changes were made to hide them.
- Nine SEO browser checks passed against the production build with indexing enabled, then the same nine passed with indexing disabled at runtime. Coverage includes all twelve public URLs, initial-head metadata, exact CSP nonce matching, actual 404 status, private-route headers, sitemap scope, two PNG share images, and mobile/desktop dark/light axe checks. The checks also passed on the fixture dev server before the final metadata-head delivery change; the production run verifies that change.
- Local mobile Lighthouse on `/research/early-token-risk-checklist`: accessibility **100**, best practices **100**, SEO **92**, performance **89**, CLS **0**. The remaining scored SEO failure is the deliberate cross-host canonical (`localhost` served with `https://narrax.example` as its configured production identity), not a missing canonical. A real-domain audit is required after deployment. These are synthetic local measurements, not field Core Web Vitals or a ranking claim. Final audit: `C:/Users/gifar/AppData/Local/Temp/opencode/narrax-seo-lighthouse-final.json`.

## Ongoing visibility work

Review Search Console impressions, clicks, indexing exclusions and query/page pairs after launch. Track English and Indonesian separately; do not infer success from an aggregate keyword position or a single synthetic audit.

Prioritize specific source-backed research examples once publishable evidence exists. Add new articles only when they answer a distinct user question and can link to verifiable sources. Maintain existing guide accuracy and real editorial dates before expanding volume. Avoid generated token/ticker pages, copied news, purchased links, invented case studies and unqualified “best wallet” rankings. No SEO implementation can guarantee ranking or eliminate financial-research trust requirements.
