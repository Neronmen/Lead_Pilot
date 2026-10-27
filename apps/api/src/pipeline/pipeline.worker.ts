import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import type { Env } from '../config/env.schema';
import type { ProcessLeadJob } from '../queue/pipeline.queue';
import { PIPELINE_QUEUE, QUEUE_CONNECTION } from '../queue/queue.tokens';
import { PipelineService } from './pipeline.service';

/** Runs `process-lead` jobs inside this process when QUEUE_WORKERS is "on". */
@Injectable()
export class PipelineWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PipelineWorker.name);
  private worker?: Worker<ProcessLeadJob>;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly config: ConfigService<Env, true>,
    private readonly pipeline: PipelineService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('QUEUE_WORKERS', { infer: true }) === 'on') this.start();
  }

  /** Starts the worker (once). Public so a test can run one without touching the environment. */
  start(): void {
    if (this.worker) return;
    this.worker = new Worker<ProcessLeadJob>(PIPELINE_QUEUE, (job) => this.pipeline.run(job.data), {
      connection: this.connection,
      prefix: this.config.get('QUEUE_PREFIX', { infer: true }),
      concurrency: 5,
    });
    this.worker.on('error', (error) => this.logger.warn(`Worker error: ${error.message}`));
    this.worker.on('failed', (job, error) => {
      // Ids only: a lead's details never go to the log at this level.
      this.logger.warn(`Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${error.message}`);
      // The last try failed: hand the lead to the fallback instead of leaving it half-processed.
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        this.pipeline
          .gaveUp(job.data)
          .catch((fallbackError: Error) =>
            this.logger.error(`Fallback for job ${job.id} failed: ${fallbackError.message}`),
          );
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
  }
}
