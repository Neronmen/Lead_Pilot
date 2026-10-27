import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { RedisWindowStore } from './redis-window.store';

/**
 * `@nestjs/throttler` keeps its counters in memory by default, so each API
 * instance would count on its own. This storage keeps them in Redis through the
 * same window store the ingest limits use. Blocking lasts until the window ends.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly store: RedisWindowStore) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const { count, resetInMs } = await this.store.hit(`throttle:${throttlerName}:${key}`, ttl);
    const seconds = Math.max(0, Math.ceil(resetInMs / 1000));
    const isBlocked = count > limit;
    return {
      totalHits: count,
      timeToExpire: seconds,
      isBlocked,
      timeToBlockExpire: isBlocked ? seconds : 0,
    };
  }
}
