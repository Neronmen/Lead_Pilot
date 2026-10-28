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
  private created?: Queue<ProcessLeadJob>;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Created on first use, not at start-up: an app that never queues a lead (or whose Redis is down
   * while it shuts down) opens no extra connection that could report a late error with nobody
   * listening.
   */
  get queue(): Queue<ProcessLeadJob> {
    if (!this.created) {
      this.created = new Queue<ProcessLeadJob>(PIPELINE_QUEUE, {
        connection: this.connection,
        prefix: this.config.get('QUEUE_PREFIX', { infer: true }),
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
      this.created.on('error', (error) => this.logger.warn(`Queue error: ${error.message}`));
    }
    return this.created;
  }

  /**
   * Queue a lead for the pipeline. Never throws: the lead is already saved, and
   * a missed job is picked up again by the recovery sweep (leads still NEW after a while).
   */
  async enqueueLead(job: ProcessLeadJob): Promise<void> {
    try {
      const jobId = `${job.leadId}-score`;
      // BullMQ ignores an add() whose id still exists, a failed job (kept for a week) included:
      // clear it, or "look again" and the recovery sweep would silently do nothing.
      const existing = await this.queue.getJob(jobId);
      if (existing && (await existing.isFailed())) await existing.remove();
      await this.queue.add('process-lead', job, { jobId });
    } catch (error) {
      this.logger.warn(`Could not queue lead ${job.leadId}: ${(error as Error).message}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.created?.close().catch(() => undefined);
  }
}
