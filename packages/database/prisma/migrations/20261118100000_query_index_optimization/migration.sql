-- Eliminate hot sequential scans across NarrativeTokenRelation, Token, TokenMetric, Alert, and SystemSetting.
CREATE INDEX "NarrativeTokenRelation_tokenId_idx" ON "NarrativeTokenRelation"("tokenId");

CREATE INDEX "Token_deployer_createdOnChainAt_idx" ON "Token"("deployer", "createdOnChainAt");

CREATE INDEX "TokenMetric_at_tokenId_idx" ON "TokenMetric"("at", "tokenId");

CREATE INDEX "Alert_kind_refId_idx" ON "Alert"("kind", "refId");

CREATE INDEX "SystemSetting_updatedAt_idx" ON "SystemSetting"("updatedAt");
