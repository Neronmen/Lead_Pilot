import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebsiteMetaProvider } from './website-meta.provider';

describe('WebsiteMetaProvider (SSRF-safe fetch)', () => {
  let server: http.Server;
  let port: number;
  let hits: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      const html = (body: string) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(body);
      };
      switch (req.url) {
        case '/':
          return html(
            '<title>Acme</title><meta name="description" content="We build"><p>Hello</p>',
          );
        case '/hop1':
          res.writeHead(302, { location: '/hop2' });
          return res.end();
        case '/hop2':
          res.writeHead(302, { location: '/hop3' });
          return res.end();
        case '/hop3':
          res.writeHead(302, { location: '/hop4' });
          return res.end();
        case '/hop4':
          res.writeHead(302, { location: '/' });
          return res.end();
        case '/to-ip':
          res.writeHead(302, { location: `http://127.0.0.1:${port}/` });
          return res.end();
        case '/to-port':
          res.writeHead(302, { location: 'http://acme.test:6379/' });
          return res.end();
        case '/to-file':
          res.writeHead(302, { location: 'file:///etc/passwd' });
          return res.end();
        case '/json':
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end('{}');
        case '/huge':
          return html(`<title>Big</title><p>${'x'.repeat(400 * 1024)}</p>`);
        default:
          res.writeHead(404);
          return res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    hits = [];
  });

  /** Every host name "resolves" to the local test server; the address check is what is tested. */
  const provider = (allowAddress?: (address: string) => boolean) =>
    new WebsiteMetaProvider({
      allowAddress: allowAddress ?? (() => true),
      allowedPorts: [port],
      resolve: () => Promise.resolve(['127.0.0.1']),
    });
  const url = (path: string) => new URL(`http://acme.test:${port}${path}`);

  it('reads a page and follows checked redirects (up to 3)', async () => {
    const page = await provider().fetchPage(url('/'));
    expect(page).toContain('<title>Acme</title>');
    expect(await provider().fetchPage(url('/hop3'))).toContain('Acme'); // one redirect
  });

  it('refuses a 4th redirect, an IP-address target, another port and a non-http scheme', async () => {
    await expect(provider().fetchPage(url('/hop1'))).rejects.toThrow('redirects');
    await expect(provider().fetchPage(url('/to-ip'))).rejects.toThrow('IP address host');
    await expect(provider().fetchPage(url('/to-port'))).rejects.toThrow('port');
    await expect(provider().fetchPage(url('/to-file'))).rejects.toThrow('scheme');
    await expect(provider().fetchPage(new URL(`http://127.0.0.1:${port}/`))).rejects.toThrow(
      'IP address host',
    );
    await expect(provider().fetchPage(new URL(`http://[::1]:${port}/`))).rejects.toThrow(
      'IP address host',
    );
    await expect(
      provider().fetchPage(new URL(`http://user:pw@acme.test:${port}/`)),
    ).rejects.toThrow('credentials');
  });

  it('with the real address check, a host that resolves to a private address is never contacted', async () => {
    const strict = new WebsiteMetaProvider({
      allowedPorts: [port],
      resolve: () => Promise.resolve(['127.0.0.1']),
    });
    await expect(strict.fetchPage(url('/'))).rejects.toThrow('not public');
    for (const address of ['169.254.169.254', '10.0.0.5', '::1', '::ffff:7f00:1', 'fd00::1']) {
      const one = new WebsiteMetaProvider({
        allowedPorts: [port],
        resolve: () => Promise.resolve([address]),
      });
      await expect(one.fetchPage(url('/'))).rejects.toThrow('not public');
    }
    // One private address among public ones is enough to refuse (a rebinding trick).
    const mixed = new WebsiteMetaProvider({
      allowedPorts: [port],
      resolve: () => Promise.resolve(['8.8.8.8', '127.0.0.1']),
    });
    await expect(mixed.fetchPage(url('/'))).rejects.toThrow('not public');
    expect(hits).toEqual([]);
  });

  it('enrich() turns any refusal into "unreachable", and refuses non-domains outright', async () => {
    const strict = new WebsiteMetaProvider({ resolve: () => Promise.resolve(['10.0.0.1']) });
    expect((await strict.enrich('acme.com')).status).toBe('unreachable');
    for (const bad of ['localhost', '127.0.0.1', 'a b.com', 'acme.com/path', 'acme.com:8080', '']) {
      expect((await strict.enrich(bad)).status).toBe('unreachable');
    }
    expect(hits).toEqual([]);
  });

  it('accepts HTML only, and stops reading a huge page at 256 KB', async () => {
    await expect(provider().fetchPage(url('/json'))).rejects.toThrow('HTML');
    await expect(provider().fetchPage(url('/missing'))).rejects.toThrow('HTML');
    const huge = await provider().fetchPage(url('/huge'));
    expect(huge.length).toBeLessThanOrEqual(256 * 1024);
    expect(huge).toContain('<title>Big</title>');
  });
});
