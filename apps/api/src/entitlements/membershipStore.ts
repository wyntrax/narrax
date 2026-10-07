import type { PrismaClient } from '@narra/database';
import { audit, lock, TX_OPTIONS } from './common';
import { WyntraxEvent } from './wyntrax';

export interface IncomingMembership {
  wyntraxUserId: string; version: number; tier: 'NONE' | 'MEMBER' | 'PRO' | 'ELITE';
  wallets: { chain: 'solana'; address: string }[]; validUntil: Date | null;
  balanceSnapshotAt: Date | null; sourceUpdatedAt: Date;
}
/** Shared transaction boundary for authenticated webhook and (Stage 5) validated partner states. */
export async function applyMembershipState(db: PrismaClient, state: IncomingMembership, now: Date, receipt?: { id: string; bodyHash: string; occurredAt: Date }) {
  return db.$transaction(async tx => {
    // Event lock first ensures even an ID reused across members cannot race the global unique key.
    if (receipt) await lock(tx, `event:${receipt.id}`);
    await lock(tx, `member:${state.wyntraxUserId}`);
    if (receipt) {
      const prior = await tx.webhookEvent.findUnique({ where: { id: receipt.id } });
      if (prior) {
        if (prior.bodyHash !== receipt.bodyHash) await audit(tx, null, 'entitlements.event_collision', { eventId: receipt.id });
        return 'duplicate' as const;
      }
    }
    const previous = await tx.wyntraxMembership.findUnique({ where: { wyntraxUserId: state.wyntraxUserId }, include: { wallets: true } });
    const status = previous && BigInt(state.version) <= previous.version ? 'stale' as const : 'applied' as const;
    if (status === 'applied') {
      const { wallets, ...data } = state;
      const walletKeys = (ws: typeof wallets) => [...new Set(ws.map(w => `${w.chain}:${w.address}`))].sort().join(',');
      const continuous = !!previous?.validUntil && previous.validUntil > now && walletKeys(previous.wallets as typeof wallets) === walletKeys(wallets);
      const paid = ['PRO', 'ELITE'].includes(state.tier) && !!state.validUntil && state.validUntil > now;
      const proSince = paid ? (continuous && ['PRO', 'ELITE'].includes(previous!.tier) ? previous!.proSince ?? now : now) : null;
      const eliteSince = paid && state.tier === 'ELITE' ? (continuous && previous!.tier === 'ELITE' ? previous!.eliteSince ?? now : now) : null;
      const value = { ...data, proSince, eliteSince, version: BigInt(state.version), receivedAt: now, lastEventId: receipt?.id ?? null, lastTransport: receipt ? 'WEBHOOK' : 'RECONCILE' };
      await tx.wyntraxMembership.upsert({ where: { wyntraxUserId: state.wyntraxUserId }, create: value, update: value });
      await tx.wyntraxMembershipWallet.deleteMany({ where: { wyntraxUserId: state.wyntraxUserId } });
      await tx.wyntraxMembershipWallet.createMany({ data: wallets.map(w => ({ ...w, wyntraxUserId: state.wyntraxUserId })), skipDuplicates: true });
    }
    if (receipt) await tx.webhookEvent.create({ data: { ...receipt, wyntraxUserId: state.wyntraxUserId, version: BigInt(state.version), receivedAt: now, outcome: status.toUpperCase() } });
    await audit(tx, null, `entitlements.membership_${status}`, { wyntraxUserId: state.wyntraxUserId, version: state.version, tier: state.tier, eventId: receipt?.id ?? null, transport: receipt ? 'WEBHOOK' : 'RECONCILE' });
    return status;
  }, TX_OPTIONS);
}
export function applyWyntraxEvent(db: PrismaClient, input: unknown, bodyHash: string, now: Date) {
  const event = WyntraxEvent.parse(input);
  return applyMembershipState(db, { ...event.data, version: event.version,
    validUntil: event.data.validUntil ? new Date(event.data.validUntil) : null,
    balanceSnapshotAt: new Date(event.data.balanceSnapshotAt), sourceUpdatedAt: new Date(event.occurredAt) }, now,
  { id: event.id, bodyHash, occurredAt: new Date(event.occurredAt) });
}
