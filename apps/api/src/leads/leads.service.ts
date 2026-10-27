import { Injectable } from '@nestjs/common';
import type { LeadList, ListLeadsQuery } from '@leadpilot/shared';
import type { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

@Injectable()
export class LeadsService {
  constructor(private readonly tenant: TenantPrisma) {}

  async list(workspaceId: string, query: ListLeadsQuery): Promise<LeadList> {
    const db = this.tenant.for(workspaceId);
    const where: Prisma.LeadWhereInput = {
      status: query.status,
      sourceId: query.sourceId,
      isFreeMail: query.freeMail === undefined ? undefined : query.freeMail === 'true',
    };
    if (query.q) {
      // Prisma's `contains` does NOT escape LIKE wildcards, so "%" and "_" typed
      // in the box would match everything: put a backslash in front of them.
      const escaped = query.q.replace(/[\\%_]/g, '\\$&');
      const search = { contains: escaped, mode: 'insensitive' as const };
      where.OR = [
        { email: search },
        { firstName: search },
        { lastName: search },
        { company: search },
        { phone: search },
      ];
    }
    // Ids are time-ordered (UUIDv7), so id order is newest first and a stable cursor.
    const rows = await db.lead.findMany({
      where,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        source: { select: { id: true, name: true, type: true } },
        owner: { select: { user: { select: { id: true, name: true } } } },
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        name: [row.firstName, row.lastName].filter(Boolean).join(' ') || null,
        email: row.email,
        phone: row.phone,
        company: row.company,
        country: row.country,
        isFreeMail: row.isFreeMail,
        status: row.status,
        source: row.source,
        owner: row.owner ? { id: row.owner.user.id, name: row.owner.user.name } : null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
    };
  }
}
