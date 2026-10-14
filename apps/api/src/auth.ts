import { importSPKI, jwtVerify, type KeyLike } from 'jose';

export interface AuthVerifier {
  /** Resolves to the Privy user id or throws. Callers must not reveal why verification failed. */
  verify(token: string): Promise<{ privyUserId: string }>;
  /** Like verify, and also says when the token expires (ms since the epoch, null when it carries no expiry). Long-lived connections need it. */
  verifyWithExpiry?(token: string): Promise<{ privyUserId: string; expiresAtMs: number | null }>;
}

/**
 * Verifies a Privy access token locally with the app's verification key, so no network call is needed per request.
 * Privy access tokens are ES256 JWTs with issuer "privy.io", the app id as audience and the user's DID as subject.
 * Confirm these claims against Privy's current docs for your app before going live.
 */
export function createPrivyVerifier(opts: { appId: string; verificationKey: string }): AuthVerifier {
  let key: Promise<KeyLike> | undefined;
  const getKey = () => (key ??= importSPKI(opts.verificationKey.replace(/\\n/g, '\n'), 'ES256'));
  const check = async (token: string) => {
    const { payload } = await jwtVerify(token, await getKey(), { issuer: 'privy.io', audience: opts.appId, algorithms: ['ES256'] });
    if (!payload.sub) throw new Error('Token has no subject');
    return { privyUserId: payload.sub, expiresAtMs: typeof payload.exp === 'number' ? payload.exp * 1000 : null };
  };
  return {
    async verify(token) { return { privyUserId: (await check(token)).privyUserId }; },
    verifyWithExpiry: check,
  };
}

/**
 * A short reason a token was rejected, for the server log only. It never contains a token, key or app id, and clients
 * still receive a bare 401. This turns "401 and no idea why" into one actionable line.
 */
export function describeAuthFailure(e: unknown): string {
  const read = (key: string) => (typeof e === 'object' && e !== null && key in e ? String((e as Record<string, unknown>)[key]) : '');
  const code = read('code'), claim = read('claim'), message = e instanceof Error ? e.message : '';
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
    if (claim === 'aud') return 'audience mismatch: the token was issued for a different Privy app than PRIVY_APP_ID';
    if (claim === 'iss') return 'issuer mismatch: the token was not issued by privy.io';
    return `claim check failed (${claim || 'unknown claim'})`;
  }
  if (code === 'ERR_JWT_EXPIRED') return 'token expired: sign in again, and check the machine clock if it keeps happening';
  if (code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') return 'signature mismatch: PRIVY_VERIFICATION_KEY belongs to a different Privy app than the one that issued the token';
  if (code === 'ERR_JWS_INVALID' || code === 'ERR_JWT_INVALID') return 'not a Privy access token (malformed or the wrong kind of token)';
  if (code === 'ERR_JOSE_ALG_NOT_ALLOWED') return 'token is not signed with ES256';
  if (/spki|pem|key/i.test(message) || e instanceof TypeError) return 'PRIVY_VERIFICATION_KEY could not be read: it must be the full PEM public key from the Privy dashboard';
  return 'token rejected';
}
