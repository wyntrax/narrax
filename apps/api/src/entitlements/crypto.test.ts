import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { decodeBase58, verifyWalletProof } from './crypto';
import { authenticateWyntrax, WyntraxEvent } from './wyntrax';
import { VECTOR_BODY, VECTOR_SECRET, VECTOR_SIGNATURE, VECTOR_TIME } from './fixtures.test-support';

describe('strict wallet proof verification (published RFC 8032 vector 1)', () => {
  const address = bs58.encode(Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'));
  const signature = bs58.encode(Buffer.from('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b', 'hex'));
  it('accepts the published valid proof without generating any signing code', () => expect(verifyWalletProof('', signature, address)).toBe(true));
  it('rejects changed message, address, wrong signature, invalid encodings and lengths', () => {
    expect(verifyWalletProof('tampered', signature, address)).toBe(false);
    expect(verifyWalletProof('', signature, 'So11111111111111111111111111111111111111112')).toBe(false);
    for (const value of ['', '0OIl', '1', '1'.repeat(100), signature.slice(1)]) expect(verifyWalletProof('', value, address)).toBe(false);
    expect(decodeBase58('1'.repeat(31), 32)).toBeNull();
  });
});
describe('Wyntrax authentication', () => {
  const now = new Date(Number(VECTOR_TIME) * 1000);
  const headers = { timestamp: VECTOR_TIME, signature: VECTOR_SIGNATURE };
  const check = (h = headers, secret = VECTOR_SECRET, raw = VECTOR_BODY, at = now, previousSecret?: string) => authenticateWyntrax(Buffer.from(raw), h, { secret, previousSecret }, at);
  it('reproduces the exact 300-byte contract vector', () => { expect(Buffer.byteLength(VECTOR_BODY)).toBe(300); expect(check()).toBe(true); });
  it('accepts previous secret only when primary is configured', () => { expect(check(headers, 'rotated', VECTOR_BODY, now, VECTOR_SECRET)).toBe(true); expect(check(headers, '', VECTOR_BODY, now, VECTOR_SECRET)).toBe(false); });
  it('rejects wrong secret and tampering (including whitespace)', () => { expect(check(headers, 'wrong')).toBe(false); expect(check(headers, VECTOR_SECRET, VECTOR_BODY + ' ')).toBe(false); });
  it.each([-301, 301])('rejects clock offset %s seconds', seconds => expect(check(headers, VECTOR_SECRET, VECTOR_BODY, new Date(+now + seconds * 1000))).toBe(false));
  it.each([-300, 300])('accepts clock boundary %s seconds', seconds => expect(check(headers, VECTOR_SECRET, VECTOR_BODY, new Date(+now + seconds * 1000))).toBe(true));
  it.each(['', 'v2=' + 'a'.repeat(64), 'v1=zz', 'v1=' + 'A'.repeat(64), 'v1=' + 'a'.repeat(62), 'v1=' + 'a'.repeat(66)])('rejects malformed signature %s without throwing', signature => expect(check({ ...headers, signature })).toBe(false));
  it('rejects missing/array headers and non-integer timestamps', () => {
    for (const h of [{}, { timestamp: VECTOR_TIME }, { signature: VECTOR_SIGNATURE }, { ...headers, timestamp: 'NaN' }, { ...headers, timestamp: '1791300000.0' }, { ...headers, signature: [VECTOR_SIGNATURE] }]) expect(authenticateWyntrax(Buffer.from(VECTOR_BODY), h, { secret: VECTOR_SECRET }, now)).toBe(false);
  });
});
describe('wire payload schema', () => {
  const event = () => JSON.parse(VECTOR_BODY);
  it('preserves case and accepts expired grants and revocations with null expiry', () => {
    expect(WyntraxEvent.parse(event()).data.wallet).toBe('So11111111111111111111111111111111111111112');
    const e = event(); e.data.validUntil = '2020-01-01T00:00:00Z'; expect(WyntraxEvent.safeParse(e).success).toBe(true);
    e.type = 'membership.revoked'; e.data.validUntil = null; expect(WyntraxEvent.safeParse(e).success).toBe(true);
  });
  it.each(['NONE', 'UNKNOWN', 'early_access', 'pro'])('rejects key %s', key => { const e = event(); e.data.key = key; expect(WyntraxEvent.safeParse(e).success).toBe(false); });
  it('rejects missing/null grant expiry, obsolete wallet lists, wrong chain, invalid base58 and seq', () => {
    for (const change of [(e: any) => { delete e.data.validUntil; }, (e: any) => { e.data.validUntil = null; }, (e: any) => { e.data.wallets = []; }, (e: any) => { e.data.chain = 'evm'; }, (e: any) => { e.data.wallet = '0'.repeat(32); }, (e: any) => { e.data.wallet = '1'.repeat(33); }, (e: any) => { e.data.seq = 1.5; }, (e: any) => { e.data.seq = 0; }, (e: any) => { e.data.seq = Number.MAX_SAFE_INTEGER + 1; }]) { const e = event(); change(e); expect(WyntraxEvent.safeParse(e).success).toBe(false); }
  });
});
