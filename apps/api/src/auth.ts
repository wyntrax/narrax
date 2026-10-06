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
