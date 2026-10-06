
-- AlterTable
ALTER TABLE "NarrativeMention" ADD COLUMN     "creatorAgeDays" INTEGER,
ADD COLUMN     "externalId" TEXT NOT NULL,
ADD COLUMN     "simhash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "NarrativeSource_narrativeId_provider_key" ON "NarrativeSource"("narrativeId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "NarrativeMention_narrativeId_platform_externalId_key" ON "NarrativeMention"("narrativeId", "platform", "externalId");

