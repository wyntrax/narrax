import {describe, expect, it} from 'vitest';
import {effectiveStatus, shortAddress, toPayload, toSettings} from './contracts';

describe('admin settings', () => {
  it('shows API defaults for settings that were never saved', () => {
    expect(toSettings([])).toEqual({enabled: false, cap: 0, domain: '', enforced: false, shadow: true});
  });
  it('reads stored rows', () => {
    const rows = [{key: 'early_access.enabled', value: true}, {key: 'early_access.seat_cap', value: 25}, {key: 'entitlements.wallet_link_domain', value: 'http://localhost:4010'}, {key: 'entitlements.enforced', value: true}, {key: 'entitlements.shadow_log', value: false}];
    expect(toSettings(rows)).toEqual({enabled: true, cap: 25, domain: 'http://localhost:4010', enforced: true, shadow: false});
  });
  it('sends only keys the API accepts, and leaves out an empty domain', () => {
    const body = toPayload({enabled: true, cap: 10, domain: '', enforced: false, shadow: true});
    expect(Object.keys(body).sort()).toEqual(['early_access.enabled', 'early_access.seat_cap', 'entitlements.shadow_log']);
    expect(toPayload({enabled: true, cap: 10, domain: 'http://localhost:4010', enforced: false, shadow: true})['entitlements.wallet_link_domain']).toBe('http://localhost:4010');
  });
});

describe('admin grants', () => {
  const now = Date.parse('2026-10-13T00:00:00Z');
  it('treats an ACTIVE grant past its expiry as expired', () => {
    expect(effectiveStatus({status: 'ACTIVE', validUntil: '2026-10-12T00:00:00Z'}, now)).toBe('EXPIRED');
    expect(effectiveStatus({status: 'ACTIVE', validUntil: '2026-10-14T00:00:00Z'}, now)).toBe('ACTIVE');
    expect(effectiveStatus({status: 'ACTIVE', validUntil: null}, now)).toBe('ACTIVE');
    expect(effectiveStatus({status: 'REVOKED', validUntil: null}, now)).toBe('REVOKED');
  });
  it('shortens long addresses only', () => {
    expect(shortAddress('So11111111111111111111111111111111111111112')).toBe('So11…1112');
    expect(shortAddress('short')).toBe('short');
  });
});

import {parseAmount, parseTierForm, toLocalInput, toTierForm} from './contracts';

describe('admin access levels', () => {
  it('shows the owner defaults when nothing was saved', () => {
    expect(toTierForm([])).toEqual({MEMBER: '500000', PRO: '1000000', symbol: '$WYNTRAX', mint: '', closesAt: '', accessDays: ''});
  });
  it('reads stored rows, and ignores a stored value that no longer validates', () => {
    const rows = [{key: 'access.tier_requirements', value: {MEMBER: 1, PRO: 2, ELITE: 3}}, {key: 'access.token_symbol', value: '$ABC'}, {key: 'early_access.access_days', value: 14}];
    expect(toTierForm(rows)).toMatchObject({MEMBER: '1', PRO: '2', symbol: '$ABC', accessDays: '14'});
    expect(toTierForm(rows)).not.toHaveProperty('ELITE');
    expect(toTierForm([{key: 'access.tier_requirements', value: {MEMBER: 9, PRO: 2, ELITE: 3}}]).MEMBER).toBe('500000');
  });
  it('accepts 500K, 1,000,000 and 1.5M style amounts and rejects the rest', () => {
    expect(parseAmount('500K')).toBe(500000);
    expect(parseAmount('1,000,000')).toBe(1000000);
    expect(parseAmount('1.5m')).toBe(1500000);
    for (const bad of ['', 'abc', '-5', '1e6', '5 tokens', '1..5']) expect(parseAmount(bad)).toBeNull();
  });
  const form = {MEMBER: '500K', PRO: '1M', symbol: '$WYNTRAX', mint: '', closesAt: '', accessDays: ''};
  it('builds the exact payload the API accepts, clearing the limits with null', () => {
    const result = parseTierForm(form);
    expect(result.ok && result.payload).toEqual({'access.tier_requirements': {MEMBER: 500000, PRO: 1000000}, 'access.token_symbol': '$WYNTRAX', 'access.token_mint': null, 'early_access.closes_at': null, 'early_access.access_days': null});
  });
  it('turns a local closing time into an ISO time and a seat length into a number', () => {
    const result = parseTierForm({...form, closesAt: '2026-12-01T09:30', accessDays: '30'});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Date.parse(result.payload['early_access.closes_at'] as string)).toBe(new Date('2026-12-01T09:30').getTime());
      expect(result.payload['early_access.access_days']).toBe(30);
      expect(toLocalInput(result.payload['early_access.closes_at'] as string)).toBe('2026-12-01T09:30');
    }
  });
  it('rejects levels that do not increase, bad amounts, symbols and day counts', () => {
    expect(parseTierForm({...form, PRO: '400K'})).toEqual({ok: false, error: 'order'});
    expect(parseTierForm({...form, PRO: '500K'})).toEqual({ok: false, error: 'order'});
    expect(parseTierForm({...form, PRO: 'lots'})).toEqual({ok: false, error: 'amount'});
    expect(parseTierForm({...form, MEMBER: '0'})).toEqual({ok: false, error: 'amount'});
    expect(parseTierForm({...form, symbol: '<b>'})).toEqual({ok: false, error: 'symbol'});
    expect(parseTierForm({...form, accessDays: '0'})).toEqual({ok: false, error: 'days'});
    expect(parseTierForm({...form, accessDays: '1.5'})).toEqual({ok: false, error: 'days'});
  });
  it('keeps the token mint empty until it is filled in, and only accepts a real-looking address', () => {
    const mint = 'So11111111111111111111111111111111111111112';
    const ok = parseTierForm({...form, mint});
    expect(ok.ok && ok.payload['access.token_mint']).toBe(mint);
    expect(toTierForm([{key: 'access.token_mint', value: mint}]).mint).toBe(mint);
    for (const bad of ['short', '0OIl' + 'a'.repeat(40), mint + 'x'.repeat(10), '<script>alert(1)</script>']) expect(parseTierForm({...form, mint: bad})).toEqual({ok: false, error: 'mint'});
  });
});
