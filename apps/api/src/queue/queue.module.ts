import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.schema';
import { PipelineQueue } from './pipeline.queue';
import { QUEUE_CONNECTION } from './queue.tokens';

/**
 * Background jobs (BullMQ on the Redis we already run). The API only queues a
 * job and answers; a worker does the slow part (enrichment, AI scoring) later,
 * and retries it if it fails.
 */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      inject: [ConfigService],
      // BullMQ's workers hold blocking commands, so they need their own
      // connection that never gives up a command (maxRetriesPerRequest: null).
      useFactory: (config: ConfigService<Env, true>) =>
        new Redis(config.get('REDIS_URL', { infer: true }), {
          maxRetriesPerRequest: null,
          disconnectTimeout: 100,
        }),
    },
    PipelineQueue,
  ],
  exports: [QUEUE_CONNECTION, PipelineQueue],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(@Inject(QUEUE_CONNECTION) private readonly connection: Redis) {}

  // Runs after the queue and the worker have closed (module shutdown follows provider shutdown).
  async onApplicationShutdown(): Promise<void> {
    if (this.connection.status === 'end') return;
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
