import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { checkWebhookUrl, isPrivateAddress, UrlNotAllowedError } from './net-guard';

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

/** What the network layer gives back: the status and the (size-limited) text of the answer. */
export interface RawAnswer {
  status: number;
  text: string;
}
export type Sender = (
  url: URL,
  headers: Record<string, string>,
  body: string,
) => Promise<RawAnswer>;

const TIMEOUT_MS = 10_000;
/** An answer is only read up to this size: a hostile address cannot make us hold megabytes. */
const MAX_ANSWER_BYTES = 64 * 1024;

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * The DNS step of every outgoing connection. The address checked here is the address connected to
 * (the socket is opened with what this returns), so a hostile DNS server cannot show a public
 * address to a check and a private one to the connection (DNS rebinding).
 */
export function guardedLookup(hostname: string, options: object, callback: LookupCallback): void {
  dnsLookup(hostname, options, (error, address, family) => {
    if (error) return callback(error, address as never, family);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (list.length === 0 || list.some((entry) => isPrivateAddress(entry.address))) {
      return callback(new UrlNotAllowedError() as unknown as NodeJS.ErrnoException, '', undefined);
    }
    callback(null, address as never, family);
  });
}

/** One HTTPS POST. No redirects are followed and the answer is cut at MAX_ANSWER_BYTES. */
export const sendOverHttps: Sender = (url, headers, body) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: 'https:',
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        lookup: guardedLookup as never,
        timeout: TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size <= MAX_ANSWER_BYTES) chunks.push(chunk);
          else response.destroy();
        });
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          resolve({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        };
        response.on('end', done);
        response.on('close', done);
        response.on('error', reject);
      },
    );
    request.on('timeout', () =>
      request.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
    );
    request.on('error', reject);
    request.end(body);
  });

/**
 * The only place the API calls out for actions. `ACTIONS_MODE=mock` (the default) sends nothing
 * and only remembers the request, so the demo and the tests never touch the internet; `live`
 * checks the address (https, public only) and calls it, connecting only to the address it checked.
 * Redirects are not followed: a public address must not be able to bounce us to a private one.
 */
@Injectable()
export class ActionTransport {
  /** What mock mode "sent", newest last (kept short; for tests and the demo). */
  readonly sent: OutboundRequest[] = [];
  /** Replaced in tests; never given a key or a real address there. */
  send: Sender = sendOverHttps;

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
      const url = checkWebhookUrl(request.url);
      const answer = await this.send(
        url,
        { 'Content-Type': 'application/json', ...request.headers },
        JSON.stringify(request.body),
      );
      if (answer.status >= 300 && answer.status < 400) throw new ActionError('redirect');
      if (answer.status < 200 || answer.status >= 300) {
        throw new ActionError(`http_${answer.status}`);
      }
      try {
        return JSON.parse(answer.text) as unknown;
      } catch {
        return null;
      }
    } catch (error) {
      if (error instanceof ActionError) throw error;
      if (error instanceof UrlNotAllowedError) throw new ActionError('url_not_allowed');
      const code = (error as { code?: string } | null)?.code;
      if (code === 'ETIMEDOUT') throw new ActionError('timeout');
      if ((error as Error | null)?.name === 'UrlNotAllowedError') {
        throw new ActionError('url_not_allowed');
      }
      throw new ActionError('network');
    }
  }
}
