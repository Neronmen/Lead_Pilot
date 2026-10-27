import type { BrowserContext, Route } from '@playwright/test';

export const API = 'http://localhost:3999';
export const APP = 'http://localhost:3100';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface MockOptions {
  role?: Role;
  name?: string | null;
  /** What the refresh endpoint answers: a session, "expired" (401) or "down" (503). */
  refresh?: 'ok' | 'expired' | 'down';
  /** How long a refresh takes, so two tabs can overlap. */
  refreshDelayMs?: number;
}

/** A fake API for one browser context (all its tabs share it, like the real one). */
export class MockApi {
  role: Role;
  refresh: NonNullable<MockOptions['refresh']>;
  refreshCalls = 0;
  /** Times a refresh started while another was still running (the race the cross-tab lock prevents). */
  overlaps = 0;
  logoutCalls = 0;
  patches: unknown[] = [];
  /** Every API call, in order, so a test can check what was (and was not) sent. Fake values only. */
  requests: { method: string; path: string; body: unknown }[] = [];
  /** Per-test answers by "METHOD /path"; returning null falls back to the default. */
  answers = new Map<string, (body: unknown) => { status: number; body?: unknown } | null>();
  private running = 0;
  private readonly name: string | null;
  private readonly delay: number;
  /** The language saved on the account (null: follow the workspace). */
  locale: 'en' | 'vi' | null = null;
  /** The workspace's language: set when a workspace is created. */
  workspaceLocale: 'en' | 'vi' = 'en';

  constructor(options: MockOptions = {}) {
    this.role = options.role ?? 'OWNER';
    this.name = options.name === undefined ? 'Daniel Park' : options.name;
    this.refresh = options.refresh ?? 'ok';
    this.delay = options.refreshDelayMs ?? 0;
  }

  private me() {
    return {
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'daniel@northstargrowth.com',
        name: this.name,
        locale: this.locale,
      },
      workspace: {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Northstar Growth',
        slug: 'northstar',
        defaultLocale: this.workspaceLocale,
        currency: 'USD',
        timezone: 'UTC',
        defaultCountry: null,
      },
      role: this.role,
    };
  }

  private async handle(route: Route) {
    const request = route.request();
    const origin = (await request.allHeaders()).origin ?? APP;
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type,authorization,accept',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    };
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, headers: cors, contentType: 'application/json', json: body });
    const path = new URL(request.url()).pathname;

    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    let sent: unknown;
    try {
      sent = request.postDataJSON();
    } catch {
      sent = undefined;
    }
    this.requests.push({ method: request.method(), path, body: sent });
    const answer = this.answers.get(`${request.method()} ${path}`)?.(sent);
    if (answer) {
      return answer.status === 204
        ? route.fulfill({ status: 204, headers: cors })
        : json(answer.status, answer.body);
    }

    const session = (status = 200) => {
      this.refresh = 'ok'; // the refresh cookie now exists
      return json(status, { accessToken: `token-${this.requests.length}`, expiresIn: 900 });
    };
    if (path === '/auth/login') return session();
    if (path === '/auth/signup') {
      const locale = (sent as { locale?: string } | undefined)?.locale;
      if (locale === 'en' || locale === 'vi') this.workspaceLocale = locale;
      return session(201);
    }
    if (path === '/auth/invites/accept') return session();
    if (path === '/auth/invites/preview') {
      return json(200, {
        workspaceName: 'Northstar Growth',
        inviterName: 'Mia Johnson',
        role: 'MEMBER',
        email: 'ethan.brooks@northstargrowth.com',
        expiresAt: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
        accountExists: false,
      });
    }

    if (path === '/auth/refresh') {
      this.refreshCalls++;
      if (this.running > 0) this.overlaps++;
      this.running++;
      try {
        if (this.delay) await new Promise((resolve) => setTimeout(resolve, this.delay));
      } finally {
        this.running--;
      }
      if (this.refresh === 'down')
        return json(503, { error: { code: 'INTERNAL', message: 'down' } });
      if (this.refresh === 'expired')
        return json(401, { error: { code: 'AUTH_SESSION_EXPIRED', message: 'expired' } });
      return json(200, { accessToken: `token-${this.refreshCalls}`, expiresIn: 900 });
    }
    if (path === '/auth/me' && request.method() === 'GET') return json(200, this.me());
    if (path === '/auth/me' && request.method() === 'PATCH') {
      const body = request.postDataJSON() as { locale: 'en' | 'vi' | null };
      this.patches.push(body);
      this.locale = body.locale;
      return json(200, this.me());
    }
    if (path === '/auth/logout') {
      this.logoutCalls++;
      this.refresh = 'expired';
      return route.fulfill({ status: 204, headers: cors });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: path } });
  }

  async install(context: BrowserContext) {
    await context.route(`${API}/**`, (route) => this.handle(route));
  }
}

export type Theme = 'dark' | 'light';
export type Lang = 'en' | 'vi';

/** Opens a context in the given theme and language, the way a returning visitor has them stored. */
export async function prepare(context: BrowserContext, theme: Theme, lang: Lang) {
  // Nothing but the app and the mock may be reached: anything else is aborted, so a
  // test can never touch a real API. (The most recently added route wins, so this
  // catch-all is added first and `MockApi.install` overrides it for the mock.)
  await context.route(
    (url) =>
      ![new URL(APP).origin, new URL(API).origin].includes(url.origin) &&
      url.protocol.startsWith('http'),
    (route) => route.abort(),
  );
  await context.addCookies([{ name: 'lp_locale', value: lang, url: APP }]);
  await context.addInitScript((value) => {
    try {
      if (!localStorage.getItem('lp-theme')) localStorage.setItem('lp-theme', value);
    } catch {
      // storage can be blocked; the default (dark) then applies
    }
  }, theme);
}
