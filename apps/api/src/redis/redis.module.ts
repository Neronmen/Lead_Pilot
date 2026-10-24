import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.schema';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const SHUTDOWN_TIMEOUT_MS = 2_000;

function createRedisClient(config: ConfigService<Env, true>): Redis {
  const logger = new Logger('Redis');
  const client = new Redis(config.get('REDIS_URL', { infer: true }), {
    // Commands sent while (re)connecting wait in ioredis' offline queue, so a
    // probe right after boot does not fail spuriously. Callers that need a
    // fast answer (health checks) bound the wait with their own timeout.
    maxRetriesPerRequest: 1,
    // How long disconnect() waits before destroying a socket that did not
    // close. If the socket is already dead (Redis down) this timer always runs
    // out, so keep it short; graceful shutdown has its own timeout below.
    disconnectTimeout: 100,
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

    // Not connected (e.g. reconnecting while Redis is down): there is no
    // socket to close gracefully and ioredis never emits 'end' in this state,
    // so waiting would hang shutdown. Just stop the reconnect loop.
    if (this.redis.status !== 'ready') {
      this.redis.disconnect();
      return;
    }

    // Connected: QUIT lets pending replies arrive, then wait for the socket to
    // close, but never longer than the timeout. The timer is unref'd so it
    // cannot keep the process alive on its own.
    const ended = once(this.redis, 'end').catch(() => undefined);
    await Promise.race([
      Promise.all([this.redis.quit().catch(() => undefined), ended]),
      delay(SHUTDOWN_TIMEOUT_MS, undefined, { ref: false }),
    ]);
    // Read the status again: TypeScript still narrows it to 'ready' from the
    // check above, but QUIT has changed it at runtime.
    const status: string = this.redis.status;
    if (status !== 'end') this.redis.disconnect();
  }
}
