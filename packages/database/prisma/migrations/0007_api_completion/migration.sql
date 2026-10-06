-- HAND-WRITTEN (the Prisma schema engine could not be downloaded in the build sandbox). Verify with:
--   npx prisma migrate diff --from-migrations packages/database/prisma/migrations --to-schema-datamodel packages/database/prisma/schema.prisma --shadow-database-url <url> --script
-- It must print nothing (or "-- This is an empty migration.").

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "dispatchedAt" TIMESTAMP(3);

-- Alerts that exist before this migration were already handled (personal alerts created their own notification, global
-- ones never had any). Marking them dispatched keeps the first dispatcher run from flooding every user with history.
UPDATE "Alert" SET "dispatchedAt" = "createdAt" WHERE "dispatchedAt" IS NULL;

-- A notification is unique per user and alert. Remove any accidental duplicate (keeping the oldest id) before the index.
DELETE FROM "Notification" a USING "Notification" b WHERE a."userId" = b."userId" AND a."alertId" = b."alertId" AND a."id" > b."id";

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT,
    "timezone" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'DARK',
    "density" TEXT NOT NULL DEFAULT 'COMFORTABLE',
    "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
    "minAlertPriority" "AlertPriority" NOT NULL DEFAULT 'WATCH',
    "mutedAlertKinds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "Alert_dispatchedAt_createdAt_idx" ON "Alert"("dispatchedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_alertId_idx" ON "Notification"("alertId");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_alertId_key" ON "Notification"("userId", "alertId");

-- CreateIndex
CREATE INDEX "NarrativeMetric_at_idx" ON "NarrativeMetric"("at");

-- CreateIndex
CREATE INDEX "ConsensusSignal_at_idx" ON "ConsensusSignal"("at");

-- CreateIndex
CREATE INDEX "Opportunity_createdAt_idx" ON "Opportunity"("createdAt");

-- CreateIndex
CREATE INDEX "Trade_executedAt_idx" ON "Trade"("executedAt");

-- CreateIndex
CREATE INDEX "PendingConfirmation_createdAt_idx" ON "PendingConfirmation"("createdAt");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
