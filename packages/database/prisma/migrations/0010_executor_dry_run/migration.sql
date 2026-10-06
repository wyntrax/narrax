-- HAND-WRITTEN (the Prisma schema engine could not be downloaded in the build sandbox). Verify with:
--   npx prisma migrate diff --from-migrations packages/database/prisma/migrations --to-schema-datamodel packages/database/prisma/schema.prisma --shadow-database-url <url> --script
-- It must print nothing (or "-- This is an empty migration.").

-- CreateTable
CREATE TABLE "DryRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "confirmationId" TEXT,
    "side" "TradeSide" NOT NULL,
    "mint" TEXT NOT NULL,
    "sizeSol" DECIMAL(65,30),
    "outcome" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "simulation" JSONB,
    "messageHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DryRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DryRun_idempotencyKey_key" ON "DryRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DryRun_userId_createdAt_idx" ON "DryRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DryRun_outcome_createdAt_idx" ON "DryRun"("outcome", "createdAt");

-- AddForeignKey
ALTER TABLE "DryRun" ADD CONSTRAINT "DryRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
