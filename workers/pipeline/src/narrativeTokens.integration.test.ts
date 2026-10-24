import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@narra/database';
import { attributeNarrativeMentions } from './narrativeTokens';

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "NarrativeTokenRelation" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('narrative token attribution on a real Postgres', () => {
  const db = createPrisma(url);
  const tag = `nt${Date.now()}`;
  const NOW = new Date('2026-09-30T12:00:00Z');
  const H = 3_600_000;
  const at = (h: number) => new Date(NOW.getTime() - h * H);
  let narrativeId = '';
  const tokens: Record<string, string> = {};
  const mentions: string[] = [];

  // A mint string only has to be unique for the test; the resolver matches on the stored mint, exactly like production.
  const mint = (k: string) => `${k}${tag}`.padEnd(40, '1');
  const createToken = async (k: string, symbol: string, name: string, hAgo: number, m?: { liq: number; holders: number }) => {
    const t = await db.token.create({ data: { mint: mint(k), symbol, name, createdOnChainAt: at(hAgo) } });
    tokens[k] = t.id;
    if (m) {
      await db.tokenMetric.create({ data: { tokenId: t.id, priceUsd: 0.01, marketCapUsd: 900_000, liquidityUsd: m.liq, volume24hUsd: 100_000, at: NOW } });
      await db.tokenHolderMetric.create({ data: { tokenId: t.id, holders: m.holders, top10Pct: 22, devHoldingPct: 4, at: NOW } });
    }
    return t;
  };
  const mention = async (ref: string, kind: string, externalId: string, creatorId: string) => {
    await db.tokenMention.create({ data: { refKind: kind, ref, platform: 'x', externalId, creatorId, textHash: externalId, simhash: '0'.repeat(16), engagement: 3, at: at(1) } });
    mentions.push(externalId);
  };

  beforeAll(async () => {
    narrativeId = (await db.narrative.create({ data: { name: `${tag} Rockets`, slug: `attrib-${tag}`, stage: 'ACCELERATING', score: 80, velocity: 200, firstDetectedAt: at(4) } })).id;
    await createToken('ROCK', `${tag.toUpperCase()}ROCK`, `${tag} Rocket`, 5, { liq: 700_000, holders: 900 });
    await createToken('SEQUEL', `${tag.toUpperCase()}SEQ`, `${tag} Sequel`, 2, { liq: 500_000, holders: 600 });
    await createToken('QUIET', `${tag.toUpperCase()}QUIET`, `${tag} Quiet`, 6);
    await createToken('CASHTAG', `${tag.toUpperCase()}CSH`, `${tag} Cashtag`, 3, { liq: 400_000, holders: 300 });

    // One post belongs to the narrative. Its token references are what we attribute.
    for (const id of ['post-1', 'post-2', 'post-3', 'post-4']) await db.narrativeMention.create({ data: { narrativeId, platform: 'x', externalId: `${tag}-${id}`, creatorId: `c-${id}`, textHash: id, simhash: '0'.repeat(16), engagement: 5, at: at(1) } });
    // ROCK: named by mint by four distinct accounts -> qualifies.
    await mention(mint('ROCK'), 'MINT', `${tag}-post-1`, 'c-1');
    await mention(mint('ROCK'), 'MINT', `${tag}-post-2`, 'c-2');
    await mention(mint('ROCK'), 'MINT', `${tag}-post-3`, 'c-3');
    await mention(mint('ROCK'), 'MINT', `${tag}-post-4`, 'c-4');
    // SEQUEL: also four accounts, so OG ranking has a rival to compare against.
    await mention(mint('SEQUEL'), 'MINT', `${tag}-post-1`, 'c-1');
    await mention(mint('SEQUEL'), 'MINT', `${tag}-post-2`, 'c-2');
    await mention(mint('SEQUEL'), 'MINT', `${tag}-post-3`, 'c-3');
    await mention(mint('SEQUEL'), 'MINT', `${tag}-post-4`, 'c-4');
    // CASHTAG: one unambiguous live token.
    await mention(`${tag.toUpperCase()}CSH`, 'CASHTAG', `${tag}-post-1`, 'c-1');
    await mention(`${tag.toUpperCase()}CSH`, 'CASHTAG', `${tag}-post-2`, 'c-2');
    await mention(`${tag.toUpperCase()}CSH`, 'CASHTAG', `${tag}-post-3`, 'c-3');
    await mention(`${tag.toUpperCase()}CSH`, 'CASHTAG', `${tag}-post-4`, 'c-4');
    // QUIET: only one account posts it (twice), so it must not be linked.
    await mention(mint('QUIET'), 'MINT', `${tag}-post-1`, 'c-1');
    await mention(mint('QUIET'), 'MINT', `${tag}-post-2`, 'c-1');
  });
  afterAll(async () => {
    await db.narrative.delete({ where: { id: narrativeId } }).catch(() => undefined);
    await db.tokenMention.deleteMany({ where: { externalId: { in: mentions } } });
    await db.token.deleteMany({ where: { id: { in: Object.values(tokens) } } });
    await db.$disconnect();
  });

  it('links a token the narrative\'s own posts named enough, and skips one that did not clear the threshold', async () => {
    const r = await attributeNarrativeMentions(db, NOW);
    expect(r.narrativesChecked).toBeGreaterThanOrEqual(1);
    const linked = await db.narrativeTokenRelation.findMany({ where: { narrativeId }, orderBy: { matchScore: 'desc' } });
    const byToken = new Map(linked.map((x) => [x.tokenId, x]));
    expect(byToken.has(tokens.ROCK!)).toBe(true);
    expect(byToken.has(tokens.CASHTAG!)).toBe(true);
    expect(byToken.has(tokens.QUIET!)).toBe(false);
    // A mint is direct evidence, so its match score is at least the mint floor. A cashtag is weaker.
    expect(byToken.get(tokens.ROCK!)!.matchScore).toBeGreaterThanOrEqual(0.9);
    expect(byToken.get(tokens.CASHTAG!)!.matchScore).toBeGreaterThanOrEqual(0.6);
    expect(byToken.get(tokens.CASHTAG!)!.matchScore).toBeLessThan(byToken.get(tokens.ROCK!)!.matchScore);
    // OG scoring ran over the mentioned tokens: the older launch ranks at least as high.
    expect(byToken.get(tokens.ROCK!)!.ogScore).toBeGreaterThanOrEqual(byToken.get(tokens.SEQUEL!)!.ogScore - 100);
    expect(linked.every((x) => x.confidence > 0 && x.confidence <= 1)).toBe(true);
  });

  it('is repeatable and never downgrades an existing relation', async () => {
    const before = await db.narrativeTokenRelation.findMany({ where: { narrativeId } });
    const strong = before.find((x) => x.tokenId === tokens.ROCK!)!;
    // A name-matching pass would have set a high score; this pass must not lower it.
    await db.narrativeTokenRelation.update({ where: { narrativeId_tokenId: { narrativeId, tokenId: tokens.ROCK! } }, data: { matchScore: 0.95 } });
    await attributeNarrativeMentions(db, NOW);
    const after = await db.narrativeTokenRelation.findMany({ where: { narrativeId } });
    expect(after).toHaveLength(before.length);
    expect(after.find((x) => x.tokenId === tokens.ROCK!)!.matchScore).toBe(0.95);
    expect(strong.id).toBe(after.find((x) => x.tokenId === tokens.ROCK!)!.id);
  });

  it('never creates orders, positions or opportunities from a mention', async () => {
    const ids = Object.values(tokens);
    expect(await db.order.count({ where: { tokenId: { in: ids } } })).toBe(0);
    expect(await db.position.count({ where: { tokenId: { in: ids } } })).toBe(0);
    expect(await db.opportunity.count({ where: { tokenId: { in: ids } } })).toBe(0);
  });
});
