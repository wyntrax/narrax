import { describe, expect, it } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import { rejectedTokenMetadata } from './auth-token';

describe('rejectedTokenMetadata', () => {
  it('extracts only diagnostic fields from a token even when its signature is invalid', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const token = await new SignJWT({ email: 'private@example.test' })
      .setProtectedHeader({ alg: 'ES256', kid: 'key-id' }).setAudience('other-app')
      .setIssuer('privy.io').setSubject('did:privy:private').sign(privateKey);
    const tampered = `${token.slice(0, token.lastIndexOf('.') + 1)}invalid`;
    expect(rejectedTokenMetadata(tampered)).toEqual({ aud: 'other-app', iss: 'privy.io', alg: 'ES256', kid: 'key-id' });
  });

  it('handles malformed tokens without exposing their contents', () => {
    expect(rejectedTokenMetadata('not-a-token')).toEqual({ aud: null, iss: null, alg: null, kid: null });
  });

  it('bounds untrusted metadata and supports multiple audiences', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'x'.repeat(1000) })
      .setAudience(Array.from({ length: 20 }, () => 'y'.repeat(1000))).sign(privateKey);
    const metadata = rejectedTokenMetadata(token);
    expect(metadata.aud).toEqual(Array.from({ length: 8 }, () => 'y'.repeat(256)));
    expect(metadata.kid).toHaveLength(256);
    expect(metadata.iss).toBeNull();
  });
});
