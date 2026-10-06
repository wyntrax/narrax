import type { PrismaClient } from '@narra/database';
import { planWebhookSync, type HeliusWebhooks } from '@narra/solana';

export const WEBHOOK_SETTING = 'helius.webhook';
export const SYNC_STATUS_SETTING = 'wallets.syncStatus';

export type WebhookPort = Pick<HeliusWebhooks, 'list' | 'create' | 'update'>;
export interface SyncConfig { webhookUrl: string; authHeader: string }
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
}

const TRANSACTION_TYPES = ['SWAP'];

/**
 * Makes the Helius webhook watch exactly the active tracked wallets. It creates the webhook once, adopts an existing
 * one with the same URL, and otherwise only edits the address list. It never deletes or toggles a webhook, and it
 * never clears the list: with no active wallets it does nothing. The result is stored for the admin status endpoint.
 */
export async function syncWalletWebhook(db: PrismaClient, client: WebhookPort, cfg: SyncConfig, now: Date = new Date()): Promise<SyncSummary> {
  let out: SyncSummary;
  try {
    out = await run(db, client, cfg);
  } catch (e) {
    out = { action: 'skipped', desired: 0, added: 0, removed: 0, webhookId: null, webhookActive: null, error: (e as Error).message };
  }
  const value = { ...out, at: now.toISOString() };
  await db.systemSetting.upsert({ where: { key: SYNC_STATUS_SETTING }, create: { key: SYNC_STATUS_SETTING, value }, update: { value } });
  return out;
}

async function run(db: PrismaClient, client: WebhookPort, cfg: SyncConfig): Promise<SyncSummary> {
  const wallets = await db.trackedWallet.findMany({ where: { active: true }, select: { address: true }, orderBy: { address: 'asc' } });
  const desired = wallets.map((w) => w.address);
  if (!desired.length) return { action: 'skipped', reason: 'no active wallets', desired: 0, added: 0, removed: 0, webhookId: null, webhookActive: null };

  const spec = { webhookURL: cfg.webhookUrl, transactionTypes: TRANSACTION_TYPES, accountAddresses: desired, webhookType: 'enhanced' as const, authHeader: cfg.authHeader };
  const stored = await db.systemSetting.findUnique({ where: { key: WEBHOOK_SETTING } });
  const storedId = (stored?.value as { id?: unknown } | null)?.id;
  const all = await client.list();
  const existing = all.find((w) => w.webhookID === storedId) ?? all.find((w) => w.webhookURL === cfg.webhookUrl);

  if (!existing) {
    const created = await client.create(spec);
    await db.systemSetting.upsert({ where: { key: WEBHOOK_SETTING }, create: { key: WEBHOOK_SETTING, value: { id: created.webhookID } }, update: { value: { id: created.webhookID } } });
    return { action: 'created', desired: desired.length, added: desired.length, removed: 0, webhookId: created.webhookID, webhookActive: created.active ?? null };
  }

  const plan = planWebhookSync(existing.accountAddresses, desired);
  const drift = existing.webhookURL !== cfg.webhookUrl || [...existing.transactionTypes].sort().join() !== [...TRANSACTION_TYPES].sort().join();
  const base = { desired: desired.length, added: plan.add.length, removed: plan.remove.length, webhookId: existing.webhookID, webhookActive: existing.active ?? null };
  const disabled = existing.active === false ? { reason: 'webhook is disabled at Helius; re-enable it in the Helius dashboard after checking the endpoint' } : {};
  if (existing.webhookID !== storedId) await db.systemSetting.upsert({ where: { key: WEBHOOK_SETTING }, create: { key: WEBHOOK_SETTING, value: { id: existing.webhookID } }, update: { value: { id: existing.webhookID } } });
  if (plan.inSync && !drift) return { action: 'in_sync', ...base, ...disabled };
  await client.update(existing.webhookID, spec);
  return { action: 'updated', ...base, ...disabled };
}
