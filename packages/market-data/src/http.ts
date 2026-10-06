import { MarketDataError } from './types';
import type { RateLimiter } from './limiter';

export interface HttpOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  limiter?: RateLimiter;
  headers?: Record<string, string>;
}

/**
 * GET and parse JSON. Throws MarketDataError on every failure. There are no retries here: a 429 means stop,
 * and the next scheduled run tries again. Returns { status: 404 } for not-found so callers can treat it as "unknown token".
 */
export async function getJson(url: string, opts: HttpOptions = {}): Promise<{ status: number; body: unknown }> {
  await opts.limiter?.wait();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, { method: 'GET', headers: { accept: 'application/json', ...opts.headers }, signal: ctrl.signal });
  } catch (e) {
    throw new MarketDataError('network', `request failed: ${(e as Error).name}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) throw new MarketDataError('rate_limited', 'rate limited (HTTP 429)');
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new MarketDataError('http', `HTTP ${res.status}`);
  try {
    return { status: res.status, body: await res.json() };
  } catch {
    throw new MarketDataError('shape', 'response was not JSON');
  }
}

/** A finite number from a number or numeric string, otherwise null. Never turns "missing" into 0. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
