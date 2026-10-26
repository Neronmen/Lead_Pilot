import { createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorBodySchema, meResponseSchema } from '@leadpilot/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { E2E_EMAIL_PREFIX, refreshCookieOf, setCookieLine, signUp, signupBody } from './utils/auth';
import { createTestApp } from './utils/create-test-app';

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: E2E_EMAIL_PREFIX } },
      select: { memberships: { select: { workspaceId: true } } },
    });
    const workspaceIds = users.flatMap((user) => user.memberships.map((m) => m.workspaceId));
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: E2E_EMAIL_PREFIX } } });
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const errorCode = (res: request.Response) => errorBodySchema.parse(res.body).error.code;

  describe('POST /auth/signup', () => {
    it('creates the user, the workspace and the OWNER membership, and signs in', async () => {
      const body = signupBody({ locale: 'vi', currency: 'VND', defaultCountry: 'vn' });
      const res = await http().post('/auth/signup').send(body).expect(201);

      expect(res.body).toEqual({ accessToken: expect.any(String), expiresIn: 900 });
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: body.email },
        include: { memberships: { include: { workspace: true } } },
      });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      // The owner follows the workspace language until they choose one.
      expect(user.locale).toBeNull();
      expect(user.memberships).toHaveLength(1);
      expect(user.memberships[0]).toMatchObject({
        role: 'OWNER',
        lastActiveAt: expect.any(Date),
        workspace: {
          name: body.workspaceName,
          defaultLocale: 'vi',
          currency: 'VND',
          defaultCountry: 'VN',
        },
      });
    });

    it('sets the refresh cookie httpOnly, SameSite=Lax, Path=/auth, for 14 days', async () => {
      const res = await http().post('/auth/signup').send(signupBody()).expect(201);
      const line = setCookieLine(res) ?? '';
      expect(line).toMatch(/HttpOnly/i);
      expect(line).toMatch(/SameSite=Lax/i);
      expect(line).toMatch(/Path=\/auth(;|$)/);
      expect(line).toMatch(/Max-Age=1209600/);
      // Secure is on only in production (tests run with NODE_ENV=test).
      expect(line).not.toMatch(/Secure/i);
      // The token itself never travels in the body.
      expect(JSON.stringify(res.body)).not.toContain(refreshCookieOf(res).split('=')[1]);
    });

    it('refuses an email that already has an account, whatever its case', async () => {
      const { body } = await signUp(app);
      const res = await http()
        .post('/auth/signup')
        .send(signupBody({ email: body.email.toUpperCase() }))
        .expect(409);
      expect(errorCode(res)).toBe('EMAIL_TAKEN');
    });

    it('refuses an email whose ending is not a real top-level domain', async () => {
      for (const email of ['chloe@gmail.cmo', 'chloe@harbour.test']) {
        const res = await http().post('/auth/signup').send(signupBody({ email })).expect(400);
        expect(errorCode(res)).toBe('VALIDATION_FAILED');
        expect(res.body.error.details).toEqual([
          { path: 'email', code: 'custom', format: 'unknown_tld' },
        ]);
        expect(await prisma.user.count({ where: { email } })).toBe(0);
      }
    });

    it('answers VALIDATION_FAILED for a weak password or an extra field', async () => {
      const res = await http()
        .post('/auth/signup')
        .send({ ...signupBody(), password: 'short', role: 'OWNER' })
        .expect(400);
      expect(errorCode(res)).toBe('VALIDATION_FAILED');
    });
  });

  describe('POST /auth/login', () => {
    it('signs in with the right password, email in any case', async () => {
      const { body } = await signUp(app);
      const res = await http()
        .post('/auth/login')
        .send({ email: ` ${body.email.toUpperCase()} `, password: body.password })
        .expect(200);
      expect(res.body.expiresIn).toBe(900);
      expect(setCookieLine(res)).toBeDefined();
    });

    it('gives a wrong password and an unknown email the same answer', async () => {
      const { body } = await signUp(app);
      const wrong = await http()
        .post('/auth/login')
        .send({ email: body.email, password: 'not-the-password' })
        .expect(401);
      const unknown = await http()
        .post('/auth/login')
        .send({ email: `${E2E_EMAIL_PREFIX}nobody@example.com`, password: 'whatever-123' })
        .expect(401);
      expect(wrong.body).toEqual(unknown.body);
      expect(errorCode(wrong)).toBe('AUTH_INVALID_CREDENTIALS');
      expect(setCookieLine(wrong)).toBeUndefined();
    });

    it('signs in to the workspace used most recently', async () => {
      const owner = await signUp(app);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: owner.body.email } });
      const other = await prisma.workspace.create({
        data: { name: 'Second', slug: `e2e-auth-second-${Date.now()}` },
      });
      // Clean up with the user: link it through a membership.
      await prisma.membership.create({
        data: {
          workspaceId: other.id,
          userId: user.id,
          role: 'MEMBER',
          lastActiveAt: new Date(Date.now() + 60_000),
        },
      });

      const res = await http()
        .post('/auth/login')
        .send({ email: owner.body.email, password: owner.body.password })
        .expect(200);
      const me = await http()
        .get('/auth/me')
        .set('authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body).toMatchObject({ workspace: { id: other.id }, role: 'MEMBER' });
    });

    it('answers AUTH_NO_WORKSPACE for an account with no membership left', async () => {
      const { body } = await signUp(app);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email } });
      const workspaceIds = (
        await prisma.membership.findMany({
          where: { userId: user.id },
          select: { workspaceId: true },
        })
      ).map((m) => m.workspaceId);
      await prisma.membership.deleteMany({ where: { userId: user.id } });
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });

      const res = await http()
        .post('/auth/login')
        .send({ email: body.email, password: body.password })
        .expect(403);
      expect(errorCode(res)).toBe('AUTH_NO_WORKSPACE');
    });
  });

  describe('POST /auth/refresh', () => {
    it('swaps the cookie for a new access token and a new cookie', async () => {
      const { refreshCookie } = await signUp(app);
      const res = await http().post('/auth/refresh').set('cookie', refreshCookie).expect(200);
      expect(res.body).toEqual({ accessToken: expect.any(String), expiresIn: 900 });
      expect(refreshCookieOf(res)).not.toBe(refreshCookie);
    });

    it('detects reuse of a swapped token and revokes the whole sign-in', async () => {
      const { refreshCookie: first } = await signUp(app);
      const rotated = await http().post('/auth/refresh').set('cookie', first).expect(200);
      const second = refreshCookieOf(rotated);

      // Someone presents the old token again: reuse.
      const reuse = await http().post('/auth/refresh').set('cookie', first).expect(401);
      expect(errorCode(reuse)).toBe('AUTH_REFRESH_REUSED');
      expect(setCookieLine(reuse)).toMatch(/lp_refresh=;/); // cleared

      // The legitimate newest token is revoked too: both parties sign in again.
      const after = await http().post('/auth/refresh').set('cookie', second).expect(401);
      expect(errorCode(after)).toBe('AUTH_SESSION_EXPIRED');
    });

    it('lets only one of two simultaneous refreshes with the same token win', async () => {
      const { refreshCookie } = await signUp(app);
      const results = await Promise.all([
        http().post('/auth/refresh').set('cookie', refreshCookie),
        http().post('/auth/refresh').set('cookie', refreshCookie),
      ]);
      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([200, 401]);
      // The loser looks like reuse, so the whole family is revoked.
      const winner = results.find((res) => res.status === 200);
      const loser = results.find((res) => res.status === 401);
      if (!winner || !loser) throw new Error('expected one winner and one loser');
      expect(errorCode(loser)).toBe('AUTH_REFRESH_REUSED');
      expect(setCookieLine(loser)).toMatch(/lp_refresh=;/);
      await http().post('/auth/refresh').set('cookie', refreshCookieOf(winner)).expect(401);
    });

    it('answers AUTH_SESSION_EXPIRED without a cookie, or with an unknown or expired one', async () => {
      const none = await http().post('/auth/refresh').expect(401);
      expect(errorCode(none)).toBe('AUTH_SESSION_EXPIRED');
      const unknown = await http()
        .post('/auth/refresh')
        .set('cookie', 'lp_refresh=forged')
        .expect(401);
      expect(errorCode(unknown)).toBe('AUTH_SESSION_EXPIRED');

      const { body, refreshCookie } = await signUp(app);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email } });
      await prisma.refreshToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await http().post('/auth/refresh').set('cookie', refreshCookie).expect(401);
      expect(errorCode(expired)).toBe('AUTH_SESSION_EXPIRED');
    });

    it('keeps the session in its workspace', async () => {
      const { refreshCookie, accessToken } = await signUp(app);
      const before = await http().get('/auth/me').set('authorization', `Bearer ${accessToken}`);
      const res = await http().post('/auth/refresh').set('cookie', refreshCookie).expect(200);
      const after = await http()
        .get('/auth/me')
        .set('authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(after.body.workspace.id).toBe(before.body.workspace.id);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the sign-in and clears the cookie', async () => {
      const { refreshCookie } = await signUp(app);
      const res = await http().post('/auth/logout').set('cookie', refreshCookie).expect(204);
      expect(setCookieLine(res)).toMatch(/lp_refresh=;/);
      const after = await http().post('/auth/refresh').set('cookie', refreshCookie).expect(401);
      expect(errorCode(after)).toBe('AUTH_SESSION_EXPIRED');
    });

    it('succeeds without a session', async () => {
      await http().post('/auth/logout').expect(204);
    });
  });

  describe('GET /auth/me and the access token', () => {
    it('returns the signed-in user, workspace and role', async () => {
      const { body, accessToken } = await signUp(app);
      const res = await http()
        .get('/auth/me')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(meResponseSchema.parse(res.body)).toMatchObject({
        user: { email: body.email, name: body.name, locale: null },
        workspace: {
          name: body.workspaceName,
          defaultLocale: 'en',
          currency: 'USD',
          timezone: 'UTC',
        },
        role: 'OWNER',
      });
    });

    it('accepts the Bearer scheme in any letter case (RFC 7235)', async () => {
      const { accessToken } = await signUp(app);
      await http().get('/auth/me').set('authorization', `bearer ${accessToken}`).expect(200);
    });

    it('refuses a correctly signed token that has no expiry', async () => {
      const { accessToken } = await signUp(app);
      const claims = JSON.parse(
        Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString(),
      ) as { sub: string; wid: string };
      // jsonwebtoken adds `exp` from the module's signOptions unless the
      // payload is signed with a fresh service that has no default expiry.
      const forever = await new JwtService().signAsync(
        { sub: claims.sub, wid: claims.wid },
        {
          secret:
            process.env.JWT_ACCESS_SECRET ?? 'leadpilot-dev-only-jwt-secret-not-for-production',
          issuer: 'leadpilot',
          audience: 'leadpilot-api',
        },
      );
      expect(
        JSON.parse(Buffer.from(forever.split('.')[1] ?? '', 'base64url').toString()),
      ).not.toHaveProperty('exp');
      const res = await http()
        .get('/auth/me')
        .set('authorization', `Bearer ${forever}`)
        .expect(401);
      expect(errorCode(res)).toBe('AUTH_SESSION_EXPIRED');
    });

    it('answers AUTH_SESSION_EXPIRED without a token, like an expired one', async () => {
      const res = await http().get('/auth/me').expect(401);
      expect(errorCode(res)).toBe('AUTH_SESSION_EXPIRED');
    });

    it('refuses forged, expired, alg-none and wrong-secret tokens', async () => {
      const { accessToken } = await signUp(app);
      const [header, payload] = accessToken.split('.');
      const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()) as {
        sub: string;
        wid: string;
      };
      const identity = { sub: claims.sub, wid: claims.wid };
      const jwt = app.get(JwtService);
      const tokens = {
        garbage: 'not.a.token',
        tamperedPayload: `${header}.${Buffer.from(JSON.stringify({ ...claims, wid: crypto.randomUUID() })).toString('base64url')}.${accessToken.split('.')[2]}`,
        algNone: `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`,
        wrongSecret: await jwt.signAsync(identity, {
          secret: 'another-secret-of-at-least-32-chars!!',
        }),
        expired: await jwt.signAsync(identity, { expiresIn: -10 }),
      };
      for (const [name, token] of Object.entries(tokens)) {
        const res = await http().get('/auth/me').set('authorization', `Bearer ${token}`);
        expect({ name, status: res.status, code: errorCode(res) }).toEqual({
          name,
          status: 401,
          code: 'AUTH_SESSION_EXPIRED',
        });
      }
    });

    it('stops a removed member at once, with a token that has not expired', async () => {
      const { body, accessToken, refreshCookie } = await signUp(app);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email } });
      await prisma.membership.deleteMany({ where: { userId: user.id } });

      const me = await http()
        .get('/auth/me')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(401);
      expect(errorCode(me)).toBe('AUTH_SESSION_EXPIRED');
      // Removing the membership also deleted its refresh tokens.
      await http().post('/auth/refresh').set('cookie', refreshCookie).expect(401);
    });

    it('cannot reach another workspace: a valid token naming a foreign workspace is refused', async () => {
      const a = await signUp(app);
      const b = await signUp(app);
      const meB = await http().get('/auth/me').set('authorization', `Bearer ${b.accessToken}`);
      const userA = await prisma.user.findUniqueOrThrow({ where: { email: a.body.email } });

      // Correctly signed, but A is not a member of B's workspace.
      const forged = await app
        .get(JwtService)
        .signAsync({ sub: userA.id, wid: meB.body.workspace.id as string });
      const res = await http().get('/auth/me').set('authorization', `Bearer ${forged}`).expect(401);
      expect(errorCode(res)).toBe('AUTH_SESSION_EXPIRED');
    });
  });

  describe('PATCH /auth/me', () => {
    it("saves the user's language and goes back to the workspace default with null", async () => {
      const { accessToken } = await signUp(app);
      const auth = `Bearer ${accessToken}`;
      const vi = await http()
        .patch('/auth/me')
        .set('authorization', auth)
        .send({ locale: 'vi' })
        .expect(200);
      expect(vi.body.user.locale).toBe('vi');
      const reset = await http()
        .patch('/auth/me')
        .set('authorization', auth)
        .send({ locale: null })
        .expect(200);
      expect(reset.body.user.locale).toBeNull();
    });

    it('refuses an unknown language or any other field', async () => {
      const { accessToken } = await signUp(app);
      for (const body of [{ locale: 'fr' }, { locale: 'vi', name: 'Mallory' }]) {
        const res = await http()
          .patch('/auth/me')
          .set('authorization', `Bearer ${accessToken}`)
          .send(body)
          .expect(400);
        expect(errorCode(res)).toBe('VALIDATION_FAILED');
      }
    });

    it('requires a token', async () => {
      await http().patch('/auth/me').send({ locale: 'vi' }).expect(401);
    });
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────

  /** A hand-made HMAC token, so the header can carry anything. */
  function hmacToken(header: object, payload: object, secret: string, hash = 'sha256'): string {
    const enc = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
    const data = `${enc(header)}.${enc(payload)}`;
    return `${data}.${createHmac(hash, secret).update(data).digest('base64url')}`;
  }

  const jwtSecret = () => app.get(ConfigService).get<string>('JWT_ACCESS_SECRET') ?? '';

  async function userIdOf(email: string): Promise<string> {
    return (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  }

  describe('refresh rotation edge cases', () => {
    it('treats an expired token that was also replaced as reuse, and revokes the family', async () => {
      const { body, refreshCookie: first } = await signUp(app);
      const rotated = await http().post('/auth/refresh').set('cookie', first).expect(200);
      const second = refreshCookieOf(rotated);
      await prisma.refreshToken.updateMany({
        where: { userId: await userIdOf(body.email), revokedAt: { not: null } },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const old = await http().post('/auth/refresh').set('cookie', first).expect(401);
      expect(errorCode(old)).toBe('AUTH_REFRESH_REUSED');
      const after = await http().post('/auth/refresh').set('cookie', second).expect(401);
      expect(errorCode(after)).toBe('AUTH_SESSION_EXPIRED');
    });

    it('refuses a refresh once the membership is gone, even while the user has another workspace', async () => {
      const owner = await signUp(app);
      const userId = await userIdOf(owner.body.email);
      const first = await prisma.membership.findFirstOrThrow({ where: { userId } });
      const other = await prisma.workspace.create({
        data: { name: 'Other', slug: `e2e-auth-other-${Date.now()}` },
      });
      await prisma.membership.create({ data: { workspaceId: other.id, userId, role: 'MEMBER' } });
      await prisma.membership.delete({ where: { id: first.id } });

      const res = await http().post('/auth/refresh').set('cookie', owner.refreshCookie).expect(401);
      expect(errorCode(res)).toBe('AUTH_SESSION_EXPIRED');
      expect(setCookieLine(res)).toMatch(/^lp_refresh=;/);
      expect(await prisma.refreshToken.count({ where: { userId } })).toBe(0);
    });

    it('after logout, an older token of that sign-in cannot start a session again', async () => {
      const { body, refreshCookie: first } = await signUp(app);
      const rotated = await http().post('/auth/refresh').set('cookie', first).expect(200);
      await http().post('/auth/logout').set('cookie', refreshCookieOf(rotated)).expect(204);

      const res = await http().post('/auth/refresh').set('cookie', first).expect(401);
      expect(['AUTH_REFRESH_REUSED', 'AUTH_SESSION_EXPIRED']).toContain(errorCode(res));
      expect(setCookieLine(res)).toMatch(/^lp_refresh=;/);
      const live = await prisma.refreshToken.count({
        where: { userId: await userIdOf(body.email), revokedAt: null },
      });
      expect(live).toBe(0);
    });

    it('logout with an older token of the family ends the newest session too', async () => {
      const { refreshCookie: first } = await signUp(app);
      const rotated = await http().post('/auth/refresh').set('cookie', first).expect(200);
      await http().post('/auth/logout').set('cookie', first).expect(204);
      await http().post('/auth/refresh').set('cookie', refreshCookieOf(rotated)).expect(401);
    });
  });

  describe('refresh cookie clearing', () => {
    /** Cookie attributes a browser matches on, without the value and lifetime. */
    function attributes(line: string): Record<string, string> {
      const pairs = line
        .split(';')
        .slice(1)
        .map((part) => part.trim().split('='))
        .map(([key, value]) => [(key ?? '').toLowerCase(), value ?? ''] as const)
        .filter(([key]) => key !== 'max-age' && key !== 'expires');
      return Object.fromEntries(pairs);
    }

    it('clears with the Path, Domain, HttpOnly and SameSite it was set with, and expires it', async () => {
      const signup = await http().post('/auth/signup').send(signupBody()).expect(201);
      const set = setCookieLine(signup) ?? '';
      const logout = await http()
        .post('/auth/logout')
        .set('cookie', refreshCookieOf(signup))
        .expect(204);
      const failedRefresh = await http()
        .post('/auth/refresh')
        .set('cookie', 'lp_refresh=forged')
        .expect(401);

      for (const cleared of [setCookieLine(logout) ?? '', setCookieLine(failedRefresh) ?? '']) {
        expect(cleared).toMatch(/^lp_refresh=;/);
        expect(attributes(cleared)).toEqual(attributes(set));
        const expires = /Expires=([^;]+)/i.exec(cleared)?.[1];
        expect(expires).toBeDefined();
        expect(new Date(expires ?? '').getTime()).toBeLessThan(Date.now());
      }
      expect(set).not.toMatch(/Domain=/i);
    });
  });

  describe('access token header and claim tricks', () => {
    const iss = 'leadpilot';
    const aud = 'leadpilot-api';

    async function identity(): Promise<{ sub: string; wid: string }> {
      const { accessToken } = await signUp(app);
      const me = await http()
        .get('/auth/me')
        .set('authorization', `Bearer ${accessToken}`)
        .expect(200);
      return { sub: me.body.user.id as string, wid: me.body.workspace.id as string };
    }

    async function expectRefused(tokens: Record<string, string>): Promise<void> {
      for (const [name, token] of Object.entries(tokens)) {
        const res = await http().get('/auth/me').set('authorization', `Bearer ${token}`);
        expect({ name, status: res.status, code: errorCode(res) }).toEqual({
          name,
          status: 401,
          code: 'AUTH_SESSION_EXPIRED',
        });
      }
    }

    it('ignores kid / jku / jwk headers: only the server secret verifies a token', async () => {
      const { sub, wid } = await identity();
      const now = Math.floor(Date.now() / 1000);
      const claims = { sub, wid, iss, aud, iat: now, exp: now + 600 };
      const attacker = 'attacker-controlled-secret-of-32-chars!!';
      await expectRefused({
        jku: hmacToken(
          { alg: 'HS256', typ: 'JWT', jku: 'https://evil.example/jwks.json', kid: 'k1' },
          claims,
          attacker,
        ),
        kidPathTraversal: hmacToken(
          { alg: 'HS256', typ: 'JWT', kid: '../../../../dev/null' },
          claims,
          '',
        ),
        kidSqlInjection: hmacToken(
          { alg: 'HS256', typ: 'JWT', kid: "x' UNION SELECT 'attacker" },
          claims,
          'attacker',
        ),
        embeddedJwk: hmacToken(
          {
            alg: 'HS256',
            typ: 'JWT',
            jwk: { kty: 'oct', k: Buffer.from(attacker).toString('base64url') },
          },
          claims,
          attacker,
        ),
        hs512WithRealSecret: hmacToken({ alg: 'HS512', typ: 'JWT' }, claims, jwtSecret(), 'sha512'),
      });
    });

    it('refuses a correctly signed token without sub or wid, with bad ids, or for another issuer or audience', async () => {
      const { sub, wid } = await identity();
      const now = Math.floor(Date.now() / 1000);
      const base = { iss, aud, iat: now, exp: now + 600 };
      const sign = (payload: object) =>
        hmacToken({ alg: 'HS256', typ: 'JWT' }, payload, jwtSecret());
      await expectRefused({
        noSub: sign({ ...base, wid }),
        noWid: sign({ ...base, sub }),
        noClaims: sign(base),
        subNotUuid: sign({ ...base, sub: 'admin', wid }),
        widArray: sign({ ...base, sub, wid: [wid] }),
        subNumber: sign({ ...base, sub: 1, wid }),
        otherIssuer: sign({ ...base, sub, wid, iss: 'someone-else' }),
        otherAudience: sign({ ...base, sub, wid, aud: 'another-api' }),
        noAudience: sign({ sub, wid, iss, iat: now, exp: now + 600 }),
        notYetValid: sign({ ...base, sub, wid, nbf: now + 3600 }),
      });
    });

    it('accepts a genuine token whose header also carries a kid (headers are ignored, not trusted)', async () => {
      const { sub, wid } = await identity();
      const now = Math.floor(Date.now() / 1000);
      const token = hmacToken(
        { alg: 'HS256', typ: 'JWT', kid: 'anything' },
        { sub, wid, iss, aud, iat: now, exp: now + 600 },
        jwtSecret(),
      );
      await http().get('/auth/me').set('authorization', `Bearer ${token}`).expect(200);
    });
  });

  describe('PATCH /auth/me changes only the locale', () => {
    it('refuses every other field and leaves the user, membership and workspace untouched', async () => {
      const { body, accessToken } = await signUp(app);
      const userId = await userIdOf(body.email);
      const snapshot = () =>
        prisma.user.findUniqueOrThrow({
          where: { id: userId },
          include: { memberships: { include: { workspace: true } } },
        });
      const before = await snapshot();

      const attempts: unknown[] = [
        {},
        { email: 'mallory@example.com' },
        { locale: 'vi', email: 'mallory@example.com' },
        { locale: 'vi', role: 'OWNER' },
        { locale: 'vi', passwordHash: 'x' },
        { locale: 'vi', password: 'new-password-2026!' },
        { locale: 'vi', workspaceId: crypto.randomUUID() },
        { locale: 'vi', id: crypto.randomUUID() },
        { locale: 'vi', defaultLocale: 'vi' },
        { locale: 'vi', user: { name: 'Mallory' } },
        JSON.parse('{"locale":"vi","__proto__":{"role":"OWNER"}}'),
        { locale: 'VI' },
        [{ locale: 'vi' }],
      ];
      for (const attempt of attempts) {
        const res = await http()
          .patch('/auth/me')
          .set('authorization', `Bearer ${accessToken}`)
          .set('content-type', 'application/json')
          .send(JSON.stringify(attempt));
        expect({ attempt, status: res.status, code: errorCode(res) }).toEqual({
          attempt,
          status: 400,
          code: 'VALIDATION_FAILED',
        });
      }
      expect(await snapshot()).toEqual(before);
    });

    it("changes only the caller's own user, never another account", async () => {
      const a = await signUp(app);
      const b = await signUp(app);
      await http()
        .patch('/auth/me')
        .set('authorization', `Bearer ${a.accessToken}`)
        .send({ locale: 'vi' })
        .expect(200);
      const userB = await prisma.user.findUniqueOrThrow({ where: { email: b.body.email } });
      expect(userB.locale).toBeNull();
    });
  });

  describe('signup race', () => {
    it('two simultaneous signups with one email: exactly one 201, one EMAIL_TAKEN, one workspace', async () => {
      const workspaceName = `Race ${Date.now()}`;
      const first = signupBody({ workspaceName });
      const second = { ...signupBody({ workspaceName }), email: first.email.toUpperCase() };
      const results = await Promise.all([
        http().post('/auth/signup').send(first),
        http().post('/auth/signup').send(second),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      const loser = results.find((res) => res.status === 409);
      if (!loser) throw new Error('no loser');
      expect(errorCode(loser)).toBe('EMAIL_TAKEN');
      expect(setCookieLine(loser)).toBeUndefined();
      // The losing transaction rolled back: no orphan workspace.
      expect(await prisma.workspace.count({ where: { name: workspaceName } })).toBe(1);
      expect(await prisma.user.count({ where: { email: first.email } })).toBe(1);
    });
  });

  describe('login does not reveal which emails have accounts', () => {
    it('a wrong password on an account with no workspace is still AUTH_INVALID_CREDENTIALS', async () => {
      const { body } = await signUp(app);
      const userId = await userIdOf(body.email);
      const workspaceIds = (await prisma.membership.findMany({ where: { userId } })).map(
        (m) => m.workspaceId,
      );
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });

      const res = await http()
        .post('/auth/login')
        .send({ email: body.email, password: 'not-the-password' })
        .expect(401);
      expect(errorCode(res)).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('takes about as long for an unknown email as for a wrong password', async () => {
      const { body } = await signUp(app);
      const timed = async (email: string) => {
        const start = performance.now();
        await http().post('/auth/login').send({ email, password: 'not-the-password' }).expect(401);
        return performance.now() - start;
      };
      const unknownEmail = () => `${E2E_EMAIL_PREFIX}nobody-${crypto.randomUUID()}@example.com`;
      // Warm up: the first unknown-email login also builds the dummy hash.
      await timed(unknownEmail());
      await timed(body.email);

      const known: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < 7; i += 1) {
        known.push(await timed(body.email));
        unknown.push(await timed(unknownEmail()));
      }
      const median = (xs: number[]) =>
        [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] ?? 0;
      const ratio = median(unknown) / median(known);
      // Without the dummy verification an unknown email answers many times faster.
      // Wide bounds: parallel test files make argon2 timings noisy. Without the
      // dummy verification an unknown email would be many times faster.
      expect(ratio).toBeGreaterThan(0.4);
      expect(ratio).toBeLessThan(2.5);
    }, 60_000);
  });
});
