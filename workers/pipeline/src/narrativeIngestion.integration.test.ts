import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { StaticProvider, type NarrativeProvider, type RawMention } from '@narra/narrative';
import { ingestNarratives } from './narrativeIngestion';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "NarrativeMention" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('narrative ingestion on a real Postgres', () => {
  const db = createPrisma(url);
  afterAll(async () => { await db.$disconnect(); });
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
    const r = await ingestNarratives(db, [broken, provider], NOW);
    expect(r.providerErrors).toBe(1);
    expect(r.narrativesUpdated).toBe(1);
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
  });
});
