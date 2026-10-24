-- AlterTable
ALTER TABLE "TrackedWallet" ADD COLUMN     "researchReview" TEXT NOT NULL DEFAULT 'PROVISIONAL',
ADD COLUMN     "researchReviewReason" TEXT,
ADD COLUMN     "researchReviewedAt" TIMESTAMP(3),
ADD COLUMN     "researchReviewedBy" TEXT;

-- AlterTable
ALTER TABLE "WalletTrade" ADD COLUMN     "evidence" JSONB;

-- CreateTable
CREATE TABLE "WalletResearchSignal" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "walletCount" INTEGER NOT NULL,
    "independentEntities" INTEGER NOT NULL,
    "netFlowSol" DECIMAL(65,30) NOT NULL,
    "entryPriceUsd" DECIMAL(65,30) NOT NULL,
    "entryMetricId" TEXT NOT NULL,
    "entryAt" TIMESTAMP(3) NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletResearchSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletResearchMeasurement" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "horizonHours" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priceUsd" DECIMAL(65,30),
    "priceAt" TIMESTAMP(3),
    "metricId" TEXT,
    "returnPct" DOUBLE PRECISION,
    "reason" TEXT,
    "measuredAt" TIMESTAMP(3),

    CONSTRAINT "WalletResearchMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletResearchSignal_dedupeKey_key" ON "WalletResearchSignal"("dedupeKey");

-- CreateIndex
CREATE INDEX "WalletResearchSignal_tokenId_createdAt_idx" ON "WalletResearchSignal"("tokenId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletResearchSignal_createdAt_idx" ON "WalletResearchSignal"("createdAt");

-- CreateIndex
CREATE INDEX "WalletResearchMeasurement_status_dueAt_idx" ON "WalletResearchMeasurement"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletResearchMeasurement_signalId_horizonHours_key" ON "WalletResearchMeasurement"("signalId", "horizonHours");

-- AddForeignKey
ALTER TABLE "WalletResearchSignal" ADD CONSTRAINT "WalletResearchSignal_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletResearchMeasurement" ADD CONSTRAINT "WalletResearchMeasurement_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "WalletResearchSignal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
