import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { createTestApp } from './utils/create-test-app';
import { INVITES_EMAIL_PREFIX, inviteeAddress, mailbox, tokenFromEmail } from './utils/invites';

const PASSWORD = 'a-long-enough-password-1';
const NEW_PASSWORD = 'a-brand-new-password-2';

/** Forgot password and verify email: links that work once, expire, and tell nothing to strangers. */
describe('Account links (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: INVITES_EMAIL_PREFIX } },
      select: { memberships: { select: { workspaceId: true } } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: users.flatMap((u) => u.memberships.map((m) => m.workspaceId)) } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: INVITES_EMAIL_PREFIX } } });
    await prisma.$disconnect();
    await app.close();
  });

  async function signUp() {
    const email = inviteeAddress('acct');
    const res = await http()
      .post('/auth/signup')
      .send({
        name: 'Ann Account',
        workspaceName: 'Acct',
        email,
        password: PASSWORD,
        locale: 'en',
        currency: 'USD',
      })
      .expect(201);
    // The verification email is sent just after the answer (it must not hold sign-up up): wait for it.
    for (let i = 0; i < 50 && !mailbox(app).lastTo(email); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return { email, accessToken: res.body.accessToken as string };
  }
  const forgot = (email: string) => http().post('/auth/forgot-password').send({ email });

  it('sign-up sends a verification email, and the link verifies the address once', async () => {
    const { email, accessToken } = await signUp();
    const auth = { authorization: `Bearer ${accessToken}` };
    expect((await http().get('/auth/me').set(auth).expect(200)).body.user.emailVerified).toBe(
      false,
    );

    const mail = mailbox(app).lastTo(email);
    expect(mail?.subject).toMatch(/Verify your email/);
    expect(mail?.html).toContain('verify-email');
    const token = tokenFromEmail(mail);

    await http().post('/auth/verify-email').send({ token }).expect(204);
    expect((await http().get('/auth/me').set(auth).expect(200)).body.user.emailVerified).toBe(true);
    const again = await http().post('/auth/verify-email').send({ token });
    expect([again.status, again.body.error.code]).toEqual([400, 'AUTH_TOKEN_INVALID']);
  });

  it('"resend" sends another email at most once a minute, and nothing when already verified', async () => {
    const { email, accessToken } = await signUp();
    const auth = { authorization: `Bearer ${accessToken}` };
    const before = mailbox(app).outbox.filter((m) => m.to === email).length;
    await http().post('/auth/resend-verification').set(auth).expect(204);
    // The sign-up email was sent a moment ago: a second one is held back.
    expect(mailbox(app).outbox.filter((m) => m.to === email)).toHaveLength(before);

    await http()
      .post('/auth/verify-email')
      .send({ token: tokenFromEmail(mailbox(app).lastTo(email)) })
      .expect(204);
    await http().post('/auth/resend-verification').set(auth).expect(204);
    expect(mailbox(app).outbox.filter((m) => m.to === email)).toHaveLength(before);
  });

  it('forgot password: an account gets one email, an unknown address gets the same answer and none', async () => {
    const { email } = await signUp();
    const sent = mailbox(app).outbox.length;
    await forgot(email).expect(204);
    const mail = mailbox(app).lastTo(email);
    expect(mail?.subject).toMatch(/Reset your LeadPilot password/);
    expect(mail?.text).toContain('/reset-password#t=');
    expect(mailbox(app).outbox.length).toBe(sent + 1);

    // Asking again straight away does not send a second email.
    await forgot(email).expect(204);
    expect(mailbox(app).outbox.length).toBe(sent + 1);

    const stranger = inviteeAddress('nobody');
    await forgot(stranger).expect(204);
    expect(mailbox(app).outbox.length).toBe(sent + 1);
    expect(mailbox(app).lastTo(stranger)).toBeUndefined();
  });

  it('reset: the new password works, the old one and every session stop, and the link works once', async () => {
    const { email } = await signUp();
    const loggedIn = await http()
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const refreshCookie = (loggedIn.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('lp_refresh'),
    );
    await forgot(email).expect(204);
    const token = tokenFromEmail(mailbox(app).lastTo(email));

    await http().post('/auth/reset-password').send({ token, password: NEW_PASSWORD }).expect(204);
    await http().post('/auth/login').send({ email, password: NEW_PASSWORD }).expect(200);
    await http().post('/auth/login').send({ email, password: PASSWORD }).expect(401);
    // The link was proof of the mailbox: the address is verified too.
    const me = await http()
      .post('/auth/login')
      .send({ email, password: NEW_PASSWORD })
      .then((r) => http().get('/auth/me').set('authorization', `Bearer ${r.body.accessToken}`));
    expect(me.body.user.emailVerified).toBe(true);
    // The session from before the reset cannot be refreshed any more.
    if (refreshCookie) {
      await http().post('/auth/refresh').set('Cookie', refreshCookie.split(';')[0]!).expect(401);
    }
    const reused = await http()
      .post('/auth/reset-password')
      .send({ token, password: NEW_PASSWORD });
    expect([reused.status, reused.body.error.code]).toEqual([400, 'AUTH_TOKEN_INVALID']);
  });

  it('refuses a wrong, expired or wrong-kind token, and a weak new password', async () => {
    const { email } = await signUp();
    const verifyToken = tokenFromEmail(mailbox(app).lastTo(email));
    // A verification link is not a reset link.
    const wrongKind = await http()
      .post('/auth/reset-password')
      .send({ token: verifyToken, password: NEW_PASSWORD });
    expect(wrongKind.body.error.code).toBe('AUTH_TOKEN_INVALID');
    const unknown = await http()
      .post('/auth/reset-password')
      .send({ token: 'x'.repeat(43), password: NEW_PASSWORD });
    expect(unknown.body.error.code).toBe('AUTH_TOKEN_INVALID');

    await forgot(email).expect(204);
    const token = tokenFromEmail(mailbox(app).lastTo(email));
    await http().post('/auth/reset-password').send({ token, password: 'short' }).expect(400);
    // Only the hash of the token is stored: a database leak hands out no working link.
    const stored = await prisma.userToken.findMany({ where: { user: { email } } });
    expect(JSON.stringify(stored)).not.toContain(token);
    // Expired: the link stops working.
    await prisma.userToken.updateMany({
      where: { user: { email }, kind: 'PASSWORD_RESET' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const late = await http().post('/auth/reset-password').send({ token, password: NEW_PASSWORD });
    expect(late.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });
});
