import { importSPKI, jwtVerify, type KeyLike } from 'jose';
import type { RuntimeSettingsResolver } from './runtime-settings';

/** A verified identity token. The email is null when the token carries none; a missing email never grants access. */
export interface VerifiedIdentity { privyUserId: string; email: string | null }

export interface AuthVerifier {
  /** Resolves to the Privy user id or throws. Callers must not reveal why verification failed. */
  verify(token: string): Promise<{ privyUserId: string }>;
  /** Like verify, and also says when the token expires (ms since the epoch, null when it carries no expiry). Long-lived connections need it. */
  verifyWithExpiry?(token: string): Promise<{ privyUserId: string; expiresAtMs: number | null }>;
  /** Verifies a Privy identity token and returns its linked email when present. Optional: a verifier may not support it. */
  verifyIdentity?(token: string): Promise<VerifiedIdentity>;
}

/**
 * Reads the linked email from a verified Privy identity token. Privy signs this token the same way it signs the access
 * token, so once the signature checks out the address is trusted. The exact claim shape is not guaranteed, so this reads
 * it defensively and returns null when it cannot: an email that cannot be read simply never matches, it is never guessed.
 */
export function linkedEmail(payload: Record<string, unknown>): string | null {
  const clean = (value: unknown) => (typeof value === 'string' && value.includes('@') ? value.trim().toLowerCase() : null);
  const direct = clean(payload.email);
  if (direct) return direct;
  const raw = payload.linked_accounts;
  let accounts: unknown = raw;
  if (typeof raw === 'string') { try { accounts = JSON.parse(raw); } catch { return null; } }
  if (!Array.isArray(accounts)) return null;
  for (const entry of accounts) {
    if (!entry || typeof entry !== 'object') continue;
    const { type, address } = entry as { type?: unknown; address?: unknown };
    if (type === 'email') { const found = clean(address); if (found) return found; }
  }
  return null;
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
    // The identity token carries the same subject and the linked accounts. It is only ever used to learn a verified email.
    async verifyIdentity(token) {
      const { payload } = await jwtVerify(token, await getKey(), { issuer: 'privy.io', audience: opts.appId, algorithms: ['ES256'] });
      if (!payload.sub) throw new Error('Token has no subject');
      return { privyUserId: payload.sub, email: linkedEmail(payload as Record<string, unknown>) };
    },
  };
}

/** Share the runtime cache with public config and origin checks. Only the active key is retained. */
export function createRuntimePrivyVerifier(settings: RuntimeSettingsResolver): AuthVerifier {
  let active: { appId: string; key: string; verifier: AuthVerifier } | undefined;
  const current = async () => {
    const config = await settings.read(), appId = config.privyAppId.value, key = config.privyVerificationKey.value;
    if (!active || active.appId !== appId || active.key !== key) active = { appId, key, verifier: createPrivyVerifier({ appId, verificationKey: key }) };
    return active.verifier;
  };
  const check = async (token: string) => (await current()).verifyWithExpiry!(token);
  return {
    verify: async token => ({ privyUserId: (await check(token)).privyUserId }),
    verifyWithExpiry: check,
    verifyIdentity: async token => (await current()).verifyIdentity!(token),
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
