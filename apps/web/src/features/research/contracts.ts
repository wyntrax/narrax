import {z} from 'zod';
import {RadarSafetyViewSchema,LatestEvidenceSchema} from '@narra/shared';
import {QualificationSchema} from './wallet-research-contracts';

// Mirrors apps/api/src/{overview,read}.ts. Unknown fields are stripped at the boundary.
const number=z.number().finite(),nullable=number.nullable(),date=z.string().datetime({offset:true});
const text=z.string().max(20000);
export const stages=['SEED','EMERGING','ACCELERATING','MAINSTREAM','SATURATED','DECAYING','DEAD'] as const;
export const Stage=z.enum(stages);
const NarrativeRef=z.object({slug:text,name:text,stage:Stage});
export const NarrativeSchema=NarrativeRef.extend({id:text,score:number,velocity:number,acceleration:number,organicScore:number,saturationRisk:number,firstDetectedAt:date,updatedAt:date,tokenCount:z.number().int().nonnegative()});
export type Narrative=z.infer<typeof NarrativeSchema>;
export const TokenRef=z.object({mint:text,symbol:text,name:text,imageUrl:text.nullish()});
const TokenLabel=TokenRef.partial({name:true});
export const MarketObservation=z.object({source:z.literal('dexscreener'),at:date,stale:z.boolean(),marketCapIsFdv:z.boolean(),priceChange1hPct:nullable,pairAddress:text,dexId:text.nullable(),pairCreatedAt:date.nullable()});
const TokenSummary=TokenRef.extend({priceUsd:nullable,marketCapUsd:nullable,liquidityUsd:nullable,volume24hUsd:nullable.optional(),createdOnChainAt:date.nullable().optional(),observation:MarketObservation.nullish()});
export function pageOf<T extends z.ZodTypeAny>(item:T){return z.object({items:z.array(item),nextCursor:z.string().nullable()});}
export const NarrativesSchema=pageOf(NarrativeSchema);
export const TokensSchema=pageOf(TokenSummary);
export const NarrativeDetailSchema=NarrativeSchema.omit({tokenCount:true}).extend({
 summary:text.nullable(),
 latestMetric:z.object({at:date,mentionVelocity:number,creatorVelocity:number,engagementVelocity:number,manipulationRisk:number,smartMoneyCorrelation:nullable}).nullable(),
 creators:z.array(z.object({platform:text,handle:text,role:text})),
 tokens:z.array(TokenRef.extend({relation:text,ogScore:number,confidence:number,marketCapUsd:nullable,liquidityUsd:nullable}))
});
export const OpportunitySchema=z.object({
  latestEvidence:LatestEvidenceSchema.optional(),
  radarSafety:RadarSafetyViewSchema.optional(),
 id:text,createdAt:date,score:number,
 scores:z.object({narrative:number,smartMoney:number,liquidity:number,momentum:number,og:number,risk:number}),
 attentionGrowth:nullable,priceGrowth:nullable,token:TokenSummary,narrative:NarrativeRef.nullable(),
 decision:z.object({action:z.enum(['BUY','WATCH','NO_TRADE','REDUCE','SELL','HOLD']),confidence:number.min(0).max(1)}).nullable()
});
export type Opportunity=z.infer<typeof OpportunitySchema>;
export const OpportunitiesSchema=pageOf(OpportunitySchema);
const RotationItem=NarrativeRef.extend({id:text,from:number,to:number,delta:number});
const Rotation=z.object({detected:z.boolean(),window:z.enum(['1h','6h','24h','7d']),falling:z.array(RotationItem),rising:z.array(RotationItem),unknown:z.number().int().nonnegative()});
export const RotationSchema=Rotation.extend({asOf:date,rules:z.object({minDeltaPoints:number,minScoreEitherEnd:number}),note:text});
export const BarSchema=z.object({
 solUsd:z.object({priceUsd:number.positive(),at:date,stale:z.boolean()}).nullable(),
 narrativeHeat:nullable,smartMoneyNetFlowSol24h:nullable,smartMoneyTokens24h:number,
 counts:z.object({activeNarratives:number,acceleratingNarratives:number,trackedWallets:number,opportunities24h:number})
});
export const MarketPreviewSchema=z.object({
 at:date,solUsd:z.object({priceUsd:number.positive(),at:date,stale:z.boolean()}).nullable(),
 narrativeHeat:number.nullable(),trackedWallets:z.number().int().nonnegative(),opportunities24h:z.number().int().nonnegative(),
});
export const OverviewSchema=z.object({
 at:date,bar:BarSchema.nullable(),
 locked:z.object({overview:z.boolean(),narratives:z.boolean(),rotation:z.boolean(),opportunities:z.boolean()}),
  strip:z.object({topNarratives:z.array(NarrativeRef.extend({id:text,score:number,velocity:number})),hottestOpportunity:z.object({id:text,createdAt:date,score:number,token:TokenLabel.extend({priceUsd:nullable,marketCapUsd:nullable}),narrative:z.object({name:text,slug:text}).nullable()}).nullable()}),
 rotation:Rotation.nullable(),brief:z.object({generated:z.literal('rules'),points:z.array(text)}),
 me:z.object({openPositions:number,pendingConfirmations:number,unreadAlerts:number})
});
// Structured arguments are deliberately narrowed; arbitrary nested model JSON is never rendered as HTML.
const Argument=z.object({arguments:z.array(text),strength:number.min(0).max(1),keyUncertainties:z.array(text)}).nullable();
export const AnalysisSchema=z.object({
 opportunityId:text,analyzedAt:date,model:text,bull:Argument,bear:Argument,risk:z.object({risks:z.array(z.object({code:text,description:text,severity:z.enum(['LOW','MEDIUM','HIGH'])})),maxLossScenario:text}).nullable(),
 decision:z.object({action:text,confidence:number.min(0).max(1),summary:text,positiveSignals:z.array(text).optional(),negativeSignals:z.array(text).optional(),risks:z.array(text).optional(),invalidationConditions:z.array(text).optional()}),
 guardrails:z.array(text)
});
export const TokenSchema=TokenRef.extend({
  latestEvidence:LatestEvidenceSchema.optional(),
  radarSafety:RadarSafetyViewSchema.optional(),
  developerHolding:z.object({wallet:text,holdingPct:number.min(0).max(100),signature:text,source:z.literal('INITIAL_MINT_AUTHORITY'),at:date,relatedWalletsIncluded:z.boolean()}).nullish(),
 observation:MarketObservation.nullish(),
 blacklisted:z.boolean(),createdOnChainAt:date.nullable(),
 metrics:z.object({priceUsd:nullable,marketCapUsd:nullable,liquidityUsd:nullable,volume24hUsd:nullable,at:date}).nullable(),
 holders:z.object({holders:number,top10Pct:number,devHoldingPct:nullable,smartWalletHolders:number,at:date}).nullable(),
 risk:z.object({riskScore:number,flags:z.array(text),at:date}).nullable(),
 consensus:z.object({score:number,walletCount:number,independentEntities:number,leaderCount:number,netFlowSol:nullable,timingConcentration:number}).nullable(),
 narratives:z.array(NarrativeRef.extend({relation:text,ogScore:number}))
});
export type Token=z.infer<typeof TokenSchema>;
export const TokenHistorySchema=z.object({window:z.enum(['1h','24h','7d']),asOf:date,points:z.array(z.object({at:date,priceUsd:number.positive(),source:z.literal('dexscreener'),pairAddress:text})),truncated:z.boolean(),excludedUnverified:z.number().int().nonnegative()});
export type PricePoint=z.infer<typeof TokenHistorySchema>['points'][number];

