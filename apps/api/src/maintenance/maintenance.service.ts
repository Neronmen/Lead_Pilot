import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PipelineQueue } from '../queue/pipeline.queue';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Raw payloads hold personal data: kept this long, then dropped. */
export const RAW_PAYLOAD_RETENTION_DAYS = 90;
/** The per-source numbers look back 30 days; keep a margin. */
export const INGEST_ATTEMPT_RETENTION_DAYS = 90;
/** A lead still NEW after this long has probably lost its queue job. */
export const STUCK_AFTER_MS = 5 * 60 * 1000;
/** A lead still PROCESSING this long lost its worker (stalled jobs are retried by BullMQ first). */
const PROCESSING_STUCK_AFTER_MS = 15 * 60 * 1000;
const STUCK_BATCH = 200;

export interface CleanupResult {
  rawPayloadsPurged: number;
  eventPayloadsPurged: number;
  ingestAttempts: number;
  idempotencyKeys: number;
  refreshTokens: number;
}

/**
 * Jobs that look across every workspace: retention cleanup and the recovery
 * sweep. They use the raw client (and, for the JSON clean-up, raw SQL), which is
 * allowlisted in eslint.config.mjs for this file only: no request is involved,
 * so there is no workspace to scope to, and each statement is written so it can
 * only remove or re-queue data, never read it out.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: PipelineQueue,
  ) {}

  /** Retention. Safe to run twice: every statement only matches what is still due. */
  async cleanup(now: Date = new Date()): Promise<CleanupResult> {
    const payloadCutoff = new Date(now.getTime() - RAW_PAYLOAD_RETENTION_DAYS * DAY_MS);
    const attemptCutoff = new Date(now.getTime() - INGEST_ATTEMPT_RETENTION_DAYS * DAY_MS);
    const tokenCutoff = new Date(now.getTime() - DAY_MS);

    // The lead keeps its latest payload; the timeline keeps one per submission.
    const rawPayloadsPurged = await this.prisma.$executeRaw`
      UPDATE "Lead" SET "rawPayload" = '{}'::jsonb
      WHERE "rawPayload" <> '{}'::jsonb
        AND NOT EXISTS (
          SELECT 1 FROM "LeadEvent" e
          WHERE e."leadId" = "Lead".id AND e."workspaceId" = "Lead"."workspaceId"
            AND e."type" = 'ingested' AND e."createdAt" >= ${payloadCutoff}
        )
        AND "createdAt" < ${payloadCutoff}`;
    const eventPayloadsPurged = await this.prisma.$executeRaw`
      UPDATE "LeadEvent" SET "payload" = ("payload" - 'rawPayload') || '{"purged": true}'::jsonb
      WHERE "type" = 'ingested' AND "createdAt" < ${payloadCutoff} AND "payload" ? 'rawPayload'`;
    const ingestAttempts = await this.prisma.ingestAttempt.deleteMany({
      where: { createdAt: { lt: attemptCutoff } },
    });
    const idempotencyKeys = await this.prisma.idempotencyKey.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const refreshTokens = await this.prisma.refreshToken.deleteMany({
      // Only tokens that are long expired: a revoked token must stay findable until then, because
      // presenting one is how theft is detected (the whole login is then revoked).
      where: { expiresAt: { lt: tokenCutoff } },
    });

    const result: CleanupResult = {
      rawPayloadsPurged,
      eventPayloadsPurged,
      ingestAttempts: ingestAttempts.count,
      idempotencyKeys: idempotencyKeys.count,
      refreshTokens: refreshTokens.count,
    };
    this.logger.log(`Cleanup done: ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Re-queues leads whose job was lost (Redis was down when they arrived, or a
   * worker died). The job id is lead + step, so a lead that still has a job is
   * not queued twice.
   */
  async requeueStuckLeads(now: Date = new Date()): Promise<number> {
    const stuck = await this.prisma.lead.findMany({
      where: {
        OR: [
          { status: 'NEW', createdAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } },
          {
            status: 'PROCESSING',
            updatedAt: { lt: new Date(now.getTime() - PROCESSING_STUCK_AFTER_MS) },
          },
        ],
      },
      select: { id: true, workspaceId: true },
      orderBy: { createdAt: 'asc' },
      take: STUCK_BATCH,
    });
    for (const lead of stuck) {
      await this.pipeline.enqueueLead({ workspaceId: lead.workspaceId, leadId: lead.id });
    }
    if (stuck.length > 0) this.logger.log(`Re-queued ${stuck.length} lead(s) with no pipeline run`);
    return stuck.length;
  }
}
