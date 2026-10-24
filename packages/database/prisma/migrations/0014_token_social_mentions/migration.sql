-- CreateTable
CREATE TABLE "TokenMention" (
    "id" TEXT NOT NULL,
    "refKind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "creatorId" TEXT,
    "textHash" TEXT NOT NULL,
    "simhash" TEXT NOT NULL,
    "creatorAgeDays" INTEGER,
    "engagement" INTEGER NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenMention_ref_at_idx" ON "TokenMention"("ref", "at");

-- CreateIndex
CREATE INDEX "TokenMention_at_idx" ON "TokenMention"("at");

-- CreateIndex
CREATE UNIQUE INDEX "TokenMention_refKind_ref_platform_externalId_key" ON "TokenMention"("refKind", "ref", "platform", "externalId");
