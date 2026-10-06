-- HAND-WRITTEN (no Prisma schema engine was available). Verify with:
--   npx prisma migrate diff --from-migrations packages/database/prisma/migrations --to-schema-datamodel packages/database/prisma/schema.prisma --shadow-database-url <url> --script
-- It must print nothing (or "-- This is an empty migration.").

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "blacklistReason" TEXT,
ADD COLUMN     "blacklistedAt" TIMESTAMP(3),
ADD COLUMN     "blacklistedBy" TEXT;

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "model" TEXT;
