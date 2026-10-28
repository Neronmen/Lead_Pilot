import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type CreateSourceRequest,
  ErrorCode,
  type HmacSecretResponse,
  type Source,
  type SourceStats,
  USEFUL_FIELDS,
  type SourceWithKey,
  type UpdateSourceRequest,
} from '@leadpilot/shared';
import { AuditAction, AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors/domain-error';
import { CryptoService } from '../crypto/crypto.service';
import { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { newApiKey, newHmacSecret } from './api-key';

export interface Actor {
  userId: string;
  workspaceId: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Two keys with the same 8-hex-character prefix are possible (1 in 4 billion): retry. */
const KEY_ATTEMPTS = 3;

const sourceNotFound = () =>
  new DomainError(ErrorCode.NOT_FOUND, 'Source not found', HttpStatus.NOT_FOUND);

const hasLeads = () =>
  new DomainError(
    ErrorCode.SOURCE_HAS_LEADS,
    'This source has leads: switch it off instead',
    HttpStatus.CONFLICT,
  );

/** Binds a signing secret to its source: copied onto another row it no longer decrypts. */
export const hmacAad = (workspaceId: string, sourceId: string) =>
  `source:${workspaceId}:${sourceId}`;

const isCode = (error: unknown, code: string) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

interface SourceRow {
  id: string;
  name: string;
  type: 'WEBHOOK' | 'FORM' | 'CSV';
  enabled: boolean;
  formEnabled: boolean;
  apiKeyPrefix: string;
  hmacSecretEnc: string | null;
  createdAt: Date;
}

/**
 * Lead sources and their credentials (Settings > Lead sources and Advanced /
 * Developer). Every query goes through `TenantPrisma.for(workspaceId)`:
 * another workspace's source id is a 404. Keys and secrets are shown ONCE, in
 * the response that creates them; the database keeps a hash of the API key and
 * an encrypted copy of the signing secret (it must be readable to verify
 * requests), and nothing here ever logs or audits either.
 */
@Injectable()
export class SourcesService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  async list(workspaceId: string): Promise<Source[]> {
    const db = this.tenant.for(workspaceId);
    const rows = await db.source.findMany({ orderBy: { createdAt: 'asc' } });
    const recent = await db.lead.groupBy({
      by: ['sourceId'],
      where: { createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) } },
      _count: { _all: true },
    });
    const latest = await db.lead.groupBy({ by: ['sourceId'], _max: { createdAt: true } });
    const counts = new Map(recent.map((row) => [row.sourceId, row._count._all]));
    const last = new Map(latest.map((row) => [row.sourceId, row._max.createdAt]));
    const stats = await this.stats(workspaceId);
    return rows.map((row) =>
      toSource(row, counts.get(row.id) ?? 0, last.get(row.id) ?? null, stats.get(row.id)),
    );
  }

  async create(actor: Actor, input: CreateSourceRequest): Promise<SourceWithKey> {
    const db = this.tenant.for(actor.workspaceId);
    for (let attempt = 1; ; attempt += 1) {
      const key = newApiKey();
      try {
        const row = await db.$transaction(async (tx) => {
          const created = await tx.source.create({
            data: {
              workspaceId: actor.workspaceId,
              name: input.name,
              type: input.type,
              apiKeyPrefix: key.prefix,
              apiKeyHash: key.hash,
            },
          });
          await this.audit.record(tx, actor.workspaceId, {
            actorUserId: actor.userId,
            area: 'sources',
            action: AuditAction.SourceCreated,
            entityType: 'source',
            entityId: created.id,
            after: { name: created.name, type: created.type },
          });
          return created;
        });
        return { source: toSource(row, 0, null), apiKey: key.key };
      } catch (error) {
        if (isCode(error, 'P2002') && attempt < KEY_ATTEMPTS) continue; // prefix collision
        throw error;
      }
    }
  }

  async update(actor: Actor, id: string, input: UpdateSourceRequest): Promise<Source> {
    const db = this.tenant.for(actor.workspaceId);
    const row = await db
      .$transaction(async (tx) => {
        const before = await tx.source.findUnique({ where: { id } });
        if (!before) throw sourceNotFound();
        const changed = await tx.source.update({
          where: { id },
          data: { name: input.name, enabled: input.enabled, formEnabled: input.formEnabled },
        });
        const same =
          changed.name === before.name &&
          changed.enabled === before.enabled &&
          changed.formEnabled === before.formEnabled;
        if (!same) {
          await this.audit.record(tx, actor.workspaceId, {
            actorUserId: actor.userId,
            area: 'sources',
            action: AuditAction.SourceUpdated,
            entityType: 'source',
            entityId: id,
            before: { name: before.name, enabled: before.enabled },
            after: { name: changed.name, enabled: changed.enabled },
          });
        }
        return changed;
      })
      .catch((error: unknown) => {
        if (isCode(error, 'P2025')) throw sourceNotFound();
        throw error;
      });
    return this.one(actor.workspaceId, row);
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const db = this.tenant.for(actor.workspaceId);
    await db
      .$transaction(async (tx) => {
        const before = await tx.source.findUnique({ where: { id } });
        if (!before) throw sourceNotFound();
        // Leads point at their source and must keep doing so: switch it off instead.
        if ((await tx.lead.count({ where: { sourceId: id } })) > 0) throw hasLeads();
        await tx.source.delete({ where: { id } });
        await this.audit.record(tx, actor.workspaceId, {
          actorUserId: actor.userId,
          area: 'sources',
          action: AuditAction.SourceDeleted,
          entityType: 'source',
          entityId: id,
          before: { name: before.name, type: before.type },
        });
      })
      .catch((error: unknown) => {
        if (isCode(error, 'P2025')) throw sourceNotFound();
        // A lead arrived between the count and the delete: the foreign key refused.
        if (isCode(error, 'P2003')) throw hasLeads();
        throw error;
      });
  }

  /** A new key; the old one stops working at once. */
  async rotateApiKey(actor: Actor, id: string): Promise<SourceWithKey> {
    const db = this.tenant.for(actor.workspaceId);
    for (let attempt = 1; ; attempt += 1) {
      const key = newApiKey();
      try {
        const row = await db
          .$transaction(async (tx) => {
            const updated = await tx.source.update({
              where: { id },
              data: { apiKeyPrefix: key.prefix, apiKeyHash: key.hash },
            });
            await this.audit.record(tx, actor.workspaceId, {
              actorUserId: actor.userId,
              area: 'sources',
              action: AuditAction.SourceKeyRotated,
              entityType: 'source',
              entityId: id,
              after: { name: updated.name },
            });
            return updated;
          })
          .catch((error: unknown) => {
            if (isCode(error, 'P2025')) throw sourceNotFound();
            throw error;
          });
        // The old key is already dead: the new one must reach the caller even if the
        // counts for the response cannot be read.
        const source = await this.one(actor.workspaceId, row).catch(() => toSource(row, 0, null));
        return { source, apiKey: key.key };
      } catch (error) {
        if (isCode(error, 'P2002') && attempt < KEY_ATTEMPTS) continue;
        throw error;
      }
    }
  }

  /** Switch request signing on: makes a secret, shown once. Already on: HMAC_ALREADY_ENABLED. */
  async enableHmac(actor: Actor, id: string): Promise<HmacSecretResponse> {
    const db = this.tenant.for(actor.workspaceId);
    const secret = newHmacSecret();
    await db.$transaction(async (tx) => {
      // Conditional on "no secret yet": two requests at once make one secret, not two.
      const { count } = await tx.source.updateMany({
        where: { id, hmacSecretEnc: null },
        data: { hmacSecretEnc: this.crypto.encrypt(secret, hmacAad(actor.workspaceId, id)) },
      });
      if (count !== 1) {
        const exists = await tx.source.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw sourceNotFound();
        throw new DomainError(
          ErrorCode.HMAC_ALREADY_ENABLED,
          'Signing is already on for this source',
          HttpStatus.CONFLICT,
        );
      }
      await this.audit.record(tx, actor.workspaceId, {
        actorUserId: actor.userId,
        area: 'sources',
        action: AuditAction.SourceHmacEnabled,
        entityType: 'source',
        entityId: id,
      });
    });
    return { secret };
  }

  /** Switch signing off (the secret is deleted). Already off: nothing happens. */
  async disableHmac(actor: Actor, id: string): Promise<void> {
    const db = this.tenant.for(actor.workspaceId);
    await db.$transaction(async (tx) => {
      const exists = await tx.source.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw sourceNotFound();
      const { count } = await tx.source.updateMany({
        where: { id, hmacSecretEnc: { not: null } },
        data: { hmacSecretEnc: null },
      });
      if (count === 1) {
        await this.audit.record(tx, actor.workspaceId, {
          actorUserId: actor.userId,
          area: 'sources',
          action: AuditAction.SourceHmacDisabled,
          entityType: 'source',
          entityId: id,
        });
      }
    });
  }

  /** One source with its counts (after a change). */
  private async one(workspaceId: string, row: SourceRow): Promise<Source> {
    const db = this.tenant.for(workspaceId);
    const since = new Date(Date.now() - 30 * DAY_MS);
    const [recent, latest] = await Promise.all([
      db.lead.count({ where: { sourceId: row.id, createdAt: { gte: since } } }),
      db.lead.aggregate({ where: { sourceId: row.id }, _max: { createdAt: true } }),
    ]);
    const stats = await this.stats(workspaceId, row.id);
    return toSource(row, recent, latest._max.createdAt, stats.get(row.id));
  }

  /**
   * Submissions of the last 30 days per source. `received` is the sum of the
   * three outcomes it is made of, so the numbers always add up; replays are apart.
   */
  private async stats(workspaceId: string, sourceId?: string): Promise<Map<string, SourceStats>> {
    const db = this.tenant.for(workspaceId);
    const where = {
      createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) },
      ...(sourceId ? { sourceId } : {}),
    };
    const [outcomes, reasons] = await Promise.all([
      db.ingestAttempt.groupBy({ by: ['sourceId', 'outcome'], where, _count: { _all: true } }),
      db.ingestAttempt.groupBy({
        by: ['sourceId', 'reason'],
        where: { ...where, outcome: 'REJECTED' },
        _count: { _all: true },
      }),
    ]);
    const result = new Map<string, SourceStats>();
    const of = (id: string) => {
      let stats = result.get(id);
      if (!stats) {
        stats = emptyStats();
        result.set(id, stats);
      }
      return stats;
    };
    for (const row of outcomes) {
      const stats = of(row.sourceId);
      const count = row._count._all;
      if (row.outcome === 'CREATED') stats.created += count;
      else if (row.outcome === 'MERGED') stats.merged += count;
      else if (row.outcome === 'REJECTED') stats.rejected += count;
      else stats.replayed += count;
    }
    for (const stats of result.values())
      stats.received = stats.created + stats.merged + stats.rejected;
    // What each source sends: a field counts when at least half of the accepted submissions had it.
    const accepted = await db.ingestAttempt.findMany({
      where: { ...where, outcome: { in: ['CREATED', 'MERGED'] } },
      select: { sourceId: true, fields: true },
      take: 20_000,
    });
    const seen = new Map<string, { total: number; counts: Map<string, number> }>();
    for (const row of accepted) {
      const entry = seen.get(row.sourceId) ?? { total: 0, counts: new Map() };
      entry.total += 1;
      for (const field of row.fields) entry.counts.set(field, (entry.counts.get(field) ?? 0) + 1);
      seen.set(row.sourceId, entry);
    }
    for (const [id, entry] of seen) {
      const sends = USEFUL_FIELDS.filter((f) => (entry.counts.get(f) ?? 0) * 2 >= entry.total);
      of(id).readiness = {
        accepted: entry.total,
        sends,
        missing: USEFUL_FIELDS.filter((f) => !sends.includes(f)),
      };
    }
    for (const row of [...reasons].sort((a, b) => b._count._all - a._count._all)) {
      const top = of(row.sourceId).topRejections;
      if (top.length < 3) top.push({ reason: row.reason ?? 'other', count: row._count._all });
    }
    return result;
  }
}

const emptyStats = (): SourceStats => ({
  received: 0,
  created: 0,
  merged: 0,
  rejected: 0,
  replayed: 0,
  topRejections: [],
  readiness: { accepted: 0, sends: [], missing: [...USEFUL_FIELDS] },
});

function toSource(
  row: SourceRow,
  leadsLast30Days: number,
  lastLeadAt: Date | null,
  stats: SourceStats = emptyStats(),
): Source {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled,
    apiKeyPrefix: row.apiKeyPrefix,
    hmacEnabled: row.hmacSecretEnc !== null,
    formEnabled: row.formEnabled,
    createdAt: row.createdAt.toISOString(),
    leadsLast30Days,
    lastLeadAt: lastLeadAt ? lastLeadAt.toISOString() : null,
    last30Days: stats,
  };
}
