-- Measured wallet-research horizons that used a price from a pool below the
-- $20,000 flow liquidity gate are not executable returns. Keep the rows for
-- audit, but mark them UNKNOWN with a reason and clear the price/return fields.
UPDATE "WalletResearchMeasurement" AS m
SET "status" = 'UNKNOWN',
    "reason" = 'THIN_LIQUIDITY',
    "priceUsd" = NULL,
    "priceAt" = NULL,
    "metricId" = NULL,
    "returnPct" = NULL
FROM "TokenMetric" AS tm
WHERE m."metricId" = tm."id"
  AND m."status" = 'MEASURED'
  AND tm."liquidityUsd" < 20000;
