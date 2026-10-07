# B5a runbook: running the executor dry run yourself

**Purpose.** Look at what the executor would have sent for your own orders, with real Jupiter and a real node, and decide whether B5b (signing) is justified. Nothing in this stage can sign or send. The sandbox this was built in could not reach Jupiter, Helius or Privy, so **every real-network behaviour below is unverified until you run it.**

Stop at any step that does not behave as described, and tell me what you saw. Do not widen a check to make a rejection go away.

## 0. Before you start

- Postgres and Redis running. Migrations applied (`npx prisma migrate deploy`; run the `0009` diff check from `docs/CONTINUATION.md` first, since 0009 is hand-written).
- `HELIUS_RPC_URL` set (balances and simulation), and optionally `JUPITER_API_KEY`.
- **Use a wallet you do not mind being read.** A dry run signs nothing, but it builds real swap transactions for the address you register and simulates them against the real chain. It needs the address to hold a little SOL for the simulation to be meaningful (a few hundredths of a SOL is plenty). Do not put a private key anywhere. B5a has no place for one.

## 1. Register your user, wallet and permissions

Find your user id (`select id, "privyUserId", mode from "User";`). Then, for your own user only:

```sql
-- the address the swaps will be built and simulated for (an address only, never a key)
INSERT INTO "Wallet" (id, "userId", address, kind, "createdAt") VALUES (gen_random_uuid()::text, '<USER_ID>', '<YOUR_SOLANA_ADDRESS>', 'TRADING', now());
-- AI access on, not paused, not revoked (creates the row if there is none; or use PUT /v1/ai-access)
INSERT INTO "TradingPermission" (id, "userId", "aiTradingEnabled", "agentPaused", "updatedAt") VALUES (gen_random_uuid()::text, '<USER_ID>', true, false, now())
  ON CONFLICT ("userId") DO UPDATE SET "aiTradingEnabled" = true, "agentPaused" = false, "revokedAt" = NULL, "updatedAt" = now();
-- the executor only dry-runs AUTO orders (or SEMI_AUTO orders you have confirmed)
UPDATE "User" SET mode = 'AUTO' WHERE id = '<USER_ID>';
```

These statements were run against the schema in the build sandbox (inside a rolled-back transaction) and work there. Setting AUTO mode makes the fan-out create orders for you from real AI decisions. That is intended here, and it is why the executor cannot sign.

## 2. Start the two processes

```
EXECUTOR_ALLOWLIST_USER_IDS=<USER_ID> npm run dev:executor
npm run dev:workers
```

The executor should print one line with `"canSign":false`, your allow-list size (1), the two caps and `"rpc":true`. If it prints `executor not started`, read the reason: it is deliberate (a signing-key variable is set, or a cap is above its ceiling).

## 3. Read the verdicts

Wait for an AUTO order to be created (or confirm a SEMI_AUTO one). Then, as an admin:

```
GET /v1/admin/dry-runs?userId=<USER_ID>
```

For each item read:

| Field | What to check |
|---|---|
| `outcome` | ACCEPTED, REJECTED (a check refused it) or ERROR (Jupiter or the node failed, so there is no verdict) |
| `reasons` | Every failed check with a code and a sentence. **This is the most valuable output.** |
| `summary.transaction.instructions` | Every instruction by program and kind, in order. Is this what a swap should look like? |
| `summary.transaction` (`priorityFeeLamports`, `computeUnitLimit`, `lookupTables`) | Fee and compute are within what you accept |
| `summary.quote` | Amount in, expected out, **minimum out**, price impact, slippage |
| `simulation` | `walletLamportsSpent`, `inputTokensSpent`, `outputTokensGained`, `unitsConsumed`, a few cleaned program log lines |
| `messageHash` | Identifies exactly what would have been signed |

## 4. What I need back from you

1. A handful of ACCEPTED and REJECTED items (paste the JSON, redact your wallet if you like).
2. For every REJECTED item that you think **should** have passed, the `reasons` codes. The likeliest is `PROGRAM_NOT_ALLOWED`, `SYSTEM_INSTRUCTION_NOT_ALLOWED`, `TOKEN_INSTRUCTION_NOT_ALLOWED`, or `JUPITER_INSTRUCTION_COUNT`: Jupiter's real transactions may contain something the allow list does not expect. I will propose a change and you decide whether it is safe.
3. For every ACCEPTED item, whether the simulated balance changes match the quote. If `walletLamportsSpent` is far above the SOL you meant to spend, say so.
4. Any `ERROR` with its code (`SWAP_BUILD_FAILED`, `RPC_FAILED`, `UNEXPECTED`).

## Lookup-table probe (2026-10-07; review checkpoint)

Run `npx tsx scripts/b5a-lookup-probe.ts --output <new-local-json-path>` without workers. It connects only to public token sources, Jupiter and Helius; it does not connect to the database or queues. BUY input is 6,325,000 lamports, slippage 100 bps; SELL input is the corresponding BUY quote output and is verifier-only. It uses the existing RPC simulation and effect verifier, executor config/limits and quote-to-simulation window. Simulation retains `sigVerify:false` and `replaceRecentBlockhash:false`: a live blockhash is required.

