-- AlterEnum
ALTER TYPE "LeadOutcome" ADD VALUE 'BAD';

-- AlterTable
ALTER TABLE "IngestAttempt" ADD COLUMN     "fields" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "budget" TEXT,
ADD COLUMN     "infoLevel" TEXT,
ADD COLUMN     "interest" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "outcomeSetAt" TIMESTAMP(3),
ADD COLUMN     "outcomeSetBy" UUID,
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "timeline" TEXT;

-- AlterTable
ALTER TABLE "Score" ADD COLUMN     "infoLevel" TEXT NOT NULL DEFAULT 'enough';
