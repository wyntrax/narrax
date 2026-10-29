import { describe, expect, it } from 'vitest';
import { earlyAccessAdmission, featureAllowed, resolveEntitlements, usedSeats, type EntitlementSnapshot, type LocalGrant } from './entitlements';
const now = new Date('2026-10-07T12:00:00Z');
const later = new Date('2026-10-08T12:00:00Z');
const grant: LocalGrant = { id: 'g', userId: 'u', tier: 'EARLY_ACCESS', source: 'EARLY_ACCESS', status: 'ACTIVE', validUntil: null };
const snapshot = (): EntitlementSnapshot => ({ userId: 'u', linkedWallets: [{ chain: 'solana', address: 'CaseSensitive', userId: 'u', verifiedAt: now }], grants: [grant], memberships: [], earlyAccessEnabled: true });
const membership = (key = 'PRO', address = 'CaseSensitive') => ({ membershipId: 'm', chain: 'solana', address, key, status: 'ACTIVE', validUntil: later });
describe('pure entitlement resolution', () => {
  it.each(['EARLY_ACCESS','MEMBER','PRO','ELITE'])('requires an active Wyntrax membership for %s while local early access needs no holding', tier => {
    const s = snapshot();
    expect(resolveEntitlements(s, now).effectiveTier).toBe('EARLY_ACCESS');
    expect(resolveEntitlements({ ...s, grants: [] }, now).effectiveTier).toBe('NONE');
    expect(resolveEntitlements({ ...s, grants: [], memberships: [membership(tier)] }, now).effectiveTier).toBe(tier === 'ELITE' ? 'PRO' : tier);
    for (const status of ['PENDING','REVOKED']) expect(resolveEntitlements({ ...s, grants: [], memberships: [{ ...membership(tier), status }] }, now).effectiveTier).toBe('NONE');
    expect(resolveEntitlements({ ...s, grants: [], memberships: [{ ...membership(tier), validUntil: now }] }, now).effectiveTier).toBe('NONE');
  });
  it('defaults to NONE; unknown features never grant', () => {
    expect(resolveEntitlements({ ...snapshot(), grants: [] }, now).effectiveTier).toBe('NONE');
    expect(featureAllowed('ELITE', 'trading')).toBe(false);
  });
  it('an admin holds PRO-equivalent full access with no wallets, grants or memberships', () => {
    const bare: EntitlementSnapshot = { userId: 'u', linkedWallets: [], grants: [], memberships: [], earlyAccessEnabled: false, admin: true };
    const r = resolveEntitlements(bare, now);
    expect(r.admin).toBe(true);
    expect(r.effectiveTier).toBe('PRO');
    expect(r.researchPageLimit).toBe(70);
    expect(Object.values(r.features).every(f => f.allowed)).toBe(true);
    expect(r.sources).toContainEqual({ source: 'ADMIN', id: 'admin', tier: 'PRO', validUntil: null });
    // The flag is opt-in: the same snapshot without it still resolves to NONE.
    expect(resolveEntitlements({ ...bare, admin: false }, now).effectiveTier).toBe('NONE');
    expect(resolveEntitlements({ ...bare, admin: false }, now).admin).toBe(false);
  });
  it('maxes sources across multiple wallets without adding tiers', () => {
    const s = snapshot(); s.linkedWallets = [...s.linkedWallets, { chain: 'solana', address: 'other', userId: 'u', verifiedAt: now }];
    s.memberships = ['MEMBER', 'ELITE', 'PRO'].map((key, i) => ({ ...membership(key, i ? 'other' : 'CaseSensitive'), membershipId: String(i) }));
    expect(resolveEntitlements(s, now)).toMatchObject({ effectiveTier: 'PRO', researchPageLimit: 70 });
  });
  it.each(['NONE', 'UNKNOWN'])('wire tier %s grants nothing', tier => {
    expect(resolveEntitlements({ ...snapshot(), grants: [], memberships: [membership(tier)] }, now).effectiveTier).toBe('NONE');
  });
  it('unlinked wallets, wrong chain, case changes and foreign-user links grant nothing', () => {
    for (const w of [{ chain: 'solana', address: 'nobody' }, { chain: 'evm', address: 'CaseSensitive' }, { chain: 'solana', address: 'casesensitive' }]) {
      expect(resolveEntitlements({ ...snapshot(), grants: [], memberships: [{ ...membership(), ...w }] }, now).effectiveTier).toBe('NONE');
    }
    expect(resolveEntitlements({ ...snapshot(), linkedWallets: snapshot().linkedWallets.map(w => ({ ...w, userId: 'other' })) }, now).effectiveTier).toBe('NONE');
  });
  it('closing admission preserves grants; revocation, expiry and last unlink suppress local access', () => {
    for (const g of [{ ...grant, status: 'REVOKED' }, { ...grant, validUntil: now }, { ...grant, tier: 'ELITE', source: 'ADMIN' }]) expect(resolveEntitlements({ ...snapshot(), grants: [g] }, now).effectiveTier).toBe('NONE');
    expect(resolveEntitlements({ ...snapshot(), earlyAccessEnabled: false }, now).effectiveTier).toBe('EARLY_ACCESS');
    expect(resolveEntitlements({ ...snapshot(), linkedWallets: [] }, now).effectiveTier).toBe('NONE');
    for (const validUntil of [null, now, new Date('invalid')]) expect(resolveEntitlements({ ...snapshot(), grants: [], memberships: [{ ...membership(), validUntil }] }, now).effectiveTier).toBe('NONE');
  });
  it('local disable does not revoke a paid source', () => {
    expect(resolveEntitlements({ ...snapshot(), earlyAccessEnabled: false, memberships: [membership()] }, now).effectiveTier).toBe('PRO');
  });
  it('external early access is independent of local admission and falls back to surviving sources',()=>{
    const s={...snapshot(),earlyAccessEnabled:false,memberships:[membership('EARLY_ACCESS')]};
    expect(resolveEntitlements({...s,grants:[]},now)).toMatchObject({effectiveTier:'EARLY_ACCESS',researchPageLimit:20});
    expect(resolveEntitlements({...s,linkedWallets:[]},now).effectiveTier).toBe('NONE');
    expect(resolveEntitlements({...s,grants:[],memberships:[membership('EARLY_ACCESS','wrong')]},now).effectiveTier).toBe('NONE');
    expect(resolveEntitlements({...s,memberships:[{...membership('EARLY_ACCESS'),status:'REVOKED'}]},now).sources.map(x=>x.source)).toEqual(['EARLY_ACCESS']);
    expect(resolveEntitlements({...s,grants:[],memberships:[membership('EARLY_ACCESS'),{...membership('PRO'),membershipId:'pro'}]},now).effectiveTier).toBe('PRO');
    for(const validUntil of [null,now,new Date('invalid')])expect(resolveEntitlements({...s,grants:[],memberships:[{...membership('EARLY_ACCESS'),validUntil}]},now).effectiveTier).toBe('NONE');
  });
  it('independent memberships fall back ELITE to PRO to MEMBER without revoking a peer', () => {
    const s = snapshot(); s.memberships = ['MEMBER', 'PRO', 'ELITE'].map(key => ({ ...membership(key), membershipId: key }));
    expect(resolveEntitlements(s, now).effectiveTier).toBe('PRO');
    s.memberships = s.memberships.map(m => m.key === 'ELITE' ? { ...m, status: 'REVOKED' } : m);
    expect(resolveEntitlements(s, now).effectiveTier).toBe('PRO');
    s.memberships = s.memberships.map(m => m.key === 'PRO' ? { ...m, validUntil: now } : m);
    expect(resolveEntitlements(s, now).effectiveTier).toBe('MEMBER');
  });
  it('counts distinct active EARLY_ACCESS users including ADMIN, independent of wallets/Wyntrax', () => {
    expect(usedSeats([grant, { ...grant, id: 'a', source: 'ADMIN' }, { ...grant, userId: 'v' }, { ...grant, userId: 'expired', validUntil: now }, { ...grant, userId: 'revoked', status: 'REVOKED' }], now)).toBe(2);
  });
  it('admission respects cap and preserves existing seats after lowering the cap', () => {
    const s = { enabled: true, cap: 1, occupied: 1, hasWallet: true, alreadySeated: false, inviteRequired: false };
    expect(earlyAccessAdmission(s)).toBe('EARLY_ACCESS_FULL');
    expect(earlyAccessAdmission({ ...s, cap: 0, alreadySeated: true })).toBeNull();
    expect(earlyAccessAdmission({ ...s, cap: 2 })).toBeNull();
    expect(earlyAccessAdmission({ ...s, enabled: false })).toBe('EARLY_ACCESS_DISABLED');
    expect(earlyAccessAdmission({ ...s, hasWallet: false })).toBe('VERIFIED_WALLET_REQUIRED');
    expect(earlyAccessAdmission({ ...s, inviteRequired: true })).toBe('INVITES_UNAVAILABLE');
  });
});
