import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PipelineService } from '../pipeline/pipeline.service';
import { LLM_PROVIDER, type LlmProvider } from './llm.provider';
import { chooseLlm } from './llm.factory';
import { PromptService } from './prompt.service';
import { RubricController } from './rubric.controller';
import { RubricService } from './rubric.service';
import { ScoringService } from './scoring.service';

@Module({
  imports: [PipelineModule, EnrichmentModule],
  controllers: [RubricController],
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmProvider =>
        chooseLlm({
          LLM_PROVIDER: config.get('LLM_PROVIDER', { infer: true }),
          LLM_MODEL: config.get('LLM_MODEL', { infer: true }),
          ANTHROPIC_API_KEY: config.get('ANTHROPIC_API_KEY', { infer: true }),
          OPENAI_API_KEY: config.get('OPENAI_API_KEY', { infer: true }),
        }),
    },
    RubricService,
    PromptService,
    ScoringService,
  ],
  exports: [RubricService, ScoringService],
})
export class ScoringModule implements OnModuleInit {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly scoring: ScoringService,
  ) {}

  /** Step 2 of the lead pipeline (after enrichment), and what to do when the queue gives up. */
  onModuleInit(): void {
    this.pipeline.register((job) => this.scoring.scoreLead(job));
    this.pipeline.registerFailureHandler((job) =>
      this.scoring.scoreWithRules(job, 'provider_error'),
    );
  }
}
