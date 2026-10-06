export interface TrendingTopic {
  /** The provider's own id for the topic. */
  externalId: string;
  name: string;
}

/**
 * One post or comment from a provider. `text` is untrusted external content: it is used to compute hashes
 * during ingestion and is never stored or passed to a model as an instruction.
 */
export interface RawMention {
  externalId: string;
  platform: string;
  creatorHandle: string;
  creatorAgeDays: number | null;
  text: string;
  engagement: number;
  at: Date;
}

/** Providers (X, Reddit, YouTube, news, DEX data) all sit behind this. Nothing else knows which one is used. */
export interface NarrativeProvider {
  readonly name: string;
  getTrendingTopics(): Promise<TrendingTopic[]>;
  getTopicActivity(topic: TrendingTopic, since: Date): Promise<RawMention[]>;
}

/** What is kept about a mention. No text. */
export interface MentionPoint {
  externalId: string;
  platform: string;
  creator: string;
  creatorAgeDays: number | null;
  engagement: number;
  at: Date;
  simhash: string;
  textHash: string;
}
