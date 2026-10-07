# B5 security review plan: the Executor and AUTO mode

**Status: APPROVED by the owner with the recommended defaults for D1 to D9 (2026-10-05). Only stage B5a (dry run) is built. B5b, B5c and B5d need separate go-aheads.** `CLAUDE.md` rule 9 still applies: no signing, sending or Jito code until the owner approves B5b after reading real dry-run output.

**What B5a changed or decided against this plan (read these):**
- **Token-2022 mints are refused outright** for entries, which is stricter than D6 (D6 named freeze authority, transfer fee and permanent delegate). Any mint extension is also refused. Exits are never refused for a token's authorities, because that would trap the user; they are only recorded.
- **The kill switch is read, but a missing row means "off".** An unreadable row means "on". Before real signing (B5b) this should flip to an explicit "armed" flag so the default is off. Recorded in the B5b checklist.
- **Per-user circuit breakers (consecutive failures, slippage, daily loss) are NOT built.** They need real order history, which does not exist until B5b.
- **The allow list is an environment variable on the executor** (`EXECUTOR_ALLOWLIST_USER_IDS`), not a database setting, so changing it needs a deploy.
- **The quote-to-broadcast window (T7)** is applied as quote-to-simulation in the dry run.
- **Jupiter's own docs say the v1 (Metis) swap API this repo uses "is no longer actively maintained and has been superseded by Swap V2".** The quote client and the new swap builder are on v1. Moving to V2 is an open item before B5b. The transaction verifier does not depend on which API built the transaction.
- **Only the user's wallet and its two token accounts are checked in the simulation.** Other accounts the route touches are not. This is the limit of "check the effects on the user's balances".

What B5 does, in one line: it lets the system sign and send a real Solana swap from a user's wallet, after every existing check has passed. It is the first point where a bug loses real money, so this plan is stricter than the other phases.

---

## Lookup-table review checkpoint (2026-10-07; executor wiring pending approval)

`packages/tx-verify/src/lookupTables.ts` is the separate asynchronous RPC adapter. It belongs beside the verifier because its reason codes, table cap, and validation contract are verifier concerns; its structural RPC port avoids a runtime dependency on the Solana client or application services. `verifySwapTransaction` remains synchronous, with no I/O or clock. `resolvedLookupTables` is optional trusted RPC evidence; absent evidence preserves the original `ACCOUNT_NOT_STATIC` behavior. The new additive `SolanaRpc.getAccountsWithContext` retains the confirmed read's context; the existing `getAccounts` implementation and callers are unchanged.

- Resolve the message's table addresses through our configured RPC, never accept builder-supplied table contents. Check the Address Lookup Table program owner and deserialize with web3.js. Missing/RPC-failed tables yield `LOOKUP_TABLE_UNRESOLVED`; wrong owner, malformed state or any deactivation yield `LOOKUP_TABLE_INVALID`; nonexistent entries yield `LOOKUP_INDEX_OUT_OF_RANGE`. No partial result is usable. `maxLookupTables` applies before RPC and in the verifier.
- Visibility is not permission. Runtime key order is static, all writable lookups, then all readonly lookups. Every existing destination, ownership, mint, instruction, signer, compute and fee check still applies. Program IDs must remain static (`PROGRAM_NOT_STATIC`). No program was added. Token transfers and authority changes remain disallowed. The message hash still hashes exactly the original message.
- The review summary records each used table address, address count and authority, RPC context slot, and each loaded key's message index/table/index/writability. **The context slot is evidence only**, never an acceptance/freshness threshold. Tests assert that changing that slot does not change the verdict.
- Table authorities can append entries, not change existing address entries. Our trust is in Solana's ALT program invariants and the RPC's account data, not the identity of Jupiter's table authority. Jupiter chooses tables; authorities may belong to Jupiter, routing infrastructure or third parties. We have not attributed the captured authorities to organizations. Authorities can append, freeze or deactivate tables. Invalid/deactivated data is rejected even during the protocol's deactivation cooldown. Newly appended entries may not yet be usable by the runtime: simulation, not a custom slot heuristic, checks that.
- A table becoming unavailable/closed before a hypothetical later execution causes account loading to fail, not an entry to be silently redirected. Deactivation may first enter a cooldown in which existing entries remain usable and unchanged; once unusable the transaction fails. This cannot redirect swap funds, although transaction failures can generally incur network fees. There is no sending in this change.
- Jupiter's instruction remains opaque. Simulation resolves its own tables against node state and remains the final balance-effects check; static verification alone is not acceptance. RPC honesty/availability and state changes between checks remain assumptions. Keep `sigVerify:false`, `replaceRecentBlockhash:false`: the built transaction must carry a live blockhash, making the unchanged quote-to-simulation window important.

