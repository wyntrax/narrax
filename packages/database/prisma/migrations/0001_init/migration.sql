-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TradingMode" AS ENUM ('PAPER', 'SHADOW', 'SEMI_AUTO', 'AUTO');

-- CreateEnum
CREATE TYPE "DecisionAction" AS ENUM ('BUY', 'WATCH', 'HOLD', 'REDUCE', 'SELL', 'IGNORE');

-- CreateEnum
CREATE TYPE "NarrativeStage" AS ENUM ('SEED', 'EMERGING', 'ACCELERATING', 'MAINSTREAM', 'SATURATED', 'DECAYING', 'DEAD');

-- CreateEnum
CREATE TYPE "WalletStyle" AS ENUM ('EARLY_MOMENTUM', 'MEME_EARLY', 'SWING', 'SCALPER', 'ROTATION', 'LONG_HOLD', 'NARRATIVE_LEADER', 'FOLLOWER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TokenRelation" AS ENUM ('OG', 'PRIMARY', 'DERIVATIVE', 'MEME_EXPRESSION', 'UNRELATED', 'SUSPICIOUS');

-- CreateEnum
CREATE TYPE "CreatorRole" AS ENUM ('ORIGINATOR', 'EARLY_AMPLIFIER', 'FOLLOWER');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "AlertPriority" AS ENUM ('INFO', 'WATCH', 'IMPORTANT', 'CRITICAL');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "TradeMode" AS ENUM ('MANUAL', 'AI_SEMI_AUTO', 'AI_AUTO', 'TP', 'SL', 'TRAILING');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiskRoute" AS ENUM ('REJECT', 'NO_TRADE', 'LOG_ONLY', 'SIMULATE', 'AWAIT_CONFIRMATION', 'EXECUTE');

-- CreateEnum
CREATE TYPE "OutcomeLabel" AS ENUM ('WIN', 'LOSS', 'FLAT', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "privyUserId" TEXT NOT NULL,
    "email" TEXT,
    "mode" "TradingMode" NOT NULL DEFAULT 'SHADOW',
    "interests" TEXT[],
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "privyWalletId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "aiTradingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "agentPaused" BOOLEAN NOT NULL DEFAULT false,
    "delegatedUntil" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "preset" TEXT NOT NULL DEFAULT 'BALANCED',
    "maxPerTradeSol" DECIMAL(65,30) NOT NULL DEFAULT 0.25,
    "maxDailyAllocationSol" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "maxTokenExposurePct" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "maxOpenPositions" INTEGER NOT NULL DEFAULT 5,
    "maxDailyLossPct" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "minConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clusterId" TEXT,

    CONSTRAINT "TrackedWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletProfile" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "leaderScore" DOUBLE PRECISION NOT NULL,
    "style" "WalletStyle" NOT NULL DEFAULT 'UNKNOWN',
    "typicalEntryMcMin" DECIMAL(65,30),
    "typicalEntryMcMax" DECIMAL(65,30),
    "medianHoldSeconds" INTEGER,
    "strongestNarrative" TEXT,
    "bestPattern" TEXT,
    "weakPattern" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletMetric" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL,
    "pnlUsd" DECIMAL(65,30) NOT NULL,
    "avgRoi" DOUBLE PRECISION NOT NULL,
    "medianRoi" DOUBLE PRECISION NOT NULL,
    "maxDrawdown" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTrade" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "amountSol" DECIMAL(65,30) NOT NULL,
    "amountUsd" DECIMAL(65,30),
    "marketCapUsd" DECIMAL(65,30),
    "signature" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletCluster" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "confidence" "Confidence" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletRelationship" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "evidence" JSONB,

    CONSTRAINT "WalletRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creator" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorMetric" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "creatorScore" DOUBLE PRECISION NOT NULL,
    "leadScore" DOUBLE PRECISION NOT NULL,
    "amplificationScore" DOUBLE PRECISION NOT NULL,
    "hitRate" DOUBLE PRECISION NOT NULL,
    "medianLeadSeconds" INTEGER,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Narrative" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "stage" "NarrativeStage" NOT NULL DEFAULT 'SEED',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "velocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "acceleration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "organicScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saturationRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Narrative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeMetric" (
    "id" TEXT NOT NULL,
    "narrativeId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "velocity" DOUBLE PRECISION NOT NULL,
    "acceleration" DOUBLE PRECISION NOT NULL,
    "organicScore" DOUBLE PRECISION NOT NULL,
    "manipulationRisk" DOUBLE PRECISION NOT NULL,
    "mentionVelocity" DOUBLE PRECISION NOT NULL,
    "creatorVelocity" DOUBLE PRECISION NOT NULL,
    "engagementVelocity" DOUBLE PRECISION NOT NULL,
    "smartMoneyCorrelation" DOUBLE PRECISION,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NarrativeMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeSource" (
    "id" TEXT NOT NULL,
    "narrativeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalRef" TEXT,

    CONSTRAINT "NarrativeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeMention" (
    "id" TEXT NOT NULL,
    "narrativeId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "creatorId" TEXT,
    "textHash" TEXT NOT NULL,
    "engagement" INTEGER NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NarrativeMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeCreator" (
    "id" TEXT NOT NULL,
    "narrativeId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "role" "CreatorRole" NOT NULL,

    CONSTRAINT "NarrativeCreator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeTokenRelation" (
    "id" TEXT NOT NULL,
    "narrativeId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "relation" "TokenRelation" NOT NULL,
    "ogScore" DOUBLE PRECISION NOT NULL,
    "matchScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "NarrativeTokenRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdOnChainAt" TIMESTAMP(3),
    "deployer" TEXT,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenMetric" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "priceUsd" DECIMAL(65,30) NOT NULL,
    "marketCapUsd" DECIMAL(65,30) NOT NULL,
    "liquidityUsd" DECIMAL(65,30) NOT NULL,
    "volume24hUsd" DECIMAL(65,30) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenHolderMetric" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "holders" INTEGER NOT NULL,
    "top10Pct" DOUBLE PRECISION NOT NULL,
    "devHoldingPct" DOUBLE PRECISION,
    "smartWalletHolders" INTEGER NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenHolderMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenRiskMetric" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "flags" TEXT[],
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenRiskMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmartMoneySignal" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "amountUsd" DECIMAL(65,30) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmartMoneySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsensusSignal" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "walletCount" INTEGER NOT NULL,
    "independentEntities" INTEGER NOT NULL,
    "leaderCount" INTEGER NOT NULL,
    "netFlowUsd" DECIMAL(65,30) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsensusSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "narrativeId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "narrativeScore" DOUBLE PRECISION NOT NULL,
    "smartMoneyScore" DOUBLE PRECISION NOT NULL,
    "liquidityScore" DOUBLE PRECISION NOT NULL,
    "momentumScore" DOUBLE PRECISION NOT NULL,
    "ogScore" DOUBLE PRECISION NOT NULL,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "attentionGrowth" DOUBLE PRECISION,
    "priceGrowth" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAnalysis" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fastClassification" TEXT,
    "fastScore" DOUBLE PRECISION,
    "bullCase" JSONB,
    "bearCase" JSONB,
    "riskCase" JSONB,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "DecisionAction" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskDecision" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "route" "RiskRoute" NOT NULL,
    "sizeSol" DECIMAL(65,30) NOT NULL,
    "violations" JSONB NOT NULL,
    "adjustments" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "mode" "TradingMode" NOT NULL,
    "entryPriceUsd" DECIMAL(65,30) NOT NULL,
    "sizeSol" DECIMAL(65,30) NOT NULL,
    "entryContext" JSONB NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "mode" "TradeMode" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "sizeSol" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "quote" JSONB NOT NULL,
    "priceImpactPct" DOUBLE PRECISION,
    "slippageBps" DOUBLE PRECISION,
    "signature" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "positionId" TEXT,
    "side" "TradeSide" NOT NULL,
    "mode" "TradeMode" NOT NULL,
    "reason" TEXT NOT NULL,
    "expectedPriceUsd" DECIMAL(65,30) NOT NULL,
    "actualPriceUsd" DECIMAL(65,30) NOT NULL,
    "slippageBps" DOUBLE PRECISION NOT NULL,
    "realizedPnlSol" DECIMAL(65,30),
    "signature" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionOutcome" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "label" "OutcomeLabel" NOT NULL DEFAULT 'UNKNOWN',
    "returnPct1h" DOUBLE PRECISION,
    "returnPct24h" DOUBLE PRECISION,
    "leadTimeSeconds" INTEGER,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "priority" "AlertPriority" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalValueSol" DECIMAL(65,30) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_privyUserId_key" ON "User"("privyUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TradingPermission_userId_key" ON "TradingPermission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RiskProfile_userId_key" ON "RiskProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedWallet_address_key" ON "TrackedWallet"("address");

-- CreateIndex
CREATE UNIQUE INDEX "WalletProfile_walletId_key" ON "WalletProfile"("walletId");

-- CreateIndex
CREATE INDEX "WalletMetric_walletId_window_computedAt_idx" ON "WalletMetric"("walletId", "window", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTrade_signature_key" ON "WalletTrade"("signature");

-- CreateIndex
CREATE INDEX "WalletTrade_tokenId_at_idx" ON "WalletTrade"("tokenId", "at");

-- CreateIndex
CREATE INDEX "WalletTrade_walletId_at_idx" ON "WalletTrade"("walletId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "WalletRelationship_fromId_toId_kind_key" ON "WalletRelationship"("fromId", "toId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Creator_platform_handle_key" ON "Creator"("platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "Narrative_slug_key" ON "Narrative"("slug");

-- CreateIndex
CREATE INDEX "NarrativeMetric_narrativeId_at_idx" ON "NarrativeMetric"("narrativeId", "at");

-- CreateIndex
CREATE INDEX "NarrativeSource_narrativeId_idx" ON "NarrativeSource"("narrativeId");

-- CreateIndex
CREATE INDEX "NarrativeMention_narrativeId_at_idx" ON "NarrativeMention"("narrativeId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "NarrativeCreator_narrativeId_creatorId_key" ON "NarrativeCreator"("narrativeId", "creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "NarrativeTokenRelation_narrativeId_tokenId_key" ON "NarrativeTokenRelation"("narrativeId", "tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "Token_mint_key" ON "Token"("mint");

-- CreateIndex
CREATE INDEX "Token_symbol_idx" ON "Token"("symbol");

-- CreateIndex
CREATE INDEX "TokenMetric_tokenId_at_idx" ON "TokenMetric"("tokenId", "at");

-- CreateIndex
CREATE INDEX "TokenHolderMetric_tokenId_at_idx" ON "TokenHolderMetric"("tokenId", "at");

-- CreateIndex
CREATE INDEX "TokenRiskMetric_tokenId_at_idx" ON "TokenRiskMetric"("tokenId", "at");

-- CreateIndex
CREATE INDEX "SmartMoneySignal_tokenId_at_idx" ON "SmartMoneySignal"("tokenId", "at");

-- CreateIndex
CREATE INDEX "ConsensusSignal_tokenId_at_idx" ON "ConsensusSignal"("tokenId", "at");

-- CreateIndex
CREATE INDEX "Opportunity_tokenId_createdAt_idx" ON "Opportunity"("tokenId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDecision_userId_createdAt_idx" ON "AgentDecision"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskDecision_decisionId_key" ON "RiskDecision"("decisionId");

-- CreateIndex
CREATE INDEX "Position_userId_status_idx" ON "Position"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Order_userId_tokenId_createdAt_idx" ON "Order"("userId", "tokenId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_orderId_key" ON "Trade"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_signature_key" ON "Trade"("signature");

-- CreateIndex
CREATE INDEX "Trade_userId_executedAt_idx" ON "Trade"("userId", "executedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionOutcome_decisionId_key" ON "DecisionOutcome"("decisionId");

-- CreateIndex
CREATE INDEX "Alert_userId_createdAt_idx" ON "Alert"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_userId_at_idx" ON "PortfolioSnapshot"("userId", "at");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingPermission" ADD CONSTRAINT "TradingPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskProfile" ADD CONSTRAINT "RiskProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedWallet" ADD CONSTRAINT "TrackedWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedWallet" ADD CONSTRAINT "TrackedWallet_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "WalletCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletProfile" ADD CONSTRAINT "WalletProfile_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "TrackedWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletMetric" ADD CONSTRAINT "WalletMetric_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "TrackedWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTrade" ADD CONSTRAINT "WalletTrade_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "TrackedWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTrade" ADD CONSTRAINT "WalletTrade_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletRelationship" ADD CONSTRAINT "WalletRelationship_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "TrackedWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletRelationship" ADD CONSTRAINT "WalletRelationship_toId_fkey" FOREIGN KEY ("toId") REFERENCES "TrackedWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorMetric" ADD CONSTRAINT "CreatorMetric_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeMetric" ADD CONSTRAINT "NarrativeMetric_narrativeId_fkey" FOREIGN KEY ("narrativeId") REFERENCES "Narrative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeSource" ADD CONSTRAINT "NarrativeSource_narrativeId_fkey" FOREIGN KEY ("narrativeId") REFERENCES "Narrative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeMention" ADD CONSTRAINT "NarrativeMention_narrativeId_fkey" FOREIGN KEY ("narrativeId") REFERENCES "Narrative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeCreator" ADD CONSTRAINT "NarrativeCreator_narrativeId_fkey" FOREIGN KEY ("narrativeId") REFERENCES "Narrative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeCreator" ADD CONSTRAINT "NarrativeCreator_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeTokenRelation" ADD CONSTRAINT "NarrativeTokenRelation_narrativeId_fkey" FOREIGN KEY ("narrativeId") REFERENCES "Narrative"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeTokenRelation" ADD CONSTRAINT "NarrativeTokenRelation_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenMetric" ADD CONSTRAINT "TokenMetric_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenHolderMetric" ADD CONSTRAINT "TokenHolderMetric_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenRiskMetric" ADD CONSTRAINT "TokenRiskMetric_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartMoneySignal" ADD CONSTRAINT "SmartMoneySignal_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmartMoneySignal" ADD CONSTRAINT "SmartMoneySignal_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "TrackedWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsensusSignal" ADD CONSTRAINT "ConsensusSignal_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_narrativeId_fkey" FOREIGN KEY ("narrativeId") REFERENCES "Narrative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAnalysis" ADD CONSTRAINT "AgentAnalysis_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "AgentAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskDecision" ADD CONSTRAINT "RiskDecision_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AgentDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AgentDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionAttempt" ADD CONSTRAINT "ExecutionAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionOutcome" ADD CONSTRAINT "DecisionOutcome_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AgentDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "PortfolioSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

