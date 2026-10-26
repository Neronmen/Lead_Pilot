import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createAuthClient,
  type AuthClient,
  type ChannelLike,
  type LockManagerLike,
} from './auth-client';

/**
 * A fake API and a fake browser, so two "tabs" (two clients) can share one
 * cookie jar the way real tabs do, and the race can be replayed on purpose.
 */
class FakeApi {
  /** The browser's cookie jar: shared by every tab. */
  cookie: string | null = 'rt-0';
  /** The one refresh token the server accepts. */
  private current = 'rt-0';
  private spent = new Set<string>();
  private revoked = false;
  private counter = 0;
  refreshCalls = 0;
  reuseDetected = 0;
  accessTokensIssued: string[] = [];
  /** Access tokens the API currently accepts. */
  valid = new Set<string>();
  expiresIn = 900;
  down = false;
  refuseAll = false;

  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const path = url.replace('http://api.test', '');
    // The browser attaches the cookie when the request is SENT.
    const sentCookie = this.cookie;
    const auth = new Headers(init?.headers).get('authorization');
    await new Promise((resolve) => setTimeout(resolve, 5)); // network time
    if (this.down) throw new TypeError('network down');

    if (path === '/auth/refresh') {
      this.refreshCalls++;
      if (!sentCookie) return json(401, { error: { code: 'AUTH_SESSION_EXPIRED', message: 'x' } });
      if (this.revoked || this.spent.has(sentCookie)) {
        this.reuseDetected++;
        this.revoked = true;
        this.cookie = null;
        return json(401, { error: { code: 'AUTH_REFRESH_REUSED', message: 'x' } });
      }
      if (sentCookie !== this.current) {
        this.cookie = null;
        return json(401, { error: { code: 'AUTH_SESSION_EXPIRED', message: 'x' } });
      }
      this.spent.add(sentCookie);
      this.current = `rt-${++this.counter}`;
      this.cookie = this.current; // Set-Cookie in the response
      return json(200, { accessToken: this.issue(), expiresIn: this.expiresIn });
    }
    if (path === '/auth/login') {
      this.current = `rt-${++this.counter}`;
      this.cookie = this.current;
      this.revoked = false;
      return json(200, { accessToken: this.issue(), expiresIn: this.expiresIn });
    }
    if (path === '/auth/logout') {
      this.cookie = null;
      return new Response(null, { status: 204 });
    }
    if (path === '/ping') {
      const ok = !this.refuseAll && auth !== null && this.valid.has(auth.replace('Bearer ', ''));
      return ok
        ? json(200, { ok: true })
        : json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  };

  private issue(): string {
    const token = `at-${this.accessTokensIssued.length + 1}`;
    this.accessTokensIssued.push(token);
    this.valid.add(token);
    return token;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** One lock per name, first come first served: what `navigator.locks` does across tabs. */
class FakeLocks implements LockManagerLike {
  private tails = new Map<string, Promise<unknown>>();
  async request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(name) ?? Promise.resolve();
    const run = previous.then(callback, callback);
    this.tails.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  }
}

/** BroadcastChannel between tabs: delivers to every other member, asynchronously. */
class FakeBus {
  private members = new Set<FakeChannel>();
  join(): FakeChannel {
    const channel = new FakeChannel(this);
    this.members.add(channel);
    return channel;
  }
  send(from: FakeChannel, data: unknown) {
    for (const member of this.members) {
      if (member !== from) queueMicrotask(() => member.onmessage?.({ data }));
    }
  }
}
class FakeChannel implements ChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(private bus: FakeBus) {}
  postMessage(message: unknown) {
    this.bus.send(this, message);
  }
}

function tabs(api: FakeApi, options: { locks: boolean; bus?: boolean } = { locks: true }) {
  const locks = options.locks ? new FakeLocks() : null;
  const bus = options.bus === false ? null : new FakeBus();
  const make = (): AuthClient =>
    createAuthClient({
      apiUrl: 'http://api.test',
      fetch: api.fetch,
      locks,
      channel: bus?.join() ?? null,
    });
  return [make(), make()] as const;
}

describe('bootstrap (page load)', () => {
  it('turns the cookie into an access token', async () => {
    const api = new FakeApi();
    const [tab] = tabs(api);
    expect(tab.getState().status).toBe('loading');
    await tab.bootstrap();
    expect(tab.getState().status).toBe('authenticated');
  });

  it('knows the person is signed out when there is no cookie', async () => {
    const api = new FakeApi();
    api.cookie = null;
    const [tab] = tabs(api);
    await tab.bootstrap();
    expect(tab.getState()).toEqual({ status: 'unauthenticated', reason: 'expired' });
  });

  it('does not sign anyone out when the API is down', async () => {
    const api = new FakeApi();
    api.down = true;
    const [tab] = tabs(api);
    await tab.bootstrap();
    expect(tab.getState().status).toBe('unavailable');
    // And it recovers when the API is back.
    api.down = false;
    await tab.bootstrap();
    expect(tab.getState().status).toBe('authenticated');
  });
});

