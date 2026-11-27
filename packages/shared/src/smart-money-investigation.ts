import { z } from 'zod';
import { isSolanaAddress } from './solana-address';
import { InvestigationStrategies, PublishedInvestigationContext } from './investigation-strategy';

export const INVESTIGATION_LIMITS = { trades: 1000, relationships: 250, pageSize: 50, maxPageSize: 100 } as const;
/** A token-scoped scan writes its bounded progress here. Never used as admission or performance evidence. */
export const TOKEN_DISCOVERY_KEY_PREFIX = 'wallet.discovery.token.';
export const InvestigationDiscovery = z.object({
  status: z.enum(['RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED']),
  checkedAt: z.string().datetime().nullable(),
  pagesRead: z.number().int().nonnegative(), transactionsRead: z.number().int().nonnegative(),
  swapsRead: z.number().int().nonnegative(), participantsSeen: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(), newWallets: z.number().int().nonnegative(),
  backfilledWallets: z.number().int().nonnegative(), createdTrades: z.number().int().nonnegative(),
  capped: z.boolean(), error: z.enum(['NOT_CONFIGURED', 'PROVIDER_FAILED', 'TOKEN_NOT_FOUND', 'UNKNOWN']).nullable(),
});
export const InvestigationDiscoveryRequest = z.object({ status: z.literal('QUEUED') }).strict();
export const InvestigationParams = z.object({ mint: z.string().refine(isSolanaAddress) }).strict();
export const InvestigationQuery = z.object({
  window: z.enum(['24h', '7d']).default('24h'),
  asOf: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(INVESTIGATION_LIMITS.maxPageSize).default(INVESTIGATION_LIMITS.pageSize),
  cursor: z.string().min(1).max(2048).optional(),
}).strict().refine(q => !q.cursor || !!q.asOf, { message: 'A cursor requires the original asOf' });

// Amounts are decimal strings: token units and SOL must not lose precision in JSON.
const Amount = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const At = z.string().datetime();
export const InvestigationTotals = z.object({
  tradeCount: z.number().int().nonnegative(), buyCount: z.number().int().nonnegative(), sellCount: z.number().int().nonnegative(),
  buySol: Amount.nullable(), sellSol: Amount.nullable(), netSolSpent: Amount.nullable(),
  observedTokenUnitDelta: Amount.nullable(), unknownSolCount: z.number().int().nonnegative(), unknownQuantityCount: z.number().int().nonnegative(),
  firstObservedAt: At.nullable(), lastObservedAt: At.nullable(),
});
export const InvestigationHistory = z.object({
  status: z.enum(['UNKNOWN', 'STALE', 'PARTIAL', 'COVERED']),
  checkedAt: At.nullable(), coveredFrom: At.nullable(), coveredTo: At.nullable(),
  capped: z.boolean().nullable(), skipped: z.number().int().nonnegative().nullable(),
});
export const InvestigationQualification = z.object({ status: z.enum(['QUALIFIED', 'PROVISIONAL', 'REJECTED']), eligible: z.boolean(), reasons: z.array(z.string()), rulesVersion: z.number() });
export const InvestigationFlowBucket = z.object({
  startAt: At,
  endAt: At,
  buySol: Amount,
  sellSol: Amount,
  netSol: Amount,
  tradeCount: z.number().int().nonnegative(),
  activeGroups: z.number().int().nonnegative(),
});
export const InvestigationCoEntryBurst = z.object({
  startAt: At,
  endAt: At,
  spanSeconds: z.number().int().nonnegative(),
  participantCount: z.number().int().min(2),
  independentGroupCount: z.number().int().min(1),
  totalBuySol: Amount,
  participantIds: z.array(z.string()),
  sampleSignatures: z.array(z.string()),
});
export const InvestigationRapidFlip = z.object({
  walletId: z.string(),
  buySol: Amount,
  sellSol: Amount,
  netExtractedSol: Amount,
  buyCount: z.number().int().positive(),
  sellCount: z.number().int().positive(),
  spanSeconds: z.number().int().nonnegative(),
});
export const InvestigationForensics = z.object({
  postures: z.object({
    accumulatingGroups: z.number().int().nonnegative(),
    distributingGroups: z.number().int().nonnegative(),
    rotatingGroups: z.number().int().nonnegative(),
    unpricedGroups: z.number().int().nonnegative(),
    accumulatingNetSol: Amount.nullable(),
    distributingNetSol: Amount.nullable(),
  }),
  concentration: z.object({
    top1GroupSharePct: z.number().finite().min(0).max(100).nullable(),
    top3GroupSharePct: z.number().finite().min(0).max(100).nullable(),
    groupHhi: z.number().int().min(0).max(10000).nullable(),
    qualifiedBuySharePct: z.number().finite().min(0).max(100).nullable(),
    automatedParticipantCount: z.number().int().nonnegative(),
  }),
  flowSeries: z.array(InvestigationFlowBucket),
  coEntryBursts: z.array(InvestigationCoEntryBurst),
  rapidFlips: z.array(InvestigationRapidFlip),
});
export type InvestigationForensicsData = z.infer<typeof InvestigationForensics>;