The captured current-route BONK fixture has two tables; it passes with resolved tables and no remaining verifier reason codes. Without them it retains two `ACCOUNT_NOT_STATIC` reasons. Adversarial pure tests cover foreign SOL/token/close destinations, authority changes, foreign ATA mints/owners, loaded program IDs, table failures, caps and multi-table writable-before-readonly ordering. Legacy routes also verified for BONK and WIF BUY/SELL in the read-only probe, but reduced account budgets still produced tables. These observations do not guarantee no-table routes for all future swaps.

**Separate unresolved blocker:** legacy BUY RPC simulation returned `err:null` for both probe tokens, but the existing effect verifier returned `TOKEN_ACCOUNT_UNREADABLE`, before producing balance deltas. The raw pre/post accounts were not retained, so the cause is not established (closed wSOL account representation is a hypothesis only). The effect checker is unchanged. Kill-switch ordering, host migration, Swap V2, signing/sending/Jito, landing strategy and limits remain outside this patch. Executor wiring and end-to-end rerun await explicit approval.

## 1. What exists today (from the code, not from memory)

| Piece | Where | State |
|---|---|---|
| Risk Governor | `packages/risk/src/governor.ts` | Deterministic. Routes by mode: SHADOW log, PAPER simulate, SEMI_AUTO await confirmation, AUTO `EXECUTE`. Limits in `limits.ts` are hard-coded; user limits can only be stricter. |
| Execution path | `workers/pipeline/src/execution.ts` | Governor, fresh Jupiter quote, Governor again. Then `toExecutor()`. With no `deps.executor` the result is `execution_disabled`. The `Executor` interface (`execute({job,sizeSol,exitFraction,quote}) -> {signature}`) already exists and is unused. |
| Outcome handlers | `workers/pipeline/src/outcomes.ts` | Write paper fills and pending confirmations. **Nothing writes a real Order, Trade or Position.** |
| Queue | `packages/queue` | Execution jobs: one attempt, idempotency key as job id, concurrency 1. |
| Confirmation | `apps/api/src/confirmations.ts` | One atomic claim, then a job `confirm:<id>`, then the Governor re-runs. Ends at `execution_disabled`. |
| Jupiter client | `packages/solana/src/jupiter.ts` | **Quote only.** No swap-transaction call. Quotes are never cached; default freshness 5 s. |
| RPC client | `packages/solana/src/rpc.ts` | Balances, token holdings, signatures, parsed transactions. **No send, no simulate, no signature-status call.** |
| Permissions | `TradingPermission` (`aiTradingEnabled`, `agentPaused`, `delegatedUntil`, `revokedAt`), `Wallet.privyWalletId` | `PUT /v1/ai-access` only flips our flag. Nothing talks to Privy. |
| Schema | `Order` (status PENDING, QUEUED, SUBMITTED, CONFIRMED, FAILED, CANCELLED), `ExecutionAttempt` (quote, signature, error), `Trade` | The shapes already anticipate real orders. |

---

## 2. Assets and who might attack them

**Assets, in order of loss:** (1) user funds in the trading wallet, (2) the app's signing credential, (3) the integrity of the order and trade records, (4) the user's trust (a wrong or repeated trade).

**Actors and failure sources:** a malicious or prompt-injected model output; a hostile token (name, symbol, metadata, token extensions); a hostile or compromised third party (Jupiter response, RPC node, Helius); a compromised API or worker process; a leaked secret; an insider with database or admin access; a bug of ours (the most likely one); the network (crash, retry, duplicate delivery, clock skew).

---

## 3. Threats and the control for each

