import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@narra/database';
import { planWebhookSync, type HeliusWebhooks } from '@narra/solana';

export const WEBHOOK_SETTING = 'helius.webhook';
export const SYNC_STATUS_SETTING = 'wallets.syncStatus';

export type WebhookPort = Pick<HeliusWebhooks, 'list' | 'create' | 'update'>;
export interface SyncConfig { webhookUrl: string; authHeader: string }
export interface WebhookShardSummary {
  shard: number;
  desired: number;
  action: 'created' | 'updated' | 'in_sync' | 'skipped';
  added: number;
  removed: number;
  webhookId: string | null;
  webhookActive: boolean | null;
  reason?: string;
  error?: string;
}
export interface SyncSummary {
  action: 'created' | 'updated' | 'in_sync' | 'skipped';
  reason?: string;
  desired: number;
  added: number;
  removed: number;
  webhookId: string | null;
  /** What Helius reports. Helius can disable a webhook whose endpoint keeps failing. This job reports it and never toggles it. */
  webhookActive: boolean | null;
  error?: string;
  shards?: WebhookShardSummary[];
}

export interface WebhookShardClient { keyHash: string; client: WebhookPort }

export const webhookKeyHash = (apiKey: string): string =>
  createHash('sha256').update(apiKey).digest('hex').slice(0, 12);

export const shardAddressIndex = (address: string, shardCount: number): number =>
  shardCount <= 1 ? 0 : createHash('sha256').update(address).digest().readUInt32BE(0) % shardCount;

const TRANSACTION_TYPES = ['SWAP'];

/**
 * Makes the Helius webhook watch exactly the active tracked wallets. It creates the webhook once, adopts an existing
 * one with the same URL, and otherwise only edits the address list. It never deletes or toggles a webhook, and it
 * never clears the list: with no active wallets it does nothing. The result is stored for the admin status endpoint.
 */
export async function syncWalletWebhook(db: PrismaClient, client: WebhookPort, cfg: SyncConfig, now: Date = new Date()): Promise<SyncSummary> {
  return syncWalletWebhooks(db, [{ keyHash: 'primary', client }], cfg, now);
}

/**
 * Shards active tracked wallets deterministically across 1..N Helius API keys (one webhook per key, all pointing
 * at the same public `webhookUrl`). Adding a wallet only updates the single owning shard, and an error on one
 * shard still leaves the remaining shards synced.
 */
async function saveSyncStatus(db: PrismaClient, out: SyncSummary, now: Date): Promise<SyncSummary> {
  const value = { ...out, at: now.toISOString() } as unknown as Prisma.InputJsonValue;
  await db.systemSetting.upsert({ where: { key: SYNC_STATUS_SETTING }, create: { key: SYNC_STATUS_SETTING, value }, update: { value } });
  return out;
}

