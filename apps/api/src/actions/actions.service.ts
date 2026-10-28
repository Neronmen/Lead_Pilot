import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnrecoverableError } from 'bullmq';
import {
  type ActionRun,
  ErrorCode,
  type ListActionsQuery,
  ruleActionSchema,
} from '@leadpilot/shared';
import { DomainError } from '../common/errors/domain-error';
import type { Env } from '../config/env.schema';
import { CryptoService } from '../crypto/crypto.service';
import { buildHotLeadEmail } from '../email/hot-lead-email';
import { EMAIL_PROVIDER, type EmailProvider } from '../email/email.provider';
import type { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { type ActionExecutor, type ActionJob, ActionsQueue } from './actions.queue';
import {
  deliverHubspot,
  deliverSlack,
  deliverTelegram,
  deliverWebhook,
  type Delivered,
  type RoutedLead,
} from './delivery';
import { ActionError, ActionTransport } from './transport';

/** Binds an integration's secrets to its row: copied onto another row they no longer decrypt. */
export const integrationAad = (workspaceId: string, integrationId: string) =>
  `integration:${workspaceId}:${integrationId}`;

/** A failure that another try cannot fix: the run is marked DEAD at once and the queue does not retry. */
const PERMANENT = new Set([
  'bad_config',
  'url_not_allowed',
  'no_integration',
  'integration_disabled',
  'no_email',
  'no_recipient',
  'lead_gone',
  'http_400',
  'http_401',
  'http_403',
  'http_404',
]);

/** Failures that say something about the integration itself (not about this lead or this recipient). */
const blamesIntegration = (code: string) =>
  code.startsWith('http_') ||
  ['timeout', 'network', 'redirect', 'url_not_allowed', 'bad_config'].includes(code);

type RunRow = Prisma.ActionRunGetPayload<{ include: { integration: true } }>;

@Injectable()
export class ActionsService implements ActionExecutor, OnModuleInit {
  private readonly logger = new Logger(ActionsService.name);

  constructor(
    private readonly tenant: TenantPrisma,
    private readonly queue: ActionsQueue,
    private readonly transport: ActionTransport,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  onModuleInit(): void {
    this.queue.setExecutor(this);
  }

  /** Queue a run that has just been saved. */
  async enqueue(workspaceId: string, run: { id: string; jobKey: string }): Promise<void> {
    await this.queue.enqueue({ workspaceId, runId: run.id, jobKey: run.jobKey });
  }

  /**
   * One try at one run. Idempotent: a run that already succeeded is not sent again (a retried or
   * duplicated job is harmless). A temporary failure throws so the queue tries again later; the last
   * try, or a failure that cannot be fixed by waiting, leaves the run DEAD for a person to look at.
   */
  async execute(job: ActionJob, finalTry: boolean): Promise<void> {
    const db = this.tenant.for(job.workspaceId);
    const run = await db.actionRun.findUnique({
      where: { id: job.runId },
      include: { integration: true },
    });
    if (!run || run.status === 'SUCCEEDED') return;
    await db.actionRun.update({
      where: { id: run.id },
      data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date() },
    });
    try {
      const delivered = await this.perform(job.workspaceId, run);
      // Recorded first and on its own: the message is out, so nothing after this may make a retry resend it.
      await db.actionRun.update({
        where: { id: run.id },
        data: { status: 'SUCCEEDED', lastError: null, finishedAt: new Date() },
      });
      await this.afterSuccess(job.workspaceId, run, delivered).catch((error: Error) =>
        this.logger.warn(`Bookkeeping after action ${run.id} failed: ${error.message}`),
      );
      return;
    } catch (error) {
      await this.afterFailure(job, run, error, finalTry);
    }
  }

  private async afterSuccess(
    workspaceId: string,
    run: RunRow,
    delivered: Delivered,
  ): Promise<void> {
    const db = this.tenant.for(workspaceId);
    {
      if (run.integrationId) {
        await db.integration.update({
          where: { id: run.integrationId },
          data: { status: 'connected', lastError: null },
        });
      }
      if (delivered.externalId && run.type === 'hubspot') {
        const lead = await db.lead.findUnique({
          where: { id: run.leadId },
          select: { externalIds: true },
        });
        const ids = (lead?.externalIds ?? {}) as Record<string, string>;
        await db.lead.update({
          where: { id: run.leadId },
          data: { externalIds: { ...ids, hubspot: delivered.externalId } },
        });
      }
    }
  }

  private async afterFailure(
    job: ActionJob,
    run: RunRow,
    error: unknown,
    finalTry: boolean,
  ): Promise<never> {
    const db = this.tenant.for(job.workspaceId);
    {
      const code = error instanceof ActionError ? error.code : 'internal';
      if (!(error instanceof ActionError))
        this.logger.error(`Action ${run.id} crashed: ${(error as Error).message}`);
      const dead = finalTry || PERMANENT.has(code);
      await db.actionRun.update({
        where: { id: run.id },
        data: {
          status: dead ? 'DEAD' : 'FAILED',
          lastError: code,
          finishedAt: dead ? new Date() : null,
        },
      });
      // A paused integration or a missing recipient is not the integration's fault: leave its status alone.
      if (dead && run.integrationId && blamesIntegration(code)) {
        await db.integration.update({
          where: { id: run.integrationId },
          data: { status: 'needs_attention', lastError: code },
        });
      }
      // UnrecoverableError: the queue gives up now instead of waiting for the next try.
      throw PERMANENT.has(code) ? new UnrecoverableError(code) : error;
    }
  }

  private async perform(workspaceId: string, run: RunRow): Promise<Delivered> {
    const lead = await this.routedLead(workspaceId, run.leadId);
    if (run.type === 'email') return this.sendEmail(workspaceId, run, lead);
    const integration = run.integration;
    if (!integration) throw new ActionError('no_integration');
    if (!integration.enabled) throw new ActionError('integration_disabled');
    let config: unknown;
    try {
      config = JSON.parse(
        this.crypto.decrypt(integration.configEnc, integrationAad(workspaceId, integration.id)),
      );
    } catch {
      throw new ActionError('bad_config');
    }
    switch (run.type) {
      case 'slack':
        return deliverSlack(this.transport, config, lead);
      case 'telegram':
        return deliverTelegram(this.transport, config, lead);
      case 'webhook':
        return deliverWebhook(this.transport, config, lead, new Date(), run.id);
      case 'hubspot':
        return deliverHubspot(this.transport, config, lead);
      default:
        throw new ActionError('bad_config');
    }
  }

  /** The "New Hot lead" alert to the owner, or to every Owner and Admin. */
  private async sendEmail(workspaceId: string, run: RunRow, lead: RoutedLead): Promise<Delivered> {
    const db = this.tenant.for(workspaceId);
    // `sent` is progress kept on the run: a retry skips the people who already got the email.
    const { sent: sentRaw, ...actionPayload } = (run.payload ?? {}) as Record<string, unknown>;
    const already = new Set(
      Array.isArray(sentRaw) ? sentRaw.filter((e): e is string => typeof e === 'string') : [],
    );
    const action = ruleActionSchema.safeParse(actionPayload);
    if (!action.success || action.data.type !== 'email') throw new ActionError('bad_config');
    const [workspace, row] = await Promise.all([
      db.workspace.findFirstOrThrow({ select: { name: true, defaultLocale: true } }),
      db.lead.findUnique({ where: { id: run.leadId }, select: { ownerId: true } }),
    ]);
    const members = await db.membership.findMany({
      where:
        action.data.to === 'owner'
          ? { userId: row?.ownerId ?? '00000000-0000-0000-0000-000000000000' }
          : { role: { in: ['OWNER', 'ADMIN'] } },
      select: { user: { select: { email: true, locale: true } } },
    });
    if (members.length === 0) throw new ActionError('no_recipient');
    let failed = false;
    for (const { user } of members) {
      if (already.has(user.email)) continue;
      try {
        await this.email.send(
          await buildHotLeadEmail({
            to: user.email,
            locale: user.locale ?? workspace.defaultLocale,
            leadName: lead.name,
            company: lead.company,
            score: lead.score,
            reasons: lead.reasons,
            link: lead.link,
            workspaceName: workspace.name,
            webOrigin: this.config.get('WEB_ORIGIN', { infer: true }),
          }),
        );
        already.add(user.email);
        await db.actionRun.update({
          where: { id: run.id },
          data: { payload: { ...actionPayload, sent: [...already] } },
        });
      } catch {
        failed = true;
      }
    }
    if (failed) throw new ActionError('email_failed');
    return {};
  }

  private async routedLead(workspaceId: string, leadId: string): Promise<RoutedLead> {
    const db = this.tenant.for(workspaceId);
    const lead = await db.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new ActionError('lead_gone');
    const score = await db.score.findFirst({ where: { leadId }, orderBy: { createdAt: 'desc' } });
    const reasons = Array.isArray((score?.output as { reasons?: unknown } | null)?.reasons)
      ? ((score?.output as { reasons: unknown[] }).reasons.filter(
          (r) => typeof r === 'string',
        ) as string[])
      : [];
    const name =
      [lead.firstName, lead.lastName].filter(Boolean).join(' ') ||
      lead.email ||
      lead.company ||
      'New lead';
    const origin = this.config.get('WEB_ORIGIN', { infer: true }).replace(/\/$/, '');
    return {
      id: lead.id,
      name,
      email: lead.email,
      phone: lead.phone,
      company: lead.company,
      country: lead.country,
      jobTitle: lead.jobTitle,
      tier: lead.tier,
      score: lead.score,
      reasons,
      link: `${origin}/leads/${lead.id}`,
    };
  }

  async list(workspaceId: string, query: ListActionsQuery): Promise<ActionRun[]> {
    const rows = await this.tenant.for(workspaceId).actionRun.findMany({
      where: { status: query.status, leadId: query.leadId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      leadId: row.leadId,
      ruleId: row.ruleId,
      integrationId: row.integrationId,
      type: row.type,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    }));
  }

  /** "Retry" in the UI: a failed or dead run goes back in the queue with fresh tries. */
  async retry(workspaceId: string, id: string): Promise<void> {
    const db = this.tenant.for(workspaceId);
    const run = await db.actionRun.findUnique({ where: { id } });
    if (!run) throw new DomainError(ErrorCode.NOT_FOUND, 'Action not found', HttpStatus.NOT_FOUND);
    if (run.status !== 'FAILED' && run.status !== 'DEAD') {
      throw new DomainError(
        ErrorCode.CONFLICT,
        'Only a failed action can be retried',
        HttpStatus.CONFLICT,
      );
    }
    await db.actionRun.update({
      where: { id },
      data: { status: 'PENDING', lastError: null, finishedAt: null },
    });
    await this.enqueue(workspaceId, run);
  }
}
