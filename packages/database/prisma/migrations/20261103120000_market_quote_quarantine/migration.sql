-- Add per-token dead-pool backoff for the market quote lanes.
ALTER TABLE "Token"
  ADD COLUMN "marketQuoteFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "marketQuarantineUntil" TIMESTAMP(3);

CREATE INDEX "Token_marketQuarantineUntil_idx" ON "Token"("marketQuarantineUntil");
