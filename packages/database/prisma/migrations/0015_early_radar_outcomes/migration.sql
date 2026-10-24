-- CreateTable
CREATE TABLE "EarlyRadarOutcome" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "mint" TEXT,
    "alertedAt" TIMESTAMP(3) NOT NULL,
    "profile" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "matchKind" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "entryMetricId" TEXT,
    "entryAt" TIMESTAMP(3),
    "entryPriceUsd" DOUBLE PRECISION,
    "entryMarketCapUsd" DOUBLE PRECISION,
    "entryMarketCapIsFdv" BOOLEAN,
    "entrySource" TEXT,
    "entryUnknownReason" TEXT,

    CONSTRAINT "EarlyRadarOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarlyRadarMeasurement" (
    "id" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "horizonHours" INTEGER NOT NULL,
    "targetAt" TIMESTAMP(3) NOT NULL,
    "nextCheckAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "metricId" TEXT,
    "observedAt" TIMESTAMP(3),
    "priceUsd" DOUBLE PRECISION,
    "marketCapUsd" DOUBLE PRECISION,
    "marketCapIsFdv" BOOLEAN,
    "source" TEXT,
    "returnPct" DOUBLE PRECISION,
    "unknownReason" TEXT,
    "measuredAt" TIMESTAMP(3),

    CONSTRAINT "EarlyRadarMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EarlyRadarOutcome_alertId_key" ON "EarlyRadarOutcome"("alertId");

-- CreateIndex
CREATE INDEX "EarlyRadarOutcome_alertedAt_id_idx" ON "EarlyRadarOutcome"("alertedAt", "id");

-- CreateIndex
CREATE INDEX "EarlyRadarOutcome_tokenId_alertedAt_idx" ON "EarlyRadarOutcome"("tokenId", "alertedAt");

-- CreateIndex
CREATE INDEX "EarlyRadarMeasurement_status_nextCheckAt_id_idx" ON "EarlyRadarMeasurement"("status", "nextCheckAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EarlyRadarMeasurement_outcomeId_horizonHours_key" ON "EarlyRadarMeasurement"("outcomeId", "horizonHours");

-- AddForeignKey
ALTER TABLE "EarlyRadarOutcome" ADD CONSTRAINT "EarlyRadarOutcome_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarlyRadarMeasurement" ADD CONSTRAINT "EarlyRadarMeasurement_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "EarlyRadarOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;
