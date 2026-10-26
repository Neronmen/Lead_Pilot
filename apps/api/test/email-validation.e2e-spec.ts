import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorBodySchema } from '@leadpilot/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { signUp, signupBody } from './utils/auth';
import { createTestApp } from './utils/create-test-app';

// Own random prefix: another file's cleanup must not hit our users mid-test.
const PREFIX = `e2e-emailv-${randomBytes(4).toString('hex')}-`;
let counter = 0;
const address = (ending = 'com') => `${PREFIX}${Date.now()}-${++counter}@example.${ending}`;

/** The email-ending check, as every endpoint that takes an address shows it. */
describe('Email address validation (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const http = () => request(app.getHttpServer());
  const UNKNOWN_TLD = { code: 'custom', format: 'unknown_tld' };

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { memberships: { select: { workspaceId: true } } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: users.flatMap((u) => u.memberships.map((m) => m.workspaceId)) } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /auth/signup', () => {
    it('refuses an unknown ending with VALIDATION_FAILED and creates nothing', async () => {
      const email = address('cmo');
      const res = await http().post('/auth/signup').send(signupBody({ email })).expect(400);
      expect(errorBodySchema.parse(res.body).error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([{ path: 'email', ...UNKNOWN_TLD }]);
      expect(await prisma.user.count({ where: { email } })).toBe(0);
    });

    it('accepts newer endings and country second levels, stored lowercase', async () => {
      for (const ending of ['dev', 'app', 'xyz', 'vn', 'com.vn']) {
        const email = address(ending);
        const res = await http()
          .post('/auth/signup')
          .send(signupBody({ email: ` ${email.toUpperCase()} ` }))
          .expect(201);
        expect(res.body.accessToken).toBeDefined();
        expect(await prisma.user.count({ where: { email } })).toBe(1);
      }
    });

    it('answers a malformed address as invalid_format, not as an unknown ending', async () => {
      const res = await http()
        .post('/auth/signup')
        .send(signupBody({ email: 'a@[1.2.3.4]' }))
        .expect(400);
      expect(res.body.error.details).toEqual([
        { path: 'email', code: 'invalid_format', format: 'email' },
      ]);
    });
  });

  describe('POST /auth/login', () => {
    it('does not check the ending: an address that is not an account is the usual 401', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ email: address('cmo'), password: 'whatever-123' })
        .expect(401);
      expect(errorBodySchema.parse(res.body).error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    // An account whose address ending is not (or no longer) a real TLD, such as
    // one created before the check existed, must still be able to sign in.
    it('lets an existing account whose ending is no longer valid sign in', async () => {
      const owner = await signUp(app, { email: address() });
      const legacy = address('test');
      await prisma.user.update({ where: { email: owner.body.email }, data: { email: legacy } });
      const res = await http()
        .post('/auth/login')
        .send({ email: legacy.toUpperCase(), password: owner.body.password })
        .expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
    });
  });

  describe('POST /auth/login: odd addresses', () => {
    it('answers 400, not 500, for a control character such as NUL (Postgres text cannot hold it)', async () => {
      const controls = [0, 7, 10, 127].map((code) => `a${String.fromCharCode(code)}b@example.com`);
      for (const email of controls) {
        const res = await http()
          .post('/auth/login')
          .send({ email, password: 'whatever-123' })
          .expect(400);
        expect(errorBodySchema.parse(res.body).error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('answers the usual 401 for a very long or non-ASCII address that is not an account', async () => {
      const long = `${'a'.repeat(240)}@example.com`.slice(0, 254);
      for (const email of [long, 'nguyễn.văn@example.com', 'x@xn--p1ai']) {
        const res = await http()
          .post('/auth/login')
          .send({ email, password: 'whatever-123' })
          .expect(401);
        expect(errorBodySchema.parse(res.body).error.code).toBe('AUTH_INVALID_CREDENTIALS');
      }
    });
  });

  describe('POST /invites', () => {
    it('refuses the whole request when one address has an unknown ending, and sends nothing', async () => {
      const owner = await signUp(app, { email: address() });
      const good = address();
      const res = await http()
        .post('/invites')
        .set('authorization', `Bearer ${owner.accessToken}`)
        .send({ emails: [good, address('cmo')], role: 'MEMBER' })
        .expect(400);
      expect(res.body.error.details).toEqual([{ path: 'emails.1', ...UNKNOWN_TLD }]);
      const list = await http()
        .get('/invites')
        .set('authorization', `Bearer ${owner.accessToken}`)
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain(good);
    });

    it('accepts new endings and plus-addresses in invites', async () => {
      const owner = await signUp(app, { email: address() });
      const email = `${PREFIX}${Date.now()}+Tag@Example.DEV`;
      const res = await http()
        .post('/invites')
        .set('authorization', `Bearer ${owner.accessToken}`)
        .send({ emails: [email], role: 'ADMIN' })
        .expect(201);
      expect(res.body.results).toEqual([{ email: email.toLowerCase(), status: 'invited' }]);
    });
  });
});
