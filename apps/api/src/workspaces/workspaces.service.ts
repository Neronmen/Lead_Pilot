import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type MeResponse, type UpdateWorkspaceRequest } from '@leadpilot/shared';
import { AuditAction, AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors/domain-error';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

export interface Actor {
  userId: string;
  workspaceId: string;
}

/**
 * Settings > General (name, language, currency, time zone) and deleting a workspace.
 * Deleting uses the raw client (ESLint allowlist): the workspace row is the one thing the scoped client
 * is not allowed to remove, and removing it takes every row of the workspace with it (cascade).
 */
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  async update(actor: Actor, input: UpdateWorkspaceRequest): Promise<MeResponse['workspace']> {
    const db = this.tenant.for(actor.workspaceId);
    const row = await db.$transaction(async (tx) => {
      const before = await tx.workspace.findUniqueOrThrow({ where: { id: actor.workspaceId } });
      const after = await tx.workspace.update({
        where: { id: actor.workspaceId },
        data: input,
      });
      const pick = (w: typeof before) => ({
        name: w.name,
        language: w.defaultLocale,
        currency: w.currency,
        timezone: w.timezone,
        country: w.defaultCountry,
      });
      await this.audit.record(tx, actor.workspaceId, {
        actorUserId: actor.userId,
        area: 'general',
        action: AuditAction.WorkspaceUpdated,
        entityType: 'workspace',
        entityId: actor.workspaceId,
        before: pick(before),
        after: pick(after),
      });
      return after;
    });
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      defaultLocale: row.defaultLocale,
      currency: row.currency,
      timezone: row.timezone,
      defaultCountry: row.defaultCountry,
    };
  }

  /** The Owner types the workspace's name; then everything of the workspace is deleted for good. */
  async remove(actor: Actor, confirm: string): Promise<void> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: actor.workspaceId },
      select: { name: true },
    });
    if (confirm.trim() !== workspace.name) {
      throw new DomainError(
        ErrorCode.CONFIRMATION_MISMATCH,
        'The name typed does not match this workspace',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.prisma.workspace.delete({ where: { id: actor.workspaceId } });
  }
}
