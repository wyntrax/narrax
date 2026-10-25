import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import bs58 from 'bs58';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrisma, Prisma } from '@narra/database';
import { DEFAULT_TIER_REQUIREMENTS } from '@narra/shared';
import { registerEntitlementRoutes } from './routes';
import { grantEarlyAccess } from './grants';
import { tierRequirements, updateLocalSettings } from './settings';
import * as proof from './crypto';

// Scratch database only, like the other entitlement tests. Missing services are failures, not skips.
import { assertTestDatabase } from '../../../../scripts/test-database';
const target = new URL(process.env.DATABASE_URL ?? 'invalid:');
assertTestDatabase(target);
const db = createPrisma(target.toString()), tag = `tier-cfg-${randomUUID()}`;
const keys = ['early_access.enabled', 'early_access.seat_cap', 'early_access.invite_required', 'early_access.closes_at', 'early_access.access_days', 'access.tier_requirements', 'access.token_symbol', 'access.token_mint'];
let saved: Awaited<ReturnType<typeof db.systemSetting.findMany>>, at = new Date('2026-10-10T00:00:00Z');
const verifier = { verify: vi.fn(async () => { throw Error('Public routes must not authenticate'); }) };
const make = async () => { const app = Fastify(); await app.register(rateLimit, { global: false }); registerEntitlementRoutes(app, { db, verifier, now: () => at }); return app; };
const address = (n: number) => bs58.encode(Buffer.from(proof.hash(`${tag}:${n}`), 'hex'));
const admin = `${tag}-admin`, plain = `${tag}-plain`, joiner = `${tag}-joiner`;
async function put(key: string, value: Prisma.InputJsonValue) { await db.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } }); }
async function reset() { await db.systemSetting.deleteMany({ where: { key: { in: keys } } }); await put('early_access.enabled', true); await put('early_access.seat_cap', 50); }

beforeAll(async () => {
  saved = await db.systemSetting.findMany({ where: { key: { in: keys } } });
  await db.user.create({ data: { id: admin, privyUserId: admin, isAdmin: true } });
  await db.user.create({ data: { id: plain, privyUserId: plain } });
  await db.user.create({ data: { id: joiner, privyUserId: joiner } });
  await db.linkedWallet.create({ data: { userId: joiner, chain: 'solana', address: address(1), verifiedAt: new Date('2026-10-01T00:00:00Z') } });
});
beforeEach(async () => { at = new Date('2026-10-10T00:00:00Z'); await db.accessGrant.deleteMany({ where: { userId: { startsWith: tag } } }); await reset(); });
afterAll(async () => {
  try {
    await db.accessGrant.deleteMany({ where: { userId: { startsWith: tag } } });
    await db.auditLog.deleteMany({ where: { userId: { startsWith: tag } } });
    await db.linkedWallet.deleteMany({ where: { userId: { startsWith: tag } } });
    await db.user.deleteMany({ where: { id: { startsWith: tag } } });
    await db.systemSetting.deleteMany({ where: { key: { in: keys } } });
    for (const row of saved) await db.systemSetting.create({ data: { ...row, value: row.value === null ? Prisma.JsonNull : row.value } });
  } finally { await db.$disconnect(); }
});

