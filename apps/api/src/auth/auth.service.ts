import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { LoginRequest, MeResponse, SignupRequest, UpdateMeRequest } from '@leadpilot/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { emailTaken, invalidCredentials, noWorkspace, sessionExpired } from './auth.errors';
import { AccountService } from './account.service';
import { PasswordService } from './password.service';
import { type IssuedSession, isForeignKeyViolation, SessionService } from './session.service';

/**
 * Accounts and sign-in. This module uses the raw PrismaService (ESLint
 * allowlist) because it works before a workspace is known: users are global,
 * and login looks up the memberships of one user across workspaces.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly account: AccountService,
  ) {}

  /** Creates the user, the workspace and the OWNER membership in one transaction. */
  async signup(input: SignupRequest): Promise<IssuedSession> {
    if (await this.emailExists(input.email)) throw emailTaken();
    const passwordHash = await this.passwords.hash(input.password);

    let createdUserId = '';
    try {
      const session = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          // locale stays null: the owner follows the workspace language.
          data: { email: input.email, passwordHash, name: input.name },
          select: { id: true },
        });
        createdUserId = user.id;
        const workspace = await tx.workspace.create({
          data: {
            name: input.workspaceName,
            slug: workspaceSlug(input.workspaceName),
            defaultLocale: input.locale,
            currency: input.currency,
            defaultCountry: input.defaultCountry ?? null,
          },
          select: { id: true },
        });
        await tx.membership.create({
          data: {
            workspaceId: workspace.id,
            userId: user.id,
            role: 'OWNER',
            lastActiveAt: new Date(),
          },
        });
        return this.sessions.issue(tx, user.id, workspace.id);
      });
      // Best effort: a mail server that is down must not stop someone from creating an account.
      this.account
        .sendVerification(createdUserId)
        .catch((error: Error) => this.logger.warn(`Verification email failed: ${error.message}`));
      return session;
    } catch (error) {
      // Two signups with one email raced past the check above.
      if (isUniqueViolation(error) && (await this.emailExists(input.email))) throw emailTaken();
      throw error;
    }
  }

  /** Signs in to the workspace the user was active in most recently. */
  async login(input: LoginRequest): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, passwordHash: true },
    });
    // Always one argon2 verification, also for unknown emails (see PasswordService).
    const valid = await this.passwords.verify(user?.passwordHash, input.password);
    if (!user || !valid) {
      // For spotting credential stuffing; the address itself is never logged.
      this.logger.warn(
        { emailHash: shortHash(input.email), knownEmail: Boolean(user) },
        'Login failed',
      );
      throw invalidCredentials();
    }

    const membership = await this.prisma.membership.findFirst({
      where: { userId: user.id },
      orderBy: [{ lastActiveAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      select: { workspaceId: true },
    });
    if (!membership) throw noWorkspace();

    let session: IssuedSession;
    try {
      session = await this.sessions.issue(this.prisma, user.id, membership.workspaceId);
    } catch (error) {
      // The membership was removed between the lookup and the insert.
      if (isForeignKeyViolation(error)) throw noWorkspace();
      throw error;
    }
    await this.sessions.touchMembership(membership.workspaceId, user.id);
    return session;
  }

  async me(userId: string, workspaceId: string): Promise<MeResponse> {
    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: {
        role: true,
        user: {
          select: { id: true, email: true, name: true, locale: true, emailVerifiedAt: true },
        },
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            defaultLocale: true,
            currency: true,
            timezone: true,
            defaultCountry: true,
          },
        },
      },
    });
    // The guard checked the membership; it can vanish between the two queries.
    if (!membership) throw sessionExpired();
    const { emailVerifiedAt, ...user } = membership.user;
    return {
      user: { ...user, emailVerified: emailVerifiedAt !== null },
      workspace: membership.workspace,
      role: membership.role,
    };
  }

  async updateMe(userId: string, workspaceId: string, input: UpdateMeRequest): Promise<MeResponse> {
    await this.prisma.user.update({ where: { id: userId }, data: { locale: input.locale } });
    return this.me(userId, workspaceId);
  }

  private async emailExists(email: string): Promise<boolean> {
    return (await this.prisma.user.count({ where: { email } })) > 0;
  }
}

/**
 * URL-safe workspace slug: the name without diacritics ("Đông Á" ->
 * "dong-a"), plus a random suffix so two workspaces may share a name.
 */
export function workspaceSlug(name: string): string {
  const base = name
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const suffix = randomBytes(4).toString('hex');
  return `${base || 'workspace'}-${suffix}`;
}

/** First 12 hex characters of SHA-256: enough to correlate, not to read. */
function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
