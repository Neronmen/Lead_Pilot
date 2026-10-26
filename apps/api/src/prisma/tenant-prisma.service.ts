import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { scopeToWorkspace, type WorkspaceClient } from './workspace-scope';

/**
 * The way services reach tenant data: `tenantPrisma.for(workspaceId).lead...`.
 * The workspace id comes from the authenticated request (or, from M3, from
 * the job), and is passed explicitly so the scope is visible at every call.
 *
 * `for()` always wraps the root client: inside `scoped.$transaction(async (tx)
 * => ...)` use `tx`, not a second `for()` call, which would run outside the
 * transaction. Flows that create the workspace itself (signup) run in a
 * PrismaService transaction in an allowlisted module.
 */
@Injectable()
export class TenantPrisma {
  constructor(private readonly prisma: PrismaService) {}

  for(workspaceId: string): WorkspaceClient {
    return scopeToWorkspace(this.prisma, workspaceId);
  }
}
