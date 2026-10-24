# NARRAX

Narrax is a Solana narrative and smart-money research workspace. It follows narratives as they form,
links them to tokens, studies the wallets that acted early, and turns the evidence into research that
can be reviewed line by line.

## What it does

- **Narrative radar** — tracks social attention and the lifecycle of emerging narratives.
- **Token research** — connects narratives to Solana tokens and reviews market, holder and risk evidence.
- **Smart-money research** — studies qualified wallets, early buyers and observed trading behavior.
- **Evidence-first signals** — publishes a call only when the required observations are present and fresh.
- **Research workspace** — narratives, tokens, radar, smart money, portfolio, alerts and analytics.
- **Manual trading** — off by default. Any mainnet swap is prepared unsigned and signed by the user's own wallet.

## Principles

- **No evidence, no signal.** Missing, invalid or stale data is reported as unknown; it is never filled in
  or treated as positive evidence.
- **Freshness is part of the evidence.** Cached readings age on screen.
- **Automation is disabled.** The executor runs in `dry_run` only and cannot sign or send transactions.
- **Research, not advice.** Narrax does not custody funds or keys and does not provide financial advice.

## Stack

Next.js, React, TypeScript, Fastify, PostgreSQL, Redis, Prisma and BullMQ.

## Status

Narrax is a research preview under active development. Live trading is disabled by default, and
production performance has not been validated.

## Development

Internal setup, deployment and operations documentation is maintained separately and is not
published in this repository.

## Security

Please do not open a public issue containing credentials, wallet secrets or personal data. Report
security concerns privately to the maintainers.

## Contact

For non-sensitive questions, open an issue in this repository.