Current documentation checked before adding opt-in parameters:
- [GET quote](https://developers.jup.ag/docs/api-reference/swap/v1/quote.md): `asLegacyTransaction` (default false), `maxAccounts` (rough account budget, default 64).
- [POST swap](https://developers.jup.ag/docs/api-reference/swap/v1/swap.md): `asLegacyTransaction` must agree with the quote. No direct-route/intermediate-token options were added or used.
- [Gateway migration](https://developers.jup.ag/docs/portal/migration.md) and [setup](https://developers.jup.ag/docs/portal/setup.md): current documented host is `api.jup.ag`; `lite-api.jup.ag` is progressively phased out, with no fixed retirement date on the current page. Keyless access on `api.jup.ag` is available at 0.5 RPS; `x-api-key` is recommended for higher limits, not universally mandatory. The repo default remains `lite-api.jup.ag/swap/v1`, which worked for all probe requests with the configured header. Host migration and Swap V2 remain separate review items.

Both BONK and WIF were independently matched by Jupiter token search and DEX Screener, then passed `getMintInfo`: classic Token program, null freeze/mint authorities, no extensions.
- BONK: `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`; sources: `https://api.jup.ag/tokens/v2/search?query=BONK` and `https://api.dexscreener.com/tokens/v1/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263`.
- WIF (`$WIF`): `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm`; sources: `https://api.jup.ag/tokens/v2/search?query=dogwifhat` and `https://api.dexscreener.com/tokens/v1/solana/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm`.

| Token | Variant | BUY bytes / instructions / tables | SELL bytes / instructions / tables | Verifier BUY / SELL |
|---|---|---|---|---|
| BONK | Current v0 | 820 / 8 / 2 | 1051 / 5 / 3 | ACCOUNT_NOT_STATIC / ACCOUNT_NOT_STATIC |
| BONK | Legacy | 1148 / 8 / 0 | 775 / 5 / 0 | PASS / PASS |
| BONK | v0 maxAccounts=32 | 820 / 8 / 2 | 889 / 5 / 2 | ACCOUNT_NOT_STATIC / ACCOUNT_NOT_STATIC |
| WIF | Current v0 | 664 / 8 / 1 | 625 / 5 / 1 | ACCOUNT_NOT_STATIC / ACCOUNT_NOT_STATIC |
| WIF | Legacy | 876 / 8 / 0 | 775 / 5 / 0 | PASS / PASS |
| WIF | v0 maxAccounts=32 | 664 / 8 / 1 | 625 / 5 / 1 | ACCOUNT_NOT_STATIC / ACCOUNT_NOT_STATIC |

All routes existed, all serialized transactions fit 1232 bytes, and reported impact was below 1%. Legacy BUY RPC simulation returned no execution error but the effect checker returned `TOKEN_ACCOUNT_UNREADABLE` for both tokens (121785 / 69086 units). Effect-summary deltas remained null. This independent blocker is not fixed here. Exits were not simulated. Legacy routes exist at this size, but are not a guarantee for every future route; reducing maxAccounts does not promise zero tables.

The first current-variant rejection is saved unmodified in `packages/tx-verify/src/captured-fixtures.ts`, including base64 transaction, raw account data, capture time and RPC slot. The script never overwrites it. Pure tests do not fetch the network or simulate this historical blockhash. Compatibility tests live under tx-verify (within the approved edit scope); they assert exact default Jupiter URL/body bytes. No executor wiring is authorized before the review checkpoint.

## 5. Drills (do these once)

- **Kill switch.** `PUT /v1/admin/executor/kill-switch` `{"enabled":true,"reason":"drill"}`. The next dry run must be REJECTED with `KILL_SWITCH` and make no Jupiter or node call. Turn it off with a reason. A corrupted value (put `{"enabled":"maybe"}` straight into `SystemSetting.executor.kill_switch`) must also stop it.
- **Revoke.** `PUT /v1/ai-access` to revoke, or set `agentPaused`. The next order must be REJECTED (`ACCESS_REVOKED`, `AGENT_PAUSED`).
- **Caps.** Set `EXECUTOR_HARD_CAP_SOL=0.005` and restart. An order above it must be REJECTED with `HARD_CAP_EXCEEDED`.
- **Refusal to start.** Start the executor with `EXECUTOR_SIGNING_KEY=x`. It must refuse. Then with `EXECUTOR_MODE=live`. It must refuse.

## 6. What "ready for B5b" means

All of these, in your judgement:

- Real Jupiter swaps for real tokens pass the verifier (or fail it for reasons you reviewed and agree with), with the allow list changed only deliberately.
- The simulated balance changes match the quotes within the slippage you set.
- The drills behave as described.
- You have decided the open items: Jupiter Swap V2 (see the plan), where the signing credential will live (D8), and the Privy plan's policy support (D2).
- Optional but advisable before B5c: the legal check (D9) and an external security review.

Only then ask for B5b. It starts with the first signing code, for your own wallet only, a 0.01 SOL cap per transaction and 0.05 SOL per day, and the kill switch armed.
