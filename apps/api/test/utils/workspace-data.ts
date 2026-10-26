import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';

/** The workspace a user (by email) belongs to; fine for users with one workspace. */
export async function workspaceOf(prisma: PrismaClient, email: string): Promise<string> {
  const row = await prisma.membership.findFirstOrThrow({
    where: { user: { email } },
    orderBy: { createdAt: 'asc' },
    select: { workspaceId: true },
  });
  return row.workspaceId;
}

/** The membership of a user (by email) in a workspace. */
export function membershipOf(prisma: PrismaClient, email: string, workspaceId: string) {
  return prisma.membership.findFirstOrThrow({ where: { workspaceId, user: { email } } });
}

/** A lead in a workspace (with a source of its own), optionally owned and with an outcome. */
export async function makeLead(
  prisma: PrismaClient,
  workspaceId: string,
  options: { ownerId?: string; outcome?: 'NONE' | 'CONTACTED' | 'QUALIFIED' | 'WON' | 'LOST' } = {},
) {
  const suffix = randomBytes(6).toString('hex');
  const source = await prisma.source.create({
    data: {
      workspaceId,
      name: `Source ${suffix}`,
      type: 'FORM',
      apiKeyPrefix: `lp_e2e_${suffix}`,
      apiKeyHash: 'sha256-placeholder',
    },
  });
  return prisma.lead.create({
    data: {
      workspaceId,
      sourceId: source.id,
      email: `lead-${suffix}@example.com`,
      rawPayload: {},
      ownerId: options.ownerId,
      outcome: options.outcome ?? 'NONE',
    },
  });
}

/** The change history of a workspace, oldest first. */
export function auditRows(prisma: PrismaClient, workspaceId: string) {
  return prisma.auditLog.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
}
