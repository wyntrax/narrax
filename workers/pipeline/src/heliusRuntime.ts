import type { PrismaClient } from '@narra/database';
import type { HeliusSettings } from '@narra/shared';
import type { SolanaRpc } from '@narra/solana';
import { readHeliusSettings } from './heliusSettings';
import { makeHeliusRpcPool, makeHeliusRpcTiers } from './rpcPool';
import { pooledHeliusMetadataSource, type MetadataSource } from './tokenMetadata';
import { makeHolderRpcSource, type HolderRpcSource } from './holderRpc';
import { holderRpcEndpointPools, makePooledHolderSource } from './holderRpcFailover';

/** How long a process may keep an admin edit before re-reading the settings rows. */
export const HELIUS_RUNTIME_TTL_MS = 10_000;

export interface HeliusRuntimeOptions {
  ttlMs?: number;
  now?: () => number;
  fetch?: typeof fetch;
}

export interface HeliusRuntime {
  read(): Promise<HeliusSettings>;
  /** Drops the cached snapshot and every client built from it. */
  invalidate(): void;
  /** One pool over primary and fallback tiers, cached until the URL list changes. */
  rpc(timeoutMs?: number): Promise<SolanaRpc | null>;
  /** Separate tier pools for discovery's checkpointed transition. */
  rpcTiers(timeoutMs?: number): Promise<{ primary: SolanaRpc | null; fallback: SolanaRpc | null }>;
  /** DAS metadata over the RPC pool, or null when no RPC URL is configured. */
  metadataSource(): Promise<MetadataSource | null>;
  /** Dedicated holder pool, or the shared pool when no holder endpoint is set. */
  holderSource(): Promise<HolderRpcSource | null>;
}

/**
 * Hot-reloadable Helius settings and clients.
 *
 * The settings row is re-read at most once per TTL, so an admin save applies to the next
 * job or request without restarting a process. Clients are cached by their URL list, so
 * an unchanged configuration keeps the same cooldown state, and a changed list rebuilds
 * the pool on its next use.
 */
export function createHeliusRuntime(
  db: Pick<PrismaClient, 'systemSetting'>,
  env: Record<string, string | undefined> = process.env,
  opts: HeliusRuntimeOptions = {},
): HeliusRuntime {
  const ttlMs = opts.ttlMs ?? HELIUS_RUNTIME_TTL_MS, now = opts.now ?? Date.now;
  let version = 0;
  let cache: { value: HeliusSettings; until: number; version: number } | undefined;
  let pending: { promise: Promise<HeliusSettings>; version: number } | undefined;
  let rpcCache: { key: string; value: SolanaRpc | null } | undefined;
  let tierCache: { key: string; value: { primary: SolanaRpc | null; fallback: SolanaRpc | null } } | undefined;
  let metadataCache: { key: string; value: MetadataSource | null } | undefined;
  let holderCache: { key: string; value: HolderRpcSource | null } | undefined;

  const invalidate = () => {
    version++;
    cache = undefined; rpcCache = undefined; tierCache = undefined; metadataCache = undefined; holderCache = undefined;
  };

  const read = async (): Promise<HeliusSettings> => {
    const current = version;
    if (cache && cache.version === current && now() < cache.until) return cache.value;
    if (!pending || pending.version !== current) {
      const promise = readHeliusSettings(db, env).then(value => {
        if (version === current) cache = { value, until: now() + ttlMs, version: current };
        return value;
      }).catch(error => {
        // A short database outage must not take webhook authentication, balances or
        // manual swaps down. Keep the last good snapshot; the next read retries.
        if (cache) return cache.value;
        throw error;
      }).finally(() => { if (pending?.promise === promise) pending = undefined; });
      pending = { promise, version: current };
    }
    return pending.promise;
  };

  const key = (settings: HeliusSettings, suffix = '') =>
    `${suffix}|${settings.rpcUrls.value.join('\n')}|${settings.rpcFallbackUrls.value.join('\n')}`;

  return {
    read,
    invalidate,
    async rpc(timeoutMs = 15_000) {
      const settings = await read(), cacheKey = key(settings, String(timeoutMs));
      if (rpcCache?.key !== cacheKey) rpcCache = { key: cacheKey, value: makeHeliusRpcPool(settings.rpcUrls.value, settings.rpcFallbackUrls.value, { timeoutMs, ...(opts.fetch ? { fetch: opts.fetch } : {}) }) };
      return rpcCache.value;
    },
    async rpcTiers(timeoutMs = 15_000) {
      const settings = await read(), cacheKey = key(settings, String(timeoutMs));
      if (tierCache?.key !== cacheKey) tierCache = { key: cacheKey, value: makeHeliusRpcTiers(settings.rpcUrls.value, settings.rpcFallbackUrls.value, { timeoutMs, ...(opts.fetch ? { fetch: opts.fetch } : {}) }) };
      return tierCache.value;
    },
    async metadataSource() {
      const settings = await read();
      const urls = [...settings.rpcUrls.value, ...settings.rpcFallbackUrls.value], cacheKey = urls.join('\n');
      if (metadataCache?.key !== cacheKey) metadataCache = { key: cacheKey, value: pooledHeliusMetadataSource(urls, opts.fetch) };
      return metadataCache.value;
    },
    async holderSource() {
      if (env.HOLDER_RPC_FALLBACK_ENABLED === 'false') return null;
      const settings = await read();
      const endpoints = holderRpcEndpointPools({
        sharedPrimary: settings.rpcUrls.value,
        sharedFallback: settings.rpcFallbackUrls.value,
        holderPrimary: settings.holderRpcUrls.value,
        holderFallback: settings.holderRpcFallbackUrls.value,
      });
      if (!endpoints) return null;
      const cacheKey = `${endpoints.primary.join('\n')}||${endpoints.fallback.join('\n')}`;
      if (holderCache?.key !== cacheKey) {
        const sourceOpts = opts.fetch ? { fetch: opts.fetch } : {};
        holderCache = {
          key: cacheKey,
          value: makePooledHolderSource(
            endpoints.primary.map(url => makeHolderRpcSource(url, sourceOpts)),
            endpoints.fallback.map(url => makeHolderRpcSource(url, sourceOpts)),
          ),
        };
      }
      return holderCache.value;
    },
  };
}
