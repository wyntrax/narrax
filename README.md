<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/web/public/narrax-logo-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="apps/web/public/narrax-symbol.svg" />
    <img src="apps/web/public/narrax-symbol.svg" alt="Narrax" width="28" height="28" />
  </picture>
  &nbsp;NARRAX
</h1>

**Solana narrative and smart-money intelligence you can verify.**

Evidence-first research desk · Fail-closed risk &amp; safety gates · Built on Solana

<p>
  <img src="https://img.shields.io/badge/Built%20on-Solana-0F172A?style=flat&labelColor=1E293B" alt="Built on Solana" />
  <img src="https://img.shields.io/badge/status-research%20preview%20%C2%B7%20fail--closed-C99A3B?style=flat&labelColor=1E293B" alt="Status: research preview, fail-closed" />
  <img src="https://img.shields.io/badge/execution-dry__run%20%C2%B7%20manual%20sign-2D6A4F?style=flat&labelColor=1E293B" alt="Execution: dry_run and manual wallet sign" />
  <img src="https://img.shields.io/badge/stack-Next.js%20%C2%B7%20Fastify%20%C2%B7%20Postgres-2D6A4F?style=flat&labelColor=1E293B" alt="Stack: Next.js, Fastify, Postgres" />
</p>

[What it does](#what-it-does) · [Principles](#principles) · [Workspace](#research-workspace) · [Architecture](#architecture--stack) · [Development](#development)

</div>

Narrax is a Solana narrative and smart-money research workspace. It follows narratives as they form, links them to tokens, studies the wallets that acted early, and turns the evidence into research that can be reviewed line by line.

---

## What it does

- **Narrative radar** — tracks social attention and the lifecycle of emerging narratives.
- **Token research** — connects narratives to Solana tokens and reviews market, holder, deployer, and risk evidence.
- **Smart-money research** — studies qualified wallets, early buyers, and observed trading behavior.
- **Small-cap wallet leaderboard** — 30-day observed realised SOL results, closed-position win/loss samples, entry-cap bands, first-sale/close timing, and explicit coverage. Missing historical market caps remain unknown. Rankings identify research candidates, not approved wallets or verified copy-trade returns. The Rankings tab defaults to PRO with its own admin-configurable minimum tier; directory, flows, and emerging wallets retain their existing access.
- **Evidence-first signals** — publishes a call only when the required observations are present and fresh.
- **Personal PRO research** — saved radar conditions with private alerts, token thesis tracking, and daily evidence-linked briefings.
- **Smart Money Investigation** — recorded swaps, wallet-group comparisons, evidence-backed buying/selling patterns, and frozen published-flow context with token-price outcomes and explicit coverage. Defaults to PRO; admins can change its minimum tier independently.
- **Manual trading** — off by default. Any mainnet swap is prepared unsigned and signed by the user's own wallet.

## Principles

- **No evidence, no signal.** Missing, invalid, or stale data is reported as unknown; it is never filled in or treated as positive evidence.
- **Freshness is part of the evidence.** Cached readings age on screen and in delivery gates.
- **Automation is disabled.** The executor runs in `dry_run` only and cannot sign or send transactions.
- **Research, not advice.** Narrax does not custody funds or keys and does not provide financial advice.

## Research Workspace

| Surface | Focus |
| --- | --- |
| **Narratives & Tokens** | Emerging narrative lifecycles, OG relation scoring, screener filters, and live liquidity/holder checks |
| **Early Radar** | Multi-factor early-cap surfacing with launch forensics, tradeability quotes, and Telegram delivery |
| **AI Opportunity Desk** | Structured multi-role agent reviews grounded strictly in verified on-chain and market facts |
| **Smart Money** | 30-day cohort evaluation, timing/funding clusters, consensus tracking, and investigation views |
| **Portfolio & Alerts** | Paper trading, live unsigned swap preparation, exit monitors, and status notifications |

## Architecture & Stack

`Next.js` · `React` · `TypeScript` · `Fastify` · `PostgreSQL` · `Redis` · `Prisma` · `BullMQ`

- `apps/web` — Next.js research interface and interactive portfolio desk.
- `apps/api` — Fastify REST API, authentication, entitlements, screener, and read projections.
- `workers/pipeline` — Narrative ingestion, market/holder collectors, early radar, smart-money intelligence, and Telegram alerts.
- `workers/executor` — Isolated `dry_run` execution gate (non-signing).
- `packages/*` — Shared domain logic (`token-intel`, `smart-money`, `narrative`, `risk`, `analytics`, `ai`, `solana`, `database`).

## Status

Narrax is a research preview under active development. Live automated trading is disabled by default, and production performance has not been validated.

## Development

Internal setup, deployment, and operations documentation is maintained separately and is not published in this repository.

## Security

Please do not open a public issue containing credentials, wallet secrets, or personal data. Report security concerns privately to the maintainers.

## Contact

For non-sensitive questions, open an issue in this repository.
