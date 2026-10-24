import { normalizeTopic } from './normalize';
import type { TregTopic } from './tregProvider';

/**
 * Ready-made watchlist topics. The radar is a WATCHLIST: it only looks at what is listed here, so a single
 * "solana" topic can only ever show one narrative. A pack is a set of searches chosen for one kind of user.
 *
 * Honest limits: every query is a starting guess, not tuned against outcomes. Social search is sampled and
 * ranked by the provider, so counts are indications, not totals. Topic NAMES matter because token matching
 * compares name words (4+ letters) with token names and symbols, so each name carries a word a real token
 * could plausibly use. Add a specific theme you see on your timeline with TREG_NARRATIVE_TOPICS.
 */
export const TOPIC_PACKS = {
  /** The base Solana watch, kept so nothing changes for anyone already running it. */
  solana: {
    description: 'One broad Solana topic (the previous default).',
    topics: [
      { name: 'Solana ecosystem', query: 'solana' },
    ],
  },
  /** Memecoin culture on Solana: launch meta, community takeovers, early low caps. */
  trencher: {
    description: 'Memecoin trenches: pump.fun meta, community takeovers, low-cap gems, viral memes, AI-agent coins.',
    topics: [
      { name: 'Pumpfun meta', query: 'pump.fun OR pumpfun OR "pump fun" OR "bonding curve" OR "just migrated"' },
      { name: 'Community takeover', query: 'solana ("community takeover" OR CTO OR "CTO\'d" OR "dev left" OR "dev abandoned")' },
      { name: 'Lowcap gems', query: 'solana ("low cap" OR lowcap OR "micro cap" OR "under 100k" OR "sub 100k" OR "early gem")' },
      { name: 'Viral memes', query: 'solana (memecoin OR meme) (viral OR trending OR "new meta" OR "meta rotation")' },
      { name: 'Agent coins', query: 'solana ("AI agent" OR "AI agents" OR "agent coin" OR "agentic") (token OR coin OR memecoin)' },
    ],
  },
  /**
   * Posts that tend to carry a contract address or a $TICKER call. The ingestion step pulls those references out
   * and the social-token scan checks them against market data. Pick this pack with `trencher` only: all three
   * together are 12 topics, over the 10 limit.
   */
  chatter: {
    description: 'Contract drops and ape calls: posts likely to carry a mint address or $TICKER, mined for token discovery.',
    topics: [
      { name: 'Contract drops', query: 'solana ("CA:" OR "contract address" OR "fair launch" OR "just launched" OR "now live")' },
      { name: 'Ape calls', query: '(solana OR sol) (gem OR ape OR "early" OR "send it" OR "100x") ("CA" OR "contract" OR "$")' },
    ],
  },
  /** Longer-term holders: real products, builders, and community-backed projects on Solana. */
  holder: {
    description: 'Long-term holders: DePIN, RWA, DeFi, gaming and builder or community activity on Solana.',
    topics: [
      { name: 'Solana DePIN', query: 'solana (DePIN OR "decentralized physical infrastructure" OR "physical infrastructure")' },
      { name: 'Solana RWA', query: 'solana (RWA OR "real world assets" OR "tokenized" OR "tokenised")' },
      { name: 'Solana DeFi', query: 'solana (DeFi OR "liquid staking" OR perps OR "yield vault" OR "lending protocol")' },
      { name: 'Solana gaming', query: 'solana (gamefi OR "on-chain game" OR "onchain game" OR "web3 game" OR "game launch")' },
      { name: 'Builders shipping', query: 'solana ("mainnet launch" OR "shipped" OR "new release" OR "dev update" OR roadmap) (token OR project OR protocol)' },
    ],
  },
} as const satisfies Record<string, { description: string; topics: readonly TregTopic[] }>;

export type TopicPackName = keyof typeof TOPIC_PACKS;
export const TOPIC_PACK_NAMES = Object.keys(TOPIC_PACKS) as TopicPackName[];

/** The most topics one provider run accepts. Kept here so config and provider cannot drift apart. */
export const MAX_TOPICS = 10;

/** Catalog estimate per successful call, reviewed 2026-10-14. Prices can change; Treg's ledger is authoritative. */
export const TREG_CALL_ESTIMATE_USD = { x: 0.00075, reddit: 0.0012, tiktok: 0.0012 } as const;

/** Rough cost of one collection cycle. An estimate for planning, not a billing figure. */
export function estimateCycleCostUsd(topicCount: number, platforms: readonly (keyof typeof TREG_CALL_ESTIMATE_USD)[], pages = 1): number {
  const perTopic = platforms.reduce((sum, p) => sum + TREG_CALL_ESTIMATE_USD[p], 0);
  return Math.round(topicCount * perTopic * pages * 1e6) / 1e6;
}

/**
 * Packs plus custom topics, in one list. Custom topics come first so they win a name clash. Unknown packs, bad
 * topics and too many topics are errors, never silently dropped, because a quietly shorter watchlist looks like
 * a quiet market.
 */
export function mergeTopics(packs: readonly string[], custom: readonly TregTopic[]): TregTopic[] {
  const out: TregTopic[] = [];
  const seen = new Set<string>();
  const add = (t: TregTopic) => {
    const norm = normalizeTopic(t.name);
    if (!norm) throw new Error('INVALID_TREG_TOPIC');
    if (seen.has(norm.slug)) return;
    seen.add(norm.slug);
    out.push({ name: t.name, query: t.query });
  };
  custom.forEach(add);
  for (const pack of packs) {
    if (!Object.hasOwn(TOPIC_PACKS, pack)) throw new Error('INVALID_TREG_PACK');
    TOPIC_PACKS[pack as TopicPackName].topics.forEach(add);
  }
  if (out.length > MAX_TOPICS) throw new Error('TOO_MANY_TREG_TOPICS');
  return out;
}
