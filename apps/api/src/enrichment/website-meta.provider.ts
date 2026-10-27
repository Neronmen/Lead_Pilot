import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type { EnrichmentData, EnrichmentProvider } from './enrichment.provider';
import { extractPageMeta } from './html-meta';
import { isPublicAddress } from './ip-guard';

const MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
const TOTAL_TIMEOUT_MS = 8_000;
const DOMAIN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface WebsiteMetaOptions {
  /** Which addresses may be connected to. Tests loosen this; the default is "public internet only". */
  allowAddress?: (address: string) => boolean;
  /** Which ports a URL (and every redirect) may use. */
  allowedPorts?: number[];
  /** Resolves a host name. Tests replace it. */
  resolve?: (host: string) => Promise<string[]>;
}

class Refused extends Error {}

function resolveAll(host: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { all: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses.map((a) => a.address)),
    );
  });
}

/**
 * Reads a company's homepage: title, description and the first ~2000 characters
 * of text. The address came from a stranger's form, so the fetch is locked down:
 *
 * - only http and https, only the usual ports, never an IP-address host;
 * - the host name is resolved by US and every address must be public, and the
 *   connection is made to exactly that address (a second DNS lookup could
 *   answer differently: "DNS rebinding"), see `connect`;
 * - redirects are followed by hand, at most 3, each one checked the same way;
 * - 8 s overall, 256 KB of body, HTML only, no compression (so no zip bombs).
 */
export class WebsiteMetaProvider implements EnrichmentProvider {
  readonly name = 'website';
  private readonly allowAddress: (address: string) => boolean;
  private readonly allowedPorts: number[];
  private readonly resolve: (host: string) => Promise<string[]>;

  constructor(options: WebsiteMetaOptions = {}) {
    this.allowAddress = options.allowAddress ?? isPublicAddress;
    this.allowedPorts = options.allowedPorts ?? [80, 443];
    this.resolve = options.resolve ?? resolveAll;
  }

  async enrich(domain: string): Promise<EnrichmentData> {
    if (!DOMAIN.test(domain)) return unreachable();
    // One clock for both tries: a slow site cannot take 2 x 8 seconds of a worker.
    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    for (const scheme of ['https', 'http']) {
      try {
        const html = await this.fetchPage(new URL(`${scheme}://${domain}/`), deadline);
        return { status: 'ok', ...extractPageMeta(html) };
      } catch {
        // Try the next scheme; a refusal, a timeout and a refused connection all end as "unreachable".
      }
    }
    return unreachable();
  }

  /** GET a page as text, following up to 3 checked redirects. Throws on anything unsafe. */
  async fetchPage(start: URL, deadline: number = Date.now() + TOTAL_TIMEOUT_MS): Promise<string> {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await this.request(url, deadline - Date.now());
      if (response.redirect === undefined) return response.body;
      url = new URL(response.redirect, url);
    }
    throw new Refused('too many redirects');
  }

  private check(url: URL): void {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Refused('scheme');
    if (url.username || url.password) throw new Refused('credentials in the address');
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
    if (!this.allowedPorts.includes(port)) throw new Refused('port');
    // An IP literal ("127.0.0.1", "[::1]", "2130706433") is never a company website.
    if (isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0) throw new Refused('IP address host');
  }

  private async request(url: URL, timeoutMs: number): Promise<{ redirect?: string; body: string }> {
    this.check(url);
    if (timeoutMs <= 0) throw new Refused('timeout');
    const addresses = await Promise.race([
      this.resolve(url.hostname),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Refused('timeout')), timeoutMs);
        timer.unref();
      }),
    ]);
    if (addresses.length === 0 || !addresses.every((address) => this.allowAddress(address))) {
      throw new Refused('address is not public');
    }
    const address = addresses[0]!;
    const client = url.protocol === 'https:' ? https : http;

    return new Promise((resolveResult, reject) => {
      // An idle timeout alone lets a server send one byte every few seconds for ever: this is the total.
      const total = setTimeout(() => request.destroy(new Refused('timeout')), timeoutMs);
      const resolve = (value: { redirect?: string; body: string }) => {
        clearTimeout(total);
        resolveResult(value);
      };
      const request = client.request(
        url,
        {
          method: 'GET',
          agent: false,
          // Connect to the address we checked, not to whatever DNS says a moment later.
          lookup: (_host, options, callback) => {
            const family = isIP(address);
            // Node may ask for every address ("all") or for one: answer in the shape it asked for.
            if (options.all) {
              (callback as (e: null, list: { address: string; family: number }[]) => void)(null, [
                { address, family },
              ]);
            } else {
              (callback as (e: null, address: string, family: number) => void)(
                null,
                address,
                family,
              );
            }
          },
          headers: {
            'user-agent': 'LeadPilot-Enrichment/1.0',
            accept: 'text/html',
            'accept-encoding': 'identity',
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400 && response.headers.location) {
            response.resume();
            resolve({ redirect: response.headers.location, body: '' });
            return;
          }
          const type = String(response.headers['content-type'] ?? '');
          if (status !== 200 || !/^text\/html\b/i.test(type)) {
            response.resume();
            reject(new Refused('not an HTML page'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BYTES) {
              // Enough: use what we have and stop reading.
              chunks.push(chunk.subarray(0, chunk.length - (size - MAX_BYTES)));
              request.destroy();
              resolve({ body: Buffer.concat(chunks).toString('utf8') });
            } else {
              chunks.push(chunk);
            }
          });
          response.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
          response.on('error', reject);
        },
      );
      request.setTimeout(timeoutMs, () => request.destroy(new Refused('timeout')));
      request.on('error', (error) => {
        clearTimeout(total);
        reject(error);
      });
      request.end();
    });
  }
}

const unreachable = (): EnrichmentData => ({
  status: 'unreachable',
  title: null,
  description: null,
  text: '',
});
