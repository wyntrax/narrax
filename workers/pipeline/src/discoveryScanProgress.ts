import { z } from 'zod';
import { DiscoverySpendEvidence } from '@narra/solana';

export const DISCOVERY_PROGRESS_KEY = 'wallet.discovery.scanProgress';
export const DISCOVERY_SCAN_HEALTH_KEY = 'wallet.discovery.scanHealth';
export const DISCOVERY_RESUME_MS = 24 * 3_600_000;
export const DiscoveryBuyer = z.object({
  wallet: z.string().min(1), rank: z.number().int().min(1).max(30), signature: z.string().min(1).max(120),
  at: z.string().datetime().nullable(), spendEvidence: DiscoverySpendEvidence,
});
export const DiscoveryCheckpoint = z.object({
  tokenId: z.string().min(1), mint: z.string().min(1), startedAt: z.string().datetime(),
  pagesRead: z.number().int().min(0).max(2), before: z.string().min(1).max(120).nullable(),
  // Only the oldest 40 successful signatures are needed, retained newest first.
  candidates: z.array(z.string().min(1).max(120)).max(40), historyComplete: z.boolean(),
  nextTransaction: z.number().int().min(0).max(40), buyers: z.array(DiscoveryBuyer).max(30),
}).superRefine((p,ctx) => {
  if (p.nextTransaction > p.candidates.length || (!p.historyComplete && (p.nextTransaction !== 0 || p.buyers.length)) ||
    (p.pagesRead === 0 && (p.before !== null || p.candidates.length || p.historyComplete)) ||
    (p.pagesRead > 0 && !p.historyComplete && p.before === null) ||
    new Set(p.candidates).size !== p.candidates.length || new Set(p.buyers.map(b=>b.wallet)).size !== p.buyers.length ||
    p.buyers.some((b,i)=>b.rank!==i+1 || !p.candidates.slice().reverse().slice(0,p.nextTransaction).includes(b.signature))) {
    ctx.addIssue({code:'custom',message:'Inconsistent discovery checkpoint'});
  }
});
export type DiscoveryCheckpoint = z.infer<typeof DiscoveryCheckpoint>;
export const DiscoveryScanProgress = z.object({
  version: z.literal(1), cooldownUntil: z.string().datetime().nullable(), pending: z.array(DiscoveryCheckpoint).max(5),
}).refine(p=>new Set(p.pending.map(c=>c.tokenId)).size===p.pending.length);
export type DiscoveryScanProgress = z.infer<typeof DiscoveryScanProgress>;
