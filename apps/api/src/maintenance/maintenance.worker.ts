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
import { MAINTENANCE_QUEUE, QUEUE_CONNECTION } from '../queue/queue.tokens';
import { MaintenanceService } from './maintenance.service';

/**
 * Schedules and runs the recurring jobs. A "job scheduler" is stored in Redis
 * under a fixed id, so starting several API processes registers the schedule
 * once, and each run happens once.
 */
@Injectable()
export class MaintenanceWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MaintenanceWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    private readonly config: ConfigService<Env, true>,
    private readonly maintenance: MaintenanceService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('QUEUE_WORKERS', { infer: true }) === 'on') await this.start();
  }

  /** Public so a test can start it without touching the environment. */
  async start(): Promise<void> {
    if (this.worker) return;
    const prefix = this.config.get('QUEUE_PREFIX', { infer: true });
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.connection, prefix });
    this.queue.on('error', (error) => this.logger.warn(`Queue error: ${error.message}`));
    await this.queue.upsertJobScheduler(
      'cleanup',
      { pattern: '30 3 * * *' },
      { name: 'cleanup', opts: { removeOnComplete: true, removeOnFail: { age: 7 * 86400 } } },
    );
    await this.queue.upsertJobScheduler(
      'requeue-stuck',
      { every: 5 * 60 * 1000 },
      { name: 'requeue-stuck', opts: { removeOnComplete: true, removeOnFail: { age: 86400 } } },
    );
    this.worker = new Worker(
      MAINTENANCE_QUEUE,
      async (job) => {
        if (job.name === 'cleanup') await this.maintenance.cleanup();
        else if (job.name === 'requeue-stuck') await this.maintenance.requeueStuckLeads();
      },
      { connection: this.connection, prefix },
    );
    this.worker.on('error', (error) => this.logger.warn(`Worker error: ${error.message}`));
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Job ${job?.name} failed: ${error.message}`),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }
}
