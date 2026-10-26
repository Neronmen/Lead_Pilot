import { createServer, type Server, type Socket } from 'node:net';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { errorBodySchema } from '@leadpilot/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { SessionService } from '../src/auth/session.service';
import { EMAIL_PROVIDER } from '../src/email/email.provider';
import { SmtpEmailProvider } from '../src/email/smtp-email.provider';
import { PrismaClient } from '../src/generated/prisma/client';
import { signUp } from './utils/auth';
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

const PASSWORD = 'a-long-enough-password-1';

/**
 * Edge cases of the invite lifecycle: races, rollback, secrecy of the token,
 * role escalation, bounded email sending and odd input. The happy paths and
 * the basic authorisation matrix live in invites.e2e-spec.ts.
 */
describe('Invites edge cases (e2e)', () => {
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
  const workspaceOf = async (email: string) =>
    (await prisma.membership.findFirstOrThrow({ where: { user: { email } } })).workspaceId;
  const accept = (token: string, body: Record<string, unknown> = {}) =>
    http()
      .post('/auth/invites/accept')
      .send({ token, name: 'Edge Case', password: PASSWORD, ...body });

  describe('races', () => {
    it('cancel vs accept: exactly one wins and the outcome is consistent', async () => {
      for (let round = 0; round < 4; round += 1) {
        const owner = await ownerOf(app, `cancel-race-${round}`);
        const address = inviteeAddress(`cancel-race-${round}`);
        const token = await inviteAddress(app, owner, address);
        const id = (await dbInvite(address)).id;

        const [accepted, cancelled] = await Promise.all([
          accept(token),
          http().delete(`/invites/${id}`).set('authorization', bearer(owner)),
        ]);

        const user = await prisma.user.findUnique({ where: { email: address } });
        const memberships = user
          ? await prisma.membership.count({ where: { userId: user.id } })
          : 0;
        if (accepted.status === 200) {
          expect(cancelled.status).toBe(404);
          expect(memberships).toBe(1);
        } else {
          expect(accepted.status).toBe(400);
          expect(errorCode(accepted)).toBe('INVITE_INVALID');
          expect(cancelled.status).toBe(204);
          // Nothing half-created.
          expect(user).toBeNull();
          expect(memberships).toBe(0);
        }
      }
    });

    it('resend vs accept: never two memberships, and a dead link never signs anyone in', async () => {
      for (let round = 0; round < 4; round += 1) {
        const owner = await ownerOf(app, `resend-race-${round}`);
        const address = inviteeAddress(`resend-race-${round}`);
        const token = await inviteAddress(app, owner, address);
        const id = (await dbInvite(address)).id;
        const before = mailbox(app).outbox.length;

        const [accepted, resent] = await Promise.all([
          accept(token),
          http().post(`/invites/${id}/resend`).set('authorization', bearer(owner)),
        ]);

        const user = await prisma.user.findUnique({ where: { email: address } });
        const memberships = user
          ? await prisma.membership.count({ where: { userId: user.id } })
          : 0;
        expect(memberships).toBe(accepted.status === 200 ? 1 : 0);
        if (accepted.status === 200) {
          // Accept won the row: Resend must not revive a used invite.
          expect([200, 404]).toContain(resent.status);
          if (resent.status === 404) expect(mailbox(app).outbox.length).toBe(before);
        } else {
          // Resend replaced the token first: the old link is dead.
          expect(resent.status).toBe(200);
          expect(errorCode(accepted)).toBe('INVITE_INVALID');
          const fresh = tokenFromEmail(mailbox(app).lastTo(address));
          expect(fresh).not.toBe(token);
          await http().post('/auth/invites/preview').send({ token: fresh }).expect(200);
        }
      }
    });

    it('two admins reissuing the same expired invite at once leave exactly one working link', async () => {
      const owner = await ownerOf(app, 'reissue-race');
      const address = inviteeAddress('reissue-race');
      await inviteAddress(app, owner, address);
      await prisma.invite.updateMany({
        where: { email: address },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const before = mailbox(app).outbox.length;

      const results = await Promise.all(
        [1, 2].map(() =>
          http()
            .post('/invites')
            .set('authorization', bearer(owner))
            .send({ emails: [address], role: 'MEMBER' }),
        ),
      );
      const statuses = results.map((res) => res.body.results[0].status as string).sort();
      const sent = mailbox(app)
        .outbox.slice(before)
        .filter((m) => m.to === address);
      const working: string[] = [];
      for (const mail of sent) {
        const token = tokenFromEmail(mail);
        const res = await http().post('/auth/invites/preview').send({ token });
        if (res.status === 200) working.push(token);
      }
      // Each "invited" answer must correspond to a link that works. If both
      // requests answer "invited", one of the two emails carries a dead link.
      expect(working).toHaveLength(1);
      expect(statuses.filter((s) => s === 'invited')).toHaveLength(1);
      expect(await prisma.invite.count({ where: { email: address } })).toBe(1);
    });
  });

  describe('accept: account state changes under the invite', () => {
    it('an account created after the preview: the name is refused, the password path works', async () => {
      const owner = await ownerOf(app);
      const address = inviteeAddress('late-signup');
      const token = await inviteAddress(app, owner, address, 'ADMIN');
      const preview = await http().post('/auth/invites/preview').send({ token }).expect(200);
      expect(preview.body.accountExists).toBe(false);

      // The person signs up on their own before accepting.
      const own = await signUp(app, { email: address, name: 'Self Signup' });

      const withName = await accept(token).expect(400);
      expect(errorCode(withName)).toBe('VALIDATION_FAILED');
      await http().post('/auth/invites/preview').send({ token }).expect(200);

      const res = await http()
        .post('/auth/invites/accept')
        .send({ token, password: own.body.password })
        .expect(200);
      const me = await http()
        .get('/auth/me')
        .set('authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body).toMatchObject({ user: { name: 'Self Signup' }, role: 'ADMIN' });
      const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
      expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(2);
    });

    it("a member of workspace B can be invited to A, and B's membership is untouched", async () => {
      const a = await ownerOf(app, 'ws-a');
      const b = await ownerOf(app, 'ws-b');
      const bWorkspace = await workspaceOf(b.body.email);

      // B's owner is invited to A as a plain member.
      const sent = await http()
        .post('/invites')
        .set('authorization', bearer(a))
        .send({ emails: [b.body.email], role: 'MEMBER' })
        .expect(201);
      expect(sent.body.results).toEqual([{ email: b.body.email, status: 'invited' }]);
      const token = tokenFromEmail(mailbox(app).lastTo(b.body.email));

      const res = await http()
        .post('/auth/invites/accept')
        .send({ token, password: b.body.password })
        .expect(200);
      const me = await http()
        .get('/auth/me')
        .set('authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
      expect(me.body.role).toBe('MEMBER');
      expect(me.body.workspace.name).toBe('Harbour & Pine');

      const user = await prisma.user.findUniqueOrThrow({ where: { email: b.body.email } });
      const roles = await prisma.membership.findMany({ where: { userId: user.id } });
      expect(roles).toHaveLength(2);
      expect(roles.find((m) => m.workspaceId === bWorkspace)?.role).toBe('OWNER');
      expect(roles.find((m) => m.workspaceId !== bWorkspace)?.role).toBe('MEMBER');
    });

    it('an invite for someone who became a member another way is refused cleanly and changes nothing', async () => {
      const owner = await ownerOf(app);
      const other = await signUp(app, { email: inviteeAddress('already-in') });
      const token = await inviteAddress(app, owner, other.body.email, 'ADMIN');
      const user = await prisma.user.findUniqueOrThrow({ where: { email: other.body.email } });
      const workspaceId = await workspaceOf(owner.body.email);
      // Joined through another route (for example a manual fix or a later feature).
      await prisma.membership.create({ data: { workspaceId, userId: user.id, role: 'MEMBER' } });

      const res = await http()
        .post('/auth/invites/accept')
        .send({ token, password: other.body.password });
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('INVITE_INVALID');
      // Role was not upgraded, no session row was left behind by the failed attempt.
      const memberships = await prisma.membership.findMany({
        where: { userId: user.id, workspaceId },
      });
      expect(memberships.map((m) => m.role)).toEqual(['MEMBER']);
      // The dead invite is removed, not left "pending" in the Team list for ever.
      expect(await prisma.invite.count({ where: { email: other.body.email } })).toBe(0);
    });

    it.each(['new', 'existing'] as const)(
      'rolls back everything when signing in fails midway (%s account), and the link still works',
      async (kind) => {
        const owner = await ownerOf(app);
        const existing = kind === 'existing' ? await signUp(app) : undefined;
        const address = existing?.body.email ?? inviteeAddress('rollback');
        const token = await inviteAddress(app, owner, address);
        const workspaceId = await workspaceOf(owner.body.email);
        const spy = jest
          .spyOn(app.get(SessionService), 'issue')
          .mockRejectedValueOnce(new Error('boom'));
        try {
          const res = await accept(
            token,
            existing ? { name: undefined, password: existing.body.password } : {},
          );
          expect(res.status).toBe(500);
        } finally {
          spy.mockRestore();
        }

        expect((await dbInvite(address)).acceptedAt).toBeNull();
        expect(
          await prisma.membership.count({ where: { workspaceId, user: { email: address } } }),
        ).toBe(0);
        if (!existing) expect(await prisma.user.count({ where: { email: address } })).toBe(0);

        const retry = await accept(
          token,
          existing ? { name: undefined, password: existing.body.password } : {},
        );
        expect(retry.status).toBe(200);
        expect(
          await prisma.membership.count({ where: { workspaceId, user: { email: address } } }),
        ).toBe(1);
      },
    );
  });

  describe('secrecy and escalation', () => {
    it('keeps the plaintext token out of every table, response and log call', async () => {
      const logged: string[] = [];
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logged.push(JSON.stringify(args, (_k, v: unknown) => (v instanceof Error ? v.stack : v)));
        }),
      );
      const bodies: string[] = [];
      try {
        const owner = await ownerOf(app);
        const sendOne = async (label: string, fail: boolean) => {
          const address = inviteeAddress(label);
          mailbox(app).failWith = fail ? new Error('smtp down') : undefined;
          const res = await http()
            .post('/invites')
            .set('authorization', bearer(owner))
            .send({ emails: [address], role: 'MEMBER' })
            .expect(201);
          bodies.push(JSON.stringify(res.body));
          mailbox(app).failWith = undefined;
          return address;
        };
        const good = await sendOne('secret-ok', false);
        const token = tokenFromEmail(mailbox(app).lastTo(good));
        const failed = await sendOne('secret-fail', true);
        const failedId = (await dbInvite(failed)).id;

        bodies.push(
          JSON.stringify((await http().get('/invites').set('authorization', bearer(owner))).body),
        );
        const resent = await http()
          .post(`/invites/${failedId}/resend`)
          .set('authorization', bearer(owner))
          .expect(200);
        bodies.push(JSON.stringify(resent.body));
        const resentToken = tokenFromEmail(mailbox(app).lastTo(failed));
        bodies.push(
          JSON.stringify((await http().post('/auth/invites/preview').send({ token })).body),
        );
        // A refused accept (weak password) and a good one.
        bodies.push(JSON.stringify((await accept(token, { password: 'short' })).body));
        const done = await accept(token);
        bodies.push(JSON.stringify(done.body));

        const tokens = [token, resentToken];
        const everything = JSON.stringify(
          await Promise.all([
            prisma.invite.findMany(),
            prisma.refreshToken.findMany({ where: { user: { email: good } } }),
            prisma.user.findMany({ where: { email: good } }),
          ]),
        );
        for (const secret of tokens) {
          expect(everything).not.toContain(secret);
          for (const body of bodies) expect(body).not.toContain(secret);
          for (const line of logged) expect(line).not.toContain(secret);
        }
        // The hash is not exposed either.
        const hash = (await dbInvite(failed)).tokenHash;
        for (const body of bodies) expect(body).not.toContain(hash);
        expect(logged.length).toBeGreaterThan(0);
      } finally {
        mailbox(app).failWith = undefined;
        spies.forEach((spy) => spy.mockRestore());
      }
    });

    it('never yields OWNER or another role than the invited one, whatever the body says', async () => {
      const owner = await ownerOf(app);
      const workspaceId = await workspaceOf(owner.body.email);
      const address = inviteeAddress('escalate');
      const token = await inviteAddress(app, owner, address, 'MEMBER');

      const res = await accept(token, { role: 'OWNER', workspaceId: crypto.randomUUID() });
      // Either refused as an unknown field or ignored: never honoured.
      expect([200, 400]).toContain(res.status);
      if (res.status === 400) await accept(token).expect(200);
      const membership = await prisma.membership.findFirstOrThrow({
        where: { user: { email: address } },
      });
      expect(membership).toMatchObject({ role: 'MEMBER', workspaceId });
      expect(await prisma.membership.count({ where: { workspaceId, role: 'OWNER' } })).toBe(1);
    });

    it('an Admin cannot invite the OWNER role, nor re-invite the owner', async () => {
      const owner = await ownerOf(app);
      const admin = await joinAs(app, owner, 'ADMIN', 'sneaky');
      await http()
        .post('/invites')
        .set('authorization', bearer(admin))
        .send({ emails: [inviteeAddress('x')], role: 'OWNER' })
        .expect(400);
      const res = await http()
        .post('/invites')
        .set('authorization', bearer(admin))
        .send({ emails: [owner.body.email], role: 'ADMIN' })
        .expect(201);
      expect(res.body.results).toEqual([{ email: owner.body.email, status: 'already_member' }]);
    });

    it('does not turn an expired invite into a password oracle', async () => {
      const owner = await ownerOf(app);
      const victim = await signUp(app);
      await inviteAddress(app, owner, victim.body.email);
      const token = tokenFromEmail(mailbox(app).lastTo(victim.body.email));
      await prisma.invite.updateMany({
        where: { email: victim.body.email },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      for (const password of ['definitely-wrong-1', victim.body.password]) {
        const res = await http().post('/auth/invites/accept').send({ token, password }).expect(400);
        expect(errorCode(res)).toBe('INVITE_INVALID');
      }
      // A made-up token answers the same as the expired one.
      const unknown = await http()
        .post('/auth/invites/accept')
        .send({ token: 'A'.repeat(43), password: victim.body.password })
        .expect(400);
      expect(errorCode(unknown)).toBe('INVITE_INVALID');
    });
  });

  describe('odd input', () => {
    it.each([
      'x@example.test\r\nBcc: evil@example.test',
      'x@example.test,evil@example.test',
      'x@example.test\nBcc:evil@example.test',
      '"x y"@example.test',
      'Eve <x@example.test>',
    ])('refuses the address %j before anything is stored or sent', async (bad) => {
      const owner = await ownerOf(app);
      const before = mailbox(app).outbox.length;
      const res = await http()
        .post('/invites')
        .set('authorization', bearer(owner))
        .send({ emails: [bad], role: 'MEMBER' });
      expect(res.status).toBe(400);
      expect(mailbox(app).outbox.length).toBe(before);
    });

    it('cannot get a line break into the subject through a name or workspace name', async () => {
      for (const body of [
        { name: 'Eve\r\nBcc: evil@example.test' },
        { workspaceName: 'Evil Co' },
        { name: 'Eve\u0085Bcc' },
      ]) {
        const res = await http()
          .post('/auth/signup')
          .send({
            name: 'Chloe Martin',
            workspaceName: 'Harbour',
            email: inviteeAddress('inject'),
            password: PASSWORD,
            locale: 'en',
            currency: 'USD',
            ...body,
          });
        expect(res.status).toBe(400);
      }
    });

    it('handles 20 addresses at once, including duplicates in other case and partial failures', async () => {
      const owner = await ownerOf(app);
      const addresses = Array.from({ length: 20 }, (_, i) => inviteeAddress(`bulk-${i}`));
      const failing = new Set(addresses.filter((_, i) => i % 5 === 0));
      const mock = mailbox(app);
      const spy = jest.spyOn(mock, 'send').mockImplementation((message) => {
        if (failing.has(message.to)) return Promise.reject(new Error('mailbox full'));
        mock.outbox.push(message);
        return Promise.resolve();
      });
      try {
        const res = await http()
          .post('/invites')
          .set('authorization', bearer(owner))
          .send({ emails: addresses, role: 'MEMBER' })
          .expect(201);
        expect(res.body.results).toHaveLength(20);
        for (const row of res.body.results as Array<{ email: string; status: string }>) {
          expect(row.status).toBe(failing.has(row.email) ? 'email_failed' : 'invited');
        }
      } finally {
        spy.mockRestore();
      }
      // Every invite is saved, failed or not, each with its own token.
      const stored = await prisma.invite.findMany({ where: { email: { in: addresses } } });
      expect(stored).toHaveLength(20);
      expect(new Set(stored.map((row) => row.tokenHash)).size).toBe(20);
      // A failed one is retried with Resend and then works.
      const failedAddress = [...failing][0] as string;
      const id = (await dbInvite(failedAddress)).id;
      await http().post(`/invites/${id}/resend`).set('authorization', bearer(owner)).expect(200);
      await http()
        .post('/auth/invites/preview')
        .send({ token: tokenFromEmail(mock.lastTo(failedAddress)) })
        .expect(200);
    });
  });

  describe('a mail server that never answers', () => {
    let server: Server;
    let port: number;
    const sockets = new Set<Socket>();
    let greet = false;
    let stalled: NestExpressApplication;

    beforeAll(async () => {
      server = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => undefined);
        // Accepts the connection; optionally greets, but never answers EHLO.
        if (greet) socket.write('220 stalled ESMTP\r\n');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      port = typeof address === 'object' && address ? address.port : 0;
      stalled = await createTestApp((builder) =>
        builder.overrideProvider(EMAIL_PROVIDER).useValue(
          new SmtpEmailProvider({
            host: '127.0.0.1',
            port,
            from: 'LeadPilot <no-reply@leadpilot.local>',
          }),
        ),
      );
    });

    afterAll(async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise((resolve) => server.close(resolve));
      await stalled.close();
    });

    it.each([false, true])(
      'answers email_failed within seconds for 20 invites (server greets: %s)',
      async (greets) => {
        greet = greets;
        const owner = await signUp(stalled, { email: inviteeAddress('stalled-owner') });
        const addresses = Array.from({ length: 20 }, (_, i) => inviteeAddress(`stalled-${i}`));
        const started = Date.now();
        const res = await request(stalled.getHttpServer())
          .post('/invites')
          .set('authorization', bearer(owner))
          .send({ emails: addresses, role: 'MEMBER' })
          .expect(201);
        const seconds = (Date.now() - started) / 1000;
        expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(
          Array.from({ length: 20 }, () => 'email_failed'),
        );
        // connection 5 s + greeting 5 s + socket 10 s worst case, all in parallel.
        expect(seconds).toBeLessThan(18);
        expect(await prisma.invite.count({ where: { email: { in: addresses } } })).toBe(20);
      },
      40_000,
    );
  });
});
