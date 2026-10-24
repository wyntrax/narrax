import { randomUUID } from 'node:crypto';

export const TREG_ENDPOINTS = {
  x: 'anyapi.x.search.posts',
  reddit: 'anyapi.reddit.search',
  tiktok: 'anyapi.tiktok.search.videos',
} as const;
export type SocialPlatform = keyof typeof TREG_ENDPOINTS;
export type TregEndpoint = typeof TREG_ENDPOINTS[SocialPlatform];
export interface TregReceipt {
  endpoint: TregEndpoint;
  callId: string | null;
  costMicro: number | null;
  status: number;
  cacheHit: boolean;
  replayed: boolean;
  fetchedAt: string | null;
}
export type TregCall = (endpoint: TregEndpoint, body: Record<string, unknown>, idempotencyKey: string) => Promise<unknown>;
export class TregError extends Error {
  constructor(readonly code: string, readonly status = 0, readonly retryAfterSeconds = 0) { super(code); }
}
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export function tregHeaders(maxCostUsd: number, idempotencyKey: string = randomUUID()): Record<string, string> {
  if (!Number.isFinite(maxCostUsd) || maxCostUsd < .000001 || maxCostUsd > 1) throw new TregError('INVALID_TREG_MAX_COST');
  return { 'Content-Type': 'application/json', 'X-Treg-Route-Max-Cost': maxCostUsd.toFixed(6), 'Idempotency-Key': idempotencyKey, 'X-Treg-Meta': 'feature=narrative-ingestion', 'Cache-Control': 'no-cache' };
}
export function createTregClient(opts: {
  token: string; org?: string; maxCostUsd?: number; timeoutMs?: number; fetcher?: typeof fetch;
  onReceipt?: (receipt: TregReceipt) => void | Promise<void>;
}): TregCall {
  if (!opts.token.trim()) throw new TregError('TREG_TOKEN_REQUIRED');
  // Fixed destination and refused redirects keep the credential inside Treg.
  const fetcher = opts.fetcher ?? fetch;
  const maxCost = opts.maxCostUsd ?? .01;
  tregHeaders(maxCost);
  return async (endpoint, body, idempotencyKey) => {
    if (!Object.values(TREG_ENDPOINTS).includes(endpoint)) throw new TregError('UNSUPPORTED_TREG_ENDPOINT');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
    try {
      const response = await fetcher(`https://treg.to/call/${endpoint}`, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { ...tregHeaders(maxCost, idempotencyKey), 'X-Treg-Token': opts.token, ...(opts.org ? { 'X-Treg-Org': opts.org } : {}) },
        body: JSON.stringify(body),
      });
      const charge = response.headers.get('x-treg-cost-micro');
      // Pending/async cost headers are reservations, not settled charges.
      const pending = response.status === 202 || response.headers.has('x-treg-async');
      const cost = !pending && charge !== null && /^\d+$/.test(charge) && Number.isSafeInteger(Number(charge)) ? Number(charge) : null;
      await opts.onReceipt?.({ endpoint, callId: response.headers.get('x-treg-call-id'), costMicro: cost, status: response.status,
        cacheHit: response.headers.get('x-treg-cache') === 'hit', replayed: ['1', 'true'].includes(response.headers.get('x-treg-idempotent-replay') ?? ''), fetchedAt: response.headers.get('x-treg-fetched-at') });
      if (!response.ok || pending) {
        const retry = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        // No upstream bodies in exceptions: they may contain account balances, URLs or credentials.
        throw new TregError(response.ok && pending ? 'TREG_PENDING' : `TREG_HTTP_${response.status}`, response.status, Number.isFinite(retry) ? Math.max(0, retry) : 0);
      }
      if (!response.body) throw new TregError('TREG_INVALID_RESPONSE');
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new TregError('TREG_RESPONSE_TOO_LARGE'); }
        chunks.push(value);
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
      catch { throw new TregError('TREG_INVALID_RESPONSE'); }
    } catch (error) {
      if (error instanceof TregError) throw error;
      throw new TregError(controller.signal.aborted ? 'TREG_TIMEOUT' : 'TREG_REQUEST_FAILED');
    } finally { clearTimeout(timer); }
  };
}
