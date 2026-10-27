import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@leadpilot/shared';
import type { RequestHandler } from 'express';

export const INGEST_MAX_BYTES = 256 * 1024;

/**
 * Reads the body of an ingest request as raw bytes, up to `limit`. The HMAC
 * signature is computed over the exact bytes the sender sent, so the body must
 * not be parsed and re-serialised first. The size is counted while the body
 * streams in (a chunked body has no Content-Length to trust), and a body over
 * the limit is answered with 413 without being kept in memory.
 *
 * It runs before Nest's own body parsers; setting `_body` is how body-parser
 * knows a body was already read and skips it.
 */
export function readRawBody(limit = INGEST_MAX_BYTES): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'POST') return next();
    let size = 0;
    let rejected = false;
    const chunks: Buffer[] = [];

    const reject = () => {
      rejected = true;
      chunks.length = 0;
      res.setHeader('Connection', 'close');
      res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        error: { code: ErrorCode.PAYLOAD_TOO_LARGE, message: 'The request body is too large' },
      });
    };

    if (Number(req.headers['content-length']) > limit) {
      reject();
      return;
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (rejected) {
        // The answer is out and the connection will close; the rest is thrown
        // away, but nobody gets to stream us data for ever.
        if (size > limit * 8) req.destroy();
        return;
      }
      if (size > limit) reject();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      (req as unknown as { _body: boolean })._body = true;
      req.body = Buffer.concat(chunks);
      next();
    });
    req.on('error', () => {
      if (!rejected) next(new Error('Request body could not be read'));
    });
  };
}