describe('public tier requirements', () => {
  it('returns stored artwork for the configured mint and rejects artwork bound to another mint',async()=>{
    const token=await db.token.create({data:{mint:address(101),symbol:'ART',name:'Artwork fixture'}});
    const key=`research.market.${token.id}`,imageUrl='https://cdn.dexscreener.com/cms/images/tier-artwork.png';
    const evidence={mint:token.mint,imageUrl,metricId:'artwork-fixture',at:at.toISOString(),source:'dexscreener',marketCapIsFdv:false,priceChange1hPct:null,pairAddress:'fixture',dexId:null,pairCreatedAt:null};
    const app=await make();
    try{
      await put('access.token_mint',token.mint);await put(key,evidence);
      expect((await app.inject('/v1/access/requirements')).json().tokenImageUrl).toBe(imageUrl);
      await put(key,{...evidence,mint:address(102)});at=new Date(+at+31000);
      expect((await app.inject('/v1/access/requirements')).json().tokenImageUrl).toBeNull();
    }finally{await app.close();await db.systemSetting.deleteMany({where:{key}});await db.token.delete({where:{id:token.id}});}
  });
  it('is unauthenticated and returns the owner defaults and personal PRO features when nothing is saved', async () => {
    const app = await make();
    try {
      const r = await app.inject('/v1/access/requirements');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ tokenSymbol: '$WYNTRAX', tokenMint: null, tiers: DEFAULT_TIER_REQUIREMENTS, earlyAccess: { closesAt: null, accessDays: null }, featureTiers: { 'research.chat': 'EARLY_ACCESS', 'research.personal_radar': 'PRO', 'research.thesis_tracker': 'PRO', 'research.personal_briefing': 'PRO' } });
      expect(r.json().tiers).not.toHaveProperty('ELITE');
      expect(verifier.verify).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('serves what the admin saved, after the 30 second cache', async () => {
    const app = await make();
    try {
      expect((await app.inject('/v1/access/requirements')).json().tiers.MEMBER).toBe(500_000);
      await updateLocalSettings(db, admin, { 'access.tier_requirements': { MEMBER: 250_000, PRO: 750_000, ELITE: 5_000_000 }, 'access.token_symbol': '$WYN', 'access.token_mint': 'So11111111111111111111111111111111111111112', 'early_access.closes_at': '2026-12-01T00:00:00.000Z', 'early_access.access_days': 14 }, 'Launch pricing');
      expect((await app.inject('/v1/access/requirements')).json().tiers.MEMBER).toBe(500_000); // still cached
      at = new Date(+at + 31_000);
      expect((await app.inject('/v1/access/requirements')).json()).toMatchObject({ tokenSymbol: '$WYN', tokenMint: 'So11111111111111111111111111111111111111112', tiers: { MEMBER: 250_000, PRO: 750_000 }, earlyAccess: { closesAt: '2026-12-01T00:00:00.000Z', accessDays: 14 } });
    } finally { await app.close(); }
  });
  it('rejects tiers that do not increase, junk symbols and non-admin writers, and writes nothing', async () => {
    await expect(updateLocalSettings(db, admin, { 'access.tier_requirements': { MEMBER: 1_000_000, PRO: 1_000_000, ELITE: 2_000_000 } }, 'bad order')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(updateLocalSettings(db, admin, { 'access.token_symbol': '<script>' }, 'bad symbol')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(updateLocalSettings(db, admin, { 'access.token_mint': 'not-an-address' }, 'bad mint')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(updateLocalSettings(db, plain, { 'access.token_symbol': '$ABC' }, 'not an admin')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await db.systemSetting.count({ where: { key: { in: ['access.tier_requirements', 'access.token_symbol', 'access.token_mint'] } } })).toBe(0);
  });
  it('audits every change with the reason', async () => {
    await updateLocalSettings(db, admin, { 'access.token_symbol': '$WYN' }, 'Rename ticker');
    const rows = await db.auditLog.findMany({ where: { userId: admin, action: 'entitlements.setting_changed' }, orderBy: { createdAt: 'desc' }, take: 1 });
    expect(rows[0]?.detail).toMatchObject({ key: 'access.token_symbol', after: '$WYN', reason: 'Rename ticker' });
  });
  it('fails with 503 rather than showing defaults when a stored value is corrupt', async () => {
    await put('access.tier_requirements', { MEMBER: 9, PRO: 2, ELITE: 1 });
    await expect(tierRequirements(db)).rejects.toMatchObject({ code: 'ENTITLEMENTS_UNAVAILABLE' });
    const app = await make();
    try { expect((await app.inject('/v1/access/requirements')).statusCode).toBe(503); } finally { await app.close(); }
  });
});

describe('early-access time window', () => {
  it('reads as closed on the public status once the closing time has passed', async () => {
    await put('early_access.closes_at', '2026-10-09T00:00:00.000Z');
    const app = await make();
    try {
      const value = (await app.inject('/v1/early-access/status')).json();
      expect(value).toEqual({ enabled: false, seatsLeft: null, inviteRequired: false });
    } finally { await app.close(); }
  });
  it('stays open before the closing time and with no closing time', async () => {
    const app = await make();
    try {
      expect((await app.inject('/v1/early-access/status')).json().enabled).toBe(true);
      await put('early_access.closes_at', '2026-10-11T00:00:00.000Z');
      at = new Date(+at + 31_000);
      expect((await app.inject('/v1/early-access/status')).json().enabled).toBe(true);
    } finally { await app.close(); }
  });
  it('refuses a new join after the window ends, and admits before it', async () => {
    await put('early_access.closes_at', '2026-10-09T00:00:00.000Z');
    await expect(grantEarlyAccess(db, joiner, { tier: 'EARLY_ACCESS', validUntil: null, reason: 'Self join' }, null, at)).rejects.toMatchObject({ code: 'EARLY_ACCESS_CLOSED' });
    await put('early_access.closes_at', '2026-10-11T00:00:00.000Z');
    const grant = await grantEarlyAccess(db, joiner, { tier: 'EARLY_ACCESS', validUntil: null, reason: 'Self join' }, null, at);
    expect(grant.status).toBe('ACTIVE');
  });
  it('keeps a seat that was taken before the window ended', async () => {
    await put('early_access.closes_at', '2026-10-11T00:00:00.000Z');
    const grant = await grantEarlyAccess(db, joiner, { tier: 'EARLY_ACCESS', validUntil: null, reason: 'Self join' }, null, at);
    await put('early_access.closes_at', '2026-10-09T00:00:00.000Z');
    const again = await grantEarlyAccess(db, joiner, { tier: 'EARLY_ACCESS', validUntil: null, reason: 'Self join' }, null, at);
    expect(again.id).toBe(grant.id);
    expect(again.status).toBe('ACTIVE');
  });
});

describe('early-access seat length', () => {
  it('gives a self-joined seat the admin-set number of days', async () => {
    await put('early_access.access_days', 14);
    const grant = await grantEarlyAccess(db, joiner, { tier: 'EARLY_ACCESS', validUntil: null, reason: 'Self join' }, null, at);
    expect(grant.validUntil?.toISOString()).toBe(new Date(+at + 14 * 86_400_000).toISOString());
  });
  it('leaves the seat without an expiry when no length is set', async () => {
    const grant = await grantEarlyAccess(db, joiner, { tier: 'EARLY_ACCESS', validUntil: null, reason: 'Self join' }, null, at);
    expect(grant.validUntil).toBeNull();
  });
  it('does not override the expiry an admin chose when whitelisting', async () => {
    await put('early_access.access_days', 14);
    const until = new Date(+at + 90 * 86_400_000);
    const grant = await grantEarlyAccess(db, joiner, { tier: 'EARLY_ACCESS', validUntil: until, reason: 'Whitelisted' }, admin, at);
    expect(grant.validUntil?.toISOString()).toBe(until.toISOString());
  });
});
