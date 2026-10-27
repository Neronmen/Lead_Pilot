import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ENRICHMENT_PROVIDER,
  type EnrichmentData,
  type EnrichmentProvider,
} from './enrichment.provider';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A page we could read is reused for a week (SPEC §4.3). */
export const ENRICHMENT_TTL_MS = 7 * DAY_MS;
/** A page we could not read is not tried again for a day. */
export const UNREACHABLE_TTL_MS = DAY_MS;

export interface Enriched {
  data: EnrichmentData;
  provider: string;
  cached: boolean;
}

/**
 * Company info by domain, cached for everyone. The cache holds only what is
 * public on a company's own website, never anything about a lead, so it is one
 * global table (not per workspace) and is read through the raw client
 * (allowlisted in eslint.config.mjs for this file).
 */
@Injectable()
export class EnrichmentService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENRICHMENT_PROVIDER) private readonly provider: EnrichmentProvider,
  ) {}

  async forDomain(domain: string, now: Date = new Date()): Promise<Enriched> {
    const hit = await this.prisma.enrichment.findUnique({ where: { domain } });
    if (hit && hit.expiresAt > now && hit.provider === this.provider.name) {
      return { data: hit.data as unknown as EnrichmentData, provider: hit.provider, cached: true };
    }
    const data = await this.provider.enrich(domain);
    const expiresAt = new Date(
      now.getTime() + (data.status === 'ok' ? ENRICHMENT_TTL_MS : UNREACHABLE_TTL_MS),
    );
    const json = data as unknown as Prisma.InputJsonObject;
    await this.prisma.enrichment.upsert({
      where: { domain },
      create: { domain, provider: this.provider.name, data: json, fetchedAt: now, expiresAt },
      update: { provider: this.provider.name, data: json, fetchedAt: now, expiresAt },
    });
    return { data, provider: this.provider.name, cached: false };
  }
}
