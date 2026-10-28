import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Locale } from '@leadpilot/shared';
import type { Env } from '../config/env.schema';
import { buildAccountEmail } from '../email/account-email';
import { EMAIL_PROVIDER, type EmailProvider } from '../email/email.provider';
import type { $Enums } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { tokenInvalid } from './auth.errors';
import { PasswordService } from './password.service';
import { hashToken } from './session.service';

const HOUR_MS = 60 * 60 * 1000;
export const RESET_TTL_HOURS = 1;
export const VERIFY_TTL_HOURS = 72;
/** One email of a kind per account in this time: asking again and again cannot flood an inbox. */
const RESEND_AFTER_MS = 60 * 1000;

type Kind = $Enums.UserTokenKind;

/**
 * Password reset and email verification. The link carries a random token (32 bytes); only its
 * SHA-256 is stored, so a database leak hands out no working link. A token works once and expires.
 * Users are global, so this works on the raw PrismaService like the rest of auth (ESLint allowlist).
 *
 * Asking for a reset never says whether the address has an account: the answer is always the same.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly config: ConfigService<Env, true>,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  /** "Forgot password": sends the link when the address has an account. Never throws, never tells. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, locale: true },
    });
    if (!user) return;
    await this.sendLink(user, 'PASSWORD_RESET').catch((error: Error) =>
      this.logger.warn(`Reset email failed: ${error.message}`),
    );
  }

  /** The new password, from a reset link. Every signed-in session of the account is ended. */
  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.consume(token, 'PASSWORD_RESET');
    const passwordHash = await this.passwords.hash(password);
    const now = new Date();
    await this.prisma.$transaction([
      // Following the link proves the mailbox, so the address counts as verified too.
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, emailVerifiedAt: now },
      }),
      // Whoever had the old password (or a stolen session) is signed out everywhere.
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      // A second, older reset link must not work after this one did.
      this.prisma.userToken.deleteMany({ where: { userId, kind: 'PASSWORD_RESET', usedAt: null } }),
    ]);
  }

  /** Sends the "verify your address" email to a signed-in person who has not verified yet. */
  async sendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, locale: true, emailVerifiedAt: true },
    });
    if (!user || user.emailVerifiedAt) return;
    await this.sendLink(user, 'EMAIL_VERIFY');
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.consume(token, 'EMAIL_VERIFY');
    await this.prisma.user.updateMany({
      where: { id: userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
  }

  private async sendLink(
    user: { id: string; email: string; locale: Locale | null },
    kind: Kind,
  ): Promise<void> {
    const recent = await this.prisma.userToken.findFirst({
      where: { userId: user.id, kind, createdAt: { gt: new Date(Date.now() - RESEND_AFTER_MS) } },
      select: { id: true },
    });
    if (recent) return;

    const ttlHours = kind === 'PASSWORD_RESET' ? RESET_TTL_HOURS : VERIFY_TTL_HOURS;
    const token = randomBytes(32).toString('base64url');
    await this.prisma.userToken.create({
      data: {
        userId: user.id,
        kind,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlHours * HOUR_MS),
      },
    });

    // The email speaks the person's own language, else their workspace's.
    let locale = user.locale;
    if (!locale) {
      const membership = await this.prisma.membership.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
        select: { workspace: { select: { defaultLocale: true } } },
      });
      locale = membership?.workspace.defaultLocale ?? 'en';
    }
    const webOrigin = this.config.get('WEB_ORIGIN', { infer: true }).replace(/\/$/, '');
    const path = kind === 'PASSWORD_RESET' ? 'reset-password' : 'verify-email';
    await this.email.send(
      await buildAccountEmail({
        kind: kind === 'PASSWORD_RESET' ? 'reset' : 'verify',
        to: user.email,
        locale,
        // The fragment (#t=) is never sent to a server, so the token stays out of logs and Referer.
        link: `${webOrigin}/${path}#t=${token}`,
        expiresInHours: ttlHours,
        webOrigin,
      }),
    );
  }

  /** Uses a token up (once) and says whose it was; a wrong, used or expired token is one answer. */
  private async consume(token: string, kind: Kind): Promise<string> {
    const tokenHash = hashToken(token);
    const row = await this.prisma.userToken.findUnique({ where: { tokenHash } });
    if (!row || row.kind !== kind) throw tokenInvalid();
    const { count } = await this.prisma.userToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (count !== 1) throw tokenInvalid();
    return row.userId;
  }
}