export async function syncWalletWebhooks(
  db: PrismaClient,
  clients: readonly WebhookShardClient[],
  cfg: SyncConfig,
  now: Date = new Date(),
): Promise<SyncSummary> {
  if (!clients.length) {
    return saveSyncStatus(db, { action: 'skipped', reason: 'not configured', desired: 0, added: 0, removed: 0, webhookId: null, webhookActive: null }, now);
  }

  if (clients.length === 1) {
    let out: SyncSummary;
    try {
      const desired = (await db.trackedWallet.findMany({ where: { active: true }, select: { address: true }, orderBy: { address: 'asc' } })).map((w) => w.address);
      out = desired.length
        ? await syncOneWebhook(db, clients[0]!.client, WEBHOOK_SETTING, desired, cfg, new Set())
        : { action: 'skipped', reason: 'no active wallets', desired: 0, added: 0, removed: 0, webhookId: null, webhookActive: null };
    } catch (e) {
      out = { action: 'skipped', desired: 0, added: 0, removed: 0, webhookId: null, webhookActive: null, error: (e as Error).message };
    }
    return saveSyncStatus(db, out, now);
  }

  let out: SyncSummary;
  try {
    const wallets = await db.trackedWallet.findMany({ where: { active: true }, select: { address: true }, orderBy: { address: 'asc' } });
    if (!wallets.length) {
      out = { action: 'skipped', reason: 'no active wallets', desired: 0, added: 0, removed: 0, webhookId: null, webhookActive: null };
    } else {
      const buckets: string[][] = Array.from({ length: clients.length }, () => []);
      for (const w of wallets) buckets[shardAddressIndex(w.address, clients.length)]!.push(w.address);

      const claimedWebhookIds = new Set<string>();
      const shards: WebhookShardSummary[] = [];
      for (let i = 0; i < clients.length; i++) {
        const desired = buckets[i]!;
        if (!desired.length) {
          shards.push({ shard: i, desired: 0, action: 'skipped', reason: 'no shard wallets', added: 0, removed: 0, webhookId: null, webhookActive: null });
          continue;
        }
        const settingKey = i === 0 ? WEBHOOK_SETTING : `${WEBHOOK_SETTING}.${clients[i]!.keyHash}`;
        try {
          const res = await syncOneWebhook(db, clients[i]!.client, settingKey, desired, cfg, claimedWebhookIds);
          if (res.webhookId) claimedWebhookIds.add(res.webhookId);
          shards.push({ shard: i, ...res });
        } catch (e) {
          shards.push({ shard: i, desired: desired.length, action: 'skipped', added: 0, removed: 0, webhookId: null, webhookActive: null, error: (e as Error).message });
        }
      }

      const activeShards = shards.filter((s) => s.desired > 0);
      const succeeded = activeShards.filter((s) => !s.error);
      const failed = activeShards.filter((s) => !!s.error);
      const added = succeeded.reduce((sum, s) => sum + s.added, 0);
      const removed = succeeded.reduce((sum, s) => sum + s.removed, 0);
      const webhookActive = succeeded.some((s) => s.webhookActive === false)
        ? false
        : failed.length === 0 && succeeded.length > 0 && succeeded.every((s) => s.webhookActive === true)
          ? true
          : null;
      const action = succeeded.length === 0
        ? 'skipped'
        : succeeded.some((s) => s.action === 'updated')
          ? 'updated'
          : succeeded.some((s) => s.action === 'created')
            ? 'created'
            : 'in_sync';
      const firstError = failed.length
        ? failed.map((s) => `shard ${s.shard + 1}/${clients.length}: ${s.error}`).join('; ').slice(0, 300)
        : undefined;
      const disabledReason = succeeded.find((s) => s.reason)?.reason;

      out = {
        action,
        ...(disabledReason ? { reason: disabledReason } : {}),
        desired: wallets.length,
        added,
        removed,
        webhookId: shards.find((s) => s.webhookId)?.webhookId ?? null,
        webhookActive,
        ...(firstError ? { error: firstError } : {}),
        shards,
      };
    }
  } catch (e) {
    out = { action: 'skipped', desired: 0, added: 0, removed: 0, webhookId: null, webhookActive: null, error: (e as Error).message };
  }
  return saveSyncStatus(db, out, now);
}

async function syncOneWebhook(
  db: PrismaClient,
  client: WebhookPort,
  settingKey: string,
  desired: string[],
  cfg: SyncConfig,
  claimedWebhookIds: Set<string>,
): Promise<Omit<SyncSummary, 'shards'>> {
  const spec = { webhookURL: cfg.webhookUrl, transactionTypes: TRANSACTION_TYPES, accountAddresses: desired, webhookType: 'enhanced' as const, authHeader: cfg.authHeader };
  const stored = await db.systemSetting.findUnique({ where: { key: settingKey } });
  const storedId = (stored?.value as { id?: unknown } | null)?.id;
  const all = await client.list();
  const existing = (typeof storedId === 'string' && !claimedWebhookIds.has(storedId) ? all.find((w) => w.webhookID === storedId) : undefined)
    ?? all.find((w) => w.webhookURL === cfg.webhookUrl && !claimedWebhookIds.has(w.webhookID));

  if (!existing) {
    const created = await client.create(spec);
    await db.systemSetting.upsert({ where: { key: settingKey }, create: { key: settingKey, value: { id: created.webhookID } }, update: { value: { id: created.webhookID } } });
    return { action: 'created', desired: desired.length, added: desired.length, removed: 0, webhookId: created.webhookID, webhookActive: created.active ?? null };
  }

  const plan = planWebhookSync(existing.accountAddresses, desired);
  const drift = existing.webhookURL !== cfg.webhookUrl || [...existing.transactionTypes].sort().join() !== [...TRANSACTION_TYPES].sort().join();
  const base = { desired: desired.length, added: plan.add.length, removed: plan.remove.length, webhookId: existing.webhookID, webhookActive: existing.active ?? null };
  const disabled = existing.active === false ? { reason: 'webhook is disabled at Helius; re-enable it in the Helius dashboard after checking the endpoint' } : {};
  if (existing.webhookID !== storedId) await db.systemSetting.upsert({ where: { key: settingKey }, create: { key: settingKey, value: { id: existing.webhookID } }, update: { value: { id: existing.webhookID } } });
  if (plan.inSync && !drift) return { action: 'in_sync', ...base, ...disabled };
  await client.update(existing.webhookID, spec);
  return { action: 'updated', ...base, ...disabled };
}
