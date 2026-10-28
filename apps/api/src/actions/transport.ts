import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { assertPublicUrl, UrlNotAllowedError } from './net-guard';

/**
 * A failed action, as a short code. Only the code is stored and shown, never what the other
 * service sent back: that could carry a token, a lead's text or a stack trace.
 */
export class ActionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ActionError';
  }
}

export interface OutboundRequest {
  url: string;
  headers?: Record<string, string>;
  body: unknown;
}

const TIMEOUT_MS = 10_000;
/** An answer is only read up to this size: a hostile address cannot make us hold megabytes. */
const MAX_ANSWER_BYTES = 64 * 1024;

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ANSWER_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * The only place the API calls out for actions. `ACTIONS_MODE=mock` (the default) sends nothing
 * and only remembers the request, so the demo and the tests never touch the internet; `live`
 * checks the address (https, public only) and calls it. Redirects are not followed: a public
 * address must not be able to bounce us to a private one.
 */
@Injectable()
export class ActionTransport {
  /** What mock mode "sent", newest last (kept short; for tests and the demo). */
  readonly sent: OutboundRequest[] = [];
  /** Replaced in tests; never given a key or a real address there. */
  fetchImpl: typeof fetch = (...args) => fetch(...args);

  constructor(private readonly config: ConfigService<Env, true>) {}

  get live(): boolean {
    return this.config.get('ACTIONS_MODE', { infer: true }) === 'live';
  }

  /** Posts JSON. Resolves with the JSON answer (or null). Throws `ActionError` with a short code. */
  async post(request: OutboundRequest): Promise<unknown> {
    if (!this.live) {
      this.sent.push(request);
      if (this.sent.length > 100) this.sent.shift();
      return null;
    }
    try {
      const url = await assertPublicUrl(request.url);
      const response = await this.fetchImpl(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', ...request.headers },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) throw new ActionError('redirect');
      if (!response.ok) throw new ActionError(`http_${response.status}`);
      return await readJson(response);
    } catch (error) {
      if (error instanceof ActionError) throw error;
      if (error instanceof UrlNotAllowedError) throw new ActionError('url_not_allowed');
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new ActionError('timeout');
      }
      throw new ActionError('network');
    }
  }
}
