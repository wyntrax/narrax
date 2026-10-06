import { z } from 'zod';

export class HeliusApiError extends Error {}

export interface WebhookSpec {
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: 'enhanced';
  /** Sent back by Helius in the Authorization header of every delivery. */
  authHeader?: string;
}

const Webhook = z.object({
  webhookID: z.string(),
  webhookURL: z.string(),
  transactionTypes: z.array(z.string()).default([]),
  accountAddresses: z.array(z.string()).default([]),
  active: z.boolean().optional(),
}).passthrough();
export type WebhookInfo = z.infer<typeof Webhook>;

export interface HeliusWebhookOptions { apiKey: string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }

/**
 * Manages the Helius webhook that delivers swaps for tracked wallets (create, list, edit; never delete or toggle).
 * Paths and bodies follow the Helius webhook reference. The API key travels in the query string, as Helius requires,
 * so no error message or log line from this class ever includes the URL.
 */
export class HeliusWebhooks {
  private readonly base: string;
  constructor(private readonly opts: HeliusWebhookOptions) {
    if (!opts.apiKey) throw new HeliusApiError('A Helius API key is required');
    this.base = (opts.baseUrl || 'https://api-mainnet.helius-rpc.com').replace(/\/$/, '');
  }

  private async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 10_000);
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(`${this.base}${path}?api-key=${encodeURIComponent(this.opts.apiKey)}`, {
        method, signal: ctrl.signal, headers: { 'content-type': 'application/json', accept: 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (e) {
      throw new HeliusApiError(`${method} ${path} failed: ${(e as Error).name}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new HeliusApiError(`${method} ${path} returned HTTP ${res.status}`);
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new HeliusApiError(`${method} ${path} returned an unexpected shape`);
    return parsed.data;
  }

  list(): Promise<WebhookInfo[]> { return this.request('GET', '/v0/webhooks', z.array(Webhook)); }
  create(spec: WebhookSpec): Promise<WebhookInfo> { return this.request('POST', '/v0/webhooks', Webhook, spec); }
  update(id: string, spec: WebhookSpec): Promise<WebhookInfo> { return this.request('PUT', `/v0/webhooks/${encodeURIComponent(id)}`, Webhook, spec); }
}

/** What has to change to make the webhook's address list equal the desired one. Order and duplicates are ignored. */
export function planWebhookSync(current: string[], desired: string[]): { add: string[]; remove: string[]; inSync: boolean } {
  const cur = new Set(current), want = new Set(desired);
  const add = [...want].filter((a) => !cur.has(a)).sort();
  const remove = [...cur].filter((a) => !want.has(a)).sort();
  return { add, remove, inSync: !add.length && !remove.length };
}
