import { HttpStatus, Injectable } from '@nestjs/common';
import {
  conditionGroupSchema,
  type CreateRoutingRuleRequest,
  ErrorCode,
  type ReorderRoutingRulesRequest,
  type RoutingRule,
  ruleActionSchema,
  type RuleAction,
  type TestRoutingResponse,
  type SampleLead,
  type UpdateRoutingRuleRequest,
} from '@leadpilot/shared';
import { z } from 'zod';
import { AuditAction, AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors/domain-error';
import type { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { type EngineRule, evaluateRules, type LeadFacts } from './engine';

export interface Actor {
  userId: string;
  workspaceId: string;
}

const notFound = () => new DomainError(ErrorCode.NOT_FOUND, 'Rule not found', HttpStatus.NOT_FOUND);

const badReference = () =>
  new DomainError(
    ErrorCode.RULE_REFERENCE_INVALID,
    'A rule points at an integration, person or team that is not in this workspace',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

type RuleRow = Prisma.RoutingRuleGetPayload<object>;

const rowSchema = z.object({
  conditions: conditionGroupSchema,
  actions: z.array(ruleActionSchema),
});

/** Rules are validated when written; a stored row that no longer parses is skipped, never crashes routing. */
export function toEngineRule(row: RuleRow): EngineRule | null {
  const parsed = rowSchema.safeParse({ conditions: row.conditions, actions: row.actions });
  if (!parsed.success) return null;
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    alwaysRun: row.alwaysRun,
    ...parsed.data,
  };
}

function toRule(row: RuleRow): RoutingRule {
  const parsed = rowSchema.parse({ conditions: row.conditions, actions: row.actions });
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    ...parsed,
    enabled: row.enabled,
    alwaysRun: row.alwaysRun,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Flat values for the change history: never the whole rule body. */
const summary = (row: RuleRow, actionCount: number) => ({
  name: row.name,
  enabled: row.enabled,
  alwaysRun: row.alwaysRun,
  actions: actionCount,
});

@Injectable()
export class RoutingService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(workspaceId: string): Promise<RoutingRule[]> {
    const rows = await this.tenant
      .for(workspaceId)
      .routingRule.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toRule);
  }

  /** Every rule in order, ready for the engine. */
  async engineRules(workspaceId: string): Promise<EngineRule[]> {
    const rows = await this.tenant
      .for(workspaceId)
      .routingRule.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    return rows.flatMap((row) => toEngineRule(row) ?? []);
  }

  /**
   * An action may only point at things of this workspace. The database enforces it for
   * leads and runs (composite keys); the rule body is JSON, so the check is here.
   */
  private async checkReferences(workspaceId: string, actions: RuleAction[]): Promise<void> {
    const db = this.tenant.for(workspaceId);
    const integrationIds = new Set<string>();
    const userIds = new Set<string>();
    const teamIds = new Set<string>();
    for (const action of actions) {
      if ('integrationId' in action) integrationIds.add(action.integrationId);
      if (action.type === 'assign') {
        if (action.to.kind === 'user') userIds.add(action.to.userId);
        else teamIds.add(action.to.teamId);
      }
    }
    if (integrationIds.size > 0) {
      const found = await db.integration.findMany({
        where: { id: { in: [...integrationIds] } },
        select: { id: true, type: true },
      });
      if (found.length !== integrationIds.size) throw badReference();
      const typeOf = new Map(found.map((row) => [row.id, row.type]));
      for (const action of actions) {
        // A Slack action must use a Slack integration, and so on.
        if (
          'integrationId' in action &&
          typeOf.get(action.integrationId) !== action.type.toUpperCase()
        ) {
          throw badReference();
        }
      }
    }
    if (userIds.size > 0) {
      const count = await db.membership.count({ where: { userId: { in: [...userIds] } } });
      if (count !== userIds.size) throw badReference();
    }
    if (teamIds.size > 0) {
      const count = await db.team.count({ where: { id: { in: [...teamIds] } } });
      if (count !== teamIds.size) throw badReference();
    }
  }

  async create(actor: Actor, input: CreateRoutingRuleRequest): Promise<RoutingRule> {
    await this.checkReferences(actor.workspaceId, input.actions);
    const db = this.tenant.for(actor.workspaceId);
    const row = await db.$transaction(async (tx) => {
      const last = await tx.routingRule.findFirst({
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      const created = await tx.routingRule.create({
        data: {
          workspaceId: actor.workspaceId,
          name: input.name,
          order: (last?.order ?? 0) + 1,
          conditions: input.conditions,
          actions: input.actions,
          enabled: input.enabled,
          alwaysRun: input.alwaysRun,
        },
      });
      await this.audit.record(tx, actor.workspaceId, {
        actorUserId: actor.userId,
        area: 'rules',
        action: AuditAction.RuleCreated,
        entityType: 'rule',
        entityId: created.id,
        after: summary(created, input.actions.length),
      });
      return created;
    });
    return toRule(row);
  }

  async update(actor: Actor, id: string, input: UpdateRoutingRuleRequest): Promise<RoutingRule> {
    if (input.actions) await this.checkReferences(actor.workspaceId, input.actions);
    const db = this.tenant.for(actor.workspaceId);
    const row = await db.$transaction(async (tx) => {
      const before = await tx.routingRule.findUnique({ where: { id } });
      if (!before) throw notFound();
      const changed = await tx.routingRule.update({
        where: { id },
        data: {
          name: input.name,
          conditions: input.conditions,
          actions: input.actions,
          enabled: input.enabled,
          alwaysRun: input.alwaysRun,
        },
      });
      await this.audit.record(tx, actor.workspaceId, {
        actorUserId: actor.userId,
        area: 'rules',
        action: AuditAction.RuleUpdated,
        entityType: 'rule',
        entityId: id,
        before: summary(before, Array.isArray(before.actions) ? before.actions.length : 0),
        after: summary(
          changed,
          input.actions?.length ?? (Array.isArray(changed.actions) ? changed.actions.length : 0),
        ),
      });
      return changed;
    });
    return toRule(row);
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const db = this.tenant.for(actor.workspaceId);
    await db.$transaction(async (tx) => {
      const before = await tx.routingRule.findUnique({ where: { id } });
      if (!before) throw notFound();
      // Past action runs keep a null rule (their history stays); the FK is NoAction, so detach first.
      await tx.actionRun.updateMany({ where: { ruleId: id }, data: { ruleId: null } });
      await tx.routingRule.delete({ where: { id } });
      await this.audit.record(tx, actor.workspaceId, {
        actorUserId: actor.userId,
        area: 'rules',
        action: AuditAction.RuleDeleted,
        entityType: 'rule',
        entityId: id,
        before: summary(before, Array.isArray(before.actions) ? before.actions.length : 0),
      });
    });
  }

  /** The new order: every rule id exactly once. */
  async reorder(actor: Actor, input: ReorderRoutingRulesRequest): Promise<RoutingRule[]> {
    const db = this.tenant.for(actor.workspaceId);
    await db.$transaction(async (tx) => {
      const existing = await tx.routingRule.findMany({ select: { id: true } });
      const wanted = new Set(input.ids);
      if (
        wanted.size !== input.ids.length ||
        existing.length !== wanted.size ||
        existing.some((row) => !wanted.has(row.id))
      ) {
        throw new DomainError(
          ErrorCode.RULE_ORDER_INVALID,
          'List every rule exactly once',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      for (const [index, id] of input.ids.entries()) {
        await tx.routingRule.update({ where: { id }, data: { order: index + 1 } });
      }
      await this.audit.record(tx, actor.workspaceId, {
        actorUserId: actor.userId,
        area: 'rules',
        action: AuditAction.RulesReordered,
        entityType: 'rule',
        after: { rules: input.ids.length },
      });
    });
    return this.list(actor.workspaceId);
  }

  /** Dry run: which rule would decide for this sample lead, and why. Sends and saves nothing. */
  async test(workspaceId: string, lead: SampleLead): Promise<TestRoutingResponse> {
    const rules = await this.engineRules(workspaceId);
    const facts: LeadFacts = {
      score: lead.score,
      tier: lead.tier,
      country: lead.country,
      sourceId: lead.sourceId,
      industry: lead.industry,
      isFreeMail: lead.isFreeMail,
      customFields: lead.customFields,
    };
    return { ...evaluateRules(rules, facts), dryRun: true };
  }
}
