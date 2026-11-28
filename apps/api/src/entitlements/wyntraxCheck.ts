import type { PrismaClient } from '@narra/database';
import { z } from 'zod';
import { AccessError, lock, TX_OPTIONS } from './common';

export const CHECK_CACHE_MAX_TTL_MS = 30_000;
export const CHECK_ERROR_STALE_MAX_MS = 60_000;
const MAX_CACHE_ENTRIES = 10_000;

export const WyntraxCheckTier = z.enum(['EARLY_ACCESS', 'MEMBER', 'PRO', 'ELITE']);

export const WyntraxCheckMembership = z.object({
  membershipId: z.string().min(1).max(256),
  name: z.string(),
  accessTier: WyntraxCheckTier.nullable(),
  source: z.enum(['PAYMENT', 'NFT']),
  startedAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }).nullable(),
  gateCheckedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const WyntraxCheckResponse = z.object({
  ok: z.literal(true),
  creatorId: z.string().min(1),
  wallet: z.string().min(1),
  chain: z.string().min(1),
  active: z.boolean(),
  tier: WyntraxCheckTier.nullable(),
  validUntil: z.string().datetime({ offset: true }).nullable(),
  checkedAt: z.string().datetime({ offset: true }),
  ttlSeconds: z.number().int().min(0).max(300).optional().default(30),
  memberships: z.array(WyntraxCheckMembership),
});

export type WyntraxCheckResponse = z.infer<typeof WyntraxCheckResponse>;

export interface WyntraxCheckConfig {
  apiUrl: string;
  apiKey: string;
  creatorId?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export function wyntraxCheckConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): WyntraxCheckConfig | null {
  const apiKey = env.WYNTRAX_API_KEY?.trim();
  if (!apiKey) return null;
  const apiUrl = (env.WYNTRAX_API_URL?.trim() || 'https://wyntrax.xyz').replace(/\/+$/, '');
  const creatorId = env.WYNTRAX_CREATOR_ID?.trim() || undefined;
  return { apiUrl, apiKey, creatorId };
}

interface CacheEntry {
  response: WyntraxCheckResponse;
  fetchedAt: number;
  ttlMs: number;
}

const cache = new Map<string, CacheEntry>();

export function _resetWyntraxCheckCache() {
  cache.clear();
}

function cacheKey(config: WyntraxCheckConfig, chain: string, wallet: string): string {
  return `${config.apiUrl}|${config.creatorId ?? ''}|${chain}|${wallet}`;
}

export interface CheckCallResult {
  response: WyntraxCheckResponse;
  fromCache: boolean;
  staleFallback?: boolean;
}

/**
 * Calls Wyntrax POST /api/v1/memberships/check with a 30s cache and 60s fail-closed error fallback.
 * Never logs the API key or full wallet address.
 */
