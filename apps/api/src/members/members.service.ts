import { HttpStatus, Injectable } from '@nestjs/common';
import { type AssignableRole, ErrorCode, type Member } from '@leadpilot/shared';
import { AuditAction, AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors/domain-error';
import { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

/** Who is doing it. */
export interface Actor {
  userId: string;
  workspaceId: string;
}

const memberNotFound = () =>
  new DomainError(ErrorCode.NOT_FOUND, 'Member not found', HttpStatus.NOT_FOUND);

const ownerImmutable = () =>
  new DomainError(
    ErrorCode.OWNER_IMMUTABLE,
    'The owner cannot be changed or removed',
    HttpStatus.FORBIDDEN,
  );

const cannotModifySelf = () =>
  new DomainError(
    ErrorCode.CANNOT_MODIFY_SELF,
    'You cannot change your own role or remove yourself',
    HttpStatus.FORBIDDEN,
  );

/** A lead is open until sales marks it won or lost. */
const OPEN_OUTCOMES = ['NONE', 'CONTACTED', 'QUALIFIED'] as const;

/**
 * The people of one workspace (Settings > Team). Admins manage Members and
 * other Admins; nobody touches the Owner, and nobody changes or removes
 * themselves (ownership transfer is in docs/backlog.md). Every query goes
 * through `TenantPrisma.for(workspaceId)`: another workspace's membership id
 * is a 404.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(workspaceId: string): Promise<Member[]> {
    const db = this.tenant.for(workspaceId);
    const rows = await db.membership.findMany({
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    const counts = await db.lead.groupBy({
      by: ['ownerId'],
      where: {
        ownerId: { in: rows.map((row) => row.userId) },
        outcome: { in: [...OPEN_OUTCOMES] },
      },
      _count: { _all: true },
    });
    const openLeads = new Map(counts.map((row) => [row.ownerId, row._count._all]));
    return rows.map((row) => toMember(row, openLeads.get(row.userId) ?? 0));
  }

  async changeRole(actor: Actor, membershipId: string, role: AssignableRole): Promise<Member> {
    const db = this.tenant.for(actor.workspaceId);
    await this.findTarget(actor, membershipId); // the shared rules, before any write

    return db.$transaction(async (tx) => {
      // Read, change and record in one transaction, so the history shows the
      // role the person had when it was changed.
      const current = await tx.membership.findUnique({
        where: { id: membershipId },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      if (!current) throw memberNotFound(); // removed by a parallel request
      if (current.role === 'OWNER') throw ownerImmutable();

      const open = await tx.lead.count({
        where: { ownerId: current.userId, outcome: { in: [...OPEN_OUTCOMES] } },
      });
      if (current.role !== role) {
        // Conditional on that role: if a parallel request changed it after the
        // read, this writes nothing and no history row.
        const { count } = await tx.membership.updateMany({
          where: { id: membershipId, role: current.role },
          data: { role },
        });
        if (count !== 1) {
          const now = await tx.membership.findUnique({
            where: { id: membershipId },
            select: { role: true },
          });
          // Removed in the meantime: gone, not a conflict.
          if (!now) throw memberNotFound();
          // A parallel request already set the role we wanted: the end state is
          // what was asked for, so this is a success, and it wrote no history
          // row (the winner's row says it). With two assignable roles this is
          // the only way to lose the race; the 409 below guards a future third.
          if (now.role === role) return toMember({ ...current, role }, open);
          throw new DomainError(
            ErrorCode.CONFLICT,
            'The role changed while you were changing it; reload and try again',
            HttpStatus.CONFLICT,
          );
        }
        await this.audit.record(tx, actor.workspaceId, {
          actorUserId: actor.userId,
          area: 'team',
          action: AuditAction.MemberRoleChanged,
          entityType: 'membership',
          entityId: membershipId,
          before: { email: current.user.email, role: current.role },
          after: { email: current.user.email, role },
        });
      }
      return toMember({ ...current, role }, open);
    });
  }

  /**
   * Removes the person from this workspace. All their leads become unassigned,
   * closed ones too (the owner reference has no ON DELETE action, so it must be
   * cleared); the routing engine reassigns the open ones in M4 (docs/backlog.md).
   * Their sessions here and their team seats go with the membership. The
   * account itself stays: it may belong to other workspaces.
   */
  async remove(actor: Actor, membershipId: string): Promise<void> {
    const db = this.tenant.for(actor.workspaceId);
    const target = await this.findTarget(actor, membershipId);

    await db.$transaction(async (tx) => {
      // The owner reference has no ON DELETE action (see the schema header):
      // clear it first, with the scalar.
      const { count } = await tx.lead.updateMany({
        where: { ownerId: target.userId },
        data: { ownerId: null },
      });
      // `delete` returns the row as it was when it was deleted, so the history
      // records the role the person really had even if an admin changed it a
      // moment before. If a parallel request removed them first, this is a 404.
      const gone = await tx.membership
        .delete({ where: { id: membershipId } })
        .catch((error: unknown) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            throw memberNotFound();
          }
          throw error;
        });
      await this.audit.record(tx, actor.workspaceId, {
        actorUserId: actor.userId,
        area: 'team',
        action: AuditAction.MemberRemoved,
        entityType: 'membership',
        entityId: membershipId,
        before: { email: target.user.email, role: gone.role },
        after: { unassignedLeads: count },
      });
    });
  }

  /** The membership to act on, after the rules every change shares. */
  private async findTarget(actor: Actor, membershipId: string) {
    const target = await this.tenant.for(actor.workspaceId).membership.findUnique({
      where: { id: membershipId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!target) throw memberNotFound();
    if (target.userId === actor.userId) throw cannotModifySelf();
    if (target.role === 'OWNER') throw ownerImmutable();
    return target;
  }
}

function toMember(
  row: {
    id: string;
    userId: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    lastActiveAt: Date | null;
    createdAt: Date;
    user: { name: string | null; email: string };
  },
  openLeads: number,
): Member {
  return {
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    email: row.user.email,
    role: row.role,
    openLeads,
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    joinedAt: row.createdAt.toISOString(),
  };
}
