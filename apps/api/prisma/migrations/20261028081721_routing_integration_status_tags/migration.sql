-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('connected', 'needs_attention', 'paused');

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastTestedAt" TIMESTAMP(3),
ADD COLUMN     "status" "IntegrationStatus" NOT NULL DEFAULT 'connected';

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
