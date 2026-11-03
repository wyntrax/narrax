-- A manual quote keeps a token in the bounded focus price lane for two hours.
ALTER TABLE "Token"
  ADD COLUMN "marketPriorityUntil" TIMESTAMP(3);

CREATE INDEX "Token_marketPriorityUntil_idx" ON "Token"("marketPriorityUntil");
