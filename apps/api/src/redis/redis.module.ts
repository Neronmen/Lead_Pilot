import { once } from 'node:events';
import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.schema';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

function createRedisClient(config: ConfigService<Env, true>): Redis {
  const logger = new Logger('Redis');
  const client = new Redis(config.get('REDIS_URL', { infer: true }), {
    // Commands sent while (re)connecting wait in ioredis' offline queue, so a
    // probe right after boot does not fail spuriously. Callers that need a
    // fast answer (health checks) bound the wait with their own timeout.
    maxRetriesPerRequest: 1,
  });

  // ioredis retries forever in the background; log each distinct error once.
  let lastError: string | undefined;
  client.on('error', (err: Error) => {
    if (err.message !== lastError) {
      lastError = err.message;
      logger.warn(`Redis connection error: ${err.message}`);
    }
  });
  client.on('ready', () => {
    if (lastError !== undefined) logger.log('Redis connection restored');
    lastError = undefined;
  });

  return client;
}

@Global()
@Module({
  providers: [{ provide: REDIS_CLIENT, inject: [ConfigService], useFactory: createRedisClient }],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'end') return;
    // Wait for the socket to really close, so shutdown leaves nothing behind.
    const ended = once(this.redis, 'end');
    await this.redis.quit().catch(() => this.redis.disconnect());
    await ended;
  }
}
