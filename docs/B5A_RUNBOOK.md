# B5a runbook: running the executor dry run yourself

**Purpose.** Look at what the executor would have sent for your own orders, with real Jupiter and a real node, and decide whether B5b (signing) is justified. Nothing in this stage can sign or send. The original build sandbox could not reach the real services; the dated evidence below records the subsequent real-service checks and remaining gaps.

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

Quote evidence, captured 2026-10-07T01:02:42.494Z (base units, 100 bps slippage throughout; impact is the repository client's percent conversion):

| Token | Variant | Side | In | Expected out | Minimum out | Impact % |
|---|---|---|---:|---:|---:|---:|
| BONK | Current | BUY | 6325000 | 20874104397 | 20665363354 | 0 |
| BONK | Current | SELL | 20874104397 | 6325845 | 6262587 | 0.121399 |
| BONK | Legacy | BUY | 6325000 | 20873226293 | 20664494031 | 0 |
| BONK | Legacy | SELL | 20873226293 | 6320315 | 6257112 | 0.210258 |
| BONK | max32 | BUY | 6325000 | 20872500504 | 20663775499 | 0 |
| BONK | max32 | SELL | 20872500504 | 6324880 | 6261632 | 0.130400 |
| WIF | Current | BUY | 6325000 | 3116892 | 3085724 | 0 |
| WIF | Current | SELL | 3116892 | 6325015 | 6261765 | 0.056769 |
| WIF | Legacy | BUY | 6325000 | 3116892 | 3085724 | 0 |
| WIF | Legacy | SELL | 3116892 | 6325015 | 6261765 | 0.063641 |
| WIF | max32 | BUY | 6325000 | 3115900 | 3084741 | 0 |
| WIF | max32 | SELL | 3115900 | 6323002 | 6259772 | 0 |

Every versioned BUY had the two messages `Instruction 3 (associated-token) names an account loaded from a lookup table, which cannot be verified.` and the same message for instruction 6 (`ACCOUNT_NOT_STATIC`). Every versioned SELL had the instruction 3 message only. Legacy verifiers had no reasons. Both legacy effect-verifier failures reported `A token account was not a readable Token program account.` (`TOKEN_ACCOUNT_UNREADABLE`); `walletLamportsSpent`, `inputTokensSpent`, `outputTokensGained` were all null. Quote-to-simulation time: BONK 616 ms; WIF 610 ms (10000 ms limit). No ACCEPTED balance-effect result was obtained.

The first current-variant rejection is saved unmodified in `packages/tx-verify/src/captured-fixtures.ts`, including base64 transaction, raw account data, capture time and RPC slot. The script never overwrites it. Pure tests do not fetch the network or simulate this historical blockhash. Compatibility tests live under tx-verify (within the approved edit scope); they assert exact default Jupiter URL/body bytes. No executor wiring is authorized before the review checkpoint.

Part B checkpoint: captured transaction plus resolved tables passes the pure verifier with no reasons; absent resolution still returns two `ACCOUNT_NOT_STATIC` reasons. Resolver failures are `LOOKUP_TABLE_UNRESOLVED`, `LOOKUP_TABLE_INVALID`, `LOOKUP_INDEX_OUT_OF_RANGE`, with `TOO_MANY_LOOKUP_TABLES` checked before I/O and `UNDECODABLE` for invalid transactions. Resolution makes addresses visible without granting permissions. See the new lookup-table section of `SECURITY_REVIEW_PLAN_B5.md` for trust assumptions and the independent simulation blocker. Do not wire this into `dryRun.ts` until owner approval.

### Closed-account diagnosis and effect recheck (2026-10-07)

`npx tsx scripts/b5a-lookup-probe.ts --diagnose-effects --output <new-json-path>` runs only legacy BUYs and retains wire RPC results, wrapper account values, complete logs and fee/rent evidence. `--capture-effects-fixture` writes the two public captures once to `packages/tx-verify/src/captured-simulation-fixtures.ts` (never overwrites). `--resolved-effects` runs current-v0 and legacy BUYs, resolving tables before verification only in this standalone probe. Executor wiring remains pending approval.

The original failure was **postIn only**: closed wSOL returned `{lamports:0,owner:"11111111111111111111111111111111",data:["","base64"]}`. The RPC wrapper correctly retained the object and unwrapped the tuple to `data:""`. Pre-input/pre-output were null; post-output was a valid 165-byte Token account. `tokenAmountOf` now treats exactly zero lamports plus the literal empty data string as nonexistent, consistently for pre/post input/output. Funded System accounts, wrong-owner accounts with data, short Token data and nonempty malformed encodings are still unreadable. No RPC production code changed.

Fresh effect results (all BUY 6325000 lamports; 100 bps; verifier/effects both `ok:true`, no reasons):

| Token / variant | Wallet spent | Input tokens spent | Output gained | Expected output | Minimum output | Compute used | Priority fee |
|---|---:|---:|---:|---:|---:|---:|---:|
| BONK / legacy | 7876423 | 0 | 20849749702 | 20874719990 | 20665972791 | 121865 | 57983 |
| BONK / v0 (3 tables) | 7925498 | 0 | 20836406018 | 20877890649 | 20669111743 | 196808 | 107058 |
| WIF / legacy | 7818738 | 0 | 3136435 | 3136435 | 3105071 | 64168 | 298 |
| WIF / v0 (1 table) | 7818753 | 0 | 3136435 | 3136435 | 3105071 | 64168 | 313 |

For each, loss = 6325000 swap + 1488440 output ATA rent + priority fee + 5000 base fee. The wSOL ATA costs 1488440 rent transiently and refunds it on close, net zero. Live `getMinimumBalanceForRentExemption(165)` returned 1488440 (not the historical 2039280); `getFeeForMessage` matched the raw simulation fee. All four residuals are zero. Input token delta is zero because the transient wSOL ATA is absent/closed on both sides; SOL input is reflected in wallet loss. Quote-to-simulation times: 509, 514, 513, 821 ms respectively; flags and 10000 ms window unchanged.

Confirmed RPC reads are not an atomic snapshot: the WIF legacy pre-read was slot 454076926 and simulation slot 454076925. Its raw simulation pre-wallet balance agreed with the separate pre-read; no slot acceptance rule was added. SELL effects, funded/preexisting ATA live cases and executor integration remain untested in this follow-up. Nothing was signed/sent and no database was connected.

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

## 7. Approved executor wiring and live results — 2026-10-07

Branch `b5a-lookup-tables`; wiring commit `531b67b`. The earlier pending-approval statements are historical checkpoints. No merge or push. All times below are UTC. Artifact directory: `C:\Users\gifar\AppData\Local\Temp\opencode\`.

### Step verdicts

| Step | Status | Evidence |
|---|---|---|
| Fail-closed executor wiring | PASS | Table messages resolve before verification; resolution refusal records its code and never simulates. |
| Required unit tests | PASS | 135 tests: tx-verify 75, solana 35, executor 25. Fake-only executor tests; no scratch DB or integration suite. |
| Root typecheck | PASS | `npm run typecheck`. |
| Local DB and before-state | PASS | Printed/confirmed `localhost:5432/narra`; read-only 50-table baseline before service writes. |
| Permissions/risk/mints | PASS | AUTO, enabled/unpaused/unrevoked, kill OFF; drawdown 0; Governor EXECUTE at 0.006325 SOL; classic BONK/WIF with null authorities and no extensions. |
| Service ordering/isolation | PASS | Executor → workers → API → fresh seed; startup `canSign:false, allowlisted:1, rpc:true`, caps 0.01/0.05. |
| BONK fan-out/admin retrieval | PASS | Fresh decision `cmuxgdru50003wkdprscunxhx`; RiskDecision `cmuxgedru0008m4dpk5b99q1c`, EXECUTE; ACCEPTED DryRun below. |
| WIF fan-out/admin retrieval | PASS | Fresh decision `cmuxgeg4f0005k0dpeketelip`; RiskDecision `cmuxgfncn004im4dpbwul3nwy`, EXECUTE; ACCEPTED DryRun below. |
| Kill ON, reason drill | FAIL | New decision `cmuxgfphr0003b0dprr9m7mxg` stopped at RiskDecision `QUOTE_UNAVAILABLE`; did not reach `KILL_SWITCH` or create a DryRun. |
| Zero external calls before kill rejection | FAIL | Two balance calls and Jupiter quote occurred; earlier run also reached `KILL_SWITCH` only after those calls. |
| Malformed switch | SKIPPED | Harness stopped after the quote blocker; malformed value was never written. |
| Pause/revoke | SKIPPED | Same stop; no pause/revoke mutation or queued pause drill occurred. |
| Hard cap 0.005 | SKIPPED | Same stop; no reduced-cap executor was launched. |
| Forbidden-key / live-mode startup | PASS | Each refused startup, exit 1, before connections. |
| Restoration | PASS | Target AUTO/enabled/unpaused/unrevoked; kill OFF with reason; owned services stopped; final wallet 126491456 lamports. |
| Captured-phase undo | PASS | Exact net row inverse generated and validated in memory against all 50 tables; not executed. |
| Entire earliest-phase undo | FAIL | Earlier before-images are missing; reconstructed fixture/modes and candidate inventory are explicitly marked. |
| SELL / funded or preexisting ATA effects | SKIPPED | Wallet has no input tokens; these real-effect cases remain untested. |

Test command: `npx vitest run packages/tx-verify packages/solana workers/executor/src/dryRun.test.ts workers/executor/src/config.test.ts workers/executor/src/isolation.test.ts`. The seven new fake-only wiring tests cover missing/wrong-owner/RPC-failed tables, successful resolution, legacy and static-v0 paths, closed-wSOL effects, differing slot evidence, and the existing quote window.

The initial balance was 126491456 lamports. Today's real BUY input spend was zero; the preexisting 0.4-SOL confirmed fixture order is dated September 30. Each fresh decision's Order/RiskDecision handled-key counts were zero before its fan-out. BONK's tick considered 88 users/enqueued 76; WIF's considered 176/enqueued 76 (76 already handled, 24 paused). The target had no new Orders in either run. The admin endpoint was read with an in-memory token for the exact subject `privy-t1790913551573`.

### Accepted DryRuns

| Field | BONK | WIF |
|---|---|---|
| DryRun ID | `cmuxgedqv0006m4dp3b7vux83` | `cmuxgfnbu004gm4dplxg63e3u` |
| Created UTC | 01:53:28.850 | 01:54:27.928 |
| Outcome / reasons | ACCEPTED / `[]` | ACCEPTED / `[]` |
| Quote input (lamports) | 6325000 | 6325000 |
| Quote expected output (base units) | 20921110711 | 3133101 |
| Quote minimum output | 20711899604 | 3101770 |
| Quote fetched UTC | 01:53:28.358 | 01:54:27.428 |
| Slippage bps / impact % | 100 / 0 | 100 / 0 |
| Compute limit / price micro-lamports | 254723 / 620652 | 79358 / 1482 |
| Priority fee lamports | 158095 | 118 |
| Tables / loaded writable / readonly | 3 / 12 / 11 | 1 / 3 / 4 |
| Lookup context slot | 454080904 | 454081122 |
| Pre-simulation read slot | 454080905 | 454081123 |
| Simulation slot | 454080904 | 454081122 |
| Wallet lamports spent | 7976535 | 7818558 |
| Input tokens spent | 0 | 0 |
| Output tokens gained | 20921110711 | 3133101 |
| Units consumed | 204970 | 63894 |
| Simulation error | null | null |
| Quote-to-simulation ms | 491 | 500 |
| Last valid block height | 432118624 | 432118842 |

Both `summary.policy` objects were exactly:

```json
{"appliedTo":"entry","mintProgram":"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA","hasExtensions":false,"mintAuthority":false,"freezeAuthority":false}
```

Both transactions are version 0 with one required signature and fee payer `puwWB6sLfi8xJZF9viHexhd81vLrw8EBpfLy8aG4QSH`. Their ordered top-level instructions:

1. ComputeBudget set compute-unit limit (BONK 254723; WIF 79358).
2. ComputeBudget set compute-unit price (BONK 620652; WIF 1482 micro-lamports).
3. AssociatedToken create-idempotent wSOL ATA `6wvpbEjfPDVoJGWiV8mFKp8Mh2ALHaD3SwNvDKkEzWAM`, owned by the user.
4. System transfer 6325000 lamports from the user to that wSOL ATA.
5. Token sync-native on that wSOL ATA.
6. AssociatedToken create-idempotent output ATA, owned by the user, for the corresponding verified mint: BONK `DfEMZijhgeEJmY7vq1dyZbELydznNZCDbX6mMGV3cPyt`; WIF `GbHN7ebuWY3RzvTgEHpk5d4c56qJSihMRCZeXZ2RbWQW`.
7. Jupiter-v6 swap (BONK 59 instruction account references; WIF 21).
8. Token close wSOL ATA back to the user wallet.

Lookup table addresses and complete table address counts (counts are not just the entries used):

| Run | Table | Address count |
|---|---|---:|
| BONK | `5n3XVjKzobrcmGiEK9GWUxbappMi4qJuAnTrevfMUZKg` | 249 |
| BONK | `6RePuBmqSkZ5SeYhctxtdTQRFtmyAEXjtLKmx92J6ibA` | 250 |
| BONK | `BWyPBZphBshQwjn37KtGDKx1dErDfAJnfdCJadvghUhV` | 256 |
| WIF | `8YZUoHNvPSaoBKszkQ2GULhZC2ygiLz7DMAzsmas4Bri` | 245 |

All four table authorities were `9RAufBfjGQjDfrwxeyKmZWPADHSb8HcoqCdrmpqvCr1g`; no organizational attribution is claimed. Loaded program addresses passed as CPI account references do not relax the ban on a loaded top-level program ID.

Message hashes:
- BONK: `f874c638b14c544d15b85ceffdd75fb852cd1da87d725e4092c17b7f32e049e8`
- WIF: `db5eb385361e7b12ef529c751cea374522bc1554bb4dbfe6db8552eed2b5a4a4`

Outputs exactly matched expected quotes (0% shortfall) and exceeded minimums. Both separate pre-reads had null input/output ATAs; simulation returned a zero-lamport empty-data closed-wSOL account and a newly funded output ATA. Input token delta zero represents the transient wSOL lifecycle, not a free swap.

| Run | Swap input | Output ATA rent | Priority | Base fee | Total wallet loss | Residual |
|---|---:|---:|---:|---:|---:|---:|
| BONK | 6325000 | 1488440 | 158095 | 5000 | 7976535 | 0 |
| WIF | 6325000 | 1488440 | 118 | 5000 | 7818558 | 0 |

wSOL rent +1488440/-1488440 nets zero. Independent `getMinimumBalanceForRentExemption(165)` returned 1488440. Raw simulation fees were 163095/5118; each priority amount equals `ceil(limit * microLamportPrice / 1000000)`, leaving base fee 5000. Raw simulation pre-wallet balances both matched the separate pre-read's 126491456; post-wallet balances were 118514921/118672898. A final live balance read still returned 126491456: nothing was sent.

### Cap semantics and kill-switch ordering

The 0.01 per-trade and 0.05 daily caps count **swap input**, not total wallet loss. `preflight.ts:11-18` sums accepted BUY `DryRun.sizeSol` plus non-simulated BUY Orders in QUEUED/SUBMITTED/CONFIRMED since UTC midnight. Lines 54-57 compare that sum plus the new `sizeSol` to the daily cap and compare the new size to the per-trade cap. `dryRun.ts:55-60` persists the approved input size for BUYs. The two acceptances add 0.012650 SOL to the daily counter, although their simulated wallet losses total 0.015795093 SOL.

Separate effect checks constrain wallet loss to swap input plus the configured overhead; `dryRun.ts:139-141` additionally checks hard cap plus overhead. The default overhead is 0.005 SOL (`config.ts:20-26,65-71`), so the latter ceiling is 0.015 SOL. Rent and fees do not enter the daily accumulator. This code was not changed.

New kill-ON attempt, request-start log timestamps before rejection:

| UTC on 2026-10-07 | Event |
|---|---|
| 01:54:28.116 | API received kill ON / reason `drill`; successful response before seeding. |
| 01:55:27.007 | Executor Helius `getBalance`, target wallet. |
| 01:55:27.020 | Executor Helius `getBalance`, target wallet, second read. |
| 01:55:27.244 | Executor Jupiter `/swap/v1/quote`, 6325000 lamports → BONK. |
| 01:55:27.311 | RiskDecision `cmuxggx5b008qm4dpvo36ebvt`: REJECT / `QUOTE_UNAVAILABLE` — “Could not get a fresh quote.” |
| 01:55:27.327 | Execution queue job completed as `quote_failed`. |
| 01:55:27.481 | Final switch value OFF, reason `B5a live/drill session complete: restored off`. |

No mint read, swap build, lookup read or simulation followed that failed quote. The trace did not capture the quote's response status/body, so its underlying HTTP/parse/transport cause is unknown. `execution.ts:69,92-100,119-120` loads state and quotes before entering `dryRunner.run`; only then does `dryRun.ts:76` call preflight. Earlier DryRun `cmux3w935004gv4dp0y3mv9t1` did reject `KILL_SWITCH` (“The kill switch is on: drill”) at 2026-10-06T20:03:27.615, but also after two balance calls and a quote. No ordering fix was made.

All persisted B5a real-service reason codes seen: DryRun `ACCOUNT_NOT_STATIC` (instructions 3 and 6 could not be verified before resolution), `KILL_SWITCH`; RiskDecision `DRAWDOWN_LIMIT` (“The portfolio drawdown limit has been reached”), `QUOTE_UNAVAILABLE` (“Could not get a fresh quote”). Accepted and Governor-approved records have empty reason lists. The standalone probes additionally exposed `TOKEN_ACCOUNT_UNREADABLE`, now covered by the narrow fix; those are not database DryRun records.

### Whole-session changes, restoration and undo

**One file:** `C:\Users\gifar\AppData\Local\Temp\opencode\b5a-whole-session-undo.sql` (not executed). It replaces use of the older standalone BONK undo file; do not apply both. Section A is the exact captured net inverse, Section B reconstructs the 11 modes and deleted fixture, Section C inventories 5268 earlier timestamp candidates with commented candidate deletion SQL. Section C is not an executable complete restoration; early update/delete before-images are missing. In-memory inversion of Section A matched every original row in all 50 snapshot tables; SQL itself was not executed or integration-tested.

| Table | Captured net inserts | Updates | Deletes | Latest run inserts / updates / deletes |
|---|---:|---:|---:|---|
| AgentAnalysis | 5 | 0 | 0 | 3 / 0 / 0 |
| AgentDecision | 5 | 0 | 0 | 3 / 0 / 0 |
| Alert | 44 | 0 | 0 | 0 / 0 / 0 |
| AuditLog | 323 | 0 | 0 | 167 / 0 / 0 |
| ConsensusSignal | 2 | 0 | 0 | 1 / 0 / 0 |
| DecisionOutcome | 4 | 6 | 0 | 2 / 2 / 0 |
| DryRun | 4 | 0 | 0 | 2 / 0 / 0 |
| Notification | 3872 | 0 | 0 | 0 / 0 / 0 |
| Opportunity | 93 | 0 | 0 | 47 / 0 / 0 |
| PortfolioSnapshot | 4 | 0 | 0 | 2 / 0 / 0 |
| RiskDecision | 315 | 0 | 0 | 163 / 0 / 0 |
| SystemSetting | 1 | 2 | 0 | 0 / 3 / 0 |
| Token | 2 | 0 | 0 | 1 / 0 / 0 |
| TokenMetric | 10 | 0 | 0 | 5 / 0 / 0 |
| TokenRiskMetric | 4 | 0 | 0 | 2 / 0 / 0 |
| TrackedWallet | 0 | 24 | 0 | 0 / 24 / 0 |
| TradingPermission | 0 | 1 | 0 | 0 / 1 / 0 |
| WalletCluster | 12 | 0 | 12 | 12 / 0 / 12 |
| WalletMetric | 108 | 0 | 0 | 36 / 0 / 0 |
| WalletProfile | 0 | 36 | 0 | 0 / 36 / 0 |
| WalletRelationship | 12 | 0 | 12 | 12 / 0 / 12 |
| **Total** | **4820** | **69** | **24** | **458 / 66 / 24** |

The earlier captured BONK phase had 4386 inserts / 68 updates / 24 deletes. Phase counts do not simply add to net counts: repeated replacements and updates touch some of the same rows. Full IDs and before/after JSON are retained in `b5a-combined-changes.json` and the SQL. These include synthetic seeds plus worker background writes, not just the target's records. No new Orders, Trades or Positions were observed in either captured phase.

Earlier pre-baseline inventory: two USDC analyses/decisions, 44 alerts, 152 audit rows, one consensus, two outcomes, 4840 notifications, 46 opportunities, two snapshots, 76 risk decisions, one token, three token metrics, one token-risk metric, 12 clusters, 36 wallet metrics, 36 wallet profiles and 12 relationships. Their 12:03–12:14 UTC creation window supports a candidate inventory, not an exact original before-state. Older rows changed/deleted in that phase cannot be reconstructed completely from retained snapshots. The 11 SHADOW users match the `privy-t` fixtures created AUTO in `workers/pipeline/src/prismaStores.integration.test.ts`; Section B lists their exact IDs. The removed target snapshot `cmuqfosnb000cscdp7m8sops1` is reconstructed as 25 SOL, simulated=false, at 2026-09-20T00:00:00 from the same fixture source and the recorded deletion identity. These earlier changes have not been restored.

Environment/process/non-SQL inventory:
- Earlier local test-auth repair changed `.env` `PRIVY_APP_ID` and `PRIVY_VERIFICATION_KEY`; original values are not in the retained before-images. The local `.b5a-test-key.pem` is for API auth tokens, not Solana transactions. No auth key or token is in this report. The wired phase made no `.env` edits.
- Shared API/executor configuration is evidenced by the required child-only `PRIVY_APP_SECRET=''`: merely deleting the variable allows Prisma's root `.env` load to reintroduce it. Root/API values were preserved. The executor used only the specified target allowlist. Child-only `NODE_OPTIONS` installed sanitized read/simulation tracing; it ended with the process.
- Latest owned process roots: executor PID 10308, pipeline 21252, API 19096; all stopped with their process trees after restoration. Subsequent process inspection found no executor/pipeline/API server process. Earlier service launches/stops are known, but their exact PIDs are not retained in this artifact set. Postgres/Redis services were left running.
- Startup probes used only child overrides `EXECUTOR_SIGNING_KEY=x` and `EXECUTOR_MODE=live`; both exited 1 with the expected refusal. No 0.005-cap child was started. Current caps remain 0.01/0.05.
- Kill switch was ON with reason `drill`, then OFF with the recorded completion reason. The finalizer wrote target mode AUTO and permission booleans back to their baseline values (permission `updatedAt` changed). It did not perform the skipped pause/revoke/malformed drills.
- Redis recurring schedules were registered/refreshed for market-data, entry/exit fan-out, outcome-tracking, token-resolution, narrative-ingestion, wallet-discovery, notification-dispatch, wallet-sync, wallet-intelligence, ai-analysis, position-monitor, wallet-funding, portfolio-snapshots and realtime-publish. Jobs, handled results, streams, counters and delayed schedules persist. SQL cannot undo them; no initial Redis dump exists. `b5a-final-redis.json` retains schedule IDs/next scores and queue key counts. They were not blindly deleted because prior schedules/jobs existed.
- Repository initialization, local identity, branch commits and filesystem backup are also outside SQL. Full filesystem backup: `C:\dev\narra-backup-20261007-054521`; it is not a database/Redis backup. No remote, push or merge was added.

Evidence files: `b5a-wired-live-results.json` (admin objects, risk rows, seeds, request/RPC evidence), `b5a-wired-process-log.json` (sanitized logs), `b5a-startup-refusals.json`, `b5a-wired-reconciliation.json`, `b5a-wired-baseline.json`, `b5a-final-database.json`, `b5a-combined-changes.json`, `b5a-prebaseline-candidates.json`, `b5a-final-redis.json`, and the single consolidated SQL. Historical BONK baseline/change/verdict artifacts remain beside them.

### Slot consistency: proposal, no code

The Jupiter-independent [Solana simulateTransaction RPC reference](https://solana.com/docs/rpc/http/simulatetransaction), checked 2026-10-07, **does provide `minContextSlot`**, the minimum evaluation slot. A reviewed follow-up could pass the confirmed pre-read slot to simulation, keep `sigVerify:false` / `replaceRecentBlockhash:false`, and remain inside the existing quote window. This prevents the observed older simulation but does not force identical slots or make separate reads atomic. For exact same-bank effects, evaluate the documented simulation pre/post lamport and token-balance arrays with validated account-index mapping and missing-data handling. This is a proposal only; current slots remain evidence, not acceptance rules.

**B5b readiness remains unestablished:** kill-switch ordering, skipped live drills, SELL effects and funded/preexisting token-account effects remain open. No transaction was signed or sent.
