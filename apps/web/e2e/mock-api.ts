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
  /** The viewer is the only person in the workspace. */
  alone?: boolean;
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
  /** Wait this long (ms) before answering "METHOD /path": for loading states. */
  delays = new Map<string, number>();
  /** The workspace's people and pending invites, changed by the Team calls. */
  team: {
    id: string;
    userId: string;
    name: string | null;
    email: string;
    role: Role;
    lastActiveAt: string | null;
    joinedAt: string;
    openLeads: number;
  }[] = [];
  pending: {
    id: string;
    email: string;
    role: 'ADMIN' | 'MEMBER';
    invitedBy: { id: string; name: string | null } | null;
    expiresAt: string;
    createdAt: string;
  }[] = [];
  /** Lead sources, changed by the Sources calls. */
  sources: MockSource[] = [];
  /** Leads, newest first. */
  leads: MockLead[] = [];
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
    this.resetTeam(options.alone === true);
    this.resetSources();
  }

  /** Two sources (one working, one quiet) and a few leads, from the first source. */
  private resetSources() {
    const days = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
    this.sources = [
      {
        id: 'dddddddd-0000-4000-8000-000000000001',
        name: 'Zapier – website leads',
        type: 'WEBHOOK',
        enabled: true,
        apiKeyPrefix: 'a1b2c3d4',
        hmacEnabled: false,
        createdAt: days(60),
        leadsLast30Days: 487,
        lastLeadAt: days(0),
        last30Days: {
          received: 560,
          created: 487,
          merged: 61,
          rejected: 12,
          replayed: 4,
          topRejections: [
            { reason: 'disposable_email', count: 7 },
            { reason: 'invalid_phone', count: 3 },
            { reason: 'contact_required', count: 2 },
          ],
        },
      },
      {
        id: 'dddddddd-0000-4000-8000-000000000002',
        name: 'Livestorm',
        type: 'WEBHOOK',
        enabled: true,
        apiKeyPrefix: 'e5f6a7b8',
        hmacEnabled: true,
        createdAt: days(90),
        leadsLast30Days: 2,
        lastLeadAt: days(20),
        last30Days: {
          received: 2,
          created: 2,
          merged: 0,
          rejected: 0,
          replayed: 0,
          topRejections: [],
        },
      },
    ];
    const lead = (
      n: number,
      name: string | null,
      email: string,
      company: string | null,
      sourceIndex: number,
      over: Partial<MockLead> = {},
    ): MockLead => ({
      id: `eeeeeeee-0000-4000-8000-0000000000${String(90 - n).padStart(2, '0')}`,
      name,
      email,
      phone: null,
      company,
      country: null,
      isFreeMail: false,
      status: 'NEW',
      source: {
        id: this.sources[sourceIndex]!.id,
        name: this.sources[sourceIndex]!.name,
        type: 'WEBHOOK',
      },
      owner: null,
      submissions: 1,
      possibleDuplicateOf: null,
      createdAt: new Date(Date.now() - n * 3600_000).toISOString(),
      ...over,
    });
    this.leads = [
      lead(1, 'Ann Lee', 'ann.lee@brightpath.io', 'Brightpath', 0, { submissions: 3 }),
      lead(2, 'Nguyễn Văn An', 'an@acme.vn', 'Acme Vietnam', 0, { status: 'NEEDS_REVIEW' }),
      lead(3, null, 'sam@gmail.com', null, 1, {
        isFreeMail: true,
        possibleDuplicateOf: {
          id: 'eeeeeeee-0000-4000-8000-000000000001',
          name: 'Ann Lee',
          email: 'ann.lee@brightpath.io',
        },
      }),
      lead(5, 'Priya Shah', 'priya@northwind.com', 'Northwind', 0, { status: 'ROUTED' }),
      lead(8, 'Tom Becker', 'tom@becker.de', 'Becker GmbH', 1, { status: 'FAILED' }),
    ];
  }

  /** Four people (or one) and two pending invites, from the viewer's side. */
  private resetTeam(alone: boolean) {
    const hours = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    const person = (
      n: number,
      name: string | null,
      email: string,
      role: Role,
      active: string | null,
    ) => ({
      id: `aaaaaaaa-0000-4000-8000-00000000000${n}`,
      userId: `bbbbbbbb-0000-4000-8000-00000000000${n}`,
      name,
      email,
      role,
      lastActiveAt: active,
      joinedAt: hours(500),
      openLeads: n === 4 ? 14 : n === 3 ? 6 : 0,
    });
    const viewer = {
      ...person(1, this.name, 'daniel@northstargrowth.com', this.role, new Date().toISOString()),
      userId: '11111111-1111-4111-8111-111111111111',
    };
    const others =
      this.role === 'OWNER'
        ? []
        : [person(2, 'Mia Johnson', 'mia@northstargrowth.com', 'OWNER', hours(3))];
    this.team = alone
      ? [viewer]
      : [
          ...others.slice(0, 1),
          viewer,
          ...(this.role === 'ADMIN'
            ? []
            : [person(3, 'Linh Tran', 'linh@northstargrowth.com', 'ADMIN', hours(30))]),
          person(4, 'Ethan Brooks', 'ethan.brooks@northstargrowth.com', 'MEMBER', hours(2)),
          person(5, null, 'noah@northstargrowth.com', 'MEMBER', null),
        ];
    const inviter = { id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Mia Johnson' };
    this.pending = alone
      ? []
      : [
          {
            id: 'cccccccc-0000-4000-8000-000000000001',
            email: 'olivia@northstargrowth.com',
            role: 'MEMBER',
            invitedBy: inviter,
            expiresAt: new Date(Date.now() + 6 * 86400_000).toISOString(),
            createdAt: hours(24),
          },
          {
            id: 'cccccccc-0000-4000-8000-000000000002',
            email: 'sam@northstargrowth.com',
            role: 'ADMIN',
            invitedBy: inviter,
            expiresAt: new Date(Date.now() + 2 * 86400_000).toISOString(),
            createdAt: hours(120),
          },
        ];
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
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
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
    const wait = this.delays.get(`${request.method()} ${path}`);
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    const answer = this.answers.get(`${request.method()} ${path}`)?.(sent);
    if (answer) {
      return answer.status === 204
        ? route.fulfill({ status: 204, headers: cors })
        : json(answer.status, answer.body);
    }

    const method = request.method();
    if (path === '/members' && method === 'GET') return json(200, this.team);
    const member = /^\/members\/([0-9a-f-]{36})$/.exec(path);
    if (member && method === 'PATCH') {
      const row = this.team.find((m) => m.id === member[1]);
      if (!row) return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
      row.role = (sent as { role: Role }).role;
      return json(200, row);
    }
    if (member && method === 'DELETE') {
      this.team = this.team.filter((m) => m.id !== member[1]);
      return route.fulfill({ status: 204, headers: cors });
    }
    if (path === '/invites' && method === 'GET') return json(200, this.pending);
    if (path === '/invites' && method === 'POST') {
      const { emails, role } = sent as { emails: string[]; role: 'ADMIN' | 'MEMBER' };
      for (const email of emails) {
        this.pending.unshift({
          id: crypto.randomUUID(),
          email,
          role,
          invitedBy: { id: '11111111-1111-4111-8111-111111111111', name: this.name },
          expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
          createdAt: new Date().toISOString(),
        });
      }
      return json(201, { results: emails.map((email) => ({ email, status: 'invited' })) });
    }
    const invite = /^\/invites\/([0-9a-f-]{36})(\/resend)?$/.exec(path);
    if (invite && method === 'POST') return json(200, { status: 'invited' });
    if (invite && method === 'DELETE') {
      this.pending = this.pending.filter((i) => i.id !== invite[1]);
      return route.fulfill({ status: 204, headers: cors });
    }

    if (path === '/leads' && method === 'GET') {
      const params = new URL(request.url()).searchParams;
      const q = params.get('q')?.toLowerCase();
      const rows = this.leads.filter(
        (l) =>
          (!q || [l.name, l.email, l.company].some((v) => v?.toLowerCase().includes(q))) &&
          (!params.get('status') || l.status === params.get('status')) &&
          (!params.get('sourceId') || l.source.id === params.get('sourceId')) &&
          (!params.get('freeMail') || String(l.isFreeMail) === params.get('freeMail')),
      );
      const limit = Number(params.get('limit') ?? 25);
      const start = params.get('cursor')
        ? rows.findIndex((l) => l.id === params.get('cursor')) + 1
        : 0;
      const items = rows.slice(start, start + limit);
      const more = start + limit < rows.length;
      return json(200, { items, nextCursor: more ? items[items.length - 1]!.id : null });
    }
    if (path === '/sources' && method === 'GET') return json(200, this.sources);
    if (path === '/sources' && method === 'POST') {
      const { name, type } = sent as { name: string; type: MockSource['type'] };
      const source: MockSource = {
        id: crypto.randomUUID(),
        name,
        type,
        enabled: true,
        apiKeyPrefix: '0a1b2c3d',
        hmacEnabled: false,
        createdAt: new Date().toISOString(),
        leadsLast30Days: 0,
        lastLeadAt: null,
        last30Days: {
          received: 0,
          created: 0,
          merged: 0,
          rejected: 0,
          replayed: 0,
          topRejections: [],
        },
      };
      this.sources.push(source);
      return json(201, {
        source,
        apiKey: 'lp_0a1b2c3d.FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfake123',
      });
    }
    const src = /^\/sources\/([0-9a-f-]{36})(\/api-key|\/hmac-secret)?$/.exec(path);
    if (src) {
      const row = this.sources.find((x) => x.id === src[1]);
      if (!row) return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
      if (!src[2] && method === 'PATCH') {
        Object.assign(row, sent);
        return json(200, row);
      }
      if (!src[2] && method === 'DELETE') {
        this.sources = this.sources.filter((x) => x.id !== row.id);
        return route.fulfill({ status: 204, headers: cors });
      }
      if (src[2] === '/api-key' && method === 'POST') {
        row.apiKeyPrefix = 'ffeeddcc';
        return json(200, {
          source: row,
          apiKey: 'lp_ffeeddcc.NEWnewNEWnewNEWnewNEWnewNEWnewNEWnewNEW1234',
        });
      }
      if (src[2] === '/hmac-secret' && method === 'POST') {
        row.hmacEnabled = true;
        return json(201, { secret: 'whsec_FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfake123' });
      }
      if (src[2] === '/hmac-secret' && method === 'DELETE') {
        row.hmacEnabled = false;
        return route.fulfill({ status: 204, headers: cors });
      }
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

export interface MockSource {
  id: string;
  name: string;
  type: 'WEBHOOK' | 'FORM' | 'CSV';
  enabled: boolean;
  apiKeyPrefix: string;
  hmacEnabled: boolean;
  createdAt: string;
  leadsLast30Days: number;
  lastLeadAt: string | null;
  last30Days: {
    received: number;
    created: number;
    merged: number;
    rejected: number;
    replayed: number;
    topRejections: { reason: string; count: number }[];
  };
}

export interface MockLead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  country: string | null;
  isFreeMail: boolean;
  status: 'NEW' | 'PROCESSING' | 'NEEDS_REVIEW' | 'ROUTED' | 'FAILED';
  source: { id: string; name: string; type: 'WEBHOOK' | 'FORM' | 'CSV' };
  owner: { id: string; name: string | null } | null;
  submissions: number;
  possibleDuplicateOf: { id: string; name: string | null; email: string | null } | null;
  createdAt: string;
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
