import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type RescoreRequest,
  type RescoreResponse,
  type ReviewLeadRequest,
} from '@leadpilot/shared';
import { DomainError } from '../common/errors/domain-error';
import type { $Enums, Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { PipelineQueue } from '../queue/pipeline.queue';

interface Actor {
  userId: string;
  workspaceId: string;
}

const RESCORE_BATCH = 1000;

/** A person checks the AI's rating (Review queue, Lead detail), or asks the AI to look again. */
@Injectable()
export class ReviewService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly pipeline: PipelineQueue,
  ) {}

  async review(actor: Actor, leadId: string, body: ReviewLeadRequest): Promise<void> {
    const db = this.tenant.for(actor.workspaceId);
    await db.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId } });
      if (!lead) throw new DomainError(ErrorCode.NOT_FOUND, 'Lead not found', HttpStatus.NOT_FOUND);
      const latest = await tx.score.findFirst({
        where: { leadId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      if (body.action === 'approve') {
        // Only a lead waiting for review can be approved; a second click (or another
        // person's) finds it already done: 409, nothing changes, no second correction.
        const { count } = await tx.lead.updateMany({
          where: { id: leadId, status: 'NEEDS_REVIEW' },
          data: { status: 'SCORED' },
        });
        if (count !== 1 || !lead.tier) {
          throw new DomainError(
            ErrorCode.CONFLICT,
            'This lead is not waiting for review',
            HttpStatus.CONFLICT,
          );
        }
        await this.record(tx, actor, lead, latest?.id ?? null, {
          kind: 'approve',
          newTier: lead.tier,
          newScore: lead.score,
          note: null,
        });
        return;
      }

      const newScore = body.score ?? lead.score;
      await tx.lead.update({
        where: { id: leadId },
        data: {
          tier: body.tier,
          score: newScore,
          // A person has decided: it no longer waits for review.
          status: lead.status === 'NEEDS_REVIEW' ? 'SCORED' : undefined,
        },
      });
      await this.record(tx, actor, lead, latest?.id ?? null, {
        kind: 'override',
        newTier: body.tier,
        newScore,
        note: body.note ?? null,
      });
    });
  }

  private async record(
    tx: Parameters<Parameters<ReturnType<TenantPrisma['for']>['$transaction']>[0]>[0],
    actor: Actor,
    lead: { id: string; tier: $Enums.LeadTier | null; score: number | null },
    scoreId: string | null,
    change: {
      kind: 'approve' | 'override';
      newTier: $Enums.LeadTier;
      newScore: number | null;
      note: string | null;
    },
  ): Promise<void> {
    await tx.feedback.create({
      data: {
        workspaceId: actor.workspaceId,
        leadId: lead.id,
        scoreId,
        userId: actor.userId,
        kind: change.kind,
        previousTier: lead.tier ?? null,
        previousScore: lead.score,
        newTier: change.newTier,
        newScore: change.newScore,
        note: change.note,
      },
    });
    await tx.leadEvent.create({
      data: {
        workspaceId: actor.workspaceId,
        leadId: lead.id,
        type: 'reviewed',
        actorUserId: actor.userId,
        payload: {
          action: change.kind,
          previousTier: lead.tier ?? null,
          tier: change.newTier,
          score: change.newScore,
        },
      },
    });
  }

  /**
   * Queues leads for the AI to rate again (after the ideal customer changed, or
   * after the budget was raised). A lead a person has overridden keeps their rating
   * (the scoring step sees to that), so it is skipped here to save the AI call.
   */
  async rescore(actor: Actor, body: RescoreRequest): Promise<RescoreResponse> {
    const db = this.tenant.for(actor.workspaceId);
    const where: Prisma.LeadWhereInput = {
      feedback: { none: { kind: 'override' } },
      ...(body.scope === 'without_ai'
        ? { status: 'NEEDS_REVIEW', scores: { some: { isFallback: true } } }
        : { status: { in: ['NEW', 'NEEDS_REVIEW', 'SCORED', 'FAILED'] } }),
    };
    const leads = await db.lead.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'desc' },
      take: RESCORE_BATCH,
    });
    for (const lead of leads) {
      await this.pipeline.enqueueLead({ workspaceId: actor.workspaceId, leadId: lead.id });
    }
    return { queued: leads.length };
  }
}
