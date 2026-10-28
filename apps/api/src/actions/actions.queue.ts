import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import type Redis from 'ioredis';
import type { Env } from '../config/env.schema';
import { QUEUE_CONNECTION } from '../queue/queue.tokens';

export const ACTIONS_QUEUE = 'actions';

export interface ActionJob {
  workspaceId: string;
  runId: string;
}

/** Called by the worker; the service behind it keeps the run's status and attempt count. */
export interface ActionExecutor {
  execute(job: ActionJob, finalTry: boolean): Promise<void>;
}

/**
 * The queue of actions (one job per ActionRun): sending to Slack, email, a webhook can fail for
 * reasons that pass, so each run is retried with growing waits (10 s, 20 s, 40 s, 80 s). A run
 * that fails its last try is marked DEAD (the "dead-letter" list: kept, visible, and retried by
 * hand with `POST /actions/:id/retry`). The job id is the run's key, so one run never has two jobs.
 */
@Injectable()
export class ActionsQueue implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ActionsQueue.name);
  private created?: Queue<ActionJob>;
  private worker?: Worker<ActionJob>;
  private executor?: ActionExecutor;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Created on first use, not at start-up: an app that never queues an action (or whose Redis is
   * down while it shuts down) opens no extra connection that could fail with nobody listening.
   */
  get queue(): Queue<ActionJob> {
    if (!this.created) {
      this.created = new Queue<ActionJob>(ACTIONS_QUEUE, {
        connection: this.connection,
        prefix: this.config.get('QUEUE_PREFIX', { infer: true }),
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 60 * 60 },
        },
      });
      this.created.on('error', (error) => this.logger.warn(`Queue error: ${error.message}`));
    }
    return this.created;
  }

  /** The service that runs a job registers itself here (avoids a circular import with the queue). */
  setExecutor(executor: ActionExecutor): void {
    this.executor = executor;
  }

  /** Queue one run. Never throws: the run row exists, and a missed job can be retried from the UI. */
  async enqueue(job: ActionJob & { jobKey: string }): Promise<void> {
    try {
      const existing = await this.queue.getJob(job.jobKey);
      if (existing && (await existing.isFailed())) await existing.remove();
      await this.queue.add(
        'run-action',
        { workspaceId: job.workspaceId, runId: job.runId },
        { jobId: job.jobKey },
      );
    } catch (error) {
      this.logger.warn(`Could not queue action ${job.runId}: ${(error as Error).message}`);
    }
  }

  onApplicationBootstrap(): void {
    if (this.config.get('QUEUE_WORKERS', { infer: true }) === 'on') this.start();
  }

  /** Starts the worker (once). Public so a test can run one without touching the environment. */
  start(): void {
    if (this.worker) return;
    this.worker = new Worker<ActionJob>(
      ACTIONS_QUEUE,
      async (job) => {
        const finalTry = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        await this.executor?.execute(job.data, finalTry);
      },
      {
        connection: this.connection,
        prefix: this.config.get('QUEUE_PREFIX', { infer: true }),
        concurrency: 5,
      },
    );
    this.worker.on('error', (error) => this.logger.warn(`Worker error: ${error.message}`));
    this.worker.on('failed', (job, error) =>
      // Ids and a short code only.
      this.logger.warn(`Action job ${job?.id} failed (try ${job?.attemptsMade}): ${error.message}`),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.created?.close().catch(() => undefined);
  }
}
