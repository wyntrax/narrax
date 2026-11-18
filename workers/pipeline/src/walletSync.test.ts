import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@narra/database';
import type { WebhookInfo, WebhookSpec } from '@narra/solana';
import { SYNC_STATUS_SETTING, WEBHOOK_SETTING, syncWalletWebhooks, webhookKeyHash, type WebhookPort } from './walletSync';

const cfg = { webhookUrl: 'https://api.narrax.fun/webhooks/helius', authHeader: 'whsec-1' };

function makeMemoryDb(addresses: string[], initialSettings: [string, unknown][] = []) {
  const settings = new Map<string, unknown>(initialSettings);
  const db = {
    trackedWallet: {
      findMany: vi.fn(async () => [...addresses].sort().map((address) => ({ address }))),
    },
    systemSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
        const value = settings.has(where.key) ? update.value : create.value;
        settings.set(where.key, value);
        return { key: where.key, value };
      }),
    },
  } as unknown as PrismaClient;
  return { db, settings };
}

function makeFakeWebhookClient(initial: WebhookInfo[] = []): { port: WebhookPort; hooks: Map<string, WebhookInfo> } {
  let seq = 1;
  const hooks = new Map(initial.map((h) => [h.webhookID, h]));
  const port: WebhookPort = {
    list: vi.fn(async () => [...hooks.values()]),
    create: vi.fn(async (spec: WebhookSpec) => {
      const info: WebhookInfo = { webhookID: `wh-${seq++}`, active: true, ...spec };
      hooks.set(info.webhookID, info);
      return info;
    }),
    update: vi.fn(async (id: string, spec: WebhookSpec) => {
      const info: WebhookInfo = { webhookID: id, active: true, ...spec };
      hooks.set(id, info);
      return info;
    }),
  };
  return { port, hooks };
}

describe('syncWalletWebhooks', () => {
  it('shards wallets deterministically across multiple keys and avoids exposing raw keys', async () => {
    const wallets = Array.from({ length: 50 }, (_, i) => `Wallet${String(i).padStart(2, '0')}111111111111111111111111111111111`);
    const { db, settings } = makeMemoryDb(wallets, [[WEBHOOK_SETTING, { id: 'existing-0' }]]);
    const rawKeys = ['secret-key-0', 'secret-key-1', 'secret-key-2', 'secret-key-3', 'secret-key-4'];
    const c0 = makeFakeWebhookClient([{ webhookID: 'existing-0', webhookURL: cfg.webhookUrl, transactionTypes: ['SWAP'], accountAddresses: wallets, active: true }]);
    const others = [makeFakeWebhookClient(), makeFakeWebhookClient(), makeFakeWebhookClient(), makeFakeWebhookClient()];
    const allClients = [c0, ...others];

    const summary = await syncWalletWebhooks(
      db,
      rawKeys.map((k, idx) => ({ keyHash: webhookKeyHash(k), client: allClients[idx]!.port })),
      cfg,
      new Date('2026-11-18T05:00:00Z'),
    );

    expect(summary.desired).toBe(50);
    expect(summary.webhookActive).toBe(true);
    expect(summary.error).toBeUndefined();
    expect(summary.shards).toHaveLength(5);

    const syncedAddresses = allClients.flatMap((c) => [...c.hooks.values()].flatMap((h) => h.accountAddresses));
    expect(syncedAddresses.sort()).toEqual([...wallets].sort());
    for (const c of allClients) {
      const count = [...c.hooks.values()].reduce((n, h) => n + h.accountAddresses.length, 0);
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(wallets.length);
    }

    for (const key of settings.keys()) {
      for (const secret of rawKeys) expect(key).not.toContain(secret);
    }
    expect(settings.get(SYNC_STATUS_SETTING)).toMatchObject({ desired: 50, webhookActive: true });
  });

  it('never clobbers shard 0 if two keys share the same Helius project webhook', async () => {
    const wallets = Array.from({ length: 12 }, (_, i) => `SharedProj${i}1111111111111111111111111111111`);
    const { db } = makeMemoryDb(wallets, [[WEBHOOK_SETTING, { id: 'shared-hook' }]]);
    const shared = makeFakeWebhookClient([{ webhookID: 'shared-hook', webhookURL: cfg.webhookUrl, transactionTypes: ['SWAP'], accountAddresses: wallets, active: true }]);

    const summary = await syncWalletWebhooks(
      db,
      [
        { keyHash: webhookKeyHash('proj-key-1'), client: shared.port },
        { keyHash: webhookKeyHash('proj-key-2'), client: shared.port },
      ],
      cfg,
    );

    expect(summary.error).toBeUndefined();
    expect(shared.hooks.size).toBe(2);
    const totalWallets = [...shared.hooks.values()].flatMap((h) => h.accountAddresses);
    expect(totalWallets.sort()).toEqual([...wallets].sort());
  });

  it('keeps healthy shards synced and surfaces partial error when one shard hits 429', async () => {
    const wallets = Array.from({ length: 10 }, (_, i) => `Partial${i}1111111111111111111111111111111111`);
    const { db } = makeMemoryDb(wallets);
    const c0 = makeFakeWebhookClient();
    const failingPort: WebhookPort = {
      list: vi.fn(async () => { throw new Error('GET /v0/webhooks returned HTTP 429'); }),
      create: vi.fn(),
      update: vi.fn(),
    };

    const summary = await syncWalletWebhooks(
      db,
      [
        { keyHash: webhookKeyHash('ok-key'), client: c0.port },
        { keyHash: webhookKeyHash('bad-key'), client: failingPort },
      ],
      cfg,
    );

    expect(summary.action).toBe('created');
    expect(summary.error).toContain('shard 2/2: GET /v0/webhooks returned HTTP 429');
    expect(c0.hooks.size).toBe(1);
  });
});
