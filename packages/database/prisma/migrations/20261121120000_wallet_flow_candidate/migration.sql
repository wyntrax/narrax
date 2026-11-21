-- CreateTable
CREATE TABLE "WalletFlowCandidate" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "netFlowSol" DECIMAL(65,30) NOT NULL,
    "supportingEntities" INTEGER NOT NULL,
    "walletCount" INTEGER NOT NULL,
    "signatures" TEXT[],
    "firstFlowAt" TIMESTAMP(3) NOT NULL,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastReason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletFlowCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletFlowCandidate_tokenId_key" ON "WalletFlowCandidate"("tokenId");

-- CreateIndex
CREATE INDEX "WalletFlowCandidate_expiresAt_idx" ON "WalletFlowCandidate"("expiresAt");

-- AddForeignKey
ALTER TABLE "WalletFlowCandidate" ADD CONSTRAINT "WalletFlowCandidate_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
