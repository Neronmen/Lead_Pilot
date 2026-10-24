import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConfigService } from '@nestjs/config';
import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.schema';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept a caller's request id only if it looks like an id, so a client
// cannot inject arbitrary text into our logs.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

export function buildLoggerParams(config: ConfigService<Env, true>): Params {
  const isDev = config.get('NODE_ENV', { infer: true }) === 'development';

  return {
    pinoHttp: {
      level: config.get('LOG_LEVEL', { infer: true }),
      genReqId: resolveRequestId,
      // Log only what we need. Headers (auth, cookies, API keys) and query
      // strings (may hold emails or tokens) are left out entirely.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      // Probes hit these every few seconds; they would drown real traffic.
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      transport: isDev ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    },
  };
}
