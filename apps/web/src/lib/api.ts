import type {z} from 'zod';
import {ApiErrorSchema, ChallengeSchema, EntitlementsSchema, GrantSchema, LinkSchema, OkSchema, RequirementsSchema, StatusSchema} from './schemas';
export const REQUEST_TIMEOUT_MS = 10000;
export class ApiError extends Error {
  constructor(readonly code: string, readonly status = 0, readonly retryAfter = 0, readonly requiredTier?: string) {super(code);}
}
export const ERROR_CODES = ['INVALID_INPUT','WALLET_LINK_UNAVAILABLE','WALLET_LIMIT','CHALLENGE_LIMIT','CHALLENGE_UNAVAILABLE','NOT_FOUND','EARLY_ACCESS_DISABLED','EARLY_ACCESS_FULL','EARLY_ACCESS_CLOSED','VERIFIED_WALLET_REQUIRED','INVITES_UNAVAILABLE','ENTITLEMENTS_UNAVAILABLE','FEATURE_LOCKED','NETWORK','TIMEOUT','INVALID_RESPONSE','UNAUTHORIZED','RATE_LIMITED','INVALID_WALLET_PROOF','WALLET_UNAVAILABLE','DOMAIN_MISMATCH','WALLET_REJECTED','CONFIGURATION','UNKNOWN'] as const;
export function errorKey(error: unknown): typeof ERROR_CODES[number] {return error instanceof ApiError && ERROR_CODES.includes(error.code as typeof ERROR_CODES[number]) ? error.code as typeof ERROR_CODES[number] : 'UNKNOWN';}
/**
 * Shared plumbing for every private request: validates the API origin, attaches the access token (and the optional
 * Privy identity token, which the API ignores unless it is signed), applies the timeout and turns a failed response
 * into an `ApiError`. Returns the raw body text so a JSON reader and a file download can share it.
 */
function transportSender(base: string, getAccessToken: () => Promise<string | null>, fetcher: typeof fetch, getIdentityToken?: () => Promise<string | null>) {
  return async function send(path: string, method: string, body: unknown, authenticated: boolean, signal?: AbortSignal): Promise<string> {
    let url: URL;
    try {url = new URL(base); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();} catch {throw new ApiError('CONFIGURATION');}
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) controller.abort();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {timer = setTimeout(() => {controller.abort(); reject(new ApiError('TIMEOUT'));}, REQUEST_TIMEOUT_MS);});
    try {
      return await Promise.race([timeout, (async () => {
        const token = authenticated ? await getAccessToken() : null;
        if (controller.signal.aborted) throw new ApiError('TIMEOUT');
        if (authenticated && !token) throw new ApiError('UNAUTHORIZED', 401);
        // Optional, and never required: the API ignores it unless it is a Privy-signed token, so a failure here is silent.
        const identity = authenticated && getIdentityToken ? await getIdentityToken().catch(() => null) : null;
        const response = await fetcher(new URL(path, url), {method, signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), ...(identity ? {'x-privy-identity-token': identity} : {}), ...(body !== undefined ? {'Content-Type':'application/json'} : {})}, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
        const text = await response.text();
        if (!response.ok) {
          let value: unknown = null; try {value = text ? JSON.parse(text) : null;} catch {value = null;}
          const parsed = ApiErrorSchema.safeParse(value); const retry = Number(response.headers.get('retry-after'));
          throw new ApiError(parsed.success ? parsed.data.error : response.status === 401 ? 'UNAUTHORIZED' : 'UNKNOWN', response.status, Number.isFinite(retry) ? Math.max(0,retry) : 0, parsed.success ? parsed.data.requiredTier : undefined);
        }
        return text;
      })()]);
    } catch (e) {throw e instanceof ApiError ? e : new ApiError('NETWORK');} finally {clearTimeout(timer!);signal?.removeEventListener('abort',abort);}
  };
}
export function createTransport(base: string, getAccessToken: () => Promise<string | null>, fetcher: typeof fetch = fetch, getIdentityToken?: () => Promise<string | null>) {
  const send = transportSender(base, getAccessToken, fetcher, getIdentityToken);
  return async function request<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: unknown, authenticated = true, signal?: AbortSignal): Promise<T> {
    const text = await send(path, method, body, authenticated, signal);
    let value: unknown = null; try {value = text ? JSON.parse(text) : null;} catch {value = null;}
    const parsed = schema.safeParse(value); if (!parsed.success) throw new ApiError('INVALID_RESPONSE'); return parsed.data;
  };
}
/** An authenticated GET kept as text, for a file response (CSV export) that the JSON transport would reject. */
export function createDownloadTransport(base: string, getAccessToken: () => Promise<string | null>, fetcher: typeof fetch = fetch, getIdentityToken?: () => Promise<string | null>) {
  const send = transportSender(base, getAccessToken, fetcher, getIdentityToken);
  return (path: string, signal?: AbortSignal) => send(path, 'GET', undefined, true, signal);
}
export function createApi(base: string, getAccessToken: () => Promise<string | null>, fetcher: typeof fetch = fetch) {
  const request=createTransport(base,getAccessToken,fetcher);
  return {
    entitlements: () => request('/v1/me/entitlements', EntitlementsSchema), status: () => request('/v1/early-access/status', StatusSchema, 'GET', undefined, false),
    requirements: () => request('/v1/access/requirements', RequirementsSchema, 'GET', undefined, false),
    challenge: (address: string) => request('/v1/me/linked-wallets/challenge', ChallengeSchema, 'POST', {chain:'solana', address}),
    verify: (value: {challengeId: string; message: string; signature: string}) => request('/v1/me/linked-wallets/verify', LinkSchema, 'POST', value),
    unlink: (id: string) => request(`/v1/me/linked-wallets/${encodeURIComponent(id)}`, OkSchema, 'DELETE'),
    join: () => request('/v1/me/early-access/join', GrantSchema, 'POST'), leave: () => request('/v1/me/early-access', OkSchema, 'DELETE')
  };
}
export type Api = ReturnType<typeof createApi>;