| # | Threat | Control (all are requirements) |
|---|---|---|
| T1 | A model output reaches a transaction | Unchanged path: Zod, guardrails, Governor, queue, Executor. The Executor accepts only a Governor-approved result produced in the same job, never free text or model-chosen mints, sizes or addresses. The chat agent keeps its read-only tool registry; a test asserts no tool name can reach the Executor. |
| T2 | **The swap transaction does not do what the quote said** (a hostile or buggy builder response) | The Executor never signs what it did not verify. Before signing it decodes the versioned transaction and checks: fee payer is the user's trading wallet; only allowlisted programs (Jupiter, System, Token, Token-2022, Associated Token, Compute Budget, and the Jito tip account if used); no `SetAuthority`, `Approve`, `CloseAccount` to a third party, `Assign`, or SOL transfers other than to the tip account and wrapped-SOL accounts it owns; only the expected signer; instruction count and compute limits within bounds; input and output mints and amounts match the verified quote within the slippage cap; the blockhash is recent. **Any unknown element rejects the trade.** This is the single most important control. |
| T3 | The app's signing credential leaks | It lives only in the executor process (section 5), loaded from a secret store, never in the database, logs, API, or pipeline workers. Privy-side policies (T4) bound what a stolen key can do. A documented rotation procedure and a kill switch (T9) exist before launch. |
| T4 | The credential is used for something we did not intend | A second line of defense at Privy: wallet policies that allow only the allowlisted programs and a per-transaction SOL cap, and deny transfers to non-allowlisted addresses. If our code is fully compromised, the wallet still cannot be drained by a plain transfer. **Needs the owner's Privy plan to support policies (decision D2).** |
| T5 | Duplicate send (retry, crash, redelivery) | Write-ahead: the Order row and the signed transaction's signature and blockhash validity window are persisted **before** broadcast. The unique `idempotencyKey` prevents a second order. The Executor never builds a second transaction for the same order. After a crash an order in `SUBMITTED` is reconciled by signature status only; it is never resent as a new transaction. One BullMQ attempt, no automatic retry. |
| T6 | Lost transaction treated as failed (then re-tried = double spend) | An order is marked `FAILED` only when the signature is not found **and** the blockhash's `lastValidBlockHeight` has passed. Until then it stays `SUBMITTED`. A reconciler job owns that decision. |
| T7 | Stale quote or price | Re-quote immediately before building; verify price impact and slippage with the Governor again; the signed transaction must be broadcast within a short window (starting value 10 s, unvalidated) of that quote or it is discarded and nothing is sent. |
| T8 | Permission changed while the job was queued (revoked, paused, mode switched, delegation expired) | The Executor re-reads `TradingPermission`, `User.mode` and the kill switch **at the last step before signing**, not only when the job was created. Revoke is immediate. Confirmed orders still re-run the full Governor. |
| T9 | Everything goes wrong at once | A global kill switch (`SystemSetting`, admin-only, audited) checked by the Executor before every signature, plus per-user circuit breakers: consecutive failed orders, slippage far above expected, or daily loss reached pauses that user's agent and raises a CRITICAL alert. Exits are never blocked by an entry breaker. |
| T10 | A bug sizes a trade wrong | The Executor has its **own hard cap per transaction** (a constant, independent of the Governor and lower than `GLOBAL_LIMITS.maxPerTradeSol` during the canary), checked against the verified transaction's actual SOL leaving the wallet. Defense in depth, not a replacement for the Governor. |
| T11 | Hostile token (freeze authority, transfer fee, Token-2022 extensions, honeypot, mint authority) | Reuse the existing risk flags. New: refuse tokens whose mint has a freeze authority or a transfer-fee or permanent-delegate extension unless the owner explicitly allows it (D6). A honeypot that passes every check is still possible; the exit path must not depend on one pool (see residual risks). |
| T12 | Front-running and sandwiching (MEV) | Slippage and price-impact caps from the Governor; optional Jito bundle with a capped tip (D3). Not eliminated. |
| T13 | Records are wrong (PnL, positions) | After confirmation, parse the confirmed transaction and write the Trade and Position from **actual balance deltas**, not from the quote. A mismatch beyond tolerance raises an alert and pauses that user. |
| T14 | Logs or alerts leak secrets or addresses | Structured logs redact tokens and keys; no transaction bytes or authorization material in logs; audit rows hold hashes and signatures only. |
| T15 | Withdraw or "exit all" abused | Withdraw is **never reachable from the agent or queue path.** It needs a fresh user authentication and the user's own signer, goes only to the user's registered main wallet, has a cooldown after that address changes, and is rate-limited and audited. Exit-all creates ordinary exit jobs through the same Governor path. Recommended to ship after the executor is proven (D5). |
| T16 | Admin or insider abuse | The admin API gets no signing capability. Kill switch and limit changes are audited with the actor. The executor process is deployed and credentialed separately from the API and the AI/ingestion workers. |

