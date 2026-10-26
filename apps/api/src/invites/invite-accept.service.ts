import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AcceptInviteRequest,
  type AssignableRole,
  ErrorCode,
  type InvitePreviewResponse,
  newAccountSchema,
  toValidationIssues,
} from '@leadpilot/shared';
import { emailTaken, invalidCredentials } from '../auth/auth.errors';
import { PasswordService } from '../auth/password.service';
import { hashToken, type IssuedSession, SessionService } from '../auth/session.service';
import { DomainError } from '../common/errors/domain-error';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Wrong passwords allowed per invite before it expires. */
export const MAX_PASSWORD_ATTEMPTS = 5;

/** Unknown, expired, cancelled or already used: one answer, so guessing learns nothing. */
const inviteInvalid = () =>
  new DomainError(
    ErrorCode.INVITE_INVALID,
    'This invite link no longer works',
    HttpStatus.BAD_REQUEST,
  );

/**
 * The public side of an invite: the person holding the link has no session
 * yet, and the workspace is only known from the invite itself. That is why
 * this file uses the raw PrismaService (ESLint allowlist): it looks an invite
 * up by token across all workspaces. It only ever touches the one invite the
 * token names.
 */
@Injectable()
export class InviteAcceptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  /** What the Accept invite page shows before the person types anything. */
  async preview(token: string): Promise<InvitePreviewResponse> {
    const invite = await this.findUsable(token);
    const account = await this.prisma.user.count({ where: { email: invite.email } });
    return {
      workspaceName: invite.workspace.name,
      inviterName: invite.invitedBy?.name ?? null,
      role: assignable(invite.role),
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
      accountExists: account > 0,
    };
  }

  /**
   * Joins the workspace and signs in to it. An existing account proves itself
   * with its password (a wrong one does not use up the invite); a new account
   * is created from `name` and `password`.
   */
  async accept(input: AcceptInviteRequest): Promise<IssuedSession> {
    const invite = await this.findUsable(input.token);
    const user = await this.prisma.user.findUnique({
      where: { email: invite.email },
      select: { id: true, passwordHash: true },
    });

    let account: Account;
    if (user) {
      // Accepting never renames anyone.
      if (input.name !== undefined) throw rejectField('name');
      if (!(await this.passwords.verify(user.passwordHash, input.password))) {
        await this.recordFailedAttempt(invite.id);
        throw invalidCredentials();
      }
      account = { kind: 'existing', userId: user.id };
    } else {
      const parsed = newAccountSchema.safeParse({ name: input.name, password: input.password });
      if (!parsed.success) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          'Validation failed',
          HttpStatus.BAD_REQUEST,
          toValidationIssues(parsed.error.issues),
        );
      }
      account = {
        kind: 'new',
        name: parsed.data.name,
        passwordHash: await this.passwords.hash(parsed.data.password),
      };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Claim the invite first. Of two requests with one link only one can
        // flip acceptedAt from null, so a link cannot make two memberships.
        const { count } = await tx.invite.updateMany({
          // The token hash is part of the claim: a Resend that lands after
          // the lookup replaced the hash, so the old link can no longer win.
          where: {
            id: invite.id,
            tokenHash: hashToken(input.token),
            acceptedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { acceptedAt: new Date() },
        });
        if (count !== 1) throw inviteInvalid();

        const userId =
          account.kind === 'existing'
            ? account.userId
            : (
                await tx.user.create({
                  data: {
                    email: invite.email,
                    name: account.name,
                    passwordHash: account.passwordHash,
                  },
                  select: { id: true },
                })
              ).id;
        await tx.membership.create({
          data: {
            workspaceId: invite.workspaceId,
            userId,
            role: invite.role,
            lastActiveAt: new Date(),
          },
        });
        return this.sessions.issue(tx, userId, invite.workspaceId);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Either the account appeared after the preview (the client previews
        // again), or the person is already a member: the invite is moot.
        const nowExists = await this.prisma.user.count({ where: { email: invite.email } });
        if (nowExists > 0 && account.kind === 'new') throw emailTaken();
        // Already a member: the claim was rolled back, so drop the dead invite
        // instead of leaving it "pending" in the Team list for ever.
        await this.prisma.invite.deleteMany({ where: { id: invite.id, acceptedAt: null } });
        throw inviteInvalid();
      }
      throw error;
    }
  }

  /**
   * A wrong password on an existing account does not use the invite up, so a
   * leaked link would be a password-guessing oracle. After MAX attempts the
   * invite expires; an admin can Resend it (which resets the count).
   */
  private async recordFailedAttempt(inviteId: string): Promise<void> {
    try {
      const { failedAttempts } = await this.prisma.invite.update({
        where: { id: inviteId },
        data: { failedAttempts: { increment: 1 } },
        select: { failedAttempts: true },
      });
      if (failedAttempts >= MAX_PASSWORD_ATTEMPTS) {
        await this.prisma.invite.updateMany({
          where: { id: inviteId, acceptedAt: null },
          data: { expiresAt: new Date() },
        });
      }
    } catch (error) {
      // The invite was cancelled meanwhile: nothing left to protect.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')) {
        throw error;
      }
    }
  }

  private async findUsable(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        workspace: { select: { name: true } },
        invitedBy: { select: { name: true } },
      },
    });
    if (!invite || invite.acceptedAt !== null || invite.expiresAt <= new Date()) {
      throw inviteInvalid();
    }
    return invite;
  }
}

type Account =
  { kind: 'existing'; userId: string } | { kind: 'new'; name: string; passwordHash: string };

function assignable(role: 'OWNER' | 'ADMIN' | 'MEMBER'): AssignableRole {
  return role === 'ADMIN' ? 'ADMIN' : 'MEMBER';
}

/** The same shape a strict schema gives for a key it does not accept. */
function rejectField(name: string): DomainError {
  return new DomainError(ErrorCode.VALIDATION_FAILED, 'Validation failed', HttpStatus.BAD_REQUEST, [
    { path: '', code: 'unrecognized_keys', values: [name] },
  ]);
}
