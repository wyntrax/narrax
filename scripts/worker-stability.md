# Pipeline worker starvation investigation — 2026-10-28

## Production observations (read-only)

At 10:58–11:02 UTC, all application containers ran revision `062a2e7`. API and frontend were healthy, but the pipeline worker restarted approximately every two minutes. Six restarts were recorded by 10:59 UTC.

- Logs showed simultaneous BullMQ job-lock renewal failures across unrelated queues, followed by `worker_lock_lost`.
- At 11:00:47 UTC the worker used about one CPU core; its 90-second singleton lease was already absent (`PTTL = -2`) while the process still ran.
- Redis reported no evictions or rejected connections, had no configured memory ceiling, and had been up for over three days. Docker reported no OOM kill.
- Discovery's latest persisted Emerging snapshot was 08:34 UTC; the admission preview correctly blocked selection from that stale snapshot.
- Retained active jobs showed many stalls: wallet-intelligence had 157 on one job. Retained completed-job timestamps are not a complete history of partial work; persisted scan/history checkpoints must also be inspected.

These observations strongly implicate event-loop starvation and lease expiry. The old log's claim that another process had taken over was too specific: expiration or removal also produces a failed renewal. No live-process CPU profiler was attached, so the exact production CPU stack was not directly sampled.

## Local replay of production inputs

A bounded, database-enforced read-only capture collected stored trade inputs for 200 active wallets in the 30-day window ending 11:02:27 UTC. The full computation replay used **255,253 rows**, including the financial values and only the evidence fields read by performance calculation. Records arriving between captures explain the smaller earlier timing-only capture (254,950 rows).

The replay used an in-memory database-shaped recorder: no database writes, provider requests, or production computation were performed. The recorder returned captured rows and recorded the lazy Prisma operations that recomputation would publish. Captures/profiles stay outside the repository.

| Measurement | Before | After |
| --- | ---: | ---: |
| Recompute elapsed time | 46,895 ms | 7,597 ms |
| Longest 10-ms timer gap | 46,896 ms | 581 ms |
| Generated operations | 938 | 938 |
| Wallets scored / unscored | 165 / 35 | 165 / 35 |
| Timing clusters | 3 | 3 |

Both measurements used Node's CPU profiler on the same local machine. About 76% of baseline sampled compute time was attributed to rotation scoring and its nested callback. This is a local comparison, not a production latency promise. JSON-serialized generated operations had identical SHA-256 hashes:

`16430e5a90e6a22d3bd72efdb8a292d163e2e788040f0ef52f312e1775f594cc`

## Fix

`rotationRate` previously checked every buy for each sell, repeatedly comparing `Date` objects. It now sorts numeric buy timestamps, indexes the next different token, and binary-searches the first strictly later buy for each sell. Complexity becomes O(B log B + S log B) rather than O(B × S). Same-time buys remain excluded; the upper time boundary is inclusive; repeated buys, unknown dates and the minimum sell count retain their semantics.

`recomputeWalletIntelligence` appends to grouped arrays instead of copying them on every insert. It yields to the event loop every 2,000 input rows, between global timing calculations, and between wallets, allowing Redis renewal callbacks and other jobs to run. Lazy writes still publish in one transaction. The 90-second lease and fail-on-loss behavior remain enforced.

Regression checks cover seeded comparisons with the original rotation definition, exact boundaries/ties, invalid dates, a large non-rotating history's comparison count, event-loop responsiveness, real PostgreSQL scoring/clustering/publication, performance accounting, and isolated Redis ownership/loss behavior. All 64 targeted tests passed; the three Redis tests were rerun successfully after starting the isolated local test Redis. Backend/web typechecks passed.

## Post-deployment verification

1. Record worker image revision, start time and restart count. Check again across at least two completed wallet-intelligence cycles; a successful deploy health check alone does not establish stability.
2. Check recent worker logs for `worker_lock_lost`, job-lock renewal errors and failed/stalled jobs. Inspect the singleton lease TTL with `redis-cli PTTL narra:pipeline:worker`; repeated samples should renew rather than expire while work runs.
3. Verify a **new completed** wallet-intelligence run and advancing `wallet.evaluation.pipeline` plus `wallet.performance.*` timestamps. Prior active jobs can require BullMQ's normal stalled-job recovery.
4. Run `npm run wallets:candidate-spend` and `npm run wallets:admission-preview` using the deployed environment. Require advancing discovery checkpoints, completed scans, and a fresh Emerging snapshot. The existing 200-wallet capacity can still produce zero feasible additions.
5. Continue the collection-quality observation window before changing admission policy. A fresh snapshot, completed history or faster scoring does not establish wallet profitability or approval.

Production recovery is pending deployment and the checks above. The replay does not exercise production database latency, concurrent jobs, or every possible future dataset. Global timing calculations still run synchronously within their individual stages; measure again if those become the bottleneck.
