import { Injectable, Logger } from '@nestjs/common';
import type { RuleAction } from '@leadpilot/shared';
import { ActionsService } from '../actions/actions.service';
import type { Prisma } from '../generated/prisma/client';
import type { ProcessLeadJob } from '../queue/pipeline.queue';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { evaluateRules, type LeadFacts } from './engine';
import { RoutingService } from './routing.service';

type Db = ReturnType<TenantPrisma['for']>;

/** What makes an action the same action: its type and its target (not its position in the rule). */
function actionIdentity(action: RuleAction): string {
  switch (action.type) {
    case 'assign':
      return `assign-${action.to.kind === 'user' ? action.to.userId : action.to.teamId}`;
    case 'tag':
      return `tag-${action.tag}`;
    case 'email':
      return `email-${action.to}`;
    default:
      return `${action.type}-${action.integrationId}`;
  }
}

const isCode = (error: unknown, code: string) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === code;

/** Custom fields are stored as JSON: keep only plain values the engine can compare. */
function plainFields(value: unknown): Record<string, string | number | boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string | number | boolean] =>
      ['string', 'number', 'boolean'].includes(typeof entry[1]),
    ),
  );
}

/**
 * Step 3 of the pipeline (after enrichment and scoring): the rules decide what happens to a rated
 * lead. Assigning an owner and adding a tag are database changes and happen here, at once; sending
 * to Slack, email, a webhook or HubSpot is queued (one ActionRun each), so a slow or broken service
 * never holds up the pipeline.
 *
 * Idempotent: each run has a key made of lead + rule + position, and the key is unique in the
 * database. Routing the same lead twice (a retry, or an approval after a re-score) creates no second
 * run, so no second Slack message and no second email.
 */
@Injectable()
export class RoutingRunner {
  private readonly logger = new Logger(RoutingRunner.name);

  constructor(
    private readonly tenant: TenantPrisma,
    private readonly routing: RoutingService,
    private readonly actions: ActionsService,
  ) {}

  async routeLead({ workspaceId, leadId }: ProcessLeadJob): Promise<void> {
    const db = this.tenant.for(workspaceId);
    const lead = await db.lead.findUnique({ where: { id: leadId } });
    // A lead that is not rated yet, or is waiting for a person to check the rating, is not acted on:
    // routing starts after the review (the review service calls this again).
    if (!lead || lead.tier === null || lead.status === 'NEEDS_REVIEW' || lead.status === 'FAILED')
      return;

    const facts: LeadFacts = {
      score: lead.score,
      tier: lead.tier,
      country: lead.country,
      sourceId: lead.sourceId,
      industry:
        typeof (lead.customFields as Record<string, unknown>)?.industry === 'string'
          ? ((lead.customFields as Record<string, string>).industry ?? null)
          : null,
      isFreeMail: lead.isFreeMail,
      customFields: plainFields(lead.customFields),
    };
    const { verdicts } = evaluateRules(await this.routing.engineRules(workspaceId), facts);
    const fired = verdicts.filter((v) => v.skipped === null && v.matched);
    if (fired.length === 0) return;

    // Assigning first, across every rule that fired, so an "email the owner" action (in this rule
    // or an "always run" one before it) finds the owner.
    const todo = fired
      .flatMap((verdict) => verdict.actions.map((action) => ({ verdict, action })))
      .sort((a, b) => Number(b.action.type === 'assign') - Number(a.action.type === 'assign'));
    let started = 0;
    for (const { verdict, action } of todo) {
      const run = await this.createRun(db, workspaceId, leadId, verdict.ruleId, action);
      if (!run) continue; // already routed by this rule (or already done)
      started += 1;
      if (action.type === 'assign' || action.type === 'tag') {
        await this.runLocal(db, workspaceId, leadId, run.id, action);
      } else {
        await this.actions.enqueue(workspaceId, run);
      }
    }
    if (started === 0) return; // a second routing of the same lead: nothing new, nothing to record

    await db.lead.updateMany({
      where: { id: leadId, status: 'SCORED' },
      data: { status: 'ROUTED' },
    });
    await db.leadEvent.create({
      data: {
        workspaceId,
        leadId,
        type: 'routed',
        payload: {
          rules: fired.map((v) => v.ruleId),
          decidedBy: verdicts.find((v) => v.matched && v.skipped === null)?.ruleId ?? null,
        },
      },
    });
  }

