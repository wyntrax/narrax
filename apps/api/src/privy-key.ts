import { createPublicKey } from 'node:crypto';

export type PrivyKeyCheck = { ok: true } | { ok: false; error: 'INVALID_PRIVY_KEY' | 'PRIVY_KEY_MISMATCH' | 'PRIVY_UNREACHABLE' };
/** Compares only public EC coordinates. Errors never carry response bodies or key material. */
export async function checkPrivyKey(appId: string, raw: string, opts: { fetcher?: typeof fetch; url?: string } = {}): Promise<PrivyKeyCheck> {
  let mine;
  try {
    if (!raw.trim().startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error();
    mine = createPublicKey(raw.replace(/\\n/g, '\n')).export({ format: 'jwk' });
    if (mine.kty !== 'EC' || mine.crv !== 'P-256' || !mine.x || !mine.y) throw new Error();
  } catch { return { ok: false, error: 'INVALID_PRIVY_KEY' }; }
  try {
    const response = await (opts.fetcher ?? fetch)(opts.url ?? `https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (response.status === 404) return { ok: false, error: 'PRIVY_KEY_MISMATCH' };
    if (!response.ok) return { ok: false, error: 'PRIVY_UNREACHABLE' };
    const body: unknown = await response.json();
    const keys = (body as { keys?: unknown })?.keys;
    if (!Array.isArray(keys)) return { ok: false, error: 'PRIVY_UNREACHABLE' };
    return keys.some(k => k && k.kty === 'EC' && k.crv === 'P-256' && k.x === mine.x && k.y === mine.y)
      ? { ok: true } : { ok: false, error: 'PRIVY_KEY_MISMATCH' };
  } catch { return { ok: false, error: 'PRIVY_UNREACHABLE' }; }
}