// ---- Smart money, alerts, analytics, settings and chat. Mirrors apps/api/src/{read,alerts,analytics,settings,chat}.ts. ----
export const SmartWalletSchema=z.object({address:text,label:text.nullish(),score:nullable,source:text.optional(),profileAt:date.nullish(),metricsAt:date.nullish(),trackedSince:date.optional(),lastTradeAt:date.nullish(),observedTrades:z.number().int().nonnegative().optional(),evidenceStatus:z.literal('UNVERIFIED').optional(),leaderScore:nullable.optional(),style:text.nullish(),medianHoldSeconds:nullable.optional(),bestPattern:text.nullish(),weakPattern:text.nullish(),winRate:nullable.optional(),pnl30dSol:nullable.optional(),closedTrades:nullable.optional(),avgRoi:nullable.optional(),cluster:z.object({id:text,confidence:text.or(number)}).nullable().optional()});
export type SmartWallet=z.infer<typeof SmartWalletSchema>;
export const WalletIntelligenceSchema=z.object({checkedAt:date,windowDays:number,observedTrades:number,closedTrades:number,requiredClosedTrades:number,status:z.enum(['INSUFFICIENT_HISTORY','READY'])});
export const SmartWalletsSchema=pageOf(SmartWalletSchema.extend({intelligence:WalletIntelligenceSchema.nullish(),qualification:QualificationSchema.nullish(),researchReview:text.optional()}));
const WalletTradeSchema=z.object({id:text,at:date,side:z.enum(['BUY','SELL']),amountSol:nullable,amountUsd:nullable.optional(),marketCapUsd:nullable,evidence:z.object({reasons:z.array(text),market:z.object({at:date,source:text}).nullable()}).nullish(),signature:text,token:TokenLabel});
export const WalletTradesSchema=pageOf(WalletTradeSchema);
export const WalletDetailSchema=z.object({
  qualification:QualificationSchema.nullish(),researchReview:text.optional(),
  intelligence:WalletIntelligenceSchema.extend({observedBuys:number.optional(),observedSells:number.optional(),unmatchedSells:number.optional()}).nullish(),
  history:z.object({checkedAt:date,scanned:number,accepted:number,skipped:number,capped:z.boolean(),windowDays:number}).nullish(),
 address:text,label:text.nullable(),source:text,trackedSince:date,
 profile:z.object({score:number,leaderScore:number,style:text,medianHoldSeconds:nullable,bestPattern:text.nullable(),weakPattern:text.nullable(),updatedAt:date}).nullable(),
 performance:z.record(z.object({winRate:nullable,pnlSol:nullable,closedTrades:number,avgRoi:nullable,computedAt:date})),
 cluster:z.object({label:text.nullable(),confidence:text.or(number),size:number,members:z.array(z.object({address:text,label:text.nullable()}))}).nullable(),
 funding:z.object({status:text,funder:text.nullable(),fundedAt:date.nullable(),amountSol:nullable,checkedAt:date}).nullable(),
 narrativeHistory:z.object({lookbackDays:number,scannedTrades:number,scanCapped:z.boolean(),items:z.array(z.object({slug:text,name:text,stage:Stage,buys:number,sells:number,netSol:number,lastAt:date}))})
});
export const UnreadAlertsSchema=z.object({unread:z.number().int().nonnegative(),capped:z.boolean()});
export const alertPriorities=['INFO','WATCH','IMPORTANT','CRITICAL'] as const;
export const AlertPriority=z.enum(alertPriorities);
export const AlertSchema=z.object({id:text,alertId:text,readAt:date.nullable(),createdAt:date,kind:text,priority:AlertPriority,title:text,body:text,refType:text.nullable(),refId:text.nullable(),token:TokenRef.nullish()});
export type AlertItem=z.infer<typeof AlertSchema>;
export const AlertsSchema=pageOf(AlertSchema).extend({unreadCount:z.number().int().nonnegative()});
export const MarkedSchema=z.object({marked:z.number().int().nonnegative()});
const range=z.tuple([number,number]).nullable();
export const DescribedSchema=z.object({n:number,distinctTokens:number,mean:nullable,median:nullable,p10:nullable,p90:nullable,meanCi:range,winRate:nullable,winRateCi:range,sufficient:z.boolean(),note:text.nullable()});
export type Described=z.infer<typeof DescribedSchema>;
const Bucket=z.object({label:text,described:DescribedSchema});
export const SummarySchema=z.object({
 range:z.object({days:number}),costPct:number,
 decisions:z.object({read:number,independent:number,pending:number,final:number,unknown:number,truncated:z.boolean()}),
 labels:z.object({WIN:number,LOSS:number,FLAT:number}),returns:DescribedSchema,medianLeadTimeSeconds:nullable,
 byConfidence:z.array(Bucket),caveats:z.array(text)
});
export const SignalsSchema=z.object({costPct:number,truncated:z.boolean(),byReasonCode:z.array(Bucket),caveats:z.array(text)});
export const OutcomesSchema=pageOf(z.object({decisionId:text,action:text,confidence:number,decidedAt:date,token:TokenLabel,label:text,return1hPct:nullable,return24hPct:nullable,maxGainPct:nullable,maxDrawdownPct:nullable,leadTimeSeconds:nullable,isFinal:z.boolean(),unknownReason:text.nullable()}));
export const themes=['DARK','LIGHT','SYSTEM'] as const,densities=['COMFORTABLE','COMPACT'] as const;
export const SettingsSchema=z.object({
 profile:z.object({displayName:text.nullable(),timezone:text.nullable()}),
 appearance:z.object({theme:z.enum(themes),density:z.enum(densities),reducedMotion:z.boolean()}),
 notifications:z.object({minPriority:AlertPriority,mutedKinds:z.array(text),mutableKinds:z.array(text),alwaysDelivered:z.array(text)})
});
export type UserSettings=z.infer<typeof SettingsSchema>;
export const ChatReplySchema=z.object({conversationId:text,reply:z.object({text:z.string().max(50000)}),toolsUsed:z.array(text),stopReason:text,proposals:z.array(z.object({id:text,summary:text,reason:text.nullish()}))});

