import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { PrismaService } from '../prisma/prisma.service';
import { CHECK_TIMEOUT_MS, HealthService } from './health.service';

describe('HealthService', () => {
  const queryRaw = jest.fn<Promise<unknown>, []>();
  const ping = jest.fn<Promise<string>, []>();
  const service = new HealthService(
    { $queryRaw: queryRaw } as unknown as PrismaService,
    { ping } as unknown as Redis,
  );

  beforeAll(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  beforeEach(() => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    ping.mockResolvedValue('PONG');
  });
  afterEach(() => {
    queryRaw.mockReset();
    ping.mockReset();
    jest.useRealTimers();
  });

  it('liveness is always ok and checks nothing', () => {
    expect(service.liveness()).toEqual({ status: 'ok', checks: {} });
    expect(queryRaw).not.toHaveBeenCalled();
    expect(ping).not.toHaveBeenCalled();
  });

  it('readiness is ok when Postgres and Redis answer', async () => {
    await expect(service.readiness()).resolves.toEqual({
      status: 'ok',
      checks: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('readiness is error when only the database fails, and says which check failed', async () => {
    queryRaw.mockRejectedValue(new Error('password authentication failed for user "leadpilot"'));
    const result = await service.readiness();
    expect(result).toEqual({
      status: 'error',
      checks: { database: { status: 'down', message: 'unavailable' }, redis: { status: 'up' } },
    });
    expect(JSON.stringify(result)).not.toContain('leadpilot');
  });

  it('readiness is error with a generic message when Redis fails', async () => {
    ping.mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:6379'));
    const result = await service.readiness();
    expect(result).toEqual({
      status: 'error',
      checks: { database: { status: 'up' }, redis: { status: 'down', message: 'unavailable' } },
    });
    expect(JSON.stringify(result)).not.toContain('10.1.2.3');
  });

  it('readiness is error when a dependency does not answer in time', async () => {
    jest.useFakeTimers();
    ping.mockReturnValue(new Promise(() => undefined));
    const pending = service.readiness();
    await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({
      status: 'error',
      checks: { database: { status: 'up' }, redis: { status: 'down' } },
    });
  });
});
