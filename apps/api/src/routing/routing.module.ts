import { Module, type OnModuleInit } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PipelineService } from '../pipeline/pipeline.service';
import { ScoringModule } from '../scoring/scoring.module';
import { RoutingController } from './routing.controller';
import { RoutingRunner } from './routing.runner';
import { RoutingService } from './routing.service';

// ScoringModule is imported so that Nest starts it first: its pipeline step must run before ours.
@Module({
  imports: [PipelineModule, ScoringModule, ActionsModule],
  controllers: [RoutingController],
  providers: [RoutingService, RoutingRunner],
  exports: [RoutingRunner],
})
export class RoutingModule implements OnModuleInit {
  constructor(
    private readonly pipeline: PipelineService,
    private readonly runner: RoutingRunner,
  ) {}

  /** Step 3 of the lead pipeline (after enrichment and scoring). */
  onModuleInit(): void {
    this.pipeline.register((job) => this.runner.routeLead(job));
  }
}
