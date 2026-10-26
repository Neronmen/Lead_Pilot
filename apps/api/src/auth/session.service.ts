import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthSession } from '@leadpilot/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { refreshReused, sessionExpired } from './auth.errors';

/** Access tokens live 15 minutes (SPEC §4.8). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/** A refresh token is valid 14 days; each refresh issues a new one. */
export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** "Last active" on the Team page is bumped at most this often. */
const LAST_ACTIVE_RESOLUTION_MS = 60 * 1000;

/** Claims inside an access token. `wid`: the workspace this session is in. */
export interface AccessClaims {
  sub: string;
  wid: string;
}

/** A new session: the access token for the body, the refresh token for the cookie. */
export interface IssuedSession {
  body: AuthSession;
  refreshToken: string;
}

type Db = PrismaService | Prisma.TransactionClient;

class ConcurrentRotation extends Error {}

/**
 * Sessions with rotating refresh tokens.
 *
 * - The refresh token is 32 random bytes. Only its SHA-256 is stored: it has
 *   full entropy, so a fast hash is enough, and a database leak yields
 *   nothing usable.
 * - Every refresh replaces the token and marks the old one "revoked, replaced
 *   by X". All tokens from one sign-in share a `familyId`.
 * - Reuse detection: if a replaced token comes back, two parties hold it (the
 *   user and a thief) and we cannot tell which is which, so the whole family
 *   is revoked and both must sign in again.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Starts a session (a new family) or continues one during rotation. */
  async issue(
    db: Db,
    userId: string,
    workspaceId: string,
    familyId: string = randomUUID(),
  ): Promise<IssuedSession & { tokenId: string }> {
    const refreshToken = randomBytes(32).toString('base64url');
    const row = await db.refreshToken.create({
      data: {
        userId,
        workspaceId,
        familyId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
      select: { id: true },
    });
    const claims: AccessClaims = { sub: userId, wid: workspaceId };
    const accessToken = await this.jwt.signAsync(claims);
    return {
      tokenId: row.id,
      refreshToken,
      body: { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    };
  }

  /** Swaps a refresh token for a new session in the same family. */
  async rotate(presented: string): Promise<IssuedSession> {
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(presented) },
    });
    if (!current) throw sessionExpired();

    if (current.revokedAt) {
      // Replaced earlier: the token was copied. Signed out: just expired.
      if (current.replacedById) {
        await this.revokeFamily(current.familyId);
        throw refreshReused();
      }
      throw sessionExpired();
    }
    if (current.expiresAt <= new Date()) throw sessionExpired();

    let next: IssuedSession;
    try {
      next = await this.prisma.$transaction(async (tx) => {
        const issued = await this.issue(tx, current.userId, current.workspaceId, current.familyId);
        // Conditional update: of two requests racing with the same token, only
        // one can flip revokedAt from null. The loser is treated as reuse.
        const { count } = await tx.refreshToken.updateMany({
          where: { id: current.id, revokedAt: null },
          data: { revokedAt: new Date(), replacedById: issued.tokenId },
        });
        if (count !== 1) throw new ConcurrentRotation();
        return issued;
      });
    } catch (error) {
      // The membership was removed between the lookup and the insert.
      if (isForeignKeyViolation(error)) throw sessionExpired();
      if (!(error instanceof ConcurrentRotation)) throw error;
      await this.revokeFamily(current.familyId);
      throw refreshReused();
    }

    await this.touchMembership(current.workspaceId, current.userId);
    return next;
  }

  /** Signs out: revokes every token of the presented token's family. */
  async revoke(presented: string): Promise<void> {
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(presented) },
      select: { familyId: true },
    });
    if (current) await this.revokeFamily(current.familyId);
  }

  /**
   * Bumps Membership.lastActiveAt, at most once a minute. Best effort: it runs
   * after the session is committed, and a failure here must not cost the
   * user the session they were just given.
   */
  async touchMembership(workspaceId: string, userId: string): Promise<void> {
    try {
      await this.bumpLastActive(workspaceId, userId);
    } catch (err) {
      this.logger.warn({ err, workspaceId }, 'Could not update lastActiveAt');
    }
  }

  private async bumpLastActive(workspaceId: string, userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.membership.updateMany({
      where: {
        workspaceId,
        userId,
        OR: [
          { lastActiveAt: null },
          { lastActiveAt: { lt: new Date(now.getTime() - LAST_ACTIVE_RESOLUTION_MS) } },
        ],
      },
      data: { lastActiveAt: now },
    });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
