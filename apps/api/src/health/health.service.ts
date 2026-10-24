import { Inject, Injectable, Logger } from '@nestjs/common';
import type { HealthCheck, HealthResponse } from '@leadpilot/shared';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

export const CHECK_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up and serving HTTP. No dependency checks. */
  liveness(): HealthResponse {
    return { status: 'ok', checks: {} };
  }

  /** Readiness: every dependency the API needs answers within the timeout. */
  async readiness(): Promise<HealthResponse> {
    const results = await Promise.all([
      this.runCheck('database', () => this.prisma.$queryRaw`SELECT 1`),
      this.runCheck('redis', () => this.redis.ping()),
    ]);
    const checks = Object.fromEntries(results);
    const allUp = results.every(([, check]) => check.status === 'up');
    return { status: allUp ? 'ok' : 'error', checks };
  }

  private async runCheck(
    name: string,
    probe: () => Promise<unknown>,
  ): Promise<[string, HealthCheck]> {
    try {
      await withTimeout(probe(), CHECK_TIMEOUT_MS);
      return [name, { status: 'up' }];
    } catch (err) {
      // The endpoint is public: log the real reason, return a generic one.
      this.logger.warn(`Readiness check "${name}" failed: ${(err as Error).message}`);
      return [name, { status: 'down', message: 'unavailable' }];
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
