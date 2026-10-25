-- CreateTable
CREATE TABLE "ResearchMonitor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thesis" TEXT NOT NULL,
    "mint" TEXT,
    "narrativeSlug" TEXT,
    "rules" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastRun" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchObservation" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "evaluation" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "bucket" TEXT NOT NULL,
    "alerted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ResearchObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalBrief" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchMonitor_userId_kind_createdAt_idx" ON "ResearchMonitor"("userId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchMonitor_active_lastEvaluatedAt_idx" ON "ResearchMonitor"("active", "lastEvaluatedAt");

-- CreateIndex
CREATE INDEX "ResearchObservation_monitorId_at_idx" ON "ResearchObservation"("monitorId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchObservation_monitorId_mint_revision_bucket_key" ON "ResearchObservation"("monitorId", "mint", "revision", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalBrief_userId_day_key" ON "PersonalBrief"("userId", "day");

-- AddForeignKey
ALTER TABLE "ResearchMonitor" ADD CONSTRAINT "ResearchMonitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchObservation" ADD CONSTRAINT "ResearchObservation_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "ResearchMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalBrief" ADD CONSTRAINT "PersonalBrief_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Owner-approved policy reset: existing research is Early Access. Preserve the prior
-- configuration for operator review; unknown/malformed keys still fail closed.
INSERT INTO "SystemSetting" ("key", "value", "updatedAt")
SELECT 'pro_research.previous_feature_overrides', "value", CURRENT_TIMESTAMP
FROM "SystemSetting" WHERE "key" = 'entitlements.features'
ON CONFLICT ("key") DO NOTHING;

UPDATE "SystemSetting" SET "value" = "value" - ARRAY[
  'research.narratives', 'research.tokens', 'research.overview', 'research.screener',
  'research.rotation', 'research.opportunities', 'research.smart_money', 'research.analysis',
  'research.wallet_detail', 'research.decision_analytics', 'research.advanced_analytics', 'research.chat'
]::text[], "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'entitlements.features' AND jsonb_typeof("value") = 'object';

INSERT INTO "AuditLog" ("id", "action", "detail") VALUES
('migration-pro-research-policy-20261025', 'entitlements.pro_research_policy',
 '{"reason":"Owner-approved personal PRO workspace; existing research becomes Early Access","backupKey":"pro_research.previous_feature_overrides"}'::jsonb);