export async function checkWyntraxMembership(
  config: WyntraxCheckConfig,
  input: { wallet: string; chain: 'solana'; fresh?: boolean; now?: Date }
): Promise<CheckCallResult> {
  const nowMs = (input.now ?? new Date()).getTime();
  const key = cacheKey(config, input.chain, input.wallet);
  const existing = cache.get(key);

  if (!input.fresh && existing && nowMs - existing.fetchedAt < existing.ttlMs) {
    return { response: existing.response, fromCache: true };
  }

  const fetchImpl = config.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 5_000);

  try {
    const res = await fetchImpl(`${config.apiUrl}/api/v1/memberships/check`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        wallet: input.wallet,
        chain: input.chain,
        ...(config.creatorId ? { creatorId: config.creatorId } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP_${res.status}`);
    }

    const parsed = WyntraxCheckResponse.parse(await res.json());
    const ttlMs = Math.min(CHECK_CACHE_MAX_TTL_MS, Math.max(0, parsed.ttlSeconds) * 1000);

    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) cache.delete(oldestKey);
    }
    cache.set(key, { response: parsed, fetchedAt: nowMs, ttlMs });
    return { response: parsed, fromCache: false };
  } catch {
    // Fail-closed contract: serve cached value only if <= 60s old; otherwise deny.
    if (existing && nowMs - existing.fetchedAt <= CHECK_ERROR_STALE_MAX_MS) {
      return { response: existing.response, fromCache: true, staleFallback: true };
    }
    throw new AccessError('WYNTRAX_UNAVAILABLE', 503);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reconciles WyntraxEntitlement rows for one (chain, address) against an authoritative Check API snapshot.
 */
export async function syncWalletFromCheckApi(
  db: PrismaClient,
  chain: 'solana',
  address: string,
  snapshot: WyntraxCheckResponse,
  now: Date
): Promise<void> {
  const eventTag = `chk_${now.getTime()}`;

  await db.$transaction(async (tx) => {
    await lock(tx, `wallet:${chain}:${address}`);
    const existingRows = await tx.wyntraxEntitlement.findMany({
      where: { chain, address },
    });
    const byId = new Map(existingRows.map((r) => [r.membershipId, r]));

    const activePeers = existingRows.filter(
      (r) => r.status === 'ACTIVE' && (r.validUntil === null || r.validUntil > now)
    );
    const earliestSince = (elite: boolean): Date => {
      const dates = activePeers
        .filter((p) => (elite ? p.key === 'ELITE' : ['PRO', 'ELITE'].includes(p.key)))
        .map((p) => (elite ? p.eliteSince : p.proSince))
        .filter((v): v is Date => v !== null);
      return new Date(Math.min(+now, ...dates.map(Number)));
    };

    const incomingActive = new Map<
      string,
      { tier: 'EARLY_ACCESS' | 'MEMBER' | 'PRO' | 'ELITE'; validUntil: Date | null }
    >();

    if (snapshot.active) {
      for (const m of snapshot.memberships) {
        if (!m.accessTier) continue;
        const validUntil = m.validUntil ? new Date(m.validUntil) : null;
        if (validUntil !== null && validUntil <= now) continue;
        incomingActive.set(m.membershipId, { tier: m.accessTier, validUntil });
      }
    }

    for (const [membershipId, item] of incomingActive.entries()) {
      const prev = byId.get(membershipId);
      const nextSeq = (prev ? prev.seq : 0n) + 1n;
      const proSince = ['PRO', 'ELITE'].includes(item.tier) ? earliestSince(false) : null;
      const eliteSince = item.tier === 'ELITE' ? earliestSince(true) : null;

      await tx.wyntraxEntitlement.upsert({
        where: { membershipId_chain_address: { membershipId, chain, address } },
        create: {
          membershipId,
          chain,
          address,
          key: item.tier,
          seq: nextSeq,
          validUntil: item.validUntil,
          status: 'ACTIVE',
          lastEventId: eventTag,
          receivedAt: now,
          proSince,
          eliteSince,
        },
        update: {
          key: item.tier,
          seq: nextSeq,
          validUntil: item.validUntil,
          status: 'ACTIVE',
          lastEventId: eventTag,
          receivedAt: now,
          proSince,
          eliteSince,
        },
      });
    }

    // Revoke any previously active entitlements no longer present in the authoritative snapshot.
    for (const prev of existingRows) {
      if (prev.status === 'ACTIVE' && !incomingActive.has(prev.membershipId)) {
        await tx.wyntraxEntitlement.update({
          where: {
            membershipId_chain_address: {
              membershipId: prev.membershipId,
              chain,
              address,
            },
          },
          data: {
            status: 'REVOKED',
            validUntil: null,
            seq: prev.seq + 1n,
            lastEventId: eventTag,
            receivedAt: now,
            proSince: null,
            eliteSince: null,
          },
        });
      }
    }
  }, TX_OPTIONS);
}

/**
 * Refreshes all linked Solana wallets for a user against the Wyntrax Check API.
 * Skips DB writes when served from the 30s in-memory cache.
 */
export async function syncUserWalletsFromCheckApi(
  db: PrismaClient,
  links: ReadonlyArray<{ chain: string; address: string }>,
  config: WyntraxCheckConfig,
  now: Date,
  opts: { fresh?: boolean } = {}
): Promise<void> {
  for (const link of links) {
    if (link.chain !== 'solana') continue;
    const result = await checkWyntraxMembership(config, {
      wallet: link.address,
      chain: 'solana',
      fresh: opts.fresh,
      now,
    });
    if (!result.fromCache || opts.fresh) {
      await syncWalletFromCheckApi(db, 'solana', link.address, result.response, now);
    }
  }
}
