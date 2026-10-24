-- DropIndex
DROP INDEX "Lead_workspaceId_ownerId_idx";

-- DropIndex
DROP INDEX "Lead_workspaceId_sourceId_idx";

-- DropIndex
DROP INDEX "Lead_workspaceId_status_idx";

-- DropIndex
DROP INDEX "Lead_workspaceId_tier_idx";

-- CreateIndex
CREATE INDEX "Lead_workspaceId_status_createdAt_idx" ON "Lead"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_tier_createdAt_idx" ON "Lead"("workspaceId", "tier", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_ownerId_createdAt_idx" ON "Lead"("workspaceId", "ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_sourceId_createdAt_idx" ON "Lead"("workspaceId", "sourceId", "createdAt");

-- Hand-written (Prisma cannot express CHECK constraints in the schema).
-- Lead emails are stored lowercased, so the (workspaceId, email) dedup guard
-- treats Jane@Acme.com and jane@acme.com as the same person.
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_email_lowercase_check" CHECK ("email" = lower("email"));
