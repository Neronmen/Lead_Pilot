import { Module } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { PipelineWorker } from './pipeline.worker';

@Module({
  providers: [PipelineService, PipelineWorker],
  exports: [PipelineService, PipelineWorker],
})
export class PipelineModule {}
