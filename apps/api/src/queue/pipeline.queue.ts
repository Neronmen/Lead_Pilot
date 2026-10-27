import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { Env } from '../config/env.schema';
import { PIPELINE_QUEUE, QUEUE_CONNECTION } from './queue.tokens';

export interface ProcessLeadJob {
  workspaceId: string;
  leadId: string;
}

/**
 * The lead pipeline queue (enrich, score, flag for review). One job per lead.
 *
 * Idempotency: the job id is derived from the lead id and the step
 * (`<leadId>-score`), so queueing the same lead twice while a job is still
 * waiting does nothing (a burst of merges is scored once), and a retry of a
 * failed job redoes only that job. A finished job is removed, so the next
 * submission can queue a new one.
 */
@Injectable()
export class PipelineQueue implements OnApplicationShutdown {
  private readonly logger = new Logger(PipelineQueue.name);
  readonly queue: Queue<ProcessLeadJob>;

  constructor(@Inject(QUEUE_CONNECTION) connection: Redis, config: ConfigService<Env, true>) {
    this.queue = new Queue<ProcessLeadJob>(PIPELINE_QUEUE, {
      connection,
      prefix: config.get('QUEUE_PREFIX', { infer: true }),
      defaultJobOptions: {
        attempts: 5,
        // 5 s, 10 s, 20 s, 40 s between tries.
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        // Keep failures for a week so they can be looked at.
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    });
    // Without a listener a connection error would crash the process.
    this.queue.on('error', (error) => this.logger.warn(`Queue error: ${error.message}`));
  }

  /**
   * Queue a lead for the pipeline. Never throws: the lead is already saved, and
   * a missed job is picked up again by the recovery sweep (leads still NEW after a while).
   */
  async enqueueLead(job: ProcessLeadJob): Promise<void> {
    try {
      await this.queue.add('process-lead', job, { jobId: `${job.leadId}-score` });
    } catch (error) {
      this.logger.warn(`Could not queue lead ${job.leadId}: ${(error as Error).message}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close().catch(() => undefined);
  }
}