---

## 4. Design

**4.1 Process separation (a requirement).** Today the execution consumer runs inside the pipeline worker (`workers/pipeline/src/main.ts`), the same process that ingests untrusted narrative text and calls the AI. B5 moves execution into a new `workers/executor`: it consumes only the execution queue, has the only copy of the signing credential, makes no AI or narrative calls, and exposes no HTTP surface. The pipeline worker and API keep zero signing capability, so a compromise of the part that reads strangers' text cannot sign.

**4.2 Custody.** Privy embedded wallet owned by the user, with our server authorization key added as an additional signer (Privy "user and server signers"), constrained by Privy policies (T4). We store `Wallet.privyWalletId` as a reference, never a key (rule 4). The exact Privy endpoints, parameters and policy language must be confirmed against the Privy account before coding (section 8); the design only needs three capabilities: sign a given serialized transaction as the wallet, optionally send it, and have wallet-level policies.

**4.3 Executor steps (all fail closed):**
1. Re-check kill switch, permission, mode, delegation expiry, circuit breaker (T8, T9).
2. Re-quote; Governor again (existing).
3. Build the swap transaction from that quote (new Jupiter swap call), with a capped priority fee.
4. **Verify the transaction** (T2). Reject on anything unknown.
5. Check the hard per-transaction cap (T10) and the broadcast window (T7).
6. Write-ahead: Order to `QUEUED`/`SUBMITTED` with blockhash and `lastValidBlockHeight`; an `ExecutionAttempt` row; an audit row (T5).
7. Sign through Privy, then broadcast once (RPC; Jito only if D3).
8. Store the signature, then hand to the confirmation tracker. The job returns; it does not wait in the queue for finality.
9. Tracker/reconciler: confirm via signature status; on success parse the transaction and write Trade, Position, realized PnL from actual deltas (T13); on expiry mark `FAILED` (T6).

**4.4 Schema changes (migration 0008, hand-checked like earlier ones):** Order gets the blockhash, `lastValidBlockHeight`, signature, transaction message hash, and a failure reason; `Trade`/`Position` already carry `simulated`, so real rows are `simulated=false`. A `SystemSetting` row for the kill switch. No private material anywhere.

**4.5 New code, by package (when approved):** `packages/solana`: Jupiter swap call, `sendTransaction`, `simulateTransaction`, `getSignatureStatuses`, `getBlockHeight`. A new pure module (`packages/trading` or `packages/solana`) for transaction decoding and verification: **pure, with the heaviest test coverage in the repo.** `workers/executor`: the Privy signer port, the executor, the tracker and reconciler. `workers/pipeline/src/outcomes.ts`: real-fill handlers beside the paper ones. API: delegation grant and revoke, kill-switch admin route, order status read.

---

## 5. Secrets and deployment

- Signing credential: secret manager or injected env on the executor deployment only; never committed, never in `.env.example` with a value, never logged. Rotation steps written before launch.
- Separate service account, network egress limited to Privy, the RPC provider, and Jupiter. No inbound ports.
- The Privy policy set (T4) is reviewed as code and kept in the repo as a documented JSON, applied by the owner in the Privy dashboard.

---

## 6. Phased delivery. Each stage is a separate approval

| Stage | What it does | Real money? | Gate to the next stage |
|---|---|---|---|
| **B5a. Dry run** | Everything up to and including steps 1 to 5, plus `simulateTransaction` against the real network. **No signing credential exists in this stage.** Records what would have been sent. | No | Verifier passes the hostile-fixture suite; the owner reviews dry-run output for real quotes and finds the verifier's accept and reject decisions correct. |
| **B5b. Canary** | Signing and sending for **one allowlisted user (the owner)**, a tiny hard cap (starting value 0.01 SOL), kill switch and circuit breaker live, reconciler live. | Yes, tiny | A set number of clean round trips (buy, confirm, sell, reconcile) with PnL matching the chain; crash and revoke drills done on the real deployment. |
| **B5c. Widen AUTO** | Remove the allowlist per owner decision; raise the hard cap in steps. | Yes | Security review of the deployed system. |
| **B5d. Wallet flows** | Exit-all, withdraw, wallet creation record. | Yes | Separate review (T15). |

