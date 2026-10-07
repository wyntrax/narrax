-- Hand-written; verified with prisma migrate diff against the full migration chain.
-- LocalAccessTier deliberately cannot store a paid Wyntrax tier.
CREATE TYPE "EntitlementChain" AS ENUM ('solana');
CREATE TYPE "WyntraxTier" AS ENUM ('NONE', 'MEMBER', 'PRO', 'ELITE');
CREATE TYPE "LocalAccessTier" AS ENUM ('EARLY_ACCESS');
CREATE TYPE "AccessGrantSource" AS ENUM ('EARLY_ACCESS', 'ADMIN');
CREATE TYPE "AccessGrantStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

CREATE TABLE "LinkedWallet" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "chain" "EntitlementChain" NOT NULL,
  "address" TEXT NOT NULL, "verifiedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LinkedWallet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LinkedWallet_chain_address_key" ON "LinkedWallet"("chain", "address");
CREATE INDEX "LinkedWallet_userId_idx" ON "LinkedWallet"("userId");
ALTER TABLE "LinkedWallet" ADD CONSTRAINT "LinkedWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WalletLinkChallenge" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "chain" "EntitlementChain" NOT NULL,
  "address" TEXT NOT NULL, "domain" TEXT NOT NULL, "nonceHash" TEXT NOT NULL,
  "messageHash" TEXT NOT NULL, "issuedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "consumedAt" TIMESTAMP(3),
  CONSTRAINT "WalletLinkChallenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WalletLinkChallenge_nonceHash_key" ON "WalletLinkChallenge"("nonceHash");
CREATE INDEX "WalletLinkChallenge_userId_expiresAt_idx" ON "WalletLinkChallenge"("userId", "expiresAt");
CREATE INDEX "WalletLinkChallenge_expiresAt_idx" ON "WalletLinkChallenge"("expiresAt");
ALTER TABLE "WalletLinkChallenge" ADD CONSTRAINT "WalletLinkChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WyntraxMembership" (
  "wyntraxUserId" TEXT NOT NULL, "tier" "WyntraxTier" NOT NULL, "version" BIGINT NOT NULL,
  "validUntil" TIMESTAMP(3), "balanceSnapshotAt" TIMESTAMP(3), "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL, "lastEventId" TEXT, "lastTransport" TEXT NOT NULL,
  CONSTRAINT "WyntraxMembership_pkey" PRIMARY KEY ("wyntraxUserId")
);
CREATE INDEX "WyntraxMembership_validUntil_idx" ON "WyntraxMembership"("validUntil");
CREATE INDEX "WyntraxMembership_sourceUpdatedAt_idx" ON "WyntraxMembership"("sourceUpdatedAt");
CREATE TABLE "WyntraxMembershipWallet" (
  "id" TEXT NOT NULL, "wyntraxUserId" TEXT NOT NULL, "chain" "EntitlementChain" NOT NULL, "address" TEXT NOT NULL,
  CONSTRAINT "WyntraxMembershipWallet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WyntraxMembershipWallet_wyntraxUserId_chain_address_key" ON "WyntraxMembershipWallet"("wyntraxUserId", "chain", "address");
CREATE INDEX "WyntraxMembershipWallet_chain_address_idx" ON "WyntraxMembershipWallet"("chain", "address");
ALTER TABLE "WyntraxMembershipWallet" ADD CONSTRAINT "WyntraxMembershipWallet_wyntraxUserId_fkey" FOREIGN KEY ("wyntraxUserId") REFERENCES "WyntraxMembership"("wyntraxUserId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AccessGrant" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "source" "AccessGrantSource" NOT NULL,
  "tier" "LocalAccessTier" NOT NULL DEFAULT 'EARLY_ACCESS', "status" "AccessGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "validUntil" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "createdBy" TEXT, "reason" TEXT,
  CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccessGrant_userId_source_key" ON "AccessGrant"("userId", "source");
CREATE INDEX "AccessGrant_source_status_validUntil_idx" ON "AccessGrant"("source", "status", "validUntil");
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL, "wyntraxUserId" TEXT NOT NULL, "version" BIGINT NOT NULL, "bodyHash" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL, "outcome" TEXT NOT NULL,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebhookEvent_wyntraxUserId_version_idx" ON "WebhookEvent"("wyntraxUserId", "version");
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");
