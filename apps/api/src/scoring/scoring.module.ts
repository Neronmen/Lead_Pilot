import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PipelineService } from '../pipeline/pipeline.service';
import { LLM_PROVIDER, type LlmProvider } from './llm.provider';
import { chooseLlm, geminiWarning } from './llm.factory';
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
          GEMINI_API_KEY: config.get('GEMINI_API_KEY', { infer: true }),
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
    private readonly config: ConfigService<Env, true>,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /** Step 2 of the lead pipeline (after enrichment), and what to do when the queue gives up. */
  onModuleInit(): void {
    const warning = geminiWarning({
      provider: this.llm.name,
      NODE_ENV: this.config.get('NODE_ENV', { infer: true }),
      GEMINI_PAID_TIER: this.config.get('GEMINI_PAID_TIER', { infer: true }),
    });
    if (warning) new Logger('Scoring').warn(warning);
    this.pipeline.register((job) => this.scoring.scoreLead(job));
    this.pipeline.registerFailureHandler((job) =>
      this.scoring.scoreWithRules(job, 'provider_error'),
    );
  }
}