  /**
   * The run row to work on, or null when this action was already done for this lead. The key is the
   * lead + rule + what the action is (not its position, so editing a rule does not reshuffle keys) and
   * is unique in the database. A row still PENDING (the process stopped, or Redis was down, before it
   * ran) is handed back so it is finished now instead of waiting for ever.
   */
  private async createRun(
    db: Db,
    workspaceId: string,
    leadId: string,
    ruleId: string,
    action: RuleAction,
  ): Promise<{ id: string; jobKey: string } | null> {
    const jobKey = `${leadId}-${ruleId}-${actionIdentity(action)}`;
    try {
      return await db.actionRun.create({
        data: {
          workspaceId,
          leadId,
          ruleId,
          integrationId: 'integrationId' in action ? action.integrationId : null,
          type: action.type,
          jobKey,
          payload: action as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, jobKey: true },
      });
    } catch (error) {
      if (!isCode(error, 'P2002')) throw error;
      const existing = await db.actionRun.findUnique({
        where: { jobKey },
        select: { id: true, jobKey: true, status: true },
      });
      return existing?.status === 'PENDING' ? { id: existing.id, jobKey: existing.jobKey } : null;
    }
  }

  private async runLocal(
    db: Db,
    workspaceId: string,
    leadId: string,
    runId: string,
    action: RuleAction,
  ): Promise<void> {
    let error: string | null = null;
    try {
      if (action.type === 'assign') await this.assign(db, workspaceId, leadId, action);
      else if (action.type === 'tag') await this.tag(db, leadId, action.tag);
    } catch (caught) {
      error = isCode(caught, 'P2003') ? 'member_gone' : 'internal';
      if (error === 'internal')
        this.logger.error(`Local action ${runId} failed: ${(caught as Error).message}`);
    }
    await db.actionRun.update({
      where: { id: runId },
      data: {
        status: error ? 'DEAD' : 'SUCCEEDED',
        attempts: 1,
        lastError: error,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });
  }

  private async tag(db: Db, leadId: string, tag: string): Promise<void> {
    const lead = await db.lead.findUnique({ where: { id: leadId }, select: { tags: true } });
    if (!lead || lead.tags.includes(tag)) return;
    await db.lead.update({ where: { id: leadId }, data: { tags: [...lead.tags, tag] } });
  }

  /**
   * Gives the lead an owner, only if it has none (a person's own choice is never taken back by a
   * rule). A team hands it to the member who was given a lead longest ago (round-robin); the
   * compare-and-set on `lastAssignedAt` makes two leads arriving together pick different people.
   */
  private async assign(
    db: Db,
    workspaceId: string,
    leadId: string,
    action: Extract<RuleAction, { type: 'assign' }>,
  ): Promise<void> {
    // A lead that already has an owner is left alone, and the team's turn is not used up for it.
    const current = await db.lead.findUnique({ where: { id: leadId }, select: { ownerId: true } });
    if (!current || current.ownerId !== null) return;
    const userId =
      action.to.kind === 'user' ? action.to.userId : await this.nextInTeam(db, action.to.teamId);
    // ownerId is checked in the where too (another run may have won meanwhile).
    // The composite foreign key to Membership fails (P2003) if the person has just been removed.
    const { count } = await db.lead.updateMany({
      where: { id: leadId, ownerId: null },
      data: { ownerId: userId },
    });
    if (count !== 1) return;
    await db.leadEvent.create({
      data: { workspaceId, leadId, type: 'assigned', payload: { userId, by: 'routing_rule' } },
    });
  }

  private async nextInTeam(db: Db, teamId: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const members = await db.teamMember.findMany({
        where: { teamId },
        orderBy: [{ lastAssignedAt: { sort: 'asc', nulls: 'first' } }, { membershipId: 'asc' }],
        take: 1,
        select: {
          membershipId: true,
          lastAssignedAt: true,
          membership: { select: { userId: true } },
        },
      });
      const next = members[0];
      if (!next) throw Object.assign(new Error('empty team'), { code: 'P2003' });
      const { count } = await db.teamMember.updateMany({
        where: { teamId, membershipId: next.membershipId, lastAssignedAt: next.lastAssignedAt },
        data: { lastAssignedAt: new Date() },
      });
      if (count === 1) return next.membership.userId;
    }
    throw new Error('team busy');
  }
}
