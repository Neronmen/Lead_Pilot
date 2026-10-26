import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC, setAuthContext } from './auth-context';
import { missingToken, sessionExpired } from './auth.errors';

// `exp` is required: a token without one would never expire.
const claimsSchema = z.object({ sub: z.uuid(), wid: z.uuid(), exp: z.number() });

/**
 * Global guard: verifies the access token, then loads the membership on every
 * request. The role is read from the database, not from the token, so a
 * member who is removed or demoted loses access at once, not when their token
 * expires 15 minutes later.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerToken(request);
    if (!token) throw missingToken();

    let claims: z.infer<typeof claimsSchema>;
    try {
      claims = claimsSchema.parse(await this.jwt.verifyAsync<object>(token));
    } catch {
      // Expired, bad signature, wrong algorithm or malformed: all the same to the client.
      throw sessionExpired();
    }

    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: claims.wid, userId: claims.sub } },
      select: { id: true, role: true },
    });
    if (!membership) throw sessionExpired();

    setAuthContext(request, {
      userId: claims.sub,
      workspaceId: claims.wid,
      membershipId: membership.id,
      role: membership.role,
    });
    // Every later log line of this request carries the tenant (CLAUDE.md, Logging).
    this.logger.assign({ workspaceId: claims.wid, userId: claims.sub });
    return true;
  }
}

function bearerToken(request: Request): string | undefined {
  const [scheme, token] = (request.headers.authorization ?? '').split(' ');
  // The scheme name is case-insensitive (RFC 7235).
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}
