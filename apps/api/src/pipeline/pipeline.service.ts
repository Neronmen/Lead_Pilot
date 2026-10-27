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
  private readonly onFailure: PipelineStep[] = [];

  register(step: PipelineStep): void {
    this.steps.push(step);
  }

  /**
   * What to do when the queue has given up on a lead (every retry failed), so the
   * lead is not left half-processed. Each handler must itself be safe to run twice.
   */
  registerFailureHandler(handler: PipelineStep): void {
    this.onFailure.push(handler);
  }

  async gaveUp(job: ProcessLeadJob): Promise<void> {
    for (const handler of this.onFailure) await handler(job);
  }

  async run(job: ProcessLeadJob): Promise<void> {
    for (const step of this.steps) await step(job);
    this.logger.debug(`Lead ${job.leadId} went through ${this.steps.length} step(s)`);
  }
}