// ---- Own account: open positions, trades, results and wallets. Mirrors apps/api/src/{read,analytics,me}.ts. ----
/** A fixed-rule reading of one open position. It is a recommendation, and null until the monitor has looked. */
export const PositionEvaluationSchema=z.object({action:text,fractionPct:number,signals:z.array(z.object({code:text,level:text,detail:text})),unavailable:z.array(text),blind:z.boolean(),pnlPct:nullable,at:date});
export type PositionEvaluation=z.infer<typeof PositionEvaluationSchema>;
export const PositionSchema=z.object({id:text,mode:text,simulated:z.boolean().optional(),paperCloseEligible:z.boolean().optional(),openedAt:date,sizeSol:nullable,entryPriceUsd:number,currentPriceUsd:nullable,pnlPct:nullable,token:TokenLabel,evaluation:PositionEvaluationSchema.nullable()});
export type Position=z.infer<typeof PositionSchema>;
export const PositionsSchema=z.object({items:z.array(PositionSchema)});
export const TradesSchema=pageOf(z.object({id:text,executedAt:date,side:z.enum(['BUY','SELL']),mode:text,simulated:z.boolean().optional(),reason:text,sizeSol:nullable,expectedPriceUsd:nullable,actualPriceUsd:nullable,slippageBps:nullable,signature:text,token:TokenLabel}));
export type Trade=z.infer<typeof TradesSchema>['items'][number];
const closedPositions=z.object({count:number,wins:number,winRate:nullable,winRateCi:range,meanPnlSol:nullable,sufficient:z.boolean(),note:text.nullable()});
export const AccountResultsSchema=z.object({trades:number,realizedPnlSol:number,feesSol:number,daily:z.array(z.object({day:text,pnlSol:number})),closedPositions});
export const PerformanceSchema=z.object({range:z.object({from:date,to:date,days:number}),truncated:z.boolean(),paper:AccountResultsSchema,real:AccountResultsSchema,caveats:z.array(text)});
export type Performance=z.infer<typeof PerformanceSchema>;
export const EquitySchema=z.object({simulated:z.boolean(),range:z.object({from:date,to:date,days:number}),points:z.array(z.object({at:date,valueSol:number})),peakSol:nullable,latestSol:nullable,drawdownPct:nullable,downsampled:z.boolean()});
export type Equity=z.infer<typeof EquitySchema>;
export const MyWalletsSchema=z.object({items:z.array(z.object({id:text,address:text,kind:text,createdAt:date}))});
export const MyBalancesSchema=z.object({at:date,items:z.array(z.object({address:text,kind:text,balanceSol:nullable,status:z.enum(['OK','UNKNOWN'])})),available:z.boolean()});
export const PaperAccountSchema=z.object({mode:text.nullable(),balanceSol:number,feeSol:number,quotesAvailable:z.boolean(),entryPermission:z.boolean(),paused:z.boolean()});
/** Own-account setup replies. Mirrors PUT /v1/mode and PUT /v1/ai-access; both are re-checked server-side on every order. */
export const ModeSchema=z.object({mode:text});
export const AiAccessSchema=z.object({aiTradingEnabled:z.boolean()});
export const PaperPreviewSchema=z.object({previewId:text,expiresAt:date,side:z.enum(['BUY','SELL']),mint:text,symbol:text.nullable(),name:text.nullish(),imageUrl:text.nullish(),sizeSol:number,requestedSizeSol:nullable,fractionPct:number,estimatedProceedsSol:nullable,feeSol:number,priceImpactPct:number,slippageBps:number,simulated:z.literal(true)});
export type PaperPreview=z.infer<typeof PaperPreviewSchema>;
export const PaperReceiptSchema=z.object({orderId:text,positionId:text.nullable(),side:z.enum(['BUY','SELL']),simulated:z.literal(true),replayed:z.boolean()});