export const InvestigationLeadItem = z.object({
  mint: z.string(),
  symbol: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable().optional(),
  tradeCount24h: z.number().int().positive(),
  buySol24h: Amount,
  sellSol24h: Amount,
  netSol24h: Amount,
  participantCount24h: z.number().int().positive(),
  qualifiedCount24h: z.number().int().nonnegative(),
  lastTradeAt: At,
});
export const InvestigationLeadsResponse = z.object({
  asOf: At,
  windowHours: z.literal(24),
  items: z.array(InvestigationLeadItem),
});
export type InvestigationLeads = z.infer<typeof InvestigationLeadsResponse>;

export const InvestigationResponse = z.object({
  methodologyVersion: z.literal(1),
  token: z.object({ mint: z.string(), symbol: z.string(), name: z.string() }),
  window: z.enum(['24h', '7d']), from: At, asOf: At, readAt: At,
  // asOf bounds event time only; current qualification/grouping are read at readAt.
  contextMode: z.literal('CURRENT'), consistency: z.literal('LIVE_REQUERY'),
  coverage: z.object({
    population: z.literal('ACTIVE_TRACKED_WALLETS'),
    activity: z.enum(['OBSERVED_TRADES', 'NO_OBSERVED_TRADES']),
    aggregationScope: z.enum(['RECORDED_WINDOW', 'LATEST_CAPPED_SAMPLE']),
    tradeLimit: z.number().int(), tradesRead: z.number().int(), tradesTruncated: z.boolean(),
    relationshipLimit: z.number().int(), relationshipsTruncated: z.boolean(),
    participantCount: z.number().int(), groupCount: z.number().int(), currentlyQualifiedCount: z.number().int(),
    historyCoveredCount: z.number().int(), limitations: z.array(z.string()),
  }),
  totals: InvestigationTotals,
  availability: z.object({ activeTrackedWallets: z.number().int().nonnegative(), lastRecordedTradeAt: At.nullable(), hasTradesIn7d: z.boolean() }).optional(),
  participants: z.array(z.object({
    id: z.string(), address: z.string(), groupId: z.string(),
    automated: z.boolean().optional(),
    currentQualification: InvestigationQualification, history: InvestigationHistory, totals: InvestigationTotals,
  })),
  groups: z.array(z.object({
    id: z.string(), basis: z.enum(['FUNDING', 'TIMING', 'UNKNOWN', 'UNGROUPED']),
    confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable(), clusterCreatedAt: At.nullable(),
    posture: z.enum(['ACCUMULATING', 'DISTRIBUTING', 'ROTATING', 'UNPRICED']).optional(),
    participantIds: z.array(z.string()), totals: InvestigationTotals,
  })),
  relationships: z.array(z.object({ id: z.string(), fromId: z.string(), toId: z.string(), kind: z.string(), confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']), evidence: z.unknown().nullable() })),
  trades: z.array(z.object({
    id: z.string(), walletId: z.string(), signature: z.string(), side: z.enum(['BUY', 'SELL']), at: At,
    amountSol: Amount.nullable(), tokenAmount: Amount.nullable(), evidence: z.unknown().nullable(),
  })),
  nextCursor: z.string().nullable(),
  strategies: InvestigationStrategies.optional(),
  publications: PublishedInvestigationContext.optional(),
  discovery: InvestigationDiscovery.optional(),
  forensics: InvestigationForensics.optional(),
});
export type SmartMoneyInvestigation = z.infer<typeof InvestigationResponse>;
export type SmartMoneyInvestigationTotals = z.infer<typeof InvestigationTotals>;
export type InvestigationDiscoveryStatus = z.infer<typeof InvestigationDiscovery>;
