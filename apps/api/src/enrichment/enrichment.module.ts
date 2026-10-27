import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PipelineService } from '../pipeline/pipeline.service';
import { TenantPrisma } from '../prisma/tenant-prisma.service';
import { ENRICHMENT_PROVIDER, type EnrichmentProvider } from './enrichment.provider';
import { EnrichmentService } from './enrichment.service';
import { MockEnrichmentProvider } from './mock-enrichment.provider';
import { WebsiteMetaProvider } from './website-meta.provider';

@Module({
  imports: [PipelineModule],
  providers: [
    {
      provide: ENRICHMENT_PROVIDER,
      inject: [ConfigService],
      // The mock is the default: the demo and the tests need no network.
      useFactory: (config: ConfigService<Env, true>): EnrichmentProvider =>
        config.get('ENRICHMENT_PROVIDER', { infer: true }) === 'website'
          ? new WebsiteMetaProvider()
          : new MockEnrichmentProvider(),
    },
    EnrichmentService,
  ],
  exports: [EnrichmentService],
})
export class EnrichmentModule implements OnModuleInit {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly enrichment: EnrichmentService,
    private readonly tenant: TenantPrisma,
  ) {}

  /** Step 1 of the lead pipeline: look up the company behind the lead's domain. */
  onModuleInit(): void {
    this.pipeline.register(async ({ workspaceId, leadId }) => {
      const db = this.tenant.for(workspaceId);
      // Scoped to the job's workspace: a lead id from another workspace finds nothing.
      const lead = await db.lead.findUnique({ where: { id: leadId }, select: { domain: true } });
      // No domain: a free-mail address or no website was given. Nothing to look up.
      if (!lead?.domain) return;
      const found = await this.enrichment.forDomain(lead.domain);
      await db.leadEvent.create({
        data: {
          workspaceId,
          leadId,
          type: 'enriched',
          payload: {
            domain: lead.domain,
            provider: found.provider,
            status: found.data.status,
            cached: found.cached,
          },
        },
      });
    });
  }
}
