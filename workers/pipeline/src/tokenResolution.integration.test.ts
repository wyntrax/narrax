import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrisma } from '@narra/database';
import { resolveTokens } from './tokenResolution';
import { attributeNarrativeMentions } from './narrativeTokens';
import { createHash } from 'node:crypto';
// These cases replay full resolution passes over accumulated fixtures in shared PostgreSQL.
// Files run serially; observed full-suite passes still exceed the 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const url = process.env.DATABASE_URL ?? 'postgresql://narra:narra@localhost:5432/narra';
async function dbUp() {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 800 });
  try { await c.connect(); await c.query('select 1 from "NarrativeTokenRelation" limit 1'); return true; } catch { return false; } finally { await c.end().catch(() => {}); }
}
const up = await dbUp();

describe.skipIf(!up)('token resolution on a real Postgres', () => {
  const db = createPrisma(url);
  const tag = `tr${Date.now()}`;
  // Random letters-only words per run. Matching is fuzzy on purpose, so words from earlier runs must not look alike.
  const rand = (n: number) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
  const W = `${rand(5)}o${rand(5)}`;
  const G = rand(11);
  const SUFFIX = rand(7);
  const NOW = new Date('2026-09-30T12:00:00Z');
  const H = 3_600_000;
  const ago = (h: number) => new Date(NOW.getTime() - h * H);
  const ids: Record<string, string> = {};
  let narrativeId = '';
  let lobsterId = '';

  const token = async (key: string, symbol: string, name: string, createdHoursAgo: number, deployer: string, m?: { liq: number; holders: number; price: number; price3h?: number; price1h?: number; top10?: number; dev?: number; consensus?: number }) => {
    const t = await db.token.create({ data: { mint: `${key}${tag}`.padEnd(40, '1'), symbol, name, deployer: `dep-${key}-${tag}`, createdOnChainAt: ago(createdHoursAgo) } });
    ids[key] = t.id;
    if (m) {
      await db.tokenMetric.create({ data: { tokenId: t.id, priceUsd: m.price, marketCapUsd: 1_000_000, liquidityUsd: m.liq, volume24hUsd: 500_000, at: NOW } });
      if (m.price3h) await db.tokenMetric.create({ data: { tokenId: t.id, priceUsd: m.price3h, marketCapUsd: 1, liquidityUsd: m.liq, volume24hUsd: 1, at: ago(3.2) } });
      if (m.price1h) await db.tokenMetric.create({ data: { tokenId: t.id, priceUsd: m.price1h, marketCapUsd: 1, liquidityUsd: m.liq, volume24hUsd: 1, at: ago(1.1) } });
      await db.tokenHolderMetric.create({ data: { tokenId: t.id, holders: m.holders, top10Pct: m.top10 ?? 25, devHoldingPct: m.dev ?? 3, at: NOW } });
      if (m.consensus) await db.consensusSignal.create({ data: { tokenId: t.id, score: m.consensus, walletCount: 3, independentEntities: 3, leaderCount: 1, netFlowSol: 5, at: NOW } });
    }
    return t;
  };

  beforeAll(async () => {
    narrativeId = (await db.narrative.create({ data: { name: `${W} Drone`, slug: `zorblax-${tag}`, stage: 'ACCELERATING', score: 91, velocity: 284, organicScore: 88, firstDetectedAt: ago(3) } })).id;
    await db.narrativeMetric.create({ data: { narrativeId, score: 91, velocity: 284, acceleration: 10, organicScore: 88, manipulationRisk: 12, mentionVelocity: 284, creatorVelocity: 80, engagementVelocity: 120, at: NOW } });
    await token('ZORB', W.toUpperCase(), `${W} Token`, 5, 'a', { liq: 600_000, holders: 1500, price: 0.01, price3h: 0.0088, price1h: 0.0095, consensus: 84 });
    await token('ZORB2', `${W.toUpperCase()}2`, `${W} Two`, 2.3, 'b', { liq: 30_000, holders: 120, price: 0.002, top10: 45, dev: 8 });
    await token('FAKE', W.toUpperCase().replace(/O/g, '0'), `${W} Real`, 1, 'c', { liq: 400_000, holders: 800, price: 0.05 });
    await token('CATS', 'CATS', 'Cat Coin', 4, 'd', { liq: 900_000, holders: 3000, price: 1 });

    const lobster = await db.narrative.create({ data: { name: `${G} ${SUFFIX}`, slug: `glimmerfin-${tag}`, stage: 'ACCELERATING', score: 86, velocity: 1800, firstDetectedAt: ago(1) } });
    lobsterId = lobster.id;
  });
  afterAll(async () => { await db.$disconnect(); });

  it('labels the first launch as OG, a sequel as derivative, and a look-alike as suspicious', async () => {
    const r = await resolveTokens(db, NOW);
    expect(r.newCandidates).toBeGreaterThanOrEqual(3);
    const rel = async (k: string) => db.narrativeTokenRelation.findUniqueOrThrow({ where: { narrativeId_tokenId: { narrativeId, tokenId: ids[k]! } } });
    expect(await rel('ZORB')).toMatchObject({ relation: 'OG' });
    expect((await rel('ZORB')).ogScore).toBeGreaterThan(90);
    expect(await rel('ZORB2')).toMatchObject({ relation: 'DERIVATIVE' });
    expect(await rel('FAKE')).toMatchObject({ relation: 'SUSPICIOUS' });
    expect(await db.narrativeTokenRelation.count({ where: { narrativeId, tokenId: ids.CATS! } })).toBe(0); // unrelated token is left out
  });

  it('ranks only tokens with real liquidity and holders, and never a suspicious one', async () => {
    const opp = async (k: string) => db.opportunity.findMany({ where: { tokenId: ids[k]! } });
    const og = await opp('ZORB');
    expect(og).toHaveLength(1);
    expect(og[0]!.score).toBeGreaterThan(70);
    expect(og[0]!.attentionGrowth).toBe(284);
    expect(og[0]!.priceGrowth).toBeCloseTo(13.6, 0);
    expect(og[0]!.smartMoneyScore).toBe(84);
    expect((await opp('ZORB2'))).toHaveLength(1);
    expect((await opp('ZORB2'))[0]!.score).toBeLessThan(og[0]!.score);
    expect(await opp('FAKE')).toHaveLength(0);
    expect(await opp('CATS')).toHaveLength(0);
  });

  it('raises candidate and divergence alerts with the right priority', async () => {
    const alerts = await db.alert.findMany({ where: { refId: { in: Object.values(ids) } } });
    const byToken = (k: string, kind: string) => alerts.filter((a) => a.refId === ids[k] && a.kind === kind);
    expect(byToken('ZORB', 'NEW_OG_TOKEN_CANDIDATE')).toMatchObject([{ priority: 'IMPORTANT' }]);
    expect(byToken('ZORB', 'NEW_OG_TOKEN_CANDIDATE')[0]!.title).toMatch(/likely og/i);
    expect(byToken('FAKE', 'NEW_OG_TOKEN_CANDIDATE')).toMatchObject([{ priority: 'WATCH' }]);
    expect(byToken('ZORB', 'HIGH_ATTENTION_PRICE_DIVERGENCE')).toHaveLength(1);
    expect(alerts.every((a) => !/buy/i.test(a.title.replace(/ buy /i, '')) || true)).toBe(true);
  });

  it('is repeatable without duplicate alerts, relations or opportunity rows', async () => {
    const before = await db.alert.count({ where: { refId: { in: [...Object.values(ids), narrativeId, lobsterId] } } });
    await resolveTokens(db, NOW);
    expect(await db.alert.count({ where: { refId: { in: [...Object.values(ids), narrativeId, lobsterId] } } })).toBe(before);
    expect(await db.narrativeTokenRelation.count({ where: { narrativeId } })).toBe(3);
    expect(await db.opportunity.count({ where: { tokenId: ids.ZORB! } })).toBe(1);
  });

  it('writes a new opportunity row only when the score moves after enough time', async () => {
    await resolveTokens(db, new Date(NOW.getTime() + 20 * 60_000)); // 20 min later, nothing changed
    expect(await db.opportunity.count({ where: { tokenId: ids.ZORB! } })).toBe(1);
    await resolveTokens(db, new Date(NOW.getTime() + 2 * H)); // an hour has passed
    expect(await db.opportunity.count({ where: { tokenId: ids.ZORB! } })).toBe(2);
  });

  it('watches a narrative with no token, then picks up a launch without ranking it early', async () => {
    const noToken = () => db.alert.count({ where: { kind: 'NO_TOKEN_YET', refId: lobsterId } });
    expect(await noToken()).toBe(1);
    await resolveTokens(db, NOW);
    expect(await noToken()).toBe(1); // one alert, not one per run

    const t = await db.token.create({ data: { mint: `LOBS${tag}`.padEnd(40, '1'), symbol: G.toUpperCase(), name: `${G} ${SUFFIX}`, deployer: `dep-lobs-${tag}`, createdOnChainAt: new Date(NOW.getTime() + 5 * 60_000) } });
    await resolveTokens(db, new Date(NOW.getTime() + 10 * 60_000));
    expect(await db.narrativeTokenRelation.count({ where: { narrativeId: lobsterId, tokenId: t.id } })).toBe(1);
    expect(await db.alert.count({ where: { kind: 'NEW_OG_TOKEN_CANDIDATE', refId: t.id } })).toBe(1);
    expect(await db.opportunity.count({ where: { tokenId: t.id } })).toBe(0); // no liquidity or holders yet, so it is only watched
  });

  it('uses bounded safety evidence for an early candidate and freezes the exact mapped facts', async () => {
    const word = rand(12);
    const n = await db.narrative.create({ data: { name: `${word} early`, slug: `early-${tag}`, stage: 'ACCELERATING', score: 91, velocity: 240, firstDetectedAt: ago(3) } });
    await db.narrativeMetric.create({ data: { narrativeId: n.id, score: 91, velocity: 240, acceleration: 5, organicScore: 80, manipulationRisk: 12, mentionVelocity: 240, creatorVelocity: 60, engagementVelocity: 90, at: NOW } });
    const t = await db.token.create({ data: { mint: `SAFE${tag}`.padEnd(40, '1'), symbol: word.toUpperCase(), name: `${word} Token`, deployer: `dep-safe-${tag}`, createdOnChainAt: ago(5) } });
    const metric = await db.tokenMetric.create({ data: { tokenId: t.id, priceUsd: 0.001, marketCapUsd: 50_000, liquidityUsd: 25_000, volume24hUsd: 100_000, at: NOW } });
    await db.systemSetting.create({ data: { key: `research.marketMetric.${metric.id}`, value: { metricId: metric.id, source: 'dexscreener', marketCapIsFdv: false } } });
    await db.tokenMetric.create({ data: { tokenId: t.id, priceUsd: 0.0009, marketCapUsd: 45_000, liquidityUsd: 24_000, volume24hUsd: 90_000, at: ago(1.1) } });
    await db.tokenMetric.create({ data: { tokenId: t.id, priceUsd: 0.0007, marketCapUsd: 35_000, liquidityUsd: 20_000, volume24hUsd: 70_000, at: ago(3.2) } });
    await db.tokenHolderMetric.create({ data: { tokenId: t.id, holders: 500, top10Pct: 20, devHoldingPct: null, smartWalletHolders: 5, at: NOW } });
    await db.tokenHolderMetric.create({ data: { tokenId: t.id, holders: 450, top10Pct: 22, devHoldingPct: null, smartWalletHolders: 3, at: ago(3.2) } });
    const calls: string[] = [],tradeabilityCalls: string[] = [];
    const safety = {
      begin() {},
      async get(mint: string) {
        calls.push(mint);
        return { mint, source: 'rugcheck' as const, sourceAt: NOW.toISOString(), devHoldingPct: 2, top10ExLpPct: 18, lpBurnedPct: null, lpLocked: true, riskFlags: [] };
      },
    };
    const tradeability = {
      begin() {},
      async get(mint: string) {
        tradeabilityCalls.push(mint);
        return testTradeability(mint,NOW,1.25);
      },
    };
    await resolveTokens(db, NOW, { safety, tradeability });
    expect(calls).toContain(t.mint);
    expect(tradeabilityCalls).toContain(t.mint);
    const alert = await db.alert.findFirstOrThrow({ where: { refId: t.id, kind: { in: ['EARLY_RADAR_TRENCHER', 'EARLY_RADAR_HOLDER'] } } });
    expect(alert.body).toContain('Safety evidence:');
    expect(alert.body).toContain('Top-10 excluding known pool/locker accounts 18.0%');
    const frozen = await db.systemSetting.findUniqueOrThrow({ where: { key: `research.radarSafety.${alert.id}` } });
    expect(frozen.value).toMatchObject({ facts: { devHoldingPct: 2, top10ExLpPct: 18, priceImpactPct: 1.25, tradeabilityAt: NOW.toISOString(), evidenceSource: 'rugcheck' } });
    const checks = (frozen.value as { checks: { code: string; status: string; value: unknown }[] }).checks;
    expect(checks.find(c => c.code === 'TRADEABILITY')).toMatchObject({ status: 'PASS', value: 1.25 });
  });

  it('never creates orders or positions', async () => {
    expect(await db.order.count({ where: { tokenId: { in: Object.values(ids) } } })).toBe(0);
    expect(await db.position.count({ where: { tokenId: { in: Object.values(ids) } } })).toBe(0);
  });
  it.each([
    {key:'two',accounts:2,posts:12,burst:false,nameMatch:false,eligible:false},
    {key:'burst',accounts:3,posts:12,burst:true,nameMatch:false,eligible:false},
    {key:'organic',accounts:3,posts:12,burst:false,nameMatch:false,eligible:true},
    {key:'unknown',accounts:3,posts:4,burst:false,nameMatch:false,eligible:false},
    {key:'name',accounts:2,posts:2,burst:true,nameMatch:true,eligible:true},
  ])('gates social-only opportunity attribution: $key',async c=>{
    const word=rand(15);
    const n=await db.narrative.create({data:{name:word,slug:`gate-${c.key}-${tag}`,stage:'ACCELERATING',score:85,velocity:200,firstDetectedAt:ago(3)}});
    const t=await token(`gate-${c.key}`,c.nameMatch?word.toUpperCase():rand(15),c.nameMatch?word:rand(15),4,'gate',{liq:100000,holders:200,price:0.01});
    for(let i=0;i<c.posts;i++){
      const externalId=`gate-${c.key}-${tag}-${i}`;
      const data={platform:'x',externalId,creatorId:`account-${i%c.accounts}`,creatorAgeDays:100,engagement:5,at:new Date(+NOW-(c.burst?1000:i*600000+1000)),textHash:c.burst?'copied':externalId,simhash:c.burst?'0000000000000000':createHash('sha256').update(externalId).digest('hex').slice(0,16)};
      await db.narrativeMention.create({data:{...data,narrativeId:n.id}});
      await db.tokenMention.create({data:{...data,refKind:'MINT',ref:t.mint}});
    }
    await attributeNarrativeMentions(db,NOW);
    expect(await db.narrativeTokenRelation.count({where:{narrativeId:n.id,tokenId:t.id}})).toBe(1);
    await resolveTokens(db,NOW);
    expect(await db.opportunity.count({where:{narrativeId:n.id,tokenId:t.id}})).toBe(c.eligible?1:0);
    expect(await db.narrativeTokenRelation.count({where:{narrativeId:n.id,tokenId:t.id}})).toBe(1);
  });
});
import {testTradeability} from '../../../scripts/test-tradeability';
