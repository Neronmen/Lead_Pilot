-- M1: auth & tenancy.
-- AuditLog.area, Invite.updatedAt and RefreshToken.workspaceId are NOT NULL
-- without a default: AuditLog and Invite are empty until M1 writes to them,
-- and sessions are disposable, so existing refresh tokens are dropped first.
DELETE FROM "RefreshToken";
-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'vi');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'VND');

-- CreateEnum
CREATE TYPE "AuditArea" AS ENUM ('rules', 'sources', 'ideal_customer', 'integrations', 'team', 'general');

-- DropForeignKey
ALTER TABLE "ActionRun" DROP CONSTRAINT "ActionRun_integrationId_fkey";

-- DropForeignKey
ALTER TABLE "ActionRun" DROP CONSTRAINT "ActionRun_leadId_fkey";

-- DropForeignKey
ALTER TABLE "ActionRun" DROP CONSTRAINT "ActionRun_ruleId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_scoreId_fkey";

-- DropForeignKey
ALTER TABLE "IdempotencyKey" DROP CONSTRAINT "IdempotencyKey_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_sourceId_fkey";

-- DropForeignKey
ALTER TABLE "LeadEvent" DROP CONSTRAINT "LeadEvent_leadId_fkey";

-- DropForeignKey
ALTER TABLE "Score" DROP CONSTRAINT "Score_leadId_fkey";

-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_membershipId_fkey";

-- DropForeignKey
ALTER TABLE "TeamMember" DROP CONSTRAINT "TeamMember_teamId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "area" "AuditArea" NOT NULL;

-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "invitedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "lastActiveAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "workspaceId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" "Locale";

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "aiMonthlyLimitUsd" DECIMAL(10,2),
ADD COLUMN     "currency" "Currency" NOT NULL DEFAULT 'USD',
ADD COLUMN     "defaultLocale" "Locale" NOT NULL DEFAULT 'en',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateIndex
CREATE INDEX "ActionRun_workspaceId_ruleId_idx" ON "ActionRun"("workspaceId", "ruleId");

-- CreateIndex
CREATE INDEX "ActionRun_workspaceId_integrationId_idx" ON "ActionRun"("workspaceId", "integrationId");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_area_createdAt_idx" ON "AuditLog"("workspaceId", "area", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_workspaceId_leadId_idx" ON "Feedback"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "Feedback_workspaceId_scoreId_idx" ON "Feedback"("workspaceId", "scoreId");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_id_workspaceId_key" ON "Integration"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "Invite_invitedById_idx" ON "Invite"("invitedById");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_id_workspaceId_key" ON "Lead"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_id_workspaceId_key" ON "Membership"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "RefreshToken_workspaceId_userId_idx" ON "RefreshToken"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingRule_id_workspaceId_key" ON "RoutingRule"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Score_id_workspaceId_key" ON "Score"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Score_id_leadId_workspaceId_key" ON "Score"("id", "leadId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Source_id_workspaceId_key" ON "Source"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_workspaceId_key" ON "Team"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "TeamMember_membershipId_idx" ON "TeamMember"("membershipId");

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_workspaceId_fkey" FOREIGN KEY ("teamId", "workspaceId") REFERENCES "Team"("id", "workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_membershipId_workspaceId_fkey" FOREIGN KEY ("membershipId", "workspaceId") REFERENCES "Membership"("id", "workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_workspaceId_userId_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Membership"("workspaceId", "userId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_sourceId_workspaceId_fkey" FOREIGN KEY ("sourceId", "workspaceId") REFERENCES "Source"("id", "workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceId_workspaceId_fkey" FOREIGN KEY ("sourceId", "workspaceId") REFERENCES "Source"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_ownerId_fkey" FOREIGN KEY ("workspaceId", "ownerId") REFERENCES "Membership"("workspaceId", "userId") ON DELETE NO ACTION ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_workspaceId_fkey" FOREIGN KEY ("leadId", "workspaceId") REFERENCES "Lead"("id", "workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_leadId_workspaceId_fkey" FOREIGN KEY ("leadId", "workspaceId") REFERENCES "Lead"("id", "workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_leadId_workspaceId_fkey" FOREIGN KEY ("leadId", "workspaceId") REFERENCES "Lead"("id", "workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_scoreId_leadId_workspaceId_fkey" FOREIGN KEY ("scoreId", "leadId", "workspaceId") REFERENCES "Score"("id", "leadId", "workspaceId") ON DELETE NO ACTION ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ActionRun" ADD CONSTRAINT "ActionRun_leadId_workspaceId_fkey" FOREIGN KEY ("leadId", "workspaceId") REFERENCES "Lead"("id", "workspaceId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ActionRun" ADD CONSTRAINT "ActionRun_ruleId_workspaceId_fkey" FOREIGN KEY ("ruleId", "workspaceId") REFERENCES "RoutingRule"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ActionRun" ADD CONSTRAINT "ActionRun_integrationId_workspaceId_fkey" FOREIGN KEY ("integrationId", "workspaceId") REFERENCES "Integration"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE RESTRICT;

-- Hand-written (Prisma cannot express CHECK constraints or partial indexes).

-- Emails are stored lowercased, so lookups and the unique constraints treat
-- Jane@Acme.com and jane@acme.com as the same address.
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_email_lowercase_check" CHECK ("email" = lower("email"));

ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_aiMonthlyLimitUsd_check" CHECK ("aiMonthlyLimitUsd" >= 0);

-- Exactly one owner per workspace: a second OWNER membership is rejected even
-- if two requests race past the service check.
CREATE UNIQUE INDEX "Membership_one_owner_per_workspace" ON "Membership"("workspaceId") WHERE "role" = 'OWNER';

-- One pending invite per address and workspace. Resending rotates the token on
-- the same row, so an old link stops working.
CREATE UNIQUE INDEX "Invite_one_pending_per_email" ON "Invite"("workspaceId", "email") WHERE "acceptedAt" IS NULL;
