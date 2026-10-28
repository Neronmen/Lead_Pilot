import { Injectable } from '@nestjs/common';
import type { Overview } from '@leadpilot/shared';
import { TenantPrisma } from '../prisma/tenant-prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 5_000;

/** The median of numbers (the middle one, or the mean of the two middle ones). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Numbers for the Overview page (the page itself comes later): the last 30 days of this workspace. */
@Injectable()
export class OverviewService {
  constructor(private readonly tenant: TenantPrisma) {}

  async get(workspaceId: string, now: Date = new Date()): Promise<Overview> {
    const db = this.tenant.for(workspaceId);
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const where = { createdAt: { gte: since } };
    const [byTier, byInfo, firstScores] = await Promise.all([
      db.lead.groupBy({ by: ['tier'], where, _count: { _all: true } }),
      db.lead.groupBy({
        by: ['infoLevel'],
        where: { ...where, infoLevel: { not: null } },
        _count: { _all: true },
      }),
      // The first score of each lead (distinct keeps the first row per lead in this order).
      db.score.findMany({
        where: { lead: where },
        orderBy: [{ createdAt: 'asc' }],
        distinct: ['leadId'],
        select: { createdAt: true, lead: { select: { createdAt: true } } },
        take: MAX_ROWS,
      }),
    ]);
    const tiers = { HOT: 0, WARM: 0, COLD: 0, JUNK: 0 };
    let leads = 0;
    let rated = 0;
    for (const row of byTier) {
      leads += row._count._all;
      if (row.tier) {
        tiers[row.tier] += row._count._all;
        rated += row._count._all;
      }
    }
    const levels = { limited: 0, enough: 0, rich: 0 };
    for (const row of byInfo) {
      if (row.infoLevel === 'limited' || row.infoLevel === 'enough' || row.infoLevel === 'rich') {
        levels[row.infoLevel] += row._count._all;
      }
    }
    const waits = firstScores.map((s) =>
      Math.max(0, (s.createdAt.getTime() - s.lead.createdAt.getTime()) / 1000),
    );
    return {
      leads,
      rated,
      junkPercent: rated === 0 ? null : Math.round((tiers.JUNK / rated) * 1000) / 10,
      medianSecondsToFirstRating: median(waits),
      byTier: tiers,
      byInfoLevel: levels,
    };
  }
}