describe('single flight', () => {
  it('shares one refresh request between callers in the same tab', async () => {
    const api = new FakeApi();
    const [tab] = tabs(api);
    await Promise.all([tab.refresh(), tab.refresh(), tab.refresh()]);
    expect(api.refreshCalls).toBe(1);
    expect(api.reuseDetected).toBe(0);
  });

  it('refreshes once when several requests find the token expired at the same time', async () => {
    const api = new FakeApi();
    const [tab] = tabs(api);
    await tab.bootstrap();
    api.valid.clear(); // the server stops accepting the token (expired)
    const results = await Promise.all([1, 2, 3].map(() => tab.request('/ping')));
    expect(results).toHaveLength(3);
    expect(api.refreshCalls).toBe(2); // bootstrap + one shared refresh
    expect(api.reuseDetected).toBe(0);
  });
});

describe('two tabs', () => {
  it('both load at once: no reuse, nobody is signed out', async () => {
    const api = new FakeApi();
    const [a, b] = tabs(api, { locks: true, bus: false });
    await Promise.all([a.bootstrap(), b.bootstrap()]);
    expect(api.reuseDetected).toBe(0);
    expect(a.getState().status).toBe('authenticated');
    expect(b.getState().status).toBe('authenticated');
    // Without the broadcast each tab refreshed on its own, one after the other.
    expect(api.refreshCalls).toBe(2);
  });

  it('shares the new token, so the waiting tab does not refresh again', async () => {
    const api = new FakeApi();
    const [a, b] = tabs(api, { locks: true, bus: true });
    await Promise.all([a.bootstrap(), b.bootstrap()]);
    expect(api.reuseDetected).toBe(0);
    expect(api.refreshCalls).toBe(1);
    expect(b.getState().status).toBe('authenticated');
  });

  it('many tabs refreshing together stay safe', async () => {
    const api = new FakeApi();
    const locks = new FakeLocks();
    const clients = Array.from({ length: 6 }, () =>
      createAuthClient({ apiUrl: 'http://api.test', fetch: api.fetch, locks }),
    );
    await Promise.all(clients.map((c) => c.bootstrap()));
    expect(api.reuseDetected).toBe(0);
    expect(clients.every((c) => c.getState().status === 'authenticated')).toBe(true);
  });

  it('NEGATIVE CONTROL: without the lock the same race signs everybody out', async () => {
    const api = new FakeApi();
    const [a, b] = tabs(api, { locks: false, bus: false });
    await Promise.all([a.bootstrap(), b.bootstrap()]);
    expect(api.reuseDetected).toBeGreaterThan(0);
    const states = [a.getState(), b.getState()];
    expect(states.some((s) => s.status === 'unauthenticated' && s.reason === 'reused')).toBe(true);
  });

  it('a logout in one tab signs the other tab out', async () => {
    const api = new FakeApi();
    const [a, b] = tabs(api);
    await a.bootstrap();
    await b.bootstrap();
    await a.logout();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(a.getState().status).toBe('unauthenticated');
    expect(b.getState().status).toBe('unauthenticated');
  });

  it('a reuse detected in one tab is shown in the other with the reason', async () => {
    const api = new FakeApi();
    const [a, b] = tabs(api);
    await a.bootstrap();
    await b.bootstrap();
    api.cookie = 'rt-0'; // an old, already used cookie comes back
    api.valid.clear();
    await a.request('/ping').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(b.getState()).toEqual({ status: 'unauthenticated', reason: 'reused' });
  });
});

describe('request', () => {
  it('sends the token and credentials, and parses the answer', async () => {
    const api = new FakeApi();
    const [tab] = tabs(api);
    await tab.bootstrap();
    const result = await tab.request('/ping', { schema: z.object({ ok: z.boolean() }) });
    expect(result).toEqual({ ok: true });
  });

  it('retries a 401 exactly once, after one refresh', async () => {
    const api = new FakeApi();
    const [tab] = tabs(api);
    await tab.bootstrap();
    api.valid.clear();
    api.valid.add('at-2'); // the token the refresh will issue
    await expect(tab.request('/ping')).resolves.toBeUndefined();
    expect(api.refreshCalls).toBe(2);
  });

  it('gives up with the API error when the retry is also refused', async () => {
    const api = new FakeApi();
    const [tab] = tabs(api);
    await tab.bootstrap();
    api.refuseAll = true; // every token is refused, even a fresh one
    await expect(tab.request('/ping')).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(api.refreshCalls).toBe(2);
  });

  it('signs the person out when the 401 cannot be refreshed', async () => {
    const api = new FakeApi();
    const [tab] = tabs(api);
    await tab.bootstrap();
    api.valid.clear();
    api.cookie = null;
    await expect(tab.request('/ping')).rejects.toMatchObject({ status: 401 });
    expect(tab.getState().status).toBe('unauthenticated');
  });

  it('turns a failed fetch into a NetworkError and keeps the session', async () => {
    const api = new FakeApi();
    const [tab] = tabs(api);
    await tab.bootstrap();
    api.down = true;
    await expect(tab.request('/ping')).rejects.toMatchObject({ name: 'NetworkError' });
    expect(tab.getState().status).toBe('authenticated');
  });

  it('login stores a session and a logout that cannot reach the API keeps the person signed in', async () => {
    const api = new FakeApi();
    api.cookie = null;
    const [tab] = tabs(api);
    await tab.login({ email: 'a@b.co', password: 'x' });
    expect(tab.getState().status).toBe('authenticated');
    api.down = true;
    await expect(tab.logout()).rejects.toMatchObject({ name: 'NetworkError' });
    // The cookie was not revoked, so pretending to be signed out would be a lie.
    expect(tab.getState().status).toBe('authenticated');
    api.down = false;
    await tab.logout();
    expect(tab.getState().status).toBe('unauthenticated');
  });
});
