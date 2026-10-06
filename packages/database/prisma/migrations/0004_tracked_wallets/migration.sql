
-- AlterTable
ALTER TABLE "TrackedWallet" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "WalletFunding" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "funder" TEXT,
    "lamports" BIGINT,
    "signature" TEXT,
    "fundedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletFunding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletCandidate" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "winnerTokens" INTEGER NOT NULL,
    "evidence" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "WalletCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenEarlyBuyers" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "complete" BOOLEAN NOT NULL,
    "buyers" JSONB NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenEarlyBuyers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletFunding_walletId_key" ON "WalletFunding"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletCandidate_address_key" ON "WalletCandidate"("address");

-- CreateIndex
CREATE INDEX "WalletCandidate_status_score_idx" ON "WalletCandidate"("status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "TokenEarlyBuyers_tokenId_key" ON "TokenEarlyBuyers"("tokenId");

-- AddForeignKey
ALTER TABLE "WalletFunding" ADD CONSTRAINT "WalletFunding_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "TrackedWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenEarlyBuyers" ADD CONSTRAINT "TokenEarlyBuyers_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
