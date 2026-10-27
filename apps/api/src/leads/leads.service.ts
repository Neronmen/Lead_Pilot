import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type LeadDetail,
  type LeadList,
  type LeadListItem,
  type ListLeadsQuery,
} from '@leadpilot/shared';
import { DomainError } from '../common/errors/domain-error';
import { EnrichmentService } from '../enrichment/enrichment.service';
import type { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

/** The newest events shown on a lead's timeline. */
const TIMELINE_LIMIT = 200;

const LIST_INCLUDE = {
  source: { select: { id: true, name: true, type: true } },
  owner: { select: { user: { select: { id: true, name: true } } } },
  possibleDuplicateOf: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.LeadInclude;

type ListRow = Prisma.LeadGetPayload<{ include: typeof LIST_INCLUDE }>;

const fullName = (first: string | null, last: string | null) =>
  [first, last].filter(Boolean).join(' ') || null;

function toItem(row: ListRow, submissions: number): LeadListItem {
  return {
    id: row.id,
    name: fullName(row.firstName, row.lastName),
    email: row.email,
    phone: row.phone,
    company: row.company,
    country: row.country,
    isFreeMail: row.isFreeMail,
    status: row.status,
    tier: row.tier,
    score: row.score,
    confidence: row.confidence,
    source: row.source,
    owner: row.owner ? { id: row.owner.user.id, name: row.owner.user.name } : null,
    submissions: Math.max(1, submissions),
    possibleDuplicateOf: row.possibleDuplicateOf
      ? {
          id: row.possibleDuplicateOf.id,
          name: fullName(row.possibleDuplicateOf.firstName, row.possibleDuplicateOf.lastName),
          email: row.possibleDuplicateOf.email,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly enrichment: EnrichmentService,
  ) {}

  async list(workspaceId: string, query: ListLeadsQuery): Promise<LeadList> {
    const db = this.tenant.for(workspaceId);
    const where: Prisma.LeadWhereInput = {
      status: query.status,
      tier: query.tier,
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
    // Ids are time-ordered (UUIDv7), so id order is date order and a stable cursor.
    const rows = await db.lead.findMany({
      where,
      orderBy: { id: query.order === 'oldest' ? 'asc' : 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: LIST_INCLUDE,
    });
    const page = rows.slice(0, query.limit);
    // Each submission leaves one "ingested" event: more than one means later ones were merged in.
    const submitted = await db.leadEvent.groupBy({
      by: ['leadId'],
      where: { type: 'ingested', leadId: { in: page.map((row) => row.id) } },
      _count: { _all: true },
    });
    const submissions = new Map(submitted.map((row) => [row.leadId, row._count._all]));
    return {
      items: page.map((row) => toItem(row, submissions.get(row.id) ?? 1)),
      nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
    };
  }

  /** One lead with its timeline and the AI's latest answer. Another workspace's lead is a 404. */
  async detail(workspaceId: string, id: string): Promise<LeadDetail> {
    const db = this.tenant.for(workspaceId);
    const row = await db.lead.findUnique({ where: { id }, include: LIST_INCLUDE });
    if (!row) throw new DomainError(ErrorCode.NOT_FOUND, 'Lead not found', HttpStatus.NOT_FOUND);
    const [events, score, submissions] = await Promise.all([
      db.leadEvent.findMany({
        where: { leadId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: TIMELINE_LIMIT,
      }),
      db.score.findFirst({
        where: { leadId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      db.leadEvent.count({ where: { leadId: id, type: 'ingested' } }),
    ]);
    const company = row.domain ? await this.enrichment.cached(row.domain) : null;
    const output = (score?.output ?? {}) as { reasons?: unknown; suggestedReply?: unknown };
    return {
      ...toItem(row, submissions),
      domain: row.domain,
      customFields: (row.customFields ?? {}) as Record<string, unknown>,
      companyInfo: company
        ? { status: company.status, title: company.title, description: company.description }
        : null,
      latestScore: score
        ? {
            id: score.id,
            provider: score.provider,
            model: score.model,
            ratedWithoutAi: score.isFallback,
            reasons: Array.isArray(output.reasons) ? output.reasons.map(String) : [],
            suggestedReply:
              typeof output.suggestedReply === 'string' ? output.suggestedReply : null,
            costUsd: Number(score.costUsd),
            createdAt: score.createdAt.toISOString(),
          }
        : null,
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        payload: (event.payload ?? {}) as Record<string, unknown>,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }
}
