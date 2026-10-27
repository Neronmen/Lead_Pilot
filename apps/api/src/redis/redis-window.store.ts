import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { WindowStore } from '../ingest/rate-limiter';

/**
 * Rate-limit counters in Redis, so every API instance counts together. A window
 * is one key: INCR makes it, and PEXPIRE (set on the first hit only) ends it.
 *
 * If Redis is unreachable the limiter lets the request through and logs once:
 * a limiter that takes the API down with Redis would be worse than none.
 */
export class RedisWindowStore implements WindowStore {
  private readonly logger = new Logger(RedisWindowStore.name);
  private failing = false;

  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async hit(key: string, windowMs: number): Promise<{ count: number; resetInMs: number }> {
    try {
      const redisKey = `${this.prefix}:rl:${key}`;
      const count = await this.redis.incr(redisKey);
      if (count === 1) await this.redis.pexpire(redisKey, windowMs);
      const ttl = await this.redis.pttl(redisKey);
      this.recovered();
      // -1: the key lost its expiry (a crash between INCR and PEXPIRE): end the window now.
      if (ttl < 0) await this.redis.pexpire(redisKey, windowMs);
      return { count, resetInMs: ttl < 0 ? windowMs : ttl };
    } catch (error) {
      return this.failOpen(error);
    }
  }

  async peek(key: string): Promise<{ count: number; resetInMs: number }> {
    try {
      const redisKey = `${this.prefix}:rl:${key}`;
      const [count, ttl] = await Promise.all([this.redis.get(redisKey), this.redis.pttl(redisKey)]);
      this.recovered();
      return { count: Number(count ?? 0), resetInMs: Math.max(0, ttl) };
    } catch (error) {
      return this.failOpen(error);
    }
  }

  async clear(): Promise<void> {
    const keys = await this.redis.keys(`${this.prefix}:rl:*`);
    if (keys.length > 0) await this.redis.del(...keys);
  }

  private failOpen(error: unknown): { count: number; resetInMs: number } {
    if (!this.failing) {
      this.failing = true;
      this.logger.warn(
        `Rate limiter cannot reach Redis, letting requests through: ${String(error)}`,
      );
    }
    return { count: 0, resetInMs: 0 };
  }

  private recovered(): void {
    if (this.failing) this.logger.log('Rate limiter reconnected to Redis');
    this.failing = false;
  }
}
