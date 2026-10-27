-- CreateEnum
CREATE TYPE "IngestOutcome" AS ENUM ('CREATED', 'MERGED', 'REJECTED', 'REPLAYED');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "possibleDuplicateOfId" UUID;

-- CreateTable
CREATE TABLE "IngestAttempt" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "outcome" "IngestOutcome" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IngestAttempt_workspaceId_sourceId_createdAt_idx" ON "IngestAttempt"("workspaceId", "sourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "IngestAttempt" ADD CONSTRAINT "IngestAttempt_sourceId_workspaceId_fkey" FOREIGN KEY ("sourceId", "workspaceId") REFERENCES "Source"("id", "workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_possibleDuplicateOfId_workspaceId_fkey" FOREIGN KEY ("possibleDuplicateOfId", "workspaceId") REFERENCES "Lead"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE RESTRICT;
