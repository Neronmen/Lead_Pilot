import { Injectable } from '@nestjs/common';
import type { IcpRubric, IcpRubricResponse } from '@leadpilot/shared';
import { AuditAction, AuditService } from '../audit/audit.service';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

export const EMPTY_RUBRIC: IcpRubric = {
  industries: [],
  companySizes: [],
  countries: [],
  budgetSignals: [],
  disqualifiers: [],
  notes: null,
};

interface Actor {
  userId: string;
  workspaceId: string;
}

/** A flat, short text for the change history (lists joined, long text cut). */
const flat = (value: string | string[] | null): string | null =>
  value === null ? null : (Array.isArray(value) ? value.join(', ') : value).slice(0, 500);

/** The workspace's ideal customer (Settings > Ideal customer): the yardstick the AI scores against. */
@Injectable()
export class RubricService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async get(workspaceId: string): Promise<IcpRubricResponse> {
    const row = await this.tenant.for(workspaceId).icpRubric.findFirst();
    return row ? toResponse(row) : { ...EMPTY_RUBRIC, updatedAt: null };
  }

  async save(actor: Actor, input: IcpRubric): Promise<IcpRubricResponse> {
    const db = this.tenant.for(actor.workspaceId);
    return db.$transaction(async (tx) => {
      const before = await tx.icpRubric.findFirst();
      const data = { ...input };
      const row = before
        ? await tx.icpRubric.update({ where: { id: before.id }, data })
        : await tx.icpRubric.create({ data: { ...data, workspaceId: actor.workspaceId } });
      const changed = (Object.keys(input) as (keyof IcpRubric)[]).filter(
        (key) => JSON.stringify(before?.[key] ?? EMPTY_RUBRIC[key]) !== JSON.stringify(input[key]),
      );
      if (changed.length > 0) {
        await this.audit.record(tx, actor.workspaceId, {
          actorUserId: actor.userId,
          area: 'ideal_customer',
          action: AuditAction.IdealCustomerUpdated,
          entityType: 'icp_rubric',
          entityId: row.id,
          before: Object.fromEntries(
            changed.map((key) => [key, flat(before?.[key] ?? EMPTY_RUBRIC[key])]),
          ),
          after: Object.fromEntries(changed.map((key) => [key, flat(input[key])])),
        });
      }
      return toResponse(row);
    });
  }
}

function toResponse(row: {
  industries: string[];
  companySizes: string[];
  countries: string[];
  budgetSignals: string[];
  disqualifiers: string[];
  notes: string | null;
  updatedAt: Date;
}): IcpRubricResponse {
  return {
    industries: row.industries,
    companySizes: row.companySizes,
    countries: row.countries,
    budgetSignals: row.budgetSignals,
    disqualifiers: row.disqualifiers,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}
