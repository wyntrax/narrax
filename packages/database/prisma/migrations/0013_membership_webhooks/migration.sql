-- No production entitlement data exists. Keep prior migrations immutable.
DROP TABLE "WyntraxMembershipWallet";
DROP TABLE "WyntraxMembership";
DROP TABLE "WebhookEvent";
CREATE TABLE "WyntraxEntitlement" (
  "membershipId" TEXT NOT NULL, "chain" "EntitlementChain" NOT NULL, "address" TEXT NOT NULL,
  "key" "WyntraxTier" NOT NULL, "seq" BIGINT NOT NULL, "validUntil" TIMESTAMP(3),
  "status" "AccessGrantStatus" NOT NULL, "lastEventId" TEXT NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL,
  "proSince" TIMESTAMP(3), "eliteSince" TIMESTAMP(3),
  CONSTRAINT "WyntraxEntitlement_pkey" PRIMARY KEY ("membershipId", "chain", "address")
);
CREATE INDEX "WyntraxEntitlement_chain_address_idx" ON "WyntraxEntitlement"("chain", "address");
CREATE INDEX "WyntraxEntitlement_validUntil_idx" ON "WyntraxEntitlement"("validUntil");
CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "membershipId" TEXT NOT NULL, "chain" "EntitlementChain" NOT NULL,
  "address" TEXT NOT NULL, "seq" BIGINT NOT NULL, "bodyHash" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL, "outcome" TEXT NOT NULL
);
CREATE INDEX "WebhookEvent_membershipId_chain_address_seq_idx" ON "WebhookEvent"("membershipId", "chain", "address", "seq");
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");
DELETE FROM "SystemSetting" WHERE "key" IN ('entitlements.reconcile_state', 'entitlements.wyntrax_reconcile_state');
