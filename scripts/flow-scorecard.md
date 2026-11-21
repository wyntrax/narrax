# Flow suitability and the flow scorecard

`flowSuitable` is a **behavioural discovery filter** for tracked wallets. It is not a profitability score, an approval, or a guarantee that a flow will publish. The token-flow publisher still applies its own independent-entity, net-size, market, holder and risk gates.

## Criteria

A wallet is flow-suitable only when all of these hold for its `ALL` 30-day performance band:

| Check | Threshold |
| --- | --- |
| History coverage | Complete fresh 30-day scan, or the existing deep live-sample path |
| Performance freshness | Recomputed within 45 minutes |
| Trade cap | Performance snapshot is not capped |
| Cost basis | No invalid trades; unmatched sells within the existing 1.5% tolerance on 100+ closes |
| Sample | At least 20 closes, 5 closed tokens and 7 observed days |
| Hold behaviour | Median first sell and median close at least 30 minutes |
| Position size | Median closed-position spend at least 0.5 SOL |
| Fast exits | Fewer than half of closes under one minute |

The 0.5 SOL position floor matches the flow publisher's per-entity net floor. The 30-minute hold floor is half of the 60-minute flow window. Both are unvalidated starting values and should be reviewed against measured outcomes.

## Where it appears

- `GET /v1/smart-money/rankings?flowOnly=true` returns only flow-suitable wallets and adds `flowSuitable`, `flowReasons` and `flowMetrics` to each item.
- The small-cap wallet leaderboard has a **Flow-suitable only** toggle and a badge. Flow suitability is independent of review readiness, so enabling the filter switches the evaluation group to All.
- `GET /v1/admin/wallets?flowOnly=true` filters the admin review list and shows the same badge and reason list.
- `npm run flows:scorecard` prints a read-only report.

## Scorecard

Run against the configured database:

```bash
npm run flows:scorecard
```

It prints:

- aggregate 1h/4h/24h outcomes by side, entity count, net-flow, liquidity and holder bucket;
- the latest `wallet.research.flowHealth` snapshot, including withheld reasons;
- the blocked-wallet reason distribution and the 15 closest near-miss wallets with a performance snapshot;
- up to 50 flow-suitable tracked wallets, ranked by median hold, median position size and score;
- the criteria used, so a saved report is self-describing.

It never approves a wallet, changes a threshold, or writes to the database.

## Swing-wallet sourcing

Discovery now probes whether the top emerging candidates still hold one of their observed early buys:

- at most 20 candidates per discovery run;
- one current token balance read per candidate;
- a 20-second overall deadline;
- stored as `hold: { checkedAt, tokenId, mint, stillHolding, heldMs }` in `wallet.discovery.emerging`.

`heldMs` is the time since the observed buy, so it is a **lower bound** on how long the wallet has held. A positive balance can include tokens received elsewhere; it is not proof of the original position.

`intakeEmergingWallets` orders candidates by:

1. still holding a token bought at least 30 minutes ago;
2. still holding a shorter-dated token;
3. known median matched spend;
4. repeat participation count.

The spend preview is accepted as either a JSON number or the decimal string actually stored by discovery. Existing tracked and rejected addresses are never re-added, and the current capacity and dust filters still apply. The hold probe is descriptive evidence, not an approval or a claim that the wallet is profitable.

When the 200-wallet discovered cap is full, the intake releases at most two stale provisional wallets per cycle to make room. A released wallet must be older than seven days and have no profile or a score below 50; it is deactivated, not deleted, so its history remains and it can be reactivated.
