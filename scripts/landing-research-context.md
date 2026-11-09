# Landing research snapshot and narrative scope

The public landing page shows aggregate research counts through `/v1/public-research-snapshot`. It exposes no wallet identities, narrative rows, user data or detailed research. Existing private endpoints, tiers and admin bypass remain effective. The public response is cached for 30 seconds per API process and rate-limited to 30 requests/minute per client.

- **Narrative heat:** rounded mean score of the strongest five non-dead narratives (or fewer when fewer exist). The overview now displays up to ten, but heat still uses five.
- **Tracked wallets:** all active tracked wallets, including manual/imported ones. Automatic-discovery occupancy is counted separately against the shared intake cap. A full discovery cohort does not mean discovery is stopped.
- **Opportunity records, 24h:** rows created within the preceding 24 hours, excluding future timestamps. Multiple updates can refer to one token; this is not a count of executed/profitable trades or unique tokens.
- **Narratives in scope:** stored non-dead narratives, not every possible market theme or necessarily every currently configured search.

The fetched-at timestamp describes the aggregate read. The separate narrative observation timestamp is the oldest last metric among the heat sample; missing metrics remain unknown, and observations older than one hour at fetch time are labelled. Failed/malformed reads show unavailable counts; zero remains a measured zero. The page offers manual refresh, not continuous polling.

## Expanding the production watchlist

Read-only inspection found seven configured X topics at a 30-minute interval: Pumpfun meta, Community takeover, Lowcap gems, Viral memes, Agent coins, Contract drops and Ape calls. The former overview showed only five; the new ten-row view can show all seven.

The new **optional** `sectors` pack adds Solana DePIN, Solana RWA and Solana DeFi. To retain the current seven and add these three, the operator can configure:

```dotenv
TREG_NARRATIVE_PACKS=trencher,chatter,sectors
```

Custom `TREG_NARRATIVE_TOPICS` are merged first; account for any extras so the merged list stays within the existing ten-topic bound. Do not combine the full `holder` pack with `trencher,chatter`: that is twelve topics. `sectors` is the three-topic subset that fits. Existing pack defaults and production configuration are not automatically changed by this PR.

At one X page/topic and a 30-minute interval, seven to ten topics means **three additional scheduled search calls per cycle** (about 43% more topic searches; up to 144 additional initial calls/day before retries). Confirm the provider's actual budget/ledger; catalog estimates are not billing guarantees. Newly enabled themes appear only after successful ingestion records observations. They are not seeded with artificial scores or trends.

Deployment of the optional pack code does not enable it. Keep collection changes separate from evaluating the ongoing worker observation window; record the enablement time if the operator expands coverage.
