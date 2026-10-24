CREATE TABLE "ManualSwap" (
 "id" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "wallet" TEXT NOT NULL,
 "mint" TEXT NOT NULL,
 "side" "TradeSide" NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PREPARED',
 "transaction" TEXT NOT NULL,
 "quote" JSONB NOT NULL,
 "review" JSONB NOT NULL,
 "lastValidBlockHeight" INTEGER NOT NULL,
 "signature" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ManualSwap_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ManualSwap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManualSwap_signature_key" ON "ManualSwap"("signature");
CREATE INDEX "ManualSwap_userId_createdAt_idx" ON "ManualSwap"("userId", "createdAt");
CREATE INDEX "ManualSwap_status_updatedAt_idx" ON "ManualSwap"("status", "updatedAt");
