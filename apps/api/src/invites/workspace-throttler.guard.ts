import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { getAuthContext } from '../auth/auth-context';

/**
 * Rate limit per workspace instead of per IP, for routes that send email: a
 * signed-up user could otherwise use the invite API as an email relay,
 * with attacker-chosen names in the subject. Runs after the global
 * JwtAuthGuard, so the workspace is known. The count is of requests, so
 * inviting and then cancelling in a loop does not reset it.
 */
@Injectable()
export class WorkspaceThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const auth = getAuthContext(req as unknown as Request);
    return Promise.resolve(auth?.workspaceId ?? String(req.ip));
  }
}
