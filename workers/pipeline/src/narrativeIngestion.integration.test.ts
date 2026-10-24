import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { StaticProvider, TregNarrativeProvider, type NarrativeProvider, type RawMention } from '@narra/narrative';
import { ingestNarratives } from './narrativeIngestion';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "NarrativeMention" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('narrative ingestion on a real Postgres', () => {
  const db = createPrisma(url);
  afterAll(async () => {
    const records = await db.narrative.findMany({ where: { slug: { endsWith: `-${tag}` } }, select: { id: true } });
    await db.alert.deleteMany({ where: { refId: { in: records.map(n => n.id) }, refType: 'NARRATIVE' } });
    await db.narrative.deleteMany({ where: { id: { in: records.map(n => n.id) } } });
    await db.creator.deleteMany({ where: { handle: { endsWith: tag } } });
    await db.$disconnect();
  });
  const tag = `ni${Date.now()}`.replace(/[^a-z0-9]/g, '');
  const NOW = new Date('2026-09-30T12:00:00Z');
  const slug = `quantum-lobster-${tag}`;
  const WORDS = 'lobster quantum claw qubit shell reef ocean entangle photon lattice market launch demo token'.split(' ');
  let s = 11;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const text = () => Array.from({ length: 8 }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ') + ` ${Math.floor(rnd() * 1e6)}`;
  const mention = (i: number, minutesAgo: number): RawMention => ({
    externalId: `${tag}-m${i}`, platform: i % 2 ? 'x' : 'reddit', creatorHandle: `@User${i % 30}${tag}`, creatorAgeDays: 300, text: text(), engagement: 10, at: new Date(NOW.getTime() - minutesAgo * 60_000),
  });
  const mentions: RawMention[] = [];
  for (let h = 2; h < 26; h++) mentions.push(mention(mentions.length, h * 60 + 5)); // quiet baseline
  for (let i = 0; i < 40; i++) mentions.push(mention(mentions.length, 1 + i)); // surge in the last hour
  const provider = new StaticProvider('static-test', [{ topic: { externalId: 'topic-1', name: `#Quantum LOBSTER ${tag}` }, mentions }]);

  it('creates the narrative, stores hashes only, scores it and raises an alert', async () => {
    const r = await ingestNarratives(db, [provider], NOW);
    expect(r).toMatchObject({ topicsSeen: 1, narrativesUpdated: 1, mentionsStored: 64, stageChanges: 1, providerErrors: 0 });

    const n = await db.narrative.findUniqueOrThrow({ where: { slug }, include: { metrics: true, sources: true, creators: true } });
    expect(n.name.toLowerCase()).toBe(`quantum lobster ${tag}`);
    expect(n.stage).toBe('ACCELERATING');
    expect(n.velocity).toBeGreaterThan(100);
    expect(n.score).toBeGreaterThan(40);
    expect(n.metrics).toHaveLength(1);
    expect(n.sources).toMatchObject([{ provider: 'static-test', externalRef: 'topic-1' }]);
    expect(n.creators.length).toBe(30);
    expect(n.creators.filter((c) => c.role === 'ORIGINATOR')).toHaveLength(1);

    const sample = await db.narrativeMention.findFirstOrThrow({ where: { narrativeId: n.id } });
    expect(Object.keys(sample)).not.toContain('text');
    expect(sample.textHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sample.simhash).toMatch(/^[0-9a-f]{16}$/);

    const alerts = await db.alert.findMany({ where: { refId: n.id } });
    expect(alerts).toMatchObject([{ kind: 'NARRATIVE_ACCELERATING', priority: 'IMPORTANT', refType: 'NARRATIVE' }]);
  });

  it('is repeatable: the same posts are not stored twice and no duplicate alert appears', async () => {
    const r = await ingestNarratives(db, [provider], NOW);
    expect(r).toMatchObject({ mentionsStored: 0, stageChanges: 0 });
    const n = await db.narrative.findUniqueOrThrow({ where: { slug } });
    expect(await db.narrativeMention.count({ where: { narrativeId: n.id } })).toBe(64);
    expect(await db.narrativeMetric.count({ where: { narrativeId: n.id } })).toBe(2);
    expect(await db.alert.count({ where: { refId: n.id } })).toBe(1);
  });

  it('keeps going when one provider fails', async () => {
    const broken: NarrativeProvider = { name: 'broken', getTrendingTopics: async () => { throw new Error('api down'); }, getTopicActivity: async () => [] };
    const failures: string[] = [];
    const r = await ingestNarratives(db, [broken, provider], NOW, { onProviderError: name => { failures.push(name); } });
    expect(r.providerErrors).toBe(1);
    expect(r.narrativesUpdated).toBe(1);
    expect(failures).toEqual(['broken']);
  });

  it('moves the narrative to decaying once activity falls off, with a decay alert', async () => {
    const later = new Date(NOW.getTime() + 60 * 60_000); // an hour on, with no new posts
    const r = await ingestNarratives(db, [provider], later);
    expect(r.stageChanges).toBe(1);
    const n = await db.narrative.findUniqueOrThrow({ where: { slug } });
    expect(n.stage).toBe('DECAYING');
    const kinds = (await db.alert.findMany({ where: { refId: n.id }, orderBy: { createdAt: 'asc' } })).map((a) => a.kind);
    expect(kinds).toEqual(['NARRATIVE_ACCELERATING', 'NARRATIVE_DECAY']);
  });

  it('skips junk topics and future-dated posts', async () => {
    const junk = new StaticProvider('junk', [
      { topic: { externalId: 'j1', name: '!!!' }, mentions: [] },
      { topic: { externalId: 'j2', name: `Future Topic ${tag}` }, mentions: [{ ...mention(9000, 0), at: new Date(NOW.getTime() + 3_600_000) }] },
    ]);
    const r = await ingestNarratives(db, [junk], NOW);
    expect(r.topicsSeen).toBe(1);
    expect(r.mentionsStored).toBe(0);
    expect(await db.narrative.findUnique({ where: { slug: `future-topic-${tag}` } })).toBeNull();
  });

  it('does not create phantom narratives from empty or stale watchlist searches', async () => {
    const provider = new StaticProvider('empty-search', [
      { topic: { name: `Empty Topic ${tag}`, externalId: 'empty' }, mentions: [] },
      { topic: { name: `Old Topic ${tag}`, externalId: 'old' }, mentions: [mention(9200, 60 * 72)] },
    ]);
    expect(await ingestNarratives(db, [provider], NOW)).toMatchObject({ mentionsStored: 0, narrativesUpdated: 0 });
    expect(await db.narrative.count({ where: { slug: { in: [`empty-topic-${tag}`, `old-topic-${tag}`] } } })).toBe(0);
  });

  it('maps Treg records into the same hash-only narrative, preserves source provenance and re-ingests without duplicate mentions', async () => {
    const topic = { name: `Treg Social ${tag}`, query: 'solana' }, timestamp = NOW.getTime() / 1000 - 60;
    const payloads = {
      x: { items: [{ id: `${tag}-social-x`, authorUsername: `alice${tag}`, text: 'social observation x', createdUtc: timestamp, likeCount: 3, replyCount: 1, retweetCount: 1, quoteCount: 0 }] },
      reddit: { posts: [{ id: `${tag}-social-reddit`, author: `bob${tag}`, title: 'social observation reddit', selftext: 'source text', createdUtc: timestamp, score: 2, numComments: 3 }] },
      tiktok: { videos: [{ id: `${tag}-social-tiktok`, author: `carol${tag}`, caption: 'social observation tiktok', createdUtc: timestamp, likes: 3, comments: 1, shares: 1 }] },
    };
    const providers = (['x', 'reddit', 'tiktok'] as const).map(platform => new TregNarrativeProvider({ platform, topics: [topic], now: NOW,
      call: async () => ({ output: { found: true, data: payloads[platform] } }) }));
    expect(await ingestNarratives(db, providers, NOW)).toMatchObject({ narrativesUpdated: 1, mentionsStored: 3, providerErrors: 0 });
    expect(await ingestNarratives(db, providers, NOW)).toMatchObject({ narrativesUpdated: 1, mentionsStored: 0, providerErrors: 0 });
    const record = await db.narrative.findUniqueOrThrow({ where: { slug: `treg-social-${tag}` }, include: { sources: true, mentions: true, creators: true } });
    expect(record.sources.map(s => s.provider).sort()).toEqual(['treg:anyapi:reddit', 'treg:anyapi:tiktok', 'treg:anyapi:x']);
    expect(record.mentions).toHaveLength(3);
    for (const mention of record.mentions) { expect(mention.textHash).toMatch(/^[a-f0-9]{64}$/); expect(mention.creatorAgeDays).toBeNull(); expect(mention).not.toHaveProperty('text'); }
  });
});