---

## 7. Test plan

**Real (Postgres 16 and Redis, as in the other phases):**
- Verifier: a fixture suite of hostile transactions (extra transfer, `SetAuthority`, unknown program, wrong fee payer, wrong mint or amount, oversized compute, stale blockhash, extra signer, address-lookup-table tricks). Each must reject; the honest swap must accept.
- Write-ahead and crash injection: kill the executor between each step; assert no double send and a correct final state after the reconciler runs.
- Concurrency: simultaneous jobs for one user and one order; one order only.
- Permission races: revoke, pause, mode change, delegation expiry, and kill switch flipped between job creation and signing; nothing signs.
- Caps: hard per-transaction cap, broadcast window, quote staleness.
- State machine: `SUBMITTED` is never marked `FAILED` before the blockhash expires.
- Accounting: Trade, Position and PnL written from balance deltas; mismatch pauses the user.
- Isolation: the API and pipeline worker import no signer; a test fails if they do. No chat or model tool can reach the Executor.

**Only against fakes (must be verified by the owner on real services):** the Privy signing calls and policy enforcement, the Jupiter swap-builder response shape, `simulateTransaction`/`sendTransaction`/signature-status responses, Jito, and everything that depends on mainnet liquidity. Jupiter has no useful devnet, so B5b on mainnet with a tiny amount is the first real test.

---

## 8. Unverified assumptions to confirm before coding

1. Privy: the exact "sign (and optionally send) a Solana transaction as a server signer" endpoint, request and authorization-signature format, and whether the owner's plan supports wallet policies with a program allowlist and a per-transaction value cap. (Privy's public docs describe user and server signers, authorization keys, key quorums, and policies; I have not called any of it.)
2. Jupiter: the swap-transaction endpoint, its response, the quote units (`priceImpactPct` is already flagged unverified in the README), and the API key requirement.
3. RPC provider: `sendTransaction` semantics (preflight, retries), and whether the Helius plan allows the needed call volume.
4. Whether a Jito bundle is wanted at all (D3).

---

## 9. Decisions needed from the owner

Recommended defaults are in bold. Nothing is built until these are answered.

| # | Decision | Recommended |
|---|---|---|
| D1 | Approve this plan and the stage order in section 6, with **B5a (no signing credential) as the first and only thing built until you approve B5b**. | **Yes, B5a first** |
| D2 | Custody: Privy embedded wallets with a server signer **and wallet policies** (T4). If your Privy plan cannot enforce policies, say so: the risk profile changes and I would tighten the Executor caps further. | **Privy + policies** |
| D3 | Submission: plain RPC send, or Jito bundles with a tip. | **RPC first; Jito later, tip capped** |
| D4 | Canary limits: who is on the allowlist, hard cap per transaction, and daily cap. | **Owner only, 0.01 SOL per transaction, 0.05 SOL per day** |
| D5 | Wallet flows: build withdraw and exit-all in B5, or after the executor is proven. | **After (B5d)** |
| D6 | Token policy: refuse mints with a freeze authority, transfer fee or permanent delegate. | **Refuse** |
| D7 | Process separation: move execution into its own `workers/executor` deployment. | **Yes (a requirement of this plan)** |
| D8 | Who holds and rotates the signing credential, and where it is stored. | Owner, in a secret manager |
| D9 | A legal and compliance check on operating a trading service that signs for users (custody, licensing, terms). This is outside what I can assess, and it should happen before B5c. | **Yes, before B5c** |

---

## 10. Residual risks that remain after all of the above

- MEV and sandwiching reduce but are not removed by caps or Jito.
- A honeypot or rug that passes every check can still trap funds; exits depend on liquidity that can vanish.
- Jupiter, the RPC provider and Privy are single points of failure and trust. An outage fails closed (no trade), which can mean a missed exit. The position monitor keeps raising alerts, so the user can act.
- If Privy is compromised, our controls do not protect the wallet.
- Every threshold in this plan (window lengths, caps, breaker counts) is an unvalidated starting value.
- This plan is a design review by the builder. It is not an independent audit. Before B5c an external security review of the deployed executor is recommended.

---

## 11. What approval means

Approving D1 to D9 (or changing them) lets me build **B5a only**. B5b needs a separate go-ahead after you have read the dry-run output. At every stage the summary will say what was tested for real, what only against fakes, and what is unverified.
