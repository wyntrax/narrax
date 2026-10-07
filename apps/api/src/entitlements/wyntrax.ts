import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { WalletInput } from './common';

export const WyntraxData = z.object({
  wyntraxUserId: z.string().min(1).max(16384), wallets: z.array(WalletInput).max(10),
  tier: z.enum(['NONE', 'MEMBER', 'PRO', 'ELITE']), validUntil: z.string().datetime({ offset: true }).nullable().optional(),
  balanceSnapshotAt: z.string().datetime({ offset: true }),
}).strict().refine(d => d.tier === 'NONE' || d.validUntil != null, { path: ['validUntil'] });
export const WyntraxEvent = z.object({
  id: z.string().min(1).max(16384), type: z.literal('membership.updated'),
  occurredAt: z.string().datetime({ offset: true }), version: z.number().int().safe(), data: WyntraxData,
}).strict();
export type WyntraxEvent = z.infer<typeof WyntraxEvent>;
export function authenticateWyntrax(raw: Buffer, headers: { timestamp?: unknown; signature?: unknown }, secrets: { secret?: string; previousSecret?: string }, now: Date): boolean {
  const { timestamp, signature } = headers;
  if (!secrets.secret || typeof timestamp !== 'string' || !/^[0-9]{1,16}$/.test(timestamp) || typeof signature !== 'string' || !/^v1=[a-f0-9]{64}$/.test(signature)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || !Number.isFinite(now.getTime()) || Math.abs(now.getTime() / 1000 - seconds) > 300) return false;
  const received = Buffer.from(signature.slice(3), 'hex');
  const check = (secret: string) => {
    const expected = createHmac('sha256', secret).update(timestamp).update('.').update(raw).digest();
    return received.length === expected.length && timingSafeEqual(received, expected);
  };
  const primary = check(secrets.secret);
  const previous = secrets.previousSecret ? check(secrets.previousSecret) : false;
  return primary || previous;
}
