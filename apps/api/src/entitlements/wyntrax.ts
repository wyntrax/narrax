import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { WalletAddress } from './common';

export const WyntraxData = z.object({
  membershipId: z.string().min(1).max(256), key: z.enum(['MEMBER', 'PRO', 'ELITE']),
  chain: z.literal('solana'), wallet: WalletAddress, seq: z.number().int().safe().positive(),
  validUntil: z.string().datetime({ offset: true }).nullable(), checkedAt: z.string().datetime({ offset: true }),
}).strict();
export const WyntraxEvent = z.object({
  id: z.string().min(1).max(256), type: z.enum(['membership.granted', 'membership.revoked', 'membership.test']),
  occurredAt: z.string().datetime({ offset: true }), data: WyntraxData,
}).strict().refine(e => e.type === 'membership.granted' ? e.data.validUntil !== null : e.data.validUntil === null, { path: ['data', 'validUntil'] });
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
