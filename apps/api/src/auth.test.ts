import { describe, expect, it } from 'vitest';
import { exportSPKI, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { createPrivyVerifier, describeAuthFailure } from './auth';

const sign = (key: KeyLike, claims: { aud: string; iss?: string; exp?: string }) =>
  new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setSubject('did:privy:abc').setIssuer(claims.iss ?? 'privy.io').setAudience(claims.aud).setExpirationTime(claims.exp ?? '5m').sign(key);

async function setup() {
  const mine = await generateKeyPair('ES256'), other = await generateKeyPair('ES256');
  const verifier = createPrivyVerifier({ appId: 'app-1', verificationKey: await exportSPKI(mine.publicKey) });
  return { mine, other, verifier };
}
const reason = async (work: Promise<unknown>) => { try { await work; return 'accepted'; } catch (e) { return describeAuthFailure(e); } };

describe('describeAuthFailure', () => {
  it('accepts a good token', async () => {
    const { mine, verifier } = await setup();
    expect(await verifier.verify(await sign(mine.privateKey, { aud: 'app-1' }))).toEqual({ privyUserId: 'did:privy:abc' });
  });
  it('names an audience mismatch', async () => {
    const { mine, verifier } = await setup();
    expect(await reason(verifier.verify(await sign(mine.privateKey, { aud: 'other-app' })))).toMatch(/audience mismatch/);
  });
  it('names a signature mismatch', async () => {
    const { other, verifier } = await setup();
    expect(await reason(verifier.verify(await sign(other.privateKey, { aud: 'app-1' })))).toMatch(/signature mismatch/);
  });
  it('names a wrong issuer and an expired token', async () => {
    const { mine, verifier } = await setup();
    expect(await reason(verifier.verify(await sign(mine.privateKey, { aud: 'app-1', iss: 'evil.example' })))).toMatch(/issuer mismatch/);
    expect(await reason(verifier.verify(await sign(mine.privateKey, { aud: 'app-1', exp: '-1m' })))).toMatch(/expired/);
  });
  it('names an unreadable key and a malformed token', async () => {
    const bad = createPrivyVerifier({ appId: 'app-1', verificationKey: '-----BEGIN PUBLIC KEY-----\nnot a key\n-----END PUBLIC KEY-----' });
    expect(await reason(bad.verify('a.b.c'))).toMatch(/could not be read|not a Privy access token/);
    const { verifier } = await setup();
    expect(await reason(verifier.verify('garbage'))).toMatch(/not a Privy access token/);
  });
  it('never includes the token, key or app id', async () => {
    const { mine, verifier } = await setup();
    const token = await sign(mine.privateKey, { aud: 'other-app' });
    const text = await reason(verifier.verify(token));
    expect(text).not.toContain(token); expect(text).not.toContain('app-1'); expect(text).not.toContain('other-app');
  });
});
