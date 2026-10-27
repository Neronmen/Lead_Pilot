import { Controller, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/auth-context';
import { IngestService, RateLimitedError } from './ingest.service';

/**
 * Where other systems send leads. Not behind a user login: the caller is a
 * machine, authenticated by the source's API key (and an optional signature).
 */
@ApiTags('ingest')
@Public()
@Controller('v1/ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post(':sourceId')
  @ApiOperation({
    summary: 'Send one lead',
    description:
      'Header `Authorization: Bearer <api key>` (or `X-API-Key`). JSON object body, up to 256 KB. ' +
      'If the source has signing on: `X-Timestamp` (unix seconds, within 5 minutes) and ' +
      '`X-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`. ' +
      'Optional `Idempotency-Key`: the same key and body within 24 hours returns the first answer. ' +
      '201 when a lead was created, 200 when it was merged into an existing one.',
  })
  async send(
    @Param('sourceId') sourceId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ leadId: string; result: 'created' | 'merged' }> {
    try {
      const out = await this.ingest.handle({
        sourceId,
        // The socket address. `trust proxy` is off, so X-Forwarded-For is never believed.
        ip: req.ip ?? 'unknown',
        header: (name) => req.get(name),
        rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      });
      res.status(out.status);
      if (out.replayed) res.setHeader('Idempotent-Replayed', 'true');
      return out.body;
    } catch (error) {
      if (error instanceof RateLimitedError) res.setHeader('Retry-After', String(error.retryAfter));
      throw error;
    }
  }
}
