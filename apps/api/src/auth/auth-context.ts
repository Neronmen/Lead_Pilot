import {
  createParamDecorator,
  type ExecutionContext,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { ErrorCode, type Role } from '@leadpilot/shared';
import type { Request } from 'express';
import { DomainError } from '../common/errors/domain-error';

/** Who is calling, set by JwtAuthGuard from the token and the membership row. */
export interface AuthContext {
  userId: string;
  workspaceId: string;
  membershipId: string;
  role: Role;
}

// Kept beside the request rather than on it: no global type augmentation,
// and nothing else can set it by accident.
const contexts = new WeakMap<Request, AuthContext>();

export function setAuthContext(request: Request, auth: AuthContext): void {
  contexts.set(request, auth);
}

/** Undefined on @Public() routes. */
export function getAuthContext(request: Request): AuthContext | undefined {
  return contexts.get(request);
}

export const IS_PUBLIC = 'auth:isPublic';
export const MIN_ROLE = 'auth:minRole';

/**
 * Every route needs a signed-in user unless it is marked @Public(). A route
 * someone forgets to protect is therefore locked, not open.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The lowest role allowed, e.g. @MinRole('ADMIN') lets Admins and the Owner in. */
export const MinRole = (role: Role) => SetMetadata(MIN_ROLE, role);

/** Role order for MinRole: a higher rank can do everything a lower one can. */
export const ROLE_RANK: Record<Role, number> = { MEMBER: 0, ADMIN: 1, OWNER: 2 };

/** The caller of a protected route: `me(@CurrentAuth() auth: AuthContext)`. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const auth = getAuthContext(ctx.switchToHttp().getRequest<Request>());
  // Only reachable on a @Public() route: a programming error, not a 401.
  if (!auth) {
    throw new DomainError(
      ErrorCode.INTERNAL,
      'CurrentAuth used on a public route',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  return auth;
});
