import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAuthClient, type ChannelLike } from './auth-client';

/** A scripted fetch: each call is handled by a function the test controls. */
type Handler = (path: string, init: RequestInit | undefined) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
const session = (n: number, expiresIn = 900) => json(200, { accessToken: `at-${n}`, expiresIn });
const err = (status: number, code: string) => json(status, { error: { code, message: 'x' } });

/** A channel the test can push messages into. */
function manualChannel() {
  const channel: ChannelLike & { deliver(data: unknown): void } = {
    postMessage() {},
    onmessage: null,
    deliver(data) {
      channel.onmessage?.({ data });
    },
  };
  return channel;
}

function setup(handler: Handler, extra: { now?: () => number; channel?: ChannelLike } = {}) {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const path = String(input).replace('http://api.test', '');
    calls.push({ path, init });
    return handler(path, init);
  };
  const client = createAuthClient({ apiUrl: 'http://api.test', fetch: fetchFn, ...extra });
  const count = (p: string) => calls.filter((c) => c.path === p).length;
  return { client, calls, count };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('refresh failures', () => {
  it('a 5xx on bootstrap leaves the person unknown, not signed out, and retry works', async () => {
    let fail = true;
    const { client, count } = setup((path) =>
      path === '/auth/refresh'
        ? fail
          ? err(503, 'SERVICE_UNAVAILABLE')
          : session(1)
        : json(200, {}),
    );
    await client.bootstrap();
    expect(client.getState().status).toBe('unavailable');
    fail = false;
    await client.bootstrap(); // inFlight must have been cleared
    expect(client.getState().status).toBe('authenticated');
    expect(count('/auth/refresh')).toBe(2);
  });

  it('a 502 with an HTML body is also not a sign-out', async () => {
    const { client } = setup(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await client.bootstrap();
    expect(client.getState().status).toBe('unavailable');
  });

  it('a network error on refresh rejects every waiter once and clears inFlight', async () => {
    let down = true;
    const { client, count } = setup(() => {
      if (down) throw new TypeError('offline');
      return session(1);
    });
    const results = await Promise.allSettled([client.refresh(), client.refresh()]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(count('/auth/refresh')).toBe(1);
    down = false;
    await expect(client.refresh()).resolves.toMatchObject({ accessToken: 'at-1' });
  });

  it('a refresh 200 with the wrong shape is not a session', async () => {
    const { client } = setup(() => json(200, { token: 'nope' }));
    await client.bootstrap();
    expect(client.getState().status).toBe('unavailable');
  });

  it('a request whose refresh gets a 5xx keeps the authenticated state', async () => {
    let phase = 0;
    const { client } = setup((path) => {
      if (path === '/auth/refresh') return phase === 0 ? session(1, 1) : err(500, 'INTERNAL');
      return json(200, { ok: true });
    });
    await client.bootstrap();
    phase = 1;
    await expect(client.request('/ping')).rejects.toMatchObject({ status: 500 });
    expect(client.getState().status).toBe('authenticated');
  });
});

describe('401 retry', () => {
  it('retries once only: a second 401 surfaces, with one extra refresh', async () => {
    let n = 0;
    const { client, count } = setup((path) =>
      path === '/auth/refresh' ? session(++n) : err(401, 'UNAUTHORIZED'),
    );
    await client.bootstrap();
    await expect(client.request('/ping')).rejects.toMatchObject({ status: 401 });
    expect(count('/ping')).toBe(2);
    expect(count('/auth/refresh')).toBe(2);
  });

  it('anonymous requests never refresh or retry on 401', async () => {
    const { client, count } = setup(() => err(401, 'AUTH_INVALID_CREDENTIALS'));
    await expect(client.login({ email: 'a', password: 'b' })).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    expect(count('/auth/login')).toBe(1);
    expect(count('/auth/refresh')).toBe(0);
    expect(client.getState().status).toBe('loading');
  });

  // SOURCE BUG (low): refresh(force) reads `rejected = token?.value` when the refresh starts, not
  // the token the failed request actually sent. If another tab's token arrived in between, it is
  // treated as the rejected one and one needless extra rotation happens (no reuse, just waste).
  it('on a 401, uses the token another tab delivered meanwhile instead of refreshing again', async () => {
    const channel = manualChannel();
    const gate = deferred<Response>();
    let issued = 0;
    const { client, count } = setup(
      (path, init) => {
        if (path === '/auth/refresh') return session(++issued);
        const auth = new Headers(init?.headers).get('authorization');
        return auth === 'Bearer at-1' ? gate.promise : json(200, { ok: true });
      },
      { channel },
    );
    await client.bootstrap();
    const pending = client.request('/ping');
    await tick();
    channel.deliver({ type: 'token', accessToken: 'at-other', expiresAt: Date.now() + 600_000 });
    gate.resolve(err(401, 'UNAUTHORIZED'));
    await pending;
    expect(count('/auth/refresh')).toBe(1);
  });
});

describe('concurrency', () => {
  it('requests made during bootstrap wait for it and share its single refresh', async () => {
    const { client, count } = setup((path) =>
      path === '/auth/refresh' ? session(1) : json(200, { ok: true }),
    );
    const boot = client.bootstrap();
    const reqs = [client.request('/a'), client.request('/b')];
    await Promise.all([boot, ...reqs]);
    expect(count('/auth/refresh')).toBe(1);
    expect(client.getState().status).toBe('authenticated');
  });

  it('a token broadcast during our own refresh does not break the state', async () => {
    const channel = manualChannel();
    const gate = deferred<Response>();
    const { client } = setup(() => gate.promise, { channel });
    const boot = client.bootstrap();
    await tick();
    channel.deliver({ type: 'token', accessToken: 'at-b', expiresAt: Date.now() + 600_000 });
    expect(client.getState().status).toBe('authenticated');
    gate.resolve(session(1));
    await boot;
    expect(client.getState().status).toBe('authenticated');
  });
});

describe('logout and login', () => {
  it('a refresh response that lands after logout does not resurrect the session', async () => {
    const gate = deferred<Response>();
    const { client } = setup((path) =>
      path === '/auth/refresh' ? gate.promise : new Response(null, { status: 204 }),
    );
    const boot = client.bootstrap();
    await client.logout();
    expect(client.getState().status).toBe('unauthenticated');
    gate.resolve(session(1));
    await boot;
    // A deliberate logout is not an "expired" sign-out.
    expect(client.getState()).toEqual({ status: 'unauthenticated' });
  });

  it('login after logout works and clears the old reason', async () => {
    const { client } = setup((path) =>
      path === '/auth/logout' ? new Response(null, { status: 204 }) : session(7),
    );
    await client.login({});
    await client.logout();
    expect(client.getState().status).toBe('unauthenticated');
    await client.login({});
    expect(client.getState()).toEqual({ status: 'authenticated' });
  });

  it('a non-anonymous request after logout sends no token', async () => {
    const { client, calls } = setup((path) => {
      if (path === '/auth/logout') return new Response(null, { status: 204 });
      if (path === '/auth/refresh') return err(401, 'AUTH_SESSION_EXPIRED');
      return err(401, 'UNAUTHORIZED');
    });
    await client.logout();
    await expect(client.request('/ping')).rejects.toMatchObject({ status: 401 });
    const ping = calls.find((c) => c.path === '/ping')!;
    expect(new Headers(ping.init?.headers).get('authorization')).toBeNull();
  });
});

describe('clock edges', () => {
  it('a token with exactly the margin left is refreshed; one ms more is used', async () => {
    let t = 1_000_000;
    let n = 0;
    const { client, count } = setup(
      (path) => (path === '/auth/refresh' ? session(++n, 60) : json(200, { ok: true })),
      { now: () => t },
    );
    await client.bootstrap(); // expires at t + 60_000
    t += 29_999;
    await client.request('/ping');
    expect(count('/auth/refresh')).toBe(1);
    t += 1; // exactly 30_000 left
    await client.request('/ping');
    expect(count('/auth/refresh')).toBe(2);
  });

  it('an expiresIn shorter than the margin refreshes on every request but still works', async () => {
    let n = 0;
    const { client, count } = setup(
      (path) => (path === '/auth/refresh' ? session(++n, 5) : json(200, { ok: true })),
      { now: () => 0 },
    );
    await client.bootstrap();
    await client.request('/a');
    await client.request('/b');
    expect(count('/auth/refresh')).toBe(3);
    expect(client.getState().status).toBe('authenticated');
  });

  it('expiresIn 1 (the schema minimum) does not loop forever', async () => {
    const { client } = setup(
      (path) => (path === '/auth/refresh' ? session(1, 1) : json(200, { ok: true })),
      { now: () => 0 },
    );
    await client.bootstrap();
    await expect(client.request('/a')).resolves.toBeUndefined();
  });
});

describe('response handling', () => {
  const isRefresh = (path: string) => path === '/auth/refresh';

  it('204 resolves undefined even with a schema', async () => {
    const { client } = setup((p) =>
      isRefresh(p) ? session(1) : new Response(null, { status: 204 }),
    );
    await client.bootstrap();
    await expect(client.request('/x', { schema: z.object({}) })).resolves.toBeUndefined();
  });

  it('a non-JSON 200 with a schema is an UNKNOWN ApiError', async () => {
    const { client } = setup((p) =>
      isRefresh(p) ? session(1) : new Response('hello', { status: 200 }),
    );
    await client.bootstrap();
    await expect(client.request('/x', { schema: z.object({}) })).rejects.toMatchObject({
      code: 'UNKNOWN',
    });
  });

  it('a non-JSON 200 without a schema is fine', async () => {
    const { client } = setup((p) =>
      isRefresh(p) ? session(1) : new Response('hello', { status: 200 }),
    );
    await client.bootstrap();
    await expect(client.request('/x')).resolves.toBeUndefined();
  });

  it('schema mismatch is an UNKNOWN ApiError', async () => {
    const { client } = setup((p) => (isRefresh(p) ? session(1) : json(200, { a: 1 })));
    await client.bootstrap();
    await expect(
      client.request('/x', { schema: z.object({ b: z.string() }) }),
    ).rejects.toMatchObject({ code: 'UNKNOWN', status: 200 });
  });

  it('a non-JSON error body becomes an UNKNOWN ApiError with the status', async () => {
    const { client } = setup((p) =>
      isRefresh(p) ? session(1) : new Response('oops', { status: 418 }),
    );
    await client.bootstrap();
    await expect(client.request('/x')).rejects.toMatchObject({ status: 418, code: 'UNKNOWN' });
  });

  it('serialises the body as JSON and picks the method', async () => {
    const { client, calls } = setup((p) => (isRefresh(p) ? session(1) : json(200, {})));
    await client.bootstrap();
    await client.request('/x', { body: { a: 1 } });
    await client.request('/y');
    await client.request('/z', { method: 'PATCH', body: { b: 2 } });
    const [x, y, z2] = calls.slice(1);
    expect(x!.init?.method).toBe('POST');
    expect(x!.init?.body).toBe('{"a":1}');
    expect(new Headers(x!.init?.headers).get('content-type')).toBe('application/json');
    expect(y!.init?.method).toBe('GET');
    expect(y!.init?.body).toBeUndefined();
    expect(new Headers(y!.init?.headers).get('content-type')).toBeNull();
    expect(z2!.init?.method).toBe('PATCH');
  });

  it('a falsy body (0, false, null) is still sent', async () => {
    const { client, calls } = setup((p) => (isRefresh(p) ? session(1) : json(200, {})));
    await client.bootstrap();
    await client.request('/x', { body: 0 });
    await client.request('/x', { body: false });
    await client.request('/x', { body: null });
    expect(calls.slice(1).map((c) => c.init?.body)).toEqual(['0', 'false', 'null']);
  });
});

describe('listeners', () => {
  it('a listener may call getState and unsubscribe itself', async () => {
    const { client } = setup(() => session(1));
    const seen: string[] = [];
    const other: string[] = [];
    const off = client.subscribe(() => {
      seen.push(client.getState().status);
      off();
    });
    client.subscribe(() => other.push(client.getState().status));
    await client.bootstrap();
    expect(seen).toEqual(['authenticated']);
    expect(other).toEqual(['authenticated']);
  });

  it('does not notify when the state did not change', async () => {
    const { client } = setup(() => session(1));
    let n = 0;
    client.subscribe(() => n++);
    await client.refresh();
    await client.refresh();
    expect(n).toBe(1);
  });

  // SOURCE BUG (low): setState calls listeners without try/catch, so a throwing
  // listener makes storeToken throw inside refresh, and a good refresh rejects.
  it('a throwing listener does not make a successful refresh fail', async () => {
    const { client } = setup(() => session(1));
    client.subscribe(() => {
      throw new Error('boom');
    });
    await expect(client.refresh()).resolves.toMatchObject({ accessToken: 'at-1' });
  });
});

describe('robustness', () => {
  it('ignores token messages that are not well formed', async () => {
    const channel = manualChannel();
    const { client } = setup((path) => (path === '/auth/refresh' ? session(1) : json(200, {})), {
      channel,
    });
    await client.bootstrap();
    channel.deliver({ type: 'token', accessToken: 42, expiresAt: Date.now() + 900_000 });
    channel.deliver({ type: 'token', accessToken: 'x', expiresAt: Number.NaN });
    channel.deliver(null);
    channel.deliver('nope');
    await client.request('/anything');
    expect(client.getState().status).toBe('authenticated');
  });

  it('a refresh that never answers ends as a lost connection, not a hang', async () => {
    // A fetch that only ends when its AbortSignal fires (even if already fired).
    const { client } = setup(
      (_path, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init!.signal!;
          if (signal.aborted) reject(new Error('aborted'));
          else signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const timeout = AbortSignal.timeout;
    AbortSignal.timeout = () => AbortSignal.abort();
    try {
      await client.bootstrap();
    } finally {
      AbortSignal.timeout = timeout;
    }
    expect(client.getState().status).toBe('unavailable');
  });

  it('a retry after unavailable shows loading first', async () => {
    let fail = true;
    const gate = deferred<Response>();
    const { client } = setup((path) =>
      path === '/auth/refresh' ? (fail ? err(503, 'X') : gate.promise) : json(200, {}),
    );
    await client.bootstrap();
    expect(client.getState().status).toBe('unavailable');
    fail = false;
    const retry = client.bootstrap();
    expect(client.getState().status).toBe('loading');
    gate.resolve(session(1));
    await retry;
    expect(client.getState().status).toBe('authenticated');
  });

  it('logout while another request waits for the lock does not send a dead cookie', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const locks = {
      request: async <T>(_name: string, cb: () => Promise<T>) => {
        await held;
        return cb();
      },
    };
    const client = createAuthClient({
      apiUrl: 'http://api.test',
      locks,
      fetch: async (input) => {
        const path = String(input).replace('http://api.test', '');
        calls.push(path);
        return path === '/auth/logout' ? new Response(null, { status: 204 }) : session(1);
      },
    });
    const boot = client.bootstrap();
    await client.logout();
    release();
    await boot;
    expect(calls).toEqual(['/auth/logout']);
    expect(client.getState()).toEqual({ status: 'unauthenticated' });
  });
});
