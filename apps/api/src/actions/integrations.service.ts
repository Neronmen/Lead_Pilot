import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type CreateIntegrationRequest,
  ErrorCode,
  type Integration,
  type IntegrationWithSecret,
  ruleActionSchema,
  type TestIntegrationResponse,
  type UpdateIntegrationRequest,
} from '@leadpilot/shared';
import { z } from 'zod';
import { AuditAction, AuditService } from '../audit/audit.service';
import { DomainError } from '../common/errors/domain-error';
import { CryptoService } from '../crypto/crypto.service';
import type { Prisma } from '../generated/prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { newHmacSecret } from '../sources/api-key';
import { integrationAad } from './actions.service';
import { sendTest } from './delivery';
import { checkWebhookUrl, UrlNotAllowedError } from './net-guard';
import { ActionError, ActionTransport } from './transport';

export interface Actor {
  userId: string;
  workspaceId: string;
}

const notFound = () =>
  new DomainError(ErrorCode.NOT_FOUND, 'Integration not found', HttpStatus.NOT_FOUND);

const urlNotAllowed = () =>
  new DomainError(
    ErrorCode.URL_NOT_ALLOWED,
    'Use a public https address',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

type Row = Prisma.IntegrationGetPayload<object>;

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly crypto: CryptoService,
    private readonly transport: ActionTransport,
    private readonly audit: AuditService,
  ) {}

  /** Where it points, without anything secret. */
  private summaryOf(workspaceId: string, row: Row): string | null {
    try {
      const config = z
        .record(z.string(), z.unknown())
        .parse(JSON.parse(this.crypto.decrypt(row.configEnc, integrationAad(workspaceId, row.id))));
      const host = (value: unknown) => (typeof value === 'string' ? new URL(value).host : null);
      if (row.type === 'SLACK') return host(config.webhookUrl);
      if (row.type === 'WEBHOOK') return host(config.url);
      if (row.type === 'TELEGRAM')
        return typeof config.chatId === 'string' ? `chat ${config.chatId}` : null;
      return null;
    } catch {
      return null;
    }
  }

  private toIntegration(workspaceId: string, row: Row): Integration {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      enabled: row.enabled,
      status: row.status,
      lastError: row.lastError,
      lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
      summary: this.summaryOf(workspaceId, row),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(workspaceId: string): Promise<Integration[]> {
    const rows = await this.tenant
      .for(workspaceId)
      .integration.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((row) => this.toIntegration(workspaceId, row));
  }

  async create(actor: Actor, input: CreateIntegrationRequest): Promise<IntegrationWithSecret> {
    let config: Record<string, string>;
    let signingSecret: string | null = null;
    try {
      if (input.type === 'SLACK') {
        // Slack incoming webhooks live on one host only: anything else is not a Slack address.
        if (checkWebhookUrl(input.config.webhookUrl).hostname !== 'hooks.slack.com')
          throw new UrlNotAllowedError();
        config = { webhookUrl: input.config.webhookUrl };
      } else if (input.type === 'WEBHOOK') {
        checkWebhookUrl(input.config.url);
        signingSecret = newHmacSecret();
        config = { url: input.config.url, signingSecret };
      } else {
        config = { ...input.config };
      }
    } catch (error) {
      if (error instanceof UrlNotAllowedError) throw urlNotAllowed();
      throw error;
    }
    const id = randomUUID();
    const db = this.tenant.for(actor.workspaceId);
    const row = await db.$transaction(async (tx) => {
      const created = await tx.integration.create({
        data: {
          id,
          workspaceId: actor.workspaceId,
          type: input.type,
          name: input.name,
          configEnc: this.crypto.encrypt(
            JSON.stringify(config),
            integrationAad(actor.workspaceId, id),
          ),
        },
      });
      await this.audit.record(tx, actor.workspaceId, {
        actorUserId: actor.userId,
        area: 'integrations',
        action: AuditAction.IntegrationConnected,
        entityType: 'integration',
        entityId: id,
        after: { name: created.name, type: created.type },
      });
      return created;
    });
    return { ...this.toIntegration(actor.workspaceId, row), signingSecret };
  }

  async update(actor: Actor, id: string, input: UpdateIntegrationRequest): Promise<Integration> {
    const db = this.tenant.for(actor.workspaceId);
    const row = await db.$transaction(async (tx) => {
      const before = await tx.integration.findUnique({ where: { id } });
      if (!before) throw notFound();
      const changed = await tx.integration.update({
        where: { id },
        data: {
          name: input.name,
          enabled: input.enabled,
          // Switching it off shows as paused; switching it on goes back to connected until a run says otherwise.
          status: input.enabled === undefined ? undefined : input.enabled ? 'connected' : 'paused',
        },
      });
      await this.audit.record(tx, actor.workspaceId, {
        actorUserId: actor.userId,
        area: 'integrations',
        action: AuditAction.IntegrationUpdated,
        entityType: 'integration',
        entityId: id,
        before: { name: before.name, enabled: before.enabled },
        after: { name: changed.name, enabled: changed.enabled },
      });
      return changed;
    });
    return this.toIntegration(actor.workspaceId, row);
  }

  async remove(actor: Actor, id: string): Promise<void> {
    const db = this.tenant.for(actor.workspaceId);
    await db.$transaction(async (tx) => {
      const before = await tx.integration.findUnique({ where: { id } });
      if (!before) throw notFound();
      // A rule that still points here would fail every run: switch the integration off instead.
      const rules = await tx.routingRule.findMany({ select: { actions: true } });
      const used = rules.some((rule) =>
        z
          .array(ruleActionSchema)
          .safeParse(rule.actions)
          .data?.some((action) => 'integrationId' in action && action.integrationId === id),
      );
      if (used) {
        throw new DomainError(
          ErrorCode.INTEGRATION_IN_USE,
          'Rules still use this integration: remove it from them, or switch it off',
          HttpStatus.CONFLICT,
        );
      }
      // Past runs stay in the history, without the link.
      await tx.actionRun.updateMany({
        where: { integrationId: id },
        data: { integrationId: null },
      });
      await tx.integration.delete({ where: { id } });
      await this.audit.record(tx, actor.workspaceId, {
        actorUserId: actor.userId,
        area: 'integrations',
        action: AuditAction.IntegrationDeleted,
        entityType: 'integration',
        entityId: id,
        before: { name: before.name, type: before.type },
      });
    });
  }

  /** "Send test message". The result is also kept on the card (status, last error, when). */
  async test(actor: Actor, id: string): Promise<TestIntegrationResponse> {
    const db = this.tenant.for(actor.workspaceId);
    const row = await db.integration.findUnique({ where: { id } });
    if (!row) throw notFound();
    let error: string | null = null;
    try {
      const type = row.type.toLowerCase();
      if (type === 'email') throw new ActionError('bad_config'); // email has no separate connection
      const config: unknown = JSON.parse(
        this.crypto.decrypt(row.configEnc, integrationAad(actor.workspaceId, row.id)),
      );
      await sendTest(this.transport, type as 'slack' | 'telegram' | 'webhook' | 'hubspot', config);
    } catch (caught) {
      error = caught instanceof ActionError ? caught.code : 'bad_config';
    }
    await db.integration.update({
      where: { id },
      data: {
        lastTestedAt: new Date(),
        lastError: error,
        status: error ? 'needs_attention' : row.enabled ? 'connected' : 'paused',
      },
    });
    return { ok: error === null, error };
  }
}
