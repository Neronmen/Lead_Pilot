import { Injectable } from '@nestjs/common';
import type { HistoryEntry, HistoryPage, ListHistoryQuery } from '@leadpilot/shared';
import type { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

const PAGE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The cursor is "<iso time>_<id>" of the last entry shown; it keeps two entries of the same millisecond apart. */
function parseCursor(cursor: string): { at: Date; id: string } | null {
  const [iso, id] = cursor.split('_');
  const at = iso ? new Date(iso) : null;
  return at && !Number.isNaN(at.getTime()) && id ? { at, id } : null;
}

/** Only flat, readable values were ever written (never secrets): keep them as they are, drop anything else. */
function flat(
  value: Prisma.JsonValue | null,
): Record<string, string | number | boolean | null> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      out[key] = item as string | number | boolean | null;
    }
  }
  return out;
}

/** Settings > Change history: who changed what in this workspace, newest first (Owner and Admin). */
@Injectable()
export class HistoryService {
  constructor(private readonly tenant: TenantPrisma) {}

  async list(workspaceId: string, query: ListHistoryQuery): Promise<HistoryPage> {
    const db = this.tenant.for(workspaceId);
    const cursor = query.before ? parseCursor(query.before) : null;
    const where: Prisma.AuditLogWhereInput = {
      area: query.area,
      actorUserId: query.actor,
      ...(query.days ? { createdAt: { gte: new Date(Date.now() - query.days * DAY_MS) } } : {}),
      ...(cursor
        ? {
            OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }],
          }
        : {}),
    };
    const rows = await db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
    });
    const shown = rows.slice(0, PAGE);

    // Names of the people behind the entries (a person who left shows as "someone").
    const actorIds = [
      ...new Set(shown.flatMap((row) => (row.actorUserId ? [row.actorUserId] : []))),
    ];
    const members = actorIds.length
      ? await db.membership.findMany({
          where: { userId: { in: actorIds } },
          select: { userId: true, user: { select: { name: true, email: true } } },
        })
      : [];
    const byId = new Map(members.map((m) => [m.userId, m.user]));

    const entries: HistoryEntry[] = shown.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      area: row.area,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: row.actorUserId
        ? {
            id: row.actorUserId,
            name: byId.get(row.actorUserId)?.name ?? null,
            email: byId.get(row.actorUserId)?.email ?? null,
          }
        : null,
      before: flat(row.before),
      after: flat(row.after),
    }));
    const last = shown.at(-1);
    return {
      entries,
      next: rows.length > PAGE && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
    };
  }
}
