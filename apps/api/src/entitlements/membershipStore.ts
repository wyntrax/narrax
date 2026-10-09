import type { PrismaClient } from '@narra/database';
import { audit, lock, TX_OPTIONS } from './common';
import { WyntraxEvent } from './wyntrax';

export async function applyWyntraxEvent(db: PrismaClient, input: unknown, bodyHash: string, now: Date) {
  const event = WyntraxEvent.parse(input), d = event.data;
  const identity = { membershipId: d.membershipId, chain: d.chain, address: d.wallet };
  return db.$transaction(async tx => {
    await lock(tx, `event:${event.id}`);
    const receipt = await tx.webhookEvent.findUnique({ where: { id: event.id } });
    if (receipt) {
      if (receipt.bodyHash !== bodyHash) await audit(tx, null, 'entitlements.event_collision', { eventId: event.id });
      return 'duplicate' as const;
    }
    // Serialize across memberships for a wallet, including the shared continuity calculation.
    await lock(tx, `wallet:${d.chain}:${d.wallet}`);
    let outcome: 'test' | 'stale' | 'applied' = 'test';
    if (event.type !== 'membership.test') {
      const previous = await tx.wyntraxEntitlement.findUnique({ where: { membershipId_chain_address: identity } });
      outcome = previous && BigInt(d.seq) <= previous.seq ? 'stale' : 'applied';
      if (outcome === 'applied') {
        const validUntil = d.validUntil ? new Date(d.validUntil) : null;
        const active = event.type === 'membership.granted' && !!validUntil && validUntil > now;
        const peers = active ? await tx.wyntraxEntitlement.findMany({ where: { chain: d.chain, address: d.wallet, status: 'ACTIVE', validUntil: { gt: now } } }) : [];
        const since = (elite: boolean) => {
          if (!active || (elite ? d.key !== 'ELITE' : !['PRO', 'ELITE'].includes(d.key))) return null;
          const dates = peers.filter(p => elite ? p.key === 'ELITE' : ['PRO', 'ELITE'].includes(p.key)).map(p => elite ? p.eliteSince : p.proSince).filter((v): v is Date => v !== null);
          return new Date(Math.min(+now, ...dates.map(Number)));
        };
        const value = { ...identity, key: d.key, seq: BigInt(d.seq), validUntil,
          status: event.type === 'membership.revoked' ? 'REVOKED' as const : active ? 'ACTIVE' as const : 'EXPIRED' as const,
          lastEventId: event.id, receivedAt: now, proSince: since(false), eliteSince: since(true) };
        await tx.wyntraxEntitlement.upsert({ where: { membershipId_chain_address: identity }, create: value, update: value });
      }
    }
    await tx.webhookEvent.create({ data: { id: event.id, ...identity, seq: BigInt(d.seq), bodyHash, occurredAt: new Date(event.occurredAt), receivedAt: now, outcome: outcome.toUpperCase() } });
    await audit(tx, null, `entitlements.membership_${outcome}`, { membershipId: d.membershipId, seq: d.seq, key: d.key, eventId: event.id });
    return outcome;
  }, TX_OPTIONS);
}
