import { Injectable, Logger } from '@nestjs/common';
import type { ProcessLeadJob } from '../queue/pipeline.queue';

/**
 * What happens to a lead after it is stored, as a list of steps. Each step
 * must be safe to run twice (jobs are retried). Steps are added by the
 * enrichment and scoring milestones; an empty list means the lead just waits.
 */
export type PipelineStep = (job: ProcessLeadJob) => Promise<void>;

@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private readonly steps: PipelineStep[] = [];

  register(step: PipelineStep): void {
    this.steps.push(step);
  }

  async run(job: ProcessLeadJob): Promise<void> {
    for (const step of this.steps) await step(job);
    this.logger.debug(`Lead ${job.leadId} went through ${this.steps.length} step(s)`);
  }
}
