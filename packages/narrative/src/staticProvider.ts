import type { NarrativeProvider, RawMention, TrendingTopic } from './types';

/** In-memory provider for development and tests. Real providers (X, Reddit, YouTube, news) implement the same interface. */
export class StaticProvider implements NarrativeProvider {
  constructor(public readonly name: string, private readonly topics: { topic: TrendingTopic; mentions: RawMention[] }[]) {}
  async getTrendingTopics() { return this.topics.map((t) => t.topic); }
  async getTopicActivity(topic: TrendingTopic, since: Date) {
    return (this.topics.find((t) => t.topic.externalId === topic.externalId)?.mentions ?? []).filter((m) => m.at >= since);
  }
}
