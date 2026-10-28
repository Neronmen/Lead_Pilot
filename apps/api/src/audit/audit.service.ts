import { Injectable } from '@nestjs/common';
import type { $Enums, Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

type AuditArea = $Enums.AuditArea;

/** Flat, readable values only: never secrets, tokens or hashes. */
type AuditValue = Record<string, string | number | boolean | null>;

/**
 * Action names, `entity.verb`. The Change history page (M4) filters on them,
 * so they are constants, not free text at each call site. Add new ones here.
 */
export const AuditAction = {
  InviteCreated: 'invite.created',
  InviteReissued: 'invite.reissued',
  InviteResent: 'invite.resent',
  InviteCancelled: 'invite.cancelled',
  MemberJoined: 'member.joined',
  MemberRoleChanged: 'member.role_changed',
  MemberRemoved: 'member.removed',
  SourceCreated: 'source.created',
  SourceUpdated: 'source.updated',
  SourceDeleted: 'source.deleted',
  SourceKeyRotated: 'source.key_rotated',
  SourceHmacEnabled: 'source.hmac_enabled',
  SourceHmacDisabled: 'source.hmac_disabled',
  IdealCustomerUpdated: 'ideal_customer.updated',
  RuleCreated: 'rule.created',
  RuleUpdated: 'rule.updated',
  RuleDeleted: 'rule.deleted',
  RulesReordered: 'rule.reordered',
  IntegrationConnected: 'integration.connected',
  IntegrationUpdated: 'integration.updated',
  IntegrationDeleted: 'integration.deleted',
} as const;

export interface AuditEntry {
  /** Null when the system did it. */
  actorUserId: string | null;
  area: AuditArea;
  /** One of `AuditAction`; a plain string so other areas can add theirs. */
  action: string;
  entityType: string;
  entityId?: string;
  before?: AuditValue;
  after?: AuditValue;
}

/**
 * What `record` needs from a client: the scoped client, a transaction opened
 * from it, or (for the accept flow, before a workspace scope exists) a raw
 * transaction. It describes only `auditLog.create`, so it does not claim a
 * scope: the caller passes the workspace id, and a scoped client rejects one
 * that is not its own.
 */
export interface AuditDb {
  auditLog: {
    create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown>;
  };
}

/**
 * The change history (SPEC §4.8): who changed what in a workspace, with the
 * before and after values. It feeds Settings > Change history (M4).
 *
 * Write inside the same transaction as the change when there is one
 * (`record(tx, ...)`), so a change and its history entry stand or fall
 * together. Entries are never edited or deleted by the app.
 */
@Injectable()
export class AuditService {
  constructor(private readonly tenant: TenantPrisma) {}

  /**
   * Records an entry on the given scoped client or transaction. `workspaceId`
   * is passed for clients that are not scoped (a raw transaction); a scoped
   * client checks it equals its own workspace and throws if not.
   */
  async record(db: AuditDb, workspaceId: string, entry: AuditEntry): Promise<void> {
    await db.auditLog.create({
      data: {
        workspaceId,
        actorUserId: entry.actorUserId,
        area: entry.area,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before as Prisma.InputJsonObject | undefined,
        after: entry.after as Prisma.InputJsonObject | undefined,
      },
    });
  }
}
