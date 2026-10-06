
-- CreateTable
CREATE TABLE "PositionEvaluation" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "action" "DecisionAction" NOT NULL,
    "fractionPct" INTEGER NOT NULL,
    "signals" JSONB NOT NULL,
    "unavailable" JSONB NOT NULL,
    "blind" BOOLEAN NOT NULL,
    "pnlPct" DOUBLE PRECISION,
    "priceUsd" DECIMAL(65,30),
    "review" JSONB,
    "aiTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PositionEvaluation_positionId_createdAt_idx" ON "PositionEvaluation"("positionId", "createdAt");

-- CreateIndex
CREATE INDEX "PositionEvaluation_createdAt_idx" ON "PositionEvaluation"("createdAt");

-- AddForeignKey
ALTER TABLE "PositionEvaluation" ADD CONSTRAINT "PositionEvaluation_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
