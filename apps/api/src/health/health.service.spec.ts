import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { CHECK_TIMEOUT_MS, HealthService } from './health.service';

describe('HealthService', () => {
  const ping = jest.fn<Promise<string>, []>();
  const service = new HealthService({ ping } as unknown as Redis);

  beforeAll(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => {
    ping.mockReset();
    jest.useRealTimers();
  });

  it('liveness is always ok and checks nothing', () => {
    expect(service.liveness()).toEqual({ status: 'ok', checks: {} });
    expect(ping).not.toHaveBeenCalled();
  });

  it('readiness is ok when Redis answers', async () => {
    ping.mockResolvedValue('PONG');
    await expect(service.readiness()).resolves.toEqual({
      status: 'ok',
      checks: { redis: { status: 'up' } },
    });
  });

  it('readiness is error with a generic message when Redis fails', async () => {
    ping.mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:6379'));
    const result = await service.readiness();
    expect(result).toEqual({
      status: 'error',
      checks: { redis: { status: 'down', message: 'unavailable' } },
    });
    expect(JSON.stringify(result)).not.toContain('10.1.2.3');
  });

  it('readiness is error when Redis does not answer in time', async () => {
    jest.useFakeTimers();
    ping.mockReturnValue(new Promise(() => undefined));
    const pending = service.readiness();
    await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({
      status: 'error',
      checks: { redis: { status: 'down' } },
    });
  });
});
