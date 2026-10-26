import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import type { ConfigService } from '@nestjs/config';
import pino from 'pino';
import type { Options } from 'pino-http';
import type { Env } from '../../config/env.schema';
import { buildLoggerParams, resolveRequestId } from './logger.config';

describe('resolveRequestId', () => {
  function call(header?: string) {
    const req = { headers: header === undefined ? {} : { 'x-request-id': header } };
    const res = { setHeader: jest.fn() };
    const id = resolveRequestId(req as IncomingMessage, res as unknown as ServerResponse);
    return { id, res };
  }

  it('reuses a well-formed incoming request id and echoes it', () => {
    const { id, res } = call('req-123_abc.DEF');
    expect(id).toBe('req-123_abc.DEF');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'req-123_abc.DEF');
  });

  it('generates a UUID when the header is missing', () => {
    expect(call().id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores ids that could inject text into logs', () => {
    expect(call('abc\n{"level":"fatal"}').id).toMatch(/^[0-9a-f-]{36}$/);
    expect(call('x'.repeat(65)).id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('buildLoggerParams', () => {
  const config = (values: Partial<Env>) =>
    ({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<Env, true>;
  const pinoHttp = (values: Partial<Env> = { NODE_ENV: 'production', LOG_LEVEL: 'info' }) =>
    buildLoggerParams(config(values)).pinoHttp as Options;

  describe('request line', () => {
    const serialize = (req: { id: string; method: string; url: string }) =>
      (pinoHttp().serializers?.req as (r: typeof req) => unknown)(req);

    it('keeps only the id, method and path: no headers', () => {
      const logged = serialize({
        id: 'req-1',
        method: 'POST',
        url: '/auth/login',
        // What the real request object also carries: must never reach the log.
        headers: { authorization: 'Bearer secret-token', cookie: 'lp_refresh=secret' },
      } as never);
      expect(logged).toEqual({ id: 'req-1', method: 'POST', url: '/auth/login' });
      expect(JSON.stringify(logged)).not.toMatch(/secret|authorization|cookie/i);
    });

    it('drops the query string, which can hold an email or a token', () => {
      const logged = serialize({
        id: 'req-2',
        method: 'GET',
        url: '/members?email=jane@acme.com&token=abc123',
      });
      expect(logged).toEqual({ id: 'req-2', method: 'GET', url: '/members' });
    });

    it('logs only the status code of the response', () => {
      const res = (pinoHttp().serializers?.res as (r: unknown) => unknown)({
        statusCode: 401,
        getHeaders: () => ({ 'set-cookie': ['lp_refresh=secret'] }),
      });
      expect(res).toEqual({ statusCode: 401 });
    });
  });

  describe('access log', () => {
    const ignore = (url: string | undefined) =>
      (pinoHttp().autoLogging as { ignore: (req: IncomingMessage) => boolean }).ignore({
        url,
      } as IncomingMessage);

    it('leaves the health probes out, which hit every few seconds', () => {
      expect(ignore('/health/live')).toBe(true);
      expect(ignore('/health/ready')).toBe(true);
    });

    it('logs every other route, and tolerates a missing url', () => {
      expect(ignore('/auth/login')).toBe(false);
      expect(ignore('/healthy-sounding-but-not-health')).toBe(false);
      expect(ignore('/health')).toBe(true);
      expect(ignore('/health?verbose=1')).toBe(true);
      expect(ignore(undefined)).toBe(false);
    });
  });

  describe('secret redaction (pino with this configuration)', () => {
    /** Logs one object through real pino with our redact settings and returns the line. */
    function logged(object: Record<string, unknown>): string {
      let line = '';
      const stream = new Writable({
        write(chunk: Buffer, _encoding, done) {
          line += chunk.toString();
          done();
        },
      });
      const { redact } = pinoHttp();
      pino({ redact }, stream).info(object, 'event');
      return line;
    }

    it.each([
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
      'secret',
      'authorization',
      'cookie',
    ])('replaces %s at the top level and one level down', (key) => {
      const line = logged({ [key]: 'SENSITIVE-VALUE', nested: { [key]: 'SENSITIVE-VALUE' } });
      expect(line).not.toContain('SENSITIVE-VALUE');
      expect(line).toContain('[redacted]');
    });

    it('leaves ordinary fields alone', () => {
      const line = logged({ workspaceId: 'w-1', userId: 'u-1', status: 401 });
      expect(JSON.parse(line)).toMatchObject({ workspaceId: 'w-1', userId: 'u-1', status: 401 });
    });
  });

  it('pretty-prints in development only, and carries assigned fields to the final line', () => {
    expect(pinoHttp({ NODE_ENV: 'development', LOG_LEVEL: 'debug' }).transport).toMatchObject({
      target: 'pino-pretty',
    });
    expect(pinoHttp().transport).toBeUndefined();
    // workspaceId and userId set by the auth guard must reach "request completed".
    expect(
      buildLoggerParams(config({ NODE_ENV: 'production', LOG_LEVEL: 'info' })).assignResponse,
    ).toBe(true);
  });
});
