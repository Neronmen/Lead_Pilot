import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AssignableRole,
  type CreateInvitesResponse,
  ErrorCode,
  type InviteResultStatus,
  type Locale,
  type PendingInvite,
  type ResendInviteResponse,
} from '@leadpilot/shared';
import { DomainError } from '../common/errors/domain-error';
import type { Env } from '../config/env.schema';
import { buildInviteEmail } from '../email/invite-email';
import { EMAIL_PROVIDER, type EmailProvider } from '../email/email.provider';
import { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { INVITE_TTL_DAYS, inviteLink, newInviteToken } from './invite-token';

/** Who sends the invites. */
export interface Inviter {
  userId: string;
  workspaceId: string;
}

/** What every email of one batch shares, loaded once. */
interface SenderContext {
  workspaceName: string;
  workspaceLocale: Locale;
  inviterName: string;
  /**
   * Set once a whole chunk of sends failed: the mail server is down, so the
   * rest of the batch is saved without waiting for the same timeout again.
   */
  mailDown: boolean;
}

/** Addresses handled at the same time: gentle on the mail server. */
const SEND_CONCURRENCY = 4;

const inviteNotFound = () =>
  new DomainError(ErrorCode.NOT_FOUND, 'Invite not found', HttpStatus.NOT_FOUND);

/**
 * Invites for one workspace (Settings > Team). Every query goes through
 * `TenantPrisma.for(workspaceId)`, so an admin can only see and change the
 * invites of their own workspace: another workspace's invite id is a 404.
 *
 * Emails are sent inside the request for now (the SMTP provider enforces a
 * total deadline per message): there is no job queue before M3, where this
 * moves to a BullMQ job. A failed send does not lose the invite; it is
 * reported as `email_failed` and the admin retries with Resend.
 */
@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    private readonly tenant: TenantPrisma,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Invites several people at once; the result has one entry per distinct address. */
  async create(
    inviter: Inviter,
    emails: string[],
    role: AssignableRole,
  ): Promise<CreateInvitesResponse> {
    // The same address typed twice is one invite (addresses are already lowercased).
    const distinct = [...new Set(emails)];
    const context = await this.senderContext(inviter);
    const results: CreateInvitesResponse['results'] = [];
    for (let i = 0; i < distinct.length; i += SEND_CONCURRENCY) {
      const chunk = distinct.slice(i, i + SEND_CONCURRENCY);
      const done = await Promise.all(
        chunk.map(async (address) => ({
          email: address,
          status: await this.inviteOne(inviter, context, address, role),
        })),
      );
      results.push(...done);
      const sends = done.filter((r) => r.status === 'invited' || r.status === 'email_failed');
      if (sends.length > 0 && sends.every((r) => r.status === 'email_failed')) {
        context.mailDown = true;
      }
    }
    return { results };
  }

  async list(workspaceId: string): Promise<PendingInvite[]> {
    const rows = await this.tenant.for(workspaceId).invite.findMany({
      where: { acceptedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { invitedBy: { select: { id: true, name: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      // An invite can only be created for ADMIN or MEMBER (never OWNER).
      role: row.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
      invitedBy: row.invitedBy,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * New token and new expiry on the same row: the old link stops working at
   * once, even if the email then fails (the admin resends again).
   */
  async resend(inviter: Inviter, inviteId: string): Promise<ResendInviteResponse> {
    const db = this.tenant.for(inviter.workspaceId);
    const fresh = newInviteToken();
    const invite = await db.invite
      .update({
        where: { id: inviteId, acceptedAt: null },
        data: {
          tokenHash: fresh.tokenHash,
          expiresAt: fresh.expiresAt,
          failedAttempts: 0,
          invitedById: inviter.userId,
        },
      })
      .catch((error: unknown) => {
        // P2025: no such invite in this workspace, or it was already accepted.
        if (isRecordNotFound(error)) throw inviteNotFound();
        throw error;
      });
    const context = await this.senderContext(inviter);
    const status = await this.sendInvite(
      context,
      inviter.workspaceId,
      invite.email,
      invite.role,
      fresh.token,
    );
    return { status };
  }

  async cancel(workspaceId: string, inviteId: string): Promise<void> {
    await this.tenant
      .for(workspaceId)
      .invite.delete({ where: { id: inviteId, acceptedAt: null } })
      .catch((error: unknown) => {
        if (isRecordNotFound(error)) throw inviteNotFound();
        throw error;
      });
  }

  private async inviteOne(
    inviter: Inviter,
    context: SenderContext,
    address: string,
    role: AssignableRole,
  ): Promise<InviteResultStatus> {
    const db = this.tenant.for(inviter.workspaceId);

    const member = await db.membership.findFirst({
      where: { user: { email: address } },
      select: { id: true },
    });
    if (member) return 'already_member';

    const fresh = newInviteToken();
    const pending = await db.invite.findFirst({
      where: { email: address, acceptedAt: null },
      select: { id: true, expiresAt: true },
    });
    if (pending) {
      // A live invite is left alone (Resend replaces its link). An expired one
      // still holds the "one pending invite per address" slot, so it is reissued.
      if (pending.expiresAt > new Date()) return 'already_invited';
      // Conditional, so of two admins reissuing at once only one wins (and
      // sends an email); the other finds a live invite and reports that.
      const { count } = await db.invite.updateMany({
        where: { id: pending.id, acceptedAt: null, expiresAt: { lte: new Date() } },
        data: {
          role,
          tokenHash: fresh.tokenHash,
          expiresAt: fresh.expiresAt,
          failedAttempts: 0,
          invitedById: inviter.userId,
        },
      });
      if (count !== 1) return 'already_invited';
    } else {
      try {
        await db.invite.create({
          data: {
            workspaceId: inviter.workspaceId,
            email: address,
            role,
            tokenHash: fresh.tokenHash,
            expiresAt: fresh.expiresAt,
            invitedById: inviter.userId,
          },
        });
      } catch (error) {
        // A parallel request invited the same address first.
        if (isUniqueViolation(error)) return 'already_invited';
        throw error;
      }
    }
    return this.sendInvite(context, inviter.workspaceId, address, role, fresh.token);
  }

  private async senderContext(inviter: Inviter): Promise<SenderContext> {
    const db = this.tenant.for(inviter.workspaceId);
    const [workspace, sender] = await Promise.all([
      db.workspace.findFirstOrThrow({ select: { name: true, defaultLocale: true } }),
      db.membership.findFirst({
        where: { userId: inviter.userId },
        select: { user: { select: { name: true, email: true } } },
      }),
    ]);
    return {
      workspaceName: workspace.name,
      workspaceLocale: workspace.defaultLocale,
      inviterName: sender?.user.name ?? sender?.user.email ?? workspace.name,
      mailDown: false,
    };
  }

  private async sendInvite(
    context: SenderContext,
    workspaceId: string,
    address: string,
    role: AssignableRole | 'OWNER',
    token: string,
  ): Promise<InviteResultStatus> {
    if (context.mailDown) return 'email_failed';
    const message = buildInviteEmail({
      to: address,
      locale: context.workspaceLocale,
      inviterName: context.inviterName,
      workspaceName: context.workspaceName,
      role: role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
      link: inviteLink(this.config.get('WEB_ORIGIN', { infer: true }), token),
      expiresInDays: INVITE_TTL_DAYS,
    });
    try {
      await this.email.send(message);
      return 'invited';
    } catch (error) {
      // Only the error's name and code: SMTP errors can carry the recipient
      // address and the server's reply, and the message holds the sign-in link.
      this.logger.warn(
        { workspaceId, errorName: errorName(error), errorCode: errorCodeOf(error) },
        'Invite email failed',
      );
      return 'email_failed';
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function errorCodeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
