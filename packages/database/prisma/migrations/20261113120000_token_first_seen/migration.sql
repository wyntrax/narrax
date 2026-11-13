-- First-seen timestamp for the 3-day no-market visibility rule.
ALTER TABLE "Token"
  ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing rows use their on-chain creation time when it is known; otherwise the
-- migration time starts the grace period so old never-priced rows are not hidden
-- immediately.
UPDATE "Token"
SET "firstSeenAt" = COALESCE("createdOnChainAt", "firstSeenAt");

CREATE INDEX "Token_firstSeenAt_idx" ON "Token"("firstSeenAt");
