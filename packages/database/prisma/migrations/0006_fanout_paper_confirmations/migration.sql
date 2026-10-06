-- HAND-WRITTEN (no database or Prisma schema engine was available). Verify with:
--   npx prisma migrate diff --from-migrations packages/database/prisma/migrations --to-schema-datamodel packages/database/prisma/schema.prisma --shadow-database-url <url> --script
-- It must print nothing (or "-- This is an empty migration.").

-- CreateEnum
CREATE TYPE "ConfirmationKind" AS ENUM ('ENTRY', 'EXIT');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('PENDING', 'CLAIMED', 'REJECTED', 'EXPIRED');

-- AlterEnum
ALTER TYPE "TradeMode" ADD VALUE 'AI_PAPER';

-- DropIndex
DROP INDEX "RiskDecision_decisionId_key";

-- AlterTable
ALTER TABLE "RiskDecision" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "userId" TEXT,
ALTER COLUMN "decisionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "baseUnits" DECIMAL(40,0),
ADD COLUMN     "entrySizeSol" DECIMAL(65,30),
ADD COLUMN     "openKey" TEXT,
ADD COLUMN     "reduceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reducedForCodes" TEXT[],
ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "amountSol" DECIMAL(65,30),
ADD COLUMN     "baseUnits" DECIMAL(40,0),
ADD COLUMN     "feeSol" DECIMAL(65,30),
ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PortfolioSnapshot" ADD COLUMN     "simulated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PendingConfirmation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" "ConfirmationKind" NOT NULL,
    "status" "ConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "mint" TEXT NOT NULL,
    "decisionId" TEXT,
    "positionId" TEXT,
    "evaluationId" TEXT,
    "job" JSONB NOT NULL,
    "sizeSol" DECIMAL(65,30) NOT NULL,
    "exitFraction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quote" JSONB NOT NULL,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PendingConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionExit" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "action" "DecisionAction" NOT NULL,
    "fractionPct" INTEGER NOT NULL,
    "signalCodes" TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "outcome" TEXT NOT NULL DEFAULT 'queued',
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionExit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingConfirmation_idempotencyKey_key" ON "PendingConfirmation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PendingConfirmation_userId_status_expiresAt_idx" ON "PendingConfirmation"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "PendingConfirmation_status_expiresAt_idx" ON "PendingConfirmation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PositionExit_evaluationId_key" ON "PositionExit"("evaluationId");

-- CreateIndex
CREATE INDEX "PositionExit_positionId_createdAt_idx" ON "PositionExit"("positionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RiskDecision_idempotencyKey_key" ON "RiskDecision"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RiskDecision_decisionId_idx" ON "RiskDecision"("decisionId");

-- CreateIndex
CREATE INDEX "RiskDecision_userId_createdAt_idx" ON "RiskDecision"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Position_openKey_key" ON "Position"("openKey");

-- AddForeignKey
ALTER TABLE "PendingConfirmation" ADD CONSTRAINT "PendingConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionExit" ADD CONSTRAINT "PositionExit_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
