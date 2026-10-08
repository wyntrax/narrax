import { z } from 'zod';
import { WyntraxData } from './wyntrax';
export const PartnerItem = z.object({ wyntraxUserId: z.string(), wallets: z.unknown(), tier: z.unknown(), validUntil: z.unknown().optional(), balanceSnapshotAt: z.unknown(), version: z.number().int().safe(), updatedAt: z.string().datetime({ offset: true }) }).strict().superRefine((item, ctx) => {
  const { version: _version, updatedAt: _updatedAt, ...data } = item;
  if (!WyntraxData.safeParse(data).success) ctx.addIssue({ code: 'custom', message: 'Invalid member state' });
}).transform(item => {
  const { version, updatedAt, ...raw } = item, data = WyntraxData.parse(raw);
  return { ...data, version, validUntil: data.validUntil ? new Date(data.validUntil) : null, balanceSnapshotAt: new Date(data.balanceSnapshotAt), sourceUpdatedAt: new Date(updatedAt) };
});
const Page = z.object({ items: z.array(PartnerItem).max(200), nextCursor: z.string().min(1).max(4096).nullable() }).strict();
export class PartnerError extends Error { constructor() { super('WYNTRAX_PARTNER_UNAVAILABLE'); } }
export interface PartnerConfig { baseUrl?: string; apiKey?: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }
export function partnerClient(config: PartnerConfig) {
  if (!config.baseUrl || !config.apiKey) return null;
  let url: URL;
  try { url = new URL('/api/partner/narra/memberships', config.baseUrl); const base = new URL(config.baseUrl); if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new PartnerError(); } catch { throw new PartnerError(); }
  const request = config.fetch ?? fetch, sleep = config.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  return { async page(updatedSince?: string, cursor?: string) {
    const endpoint = new URL(url); endpoint.searchParams.set('limit', '100');
    if (updatedSince) endpoint.searchParams.set('updatedSince', updatedSince);
    if (cursor) endpoint.searchParams.set('cursor', cursor);
    for (let attempt = 0; attempt < 3; attempt++) {
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000);
      let retry = true, retryMs = 250 * 2 ** attempt + Math.floor(Math.random() * 100);
      try {
        const response = await request(endpoint, { headers: { authorization: `Bearer ${config.apiKey}`, accept: 'application/json' }, redirect: 'error', signal: abort.signal });
        if (!response.ok) {
          retry = response.status === 429 || response.status >= 500;
          const after = Number(response.headers.get('retry-after')); if (Number.isFinite(after)) retryMs = Math.max(retryMs, Math.min(5000, after * 1000));
          await response.body?.cancel(); throw new PartnerError();
        }
        retry = false;
        if (Number(response.headers.get('content-length')) > 1048576 || !response.body) { await response.body?.cancel(); throw new PartnerError(); }
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1048576) throw new PartnerError(); chunks.push(value); } }
        finally { await reader.cancel(); }
        return Page.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch { if ((!retry && !abort.signal.aborted) || attempt === 2) throw new PartnerError(); }
      finally { clearTimeout(timer); }
      await sleep(retryMs);
    }
    throw new PartnerError();
  } };
}
