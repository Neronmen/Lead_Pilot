import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  type RescoreRequest,
  type RescoreResponse,
  type ReviewLeadRequest,
  type SetOutcomeRequest,
} from '@leadpilot/shared';
import { DomainError } from '../common/errors/domain-error';
import type { $Enums, Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { PipelineQueue } from '../queue/pipeline.queue';
import { RoutingRunner } from '../routing/routing.runner';

interface Actor {
  userId: string;
  workspaceId: string;
}

const RESCORE_BATCH = 1000;

/** A person checks the AI's rating (Review queue, Lead detail), or asks the AI to look again. */
@Injectable()
export class ReviewService {
  private readonly logger = new Logger(ReviewService.name);

  constructor(
    private readonly tenant: TenantPrisma,
    private readonly pipeline: PipelineQueue,
    private readonly routing: RoutingRunner,
  ) {}

  async review(actor: Actor, leadId: string, body: ReviewLeadRequest): Promise<void> {
    const db = this.tenant.for(actor.workspaceId);
    // A lead that was waiting for review is released by this decision: the routing rules start now.
    let released = false;
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
          data: { status: 'SCORED', reviewReason: null },
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
        released = true;
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
          reviewReason: null,
        },
      });
      await this.record(tx, actor, lead, latest?.id ?? null, {
        kind: 'override',
        newTier: body.tier,
        newScore,
        note: body.note ?? null,
      });
      released = lead.status === 'NEEDS_REVIEW';
    });
    if (released) {
      // Routing queues its sends and never throws into the request: the review is already saved.
      await this.routing
        .routeLead({ workspaceId: actor.workspaceId, leadId })
        .catch((error: Error) =>
          this.logger.error(`Routing after review failed: ${error.message}`),
        );
    }
  }

  /**
   * A rep records how the lead ended: Won, Lost, or Bad lead (not a real lead: it becomes Junk, as
   * a person's final rating). Kept with who and when. This is the real ground truth for later evals.
   */
  async setOutcome(actor: Actor, leadId: string, body: SetOutcomeRequest): Promise<void> {
    const db = this.tenant.for(actor.workspaceId);
    await db.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId } });
      if (!lead) throw new DomainError(ErrorCode.NOT_FOUND, 'Lead not found', HttpStatus.NOT_FOUND);
      if (lead.outcome === body.outcome) return; // nothing changes, nothing is recorded
      const cleared = body.outcome === 'NONE';
      await tx.lead.update({
        where: { id: leadId },
        data: {
          outcome: body.outcome,
          outcomeSetBy: cleared ? null : actor.userId,
          outcomeSetAt: cleared ? null : new Date(),
          ...(body.outcome === 'BAD'
            ? {
                tier: 'JUNK',
                status: lead.status === 'NEEDS_REVIEW' ? 'SCORED' : undefined,
                reviewReason: null,
              }
            : {}),
        },
      });
      if (body.outcome === 'BAD' && lead.tier !== 'JUNK') {
        const latest = await tx.score.findFirst({
          where: { leadId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        // The same correction as an override to Junk: the AI is measured against it, and a later
        // automatic score cannot undo it.
        await this.record(tx, actor, lead, latest?.id ?? null, {
          kind: 'override',
          newTier: 'JUNK',
          newScore: lead.score,
          note: 'Marked as a bad lead',
        });
      }
      await tx.leadEvent.create({
        data: {
          workspaceId: actor.workspaceId,
          leadId,
          type: 'outcome',
          actorUserId: actor.userId,
          payload: { outcome: body.outcome, previous: lead.outcome },
        },
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
        : { status: { in: ['NEW', 'PROCESSING', 'NEEDS_REVIEW', 'SCORED', 'FAILED'] } }),
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
