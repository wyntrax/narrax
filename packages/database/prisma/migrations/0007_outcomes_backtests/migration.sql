-- HAND-WRITTEN (no Prisma schema engine was available). Verify with:
--   npx prisma migrate diff --from-migrations packages/database/prisma/migrations --to-schema-datamodel packages/database/prisma/schema.prisma --shadow-database-url <url> --script
-- It must print nothing (or "-- This is an empty migration.").

-- AlterTable
ALTER TABLE "DecisionOutcome" ADD COLUMN     "entryPriceUsd" DOUBLE PRECISION,
ADD COLUMN     "isFinal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxDrawdownPct" DOUBLE PRECISION,
ADD COLUMN     "maxGainPct" DOUBLE PRECISION,
ADD COLUMN     "unknownReason" TEXT;

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionOutcome_isFinal_measuredAt_idx" ON "DecisionOutcome"("isFinal", "measuredAt");

-- CreateIndex
CREATE INDEX "BacktestRun_kind_createdAt_idx" ON "BacktestRun"("kind", "createdAt");
