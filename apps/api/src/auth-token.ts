import { decodeJwt, decodeProtectedHeader } from 'jose';

/** Unverified diagnostic metadata only; never use these claims to authenticate. */
export function rejectedTokenMetadata(token: string) {
  const field = (value: unknown) => typeof value === 'string' ? value.slice(0, 256) : null;
  try {
    const { aud, iss } = decodeJwt(token);
    const { alg, kid } = decodeProtectedHeader(token);
    return { aud: Array.isArray(aud) ? aud.slice(0, 8).map(field) : field(aud), iss: field(iss), alg: field(alg), kid: field(kid) };
  } catch {
    return { aud: null, iss: null, alg: null, kid: null };
  }
}
