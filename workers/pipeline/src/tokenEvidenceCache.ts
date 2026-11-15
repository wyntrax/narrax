import { z } from 'zod';
import type { PrismaClient } from '@narra/database';
import { TradeabilityQuoteSchema, type TradeabilityQuote } from '@narra/shared';
import { RADAR_SAFETY_EVIDENCE_PREFIX, type RadarSafetyEvidence } from './radarSafetyEvidence';
import type { LaunchEvidence } from './launchEvidence';

const LAUNCH_EVIDENCE_PREFIX = 'research.launchEvidence.';
const TRADEABILITY_PREFIX = 'research.radarTradeability.';

const CachedSafetySchema = z.object({
  mint: z.string(),
  source: z.literal('rugcheck'),
  sourceAt: z.string(),
  devHoldingPct: z.number().nullable(),
  top10ExLpPct: z.number().nullable(),
  lpBurnedPct: z.number().nullable(),
  lpLocked: z.boolean().nullable(),
  insiderPct: z.number().nullable(),
  riskFlags: z.array(z.string()),
});

const CachedLaunchSchema = z.object({
  mint: z.string(),
  status: z.enum(['CLEAN', 'FLAGGED', 'UNKNOWN']),
  bundlePct: z.number().nullable(),
  sniperPct: z.number().nullable(),
  insiderPct: z.number().nullable(),
  sameSlotBuyers: z.number().nullable(),
  firstBuyers: z.number(),
  firstBuyersPct: z.number().nullable(),
  historyComplete: z.boolean(),
  deployer: z.string().nullable(),
  deployerSource: z.enum(['MINT_AUTHORITY', 'FIRST_FEE_PAYER']).nullable(),
  deployerPriorTokens: z.number().nullable(),
  deployerPriorRugs: z.number().nullable(),
  source: z.literal('helius-rpc'),
  observedAt: z.string(),
  detail: z.string(),
});

export interface CachedTokenEvidence {
  safety: RadarSafetyEvidence | null;
  launch: LaunchEvidence | null;
  tradeability: TradeabilityQuote | null;
}

/**
 * Reads already-persisted Phase 1-4 research artifacts from SystemSetting without making external HTTP or RPC calls.
 */
export async function readCachedTokenEvidence(db: PrismaClient, mint: string): Promise<CachedTokenEvidence> {
  const safetyKey = `${RADAR_SAFETY_EVIDENCE_PREFIX}${mint}`;
  const launchKey = `${LAUNCH_EVIDENCE_PREFIX}${mint}`;
  const tradeabilityKey = `${TRADEABILITY_PREFIX}${mint}`;
  const rows = await db.systemSetting.findMany({
    where: { key: { in: [safetyKey, launchKey, tradeabilityKey] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const sParsed = CachedSafetySchema.safeParse(byKey.get(safetyKey));
  const lParsed = CachedLaunchSchema.safeParse(byKey.get(launchKey));
  const tParsed = TradeabilityQuoteSchema.safeParse(byKey.get(tradeabilityKey));
  return {
    safety: sParsed.success ? sParsed.data : null,
    launch: lParsed.success ? lParsed.data : null,
    tradeability: tParsed.success ? tParsed.data : null,
  };
}
