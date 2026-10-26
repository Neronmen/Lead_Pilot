import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@leadpilot/shared';
import type { Request } from 'express';
import { getAuthContext, MIN_ROLE, ROLE_RANK } from './auth-context';
import { forbidden } from './auth.errors';

/**
 * Global guard, runs after JwtAuthGuard: a route marked @MinRole('ADMIN')
 * refuses Members with 403 FORBIDDEN. Routes without @MinRole allow every role.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const minRole = this.reflector.getAllAndOverride<Role | undefined>(MIN_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!minRole) return true;

    const auth = getAuthContext(context.switchToHttp().getRequest<Request>());
    // @MinRole on a @Public() route is a mistake: fail closed.
    if (!auth || ROLE_RANK[auth.role] < ROLE_RANK[minRole]) throw forbidden();
    return true;
  }
}
