import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createInvitesResponseSchema,
  errorBodySchema,
  invitePreviewResponseSchema,
  pendingInviteSchema,
} from '@leadpilot/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { setCookieLine, signUp } from './utils/auth';
import { createTestApp } from './utils/create-test-app';
import {
  INVITES_EMAIL_PREFIX,
  inviteAddress,
  inviteeAddress,
  joinAs,
  mailbox,
  ownerOf,
  tokenFromEmail,
} from './utils/invites';

describe('Invites (e2e)', () => {
  let app: NestExpressApplication;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: INVITES_EMAIL_PREFIX } },
      select: { memberships: { select: { workspaceId: true } } },
    });
    const workspaceIds = users.flatMap((user) => user.memberships.map((m) => m.workspaceId));
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: INVITES_EMAIL_PREFIX } } });
    await prisma.$disconnect();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const bearer = (user: { accessToken: string }) => `Bearer ${user.accessToken}`;
  const errorCode = (res: request.Response) => errorBodySchema.parse(res.body).error.code;
  const dbInvite = (email: string) => prisma.invite.findFirstOrThrow({ where: { email } });

  describe('POST /invites', () => {
    it('invites several people, stores only the token hash and emails each a link', async () => {
      const owner = await ownerOf(app);
      const [a, b] = [inviteeAddress('a'), inviteeAddress('b')];
      const res = await http()
        .post('/invites')
        .set('authorization', bearer(owner))
        .send({ emails: [a, b], role: 'MEMBER' })
        .expect(201);

      expect(createInvitesResponseSchema.parse(res.body).results).toEqual([
        { email: a, status: 'invited' },
        { email: b, status: 'invited' },
      ]);
      const token = tokenFromEmail(mailbox(app).lastTo(a));
      const stored = await dbInvite(a);
      expect(stored).toMatchObject({ role: 'MEMBER', acceptedAt: null });
      expect(stored.tokenHash).not.toContain(token);
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      const days = (stored.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);
      expect(stored.invitedById).not.toBeNull();

      const mail = mailbox(app).lastTo(a);
      expect(mail?.subject).toBe('Chloe Martin invited you to Harbour & Pine on LeadPilot');
      expect(mail?.text).toContain(`/invite#t=${token}`);
      expect(mail?.text).toContain('as a member');
    });

    it('invites an address typed twice (in any case) only once', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('twice');
      const before = mailbox(app).outbox.length;
      const res = await http()
        .post('/invites')
        .set('authorization', bearer(owner))
        .send({ emails: [address, ` ${address.toUpperCase()} `], role: 'ADMIN' })
        .expect(201);
      expect(res.body.results).toEqual([{ email: address, status: 'invited' }]);
      expect(mailbox(app).outbox.length).toBe(before + 1);
      expect(await prisma.invite.count({ where: { email: address } })).toBe(1);
    });

    it('writes the email in the workspace language (Vietnamese)', async () => {
      const owner = await signUp(app, { email: inviteeAddress('vi'), locale: 'vi' });
      const address = inviteeAddress('vi-invitee');
      await inviteAddress(app, owner, address, 'ADMIN');
      const mail = mailbox(app).lastTo(address);
      expect(mail?.subject).toContain('đã mời bạn tham gia');
      expect(mail?.text).toContain('với vai trò quản trị viên');
    });

    it('says already_member for a person who is in the workspace', async () => {
      const owner = await ownerOf(app);
      const member = await joinAs(app, owner, 'MEMBER', 'joined');
      const res = await http()
        .post('/invites')
        .set('authorization', bearer(owner))
        .send({ emails: [member.email, owner.body.email], role: 'ADMIN' })
        .expect(201);
      expect(res.body.results).toEqual([
        { email: member.email, status: 'already_member' },
        { email: owner.body.email, status: 'already_member' },
      ]);
    });

    it('says already_invited for a live invite and leaves its link working', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('pending');
      const token = await inviteAddress(app, owner, address);
      const before = mailbox(app).outbox.length;
      const res = await http()
        .post('/invites')
        .set('authorization', bearer(owner))
        .send({ emails: [address], role: 'ADMIN' })
        .expect(201);
      expect(res.body.results).toEqual([{ email: address, status: 'already_invited' }]);
      expect(mailbox(app).outbox.length).toBe(before);
      await http().post('/auth/invites/preview').send({ token }).expect(200);
    });

    it('reissues an expired invite with a new link, role and expiry', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('expired');
      const oldToken = await inviteAddress(app, owner, address, 'MEMBER');
      await prisma.invite.updateMany({
        where: { email: address },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await http()
        .post('/invites')
        .set('authorization', bearer(owner))
        .send({ emails: [address], role: 'ADMIN' })
        .expect(201);
      expect(res.body.results).toEqual([{ email: address, status: 'invited' }]);
      expect(await prisma.invite.count({ where: { email: address } })).toBe(1);
      expect(await dbInvite(address)).toMatchObject({ role: 'ADMIN' });
      const newToken = tokenFromEmail(mailbox(app).lastTo(address));
      expect(newToken).not.toBe(oldToken);
      await http().post('/auth/invites/preview').send({ token: oldToken }).expect(400);
      await http().post('/auth/invites/preview').send({ token: newToken }).expect(200);
    });

    it('keeps the invite and reports email_failed when the mail server is down', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('mail-down');
      mailbox(app).failWith = new Error('connect ECONNREFUSED 127.0.0.1:1025');
      try {
        const res = await http()
          .post('/invites')
          .set('authorization', bearer(owner))
          .send({ emails: [address], role: 'MEMBER' })
          .expect(201);
        expect(res.body.results).toEqual([{ email: address, status: 'email_failed' }]);
      } finally {
        mailbox(app).failWith = undefined;
      }
      const stored = await dbInvite(address);
      // Resend delivers it once the server is back.
      const resent = await http()
        .post(`/invites/${stored.id}/resend`)
        .set('authorization', bearer(owner))
        .expect(200);
      expect(resent.body).toEqual({ status: 'invited' });
      expect(mailbox(app).lastTo(address)).toBeDefined();
    });

    it('lets an Admin invite, and stops a Member with 403', async () => {
      const owner = await ownerOf(app);
      const admin = await joinAs(app, owner, 'ADMIN', 'admin');
      const member = await joinAs(app, owner, 'MEMBER', 'member');
      const ok = await http()
        .post('/invites')
        .set('authorization', bearer(admin))
        .send({ emails: [inviteeAddress('by-admin')], role: 'MEMBER' })
        .expect(201);
      expect(ok.body.results[0].status).toBe('invited');

      const blocked = await http()
        .post('/invites')
        .set('authorization', bearer(member))
        .send({ emails: [inviteeAddress('by-member')], role: 'MEMBER' })
        .expect(403);
      expect(errorCode(blocked)).toBe('FORBIDDEN');
    });

    it('refuses to grant OWNER, unknown fields, empty and oversized lists', async () => {
      const owner = await ownerOf(app);
      const send = (body: unknown) =>
        http()
          .post('/invites')
          .set('authorization', bearer(owner))
          .send(body as object);
      const many = Array.from({ length: 21 }, () => inviteeAddress('many'));
      for (const body of [
        { emails: [inviteeAddress('x')], role: 'OWNER' },
        { emails: [inviteeAddress('x')], role: 'MEMBER', workspaceId: crypto.randomUUID() },
        { emails: [], role: 'MEMBER' },
        { emails: many, role: 'MEMBER' },
        { emails: ['not-an-email'], role: 'MEMBER' },
      ]) {
        const res = await send(body).expect(400);
        expect(errorCode(res)).toBe('VALIDATION_FAILED');
      }
    });

    it('requires a token', async () => {
      await http()
        .post('/invites')
        .send({ emails: ['a@b.co'], role: 'MEMBER' })
        .expect(401);
    });
  });

  describe('GET /invites', () => {
    it('lists pending invites with who sent them, newest first', async () => {
      const owner = await ownerOf(app);
      const [first, second] = [inviteeAddress('first'), inviteeAddress('second')];
      await inviteAddress(app, owner, first);
      await inviteAddress(app, owner, second, 'ADMIN');

      const res = await http().get('/invites').set('authorization', bearer(owner)).expect(200);
      const invites = (res.body as unknown[]).map((row) => pendingInviteSchema.parse(row));
      expect(invites.map((invite) => invite.email)).toEqual([second, first]);
      expect(invites[0]).toMatchObject({ role: 'ADMIN', invitedBy: { name: 'Chloe Martin' } });
    });

    it('drops an invite once it is accepted or cancelled', async () => {
      const owner = await ownerOf(app);
      await joinAs(app, owner, 'MEMBER', 'accepted');
      const cancelled = inviteeAddress('cancelled');
      await inviteAddress(app, owner, cancelled);
      await http()
        .delete(`/invites/${(await dbInvite(cancelled)).id}`)
        .set('authorization', bearer(owner))
        .expect(204);
      const res = await http().get('/invites').set('authorization', bearer(owner)).expect(200);
      expect(res.body).toEqual([]);
    });

    it('is Admin and Owner only', async () => {
      const owner = await ownerOf(app);
      const member = await joinAs(app, owner, 'MEMBER', 'member');
      await http().get('/invites').set('authorization', bearer(member)).expect(403);
      await http().get('/invites').expect(401);
    });

    it("never shows another workspace's invites", async () => {
      const a = await ownerOf(app, 'ws-a');
      const b = await ownerOf(app, 'ws-b');
      const inA = inviteeAddress('only-in-a');
      await inviteAddress(app, a, inA);
      const res = await http().get('/invites').set('authorization', bearer(b)).expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('POST /invites/:id/resend and DELETE /invites/:id', () => {
    it('resend gives a new link, extends the expiry and kills the old link', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('resend');
      const oldToken = await inviteAddress(app, owner, address);
      const before = await dbInvite(address);
      await prisma.invite.update({
        where: { id: before.id },
        data: { expiresAt: new Date(Date.now() + 3_600_000) },
      });

      const res = await http()
        .post(`/invites/${before.id}/resend`)
        .set('authorization', bearer(owner))
        .expect(200);
      expect(res.body).toEqual({ status: 'invited' });
      const newToken = tokenFromEmail(mailbox(app).lastTo(address));
      expect(newToken).not.toBe(oldToken);
      const after = await dbInvite(address);
      expect(after.id).toBe(before.id);
      expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

      const oldLink = await http()
        .post('/auth/invites/preview')
        .send({ token: oldToken })
        .expect(400);
      expect(errorCode(oldLink)).toBe('INVITE_INVALID');
      await http().post('/auth/invites/preview').send({ token: newToken }).expect(200);
    });

    it('cancel removes the invite and kills its link', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('cancel');
      const token = await inviteAddress(app, owner, address);
      await http()
        .delete(`/invites/${(await dbInvite(address)).id}`)
        .set('authorization', bearer(owner))
        .expect(204);
      expect(await prisma.invite.count({ where: { email: address } })).toBe(0);
      const res = await http().post('/auth/invites/preview').send({ token }).expect(400);
      expect(errorCode(res)).toBe('INVITE_INVALID');
    });

    it('answers 404 for another workspace invite, an unknown id and an accepted invite', async () => {
      const a = await ownerOf(app, 'ws-a');
      const b = await ownerOf(app, 'ws-b');
      const inA = inviteeAddress('a-invitee');
      const tokenA = await inviteAddress(app, a, inA);
      const inviteA = await dbInvite(inA);
      const sendsBefore = mailbox(app).outbox.length;

      // B's owner knows A's invite id: it must look like it does not exist.
      const resend = await http()
        .post(`/invites/${inviteA.id}/resend`)
        .set('authorization', bearer(b))
        .expect(404);
      expect(errorCode(resend)).toBe('NOT_FOUND');
      await http().delete(`/invites/${inviteA.id}`).set('authorization', bearer(b)).expect(404);
      expect(mailbox(app).outbox.length).toBe(sendsBefore);
      // A's invite is untouched: same link still works.
      await http().post('/auth/invites/preview').send({ token: tokenA }).expect(200);
      expect(await dbInvite(inA)).toMatchObject({ workspaceId: inviteA.workspaceId });

      await http()
        .post(`/invites/${crypto.randomUUID()}/resend`)
        .set('authorization', bearer(a))
        .expect(404);

      await http()
        .post('/auth/invites/accept')
        .send({ token: tokenA, name: 'Ada A', password: 'a-long-enough-password-1' })
        .expect(200);
      await http()
        .post(`/invites/${inviteA.id}/resend`)
        .set('authorization', bearer(a))
        .expect(404);
      await http().delete(`/invites/${inviteA.id}`).set('authorization', bearer(a)).expect(404);
    });

    it('rejects a malformed id and a Member', async () => {
      const owner = await ownerOf(app);
      const member = await joinAs(app, owner, 'MEMBER', 'member');
      await http()
        .post('/invites/not-a-uuid/resend')
        .set('authorization', bearer(owner))
        .expect(400);
      const id = crypto.randomUUID();
      await http().post(`/invites/${id}/resend`).set('authorization', bearer(member)).expect(403);
      await http().delete(`/invites/${id}`).set('authorization', bearer(member)).expect(403);
      await http().delete(`/invites/${id}`).expect(401);
    });
  });

  describe('POST /auth/invites/preview', () => {
    it('shows the workspace, inviter, role and address, and whether an account exists', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('preview');
      const token = await inviteAddress(app, owner, address, 'ADMIN');

      const res = await http().post('/auth/invites/preview').send({ token }).expect(200);
      expect(invitePreviewResponseSchema.parse(res.body)).toMatchObject({
        workspaceName: 'Harbour & Pine',
        inviterName: 'Chloe Martin',
        role: 'ADMIN',
        email: address,
        accountExists: false,
      });

      // An address that already has an account elsewhere.
      const other = await ownerOf(app, 'has-account');
      const existing = await inviteAddress(app, owner, other.body.email);
      const second = await http()
        .post('/auth/invites/preview')
        .send({ token: existing })
        .expect(200);
      expect(second.body.accountExists).toBe(true);
    });

    it('gives unknown, expired, cancelled and used links the same answer', async () => {
      const owner = await ownerOf(app);
      const expiredAddress = inviteeAddress('expired');
      const expired = await inviteAddress(app, owner, expiredAddress);
      await prisma.invite.updateMany({
        where: { email: expiredAddress },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const usedAddress = inviteeAddress('used');
      const used = await inviteAddress(app, owner, usedAddress);
      await http()
        .post('/auth/invites/accept')
        .send({ token: used, name: 'Used Up', password: 'a-long-enough-password-1' })
        .expect(200);

      const answers = [];
      for (const token of ['x'.repeat(43), expired, used]) {
        const res = await http().post('/auth/invites/preview').send({ token }).expect(400);
        answers.push(res.body);
      }
      expect(answers[0]).toEqual(answers[1]);
      expect(answers[1]).toEqual(answers[2]);
      expect(errorBodySchema.parse(answers[0]).error.code).toBe('INVITE_INVALID');
    });

    it('is public, but refuses a token with the wrong shape', async () => {
      for (const body of [{}, { token: 'short' }, { token: `${'a'.repeat(40)} !!` }]) {
        const res = await http().post('/auth/invites/preview').send(body).expect(400);
        expect(errorCode(res)).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('POST /auth/invites/accept', () => {
    it('creates the account, joins as the invited role and signs in to that workspace', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('new-account');
      const token = await inviteAddress(app, owner, address, 'ADMIN');

      const res = await http()
        .post('/auth/invites/accept')
        .send({ token, name: 'Ethan Brooks', password: 'ethan-brooks-2026!' })
        .expect(200);
      expect(res.body).toEqual({ accessToken: expect.any(String), expiresIn: 900 });
      expect(setCookieLine(res)).toMatch(/HttpOnly/i);

      const me = await http()
        .get('/auth/me')
        .set('authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body).toMatchObject({
        user: { email: address, name: 'Ethan Brooks', locale: null },
        workspace: { name: 'Harbour & Pine' },
        role: 'ADMIN',
      });
      const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      // The invite is used up.
      expect(await dbInvite(address)).toMatchObject({ acceptedAt: expect.any(Date) });
    });

    it('can be used once: a second accept gets INVITE_INVALID', async () => {
      const owner = await ownerOf(app);
      const token = await inviteAddress(app, owner, inviteeAddress('once'));
      const body = { token, name: 'Once Only', password: 'a-long-enough-password-1' };
      await http().post('/auth/invites/accept').send(body).expect(200);
      const again = await http().post('/auth/invites/accept').send(body).expect(400);
      expect(errorCode(again)).toBe('INVITE_INVALID');
    });

    it('lets only one of two simultaneous accepts win', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('race');
      const token = await inviteAddress(app, owner, address);
      const results = await Promise.all(
        [1, 2].map(() =>
          http()
            .post('/auth/invites/accept')
            .send({ token, name: 'Racer', password: 'a-long-enough-password-1' }),
        ),
      );
      expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
      const loser = results.find((res) => res.status === 400);
      expect(loser && errorCode(loser)).toBe('INVITE_INVALID');
      const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
      expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(1);
    });

    it('needs a name and a strong password for a new account, and reports each field', async () => {
      const owner = await ownerOf(app);
      const token = await inviteAddress(app, owner, inviteeAddress('weak'));
      const res = await http()
        .post('/auth/invites/accept')
        .send({ token, password: 'short' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'name', code: 'invalid_type' }),
          expect.objectContaining({ path: 'password', code: 'too_small', minimum: 12 }),
        ]),
      );
      // The failed attempt did not use the invite up.
      await http().post('/auth/invites/preview').send({ token }).expect(200);
    });

    it('lets an existing account join with its password and does not rename it', async () => {
      const owner = await ownerOf(app);
      const other = await signUp(app, {
        email: inviteeAddress('elsewhere'),
        name: 'Dana Elsewhere',
      });
      const token = await inviteAddress(app, owner, other.body.email, 'MEMBER');

      // A new name for an existing account is refused, and costs nothing.
      const rename = await http()
        .post('/auth/invites/accept')
        .send({ token, name: 'Mallory', password: other.body.password })
        .expect(400);
      expect(rename.body.error.details).toEqual([
        { path: '', code: 'unrecognized_keys', values: ['name'] },
      ]);
      // A wrong password is refused, and costs nothing.
      const wrong = await http()
        .post('/auth/invites/accept')
        .send({ token, password: 'not-the-password-1' })
        .expect(401);
      expect(errorCode(wrong)).toBe('AUTH_INVALID_CREDENTIALS');

      const res = await http()
        .post('/auth/invites/accept')
        .send({ token, password: other.body.password })
        .expect(200);
      const me = await http()
        .get('/auth/me')
        .set('authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body).toMatchObject({
        user: { name: 'Dana Elsewhere' },
        workspace: { name: 'Harbour & Pine' },
        role: 'MEMBER',
      });
      const user = await prisma.user.findUniqueOrThrow({ where: { email: other.body.email } });
      expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(2);
    });

    it('locks the invite after 5 wrong passwords, and Resend revives it', async () => {
      const owner = await ownerOf(app);
      const victim = await signUp(app, { email: inviteeAddress('victim') });
      const token = await inviteAddress(app, owner, victim.body.email);
      const attempt = (password: string) =>
        http().post('/auth/invites/accept').send({ token, password });

      // Four wrong guesses: still usable, and the right password still works.
      for (let i = 0; i < 4; i += 1) {
        const res = await attempt(`wrong-guess-number-${i}`).expect(401);
        expect(errorCode(res)).toBe('AUTH_INVALID_CREDENTIALS');
      }
      expect(await dbInvite(victim.body.email)).toMatchObject({ failedAttempts: 4 });
      await http().post('/auth/invites/preview').send({ token }).expect(200);

      // The fifth wrong guess burns the link: even the right password is refused now.
      await attempt('wrong-guess-number-5').expect(401);
      const dead = await attempt(victim.body.password).expect(400);
      expect(errorCode(dead)).toBe('INVITE_INVALID');
      await http().post('/auth/invites/preview').send({ token }).expect(400);

      // The admin resends: a new link, the counter starts again.
      const row = await dbInvite(victim.body.email);
      await http()
        .post(`/invites/${row.id}/resend`)
        .set('authorization', bearer(owner))
        .expect(200);
      expect(await dbInvite(victim.body.email)).toMatchObject({ failedAttempts: 0 });
      const fresh = tokenFromEmail(mailbox(app).lastTo(victim.body.email));
      await http()
        .post('/auth/invites/accept')
        .send({ token: fresh, password: victim.body.password })
        .expect(200);
    });

    it('does not count validation errors on a new account as password guesses', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('typos');
      const token = await inviteAddress(app, owner, address);
      for (let i = 0; i < 6; i += 1) {
        await http().post('/auth/invites/accept').send({ token, password: 'short' }).expect(400);
      }
      expect(await dbInvite(address)).toMatchObject({ failedAttempts: 0 });
      await http().post('/auth/invites/preview').send({ token }).expect(200);
    });

    it('answers INVITE_INVALID for an expired link', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('late');
      const token = await inviteAddress(app, owner, address);
      await prisma.invite.updateMany({
        where: { email: address },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await http()
        .post('/auth/invites/accept')
        .send({ token, name: 'Too Late', password: 'a-long-enough-password-1' })
        .expect(400);
      expect(errorCode(res)).toBe('INVITE_INVALID');
      expect(await prisma.user.count({ where: { email: address } })).toBe(0);
    });

    it('can never produce a second OWNER', async () => {
      const owner = await ownerOf(app);
      const admin = await joinAs(app, owner, 'ADMIN', 'admin');
      expect(admin.accessToken).toBeDefined();
      const workspaceId = (
        await prisma.membership.findFirstOrThrow({
          where: { user: { email: owner.body.email } },
        })
      ).workspaceId;
      expect(await prisma.membership.count({ where: { workspaceId, role: 'OWNER' } })).toBe(1);
    });
  });
});
