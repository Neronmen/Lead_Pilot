import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { InvitesService } from '../src/invites/invites.service';
import { MembersService } from '../src/members/members.service';
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
import { auditRows, membershipOf, workspaceOf } from './utils/workspace-data';

/**
 * Probes around the owner-manages-admins rule: stale tokens, races, role
 * escalation through invites, the accept flow, audit rows, error bodies.
 */
describe('Team: owner-manages-admins, hostile cases (e2e)', () => {
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
    await prisma.workspace.deleteMany({
      where: { id: { in: users.flatMap((u) => u.memberships.map((m) => m.workspaceId)) } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: INVITES_EMAIL_PREFIX } } });
    await prisma.$disconnect();
    await app.close();
  });

  type Who = { accessToken: string };
  const http = () => request(app.getHttpServer());
  const bearer = (who: Who) => `Bearer ${who.accessToken}`;
  const patch = (who: Who, id: string, role: string) =>
    http().patch(`/members/${id}`).set('authorization', bearer(who)).send({ role });
  const remove = (who: Who, id: string) =>
    http().delete(`/members/${id}`).set('authorization', bearer(who));
  const invite = (who: Who, emails: string[], role: string) =>
    http().post('/invites').set('authorization', bearer(who)).send({ emails, role });
  const resend = (who: Who, id: string) =>
    http().post(`/invites/${id}/resend`).set('authorization', bearer(who));
  const cancel = (who: Who, id: string) =>
    http().delete(`/invites/${id}`).set('authorization', bearer(who));

  async function team() {
    const owner = await ownerOf(app);
    const admin = await joinAs(app, owner, 'ADMIN', 'admin');
    const admin2 = await joinAs(app, owner, 'ADMIN', 'admin2');
    const member = await joinAs(app, owner, 'MEMBER', 'member');
    const workspaceId = await workspaceOf(prisma, owner.body.email);
    return {
      owner,
      admin,
      admin2,
      member,
      workspaceId,
      ownerM: await membershipOf(prisma, owner.body.email, workspaceId),
      adminM: await membershipOf(prisma, admin.email, workspaceId),
      admin2M: await membershipOf(prisma, admin2.email, workspaceId),
      memberM: await membershipOf(prisma, member.email, workspaceId),
    };
  }

  const roleOf = async (id: string) =>
    (await prisma.membership.findUnique({ where: { id }, select: { role: true } }))?.role ?? null;
  const expire = (address: string) =>
    prisma.invite.updateMany({
      where: { email: address },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

  describe('stale access tokens (role is read from the database per request)', () => {
    it('an admin demoted by the owner loses admin powers on the same token', async () => {
      const t = await team();
      // Before: the token works on admin routes.
      await patch(t.admin, t.memberM.id, 'MEMBER').expect(200);
      await patch(t.owner, t.adminM.id, 'MEMBER').expect(200);
      // After: same token, now a member.
      for (const res of [
        await patch(t.admin, t.memberM.id, 'MEMBER'),
        await remove(t.admin, t.memberM.id),
        await invite(t.admin, [inviteeAddress('ex')], 'MEMBER'),
        await http().get('/members').set('authorization', bearer(t.admin)),
        await http().get('/invites').set('authorization', bearer(t.admin)),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect(await roleOf(t.memberM.id)).toBe('MEMBER');
    });

    it('a demoted ex-admin cannot resend or cancel any invite, even a member invite', async () => {
      const t = await team();
      const address = inviteeAddress('pm');
      await inviteAddress(app, t.admin, address, 'MEMBER');
      const row = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      await patch(t.owner, t.adminM.id, 'MEMBER').expect(200);
      await resend(t.admin, row.id).expect(403);
      await cancel(t.admin, row.id).expect(403);
      expect(await prisma.invite.count({ where: { id: row.id } })).toBe(1);
    });

    it('an ex-admin keeps no way to touch an admin invite after demotion', async () => {
      const t = await team();
      const address = inviteeAddress('pa');
      await inviteAddress(app, t.owner, address, 'ADMIN');
      const row = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      await patch(t.owner, t.adminM.id, 'MEMBER').expect(200);
      await resend(t.admin, row.id).expect(403);
      await cancel(t.admin, row.id).expect(403);
      await invite(t.admin, [inviteeAddress('z')], 'ADMIN').expect(403);
    });

    it('a removed admin token is rejected outright (401)', async () => {
      const t = await team();
      await remove(t.owner, t.adminM.id).expect(204);
      await patch(t.admin, t.memberM.id, 'MEMBER').expect(401);
      await invite(t.admin, [inviteeAddress('gone')], 'MEMBER').expect(401);
    });

    it('a member promoted to admin works on the token issued while they were a member', async () => {
      const t = await team();
      await invite(t.member, [inviteeAddress('pre')], 'MEMBER').expect(403);
      await patch(t.owner, t.memberM.id, 'ADMIN').expect(200);
      await invite(t.member, [inviteeAddress('post')], 'MEMBER').expect(201);
      // but still cannot do owner-only things
      await patch(t.member, t.admin2M.id, 'MEMBER').expect(403);
      await invite(t.member, [inviteeAddress('postadm')], 'ADMIN').expect(403);
    });

    it('an admin never gains owner powers: the owner row stays untouchable for everyone', async () => {
      const t = await team();
      for (const who of [t.admin, t.owner]) {
        expect((await remove(who, t.ownerM.id)).status).toBe(403);
      }
      expect(await roleOf(t.ownerM.id)).toBe('OWNER');
    });
  });

  describe('races', () => {
    it('owner demotes an admin while that admin changes a member: no 5xx, consistent end state', async () => {
      const t = await team();
      const [a, b] = await Promise.all([
        patch(t.owner, t.adminM.id, 'MEMBER'),
        patch(t.admin, t.memberM.id, 'MEMBER'),
      ]);
      expect(a.status).toBe(200);
      expect([200]).toContain(b.status);
      expect(await roleOf(t.adminM.id)).toBe('MEMBER');
      expect(await roleOf(t.memberM.id)).toBe('MEMBER');
      // Nothing recorded for the no-op.
      const rows = (await auditRows(prisma, t.workspaceId)).filter(
        (r) => r.action === 'member.role_changed',
      );
      expect(rows.map((r) => r.entityId)).toEqual([t.adminM.id]);
    });

    it('owner promotes a member while an admin sets the same member to MEMBER: never a 5xx, never a demotion of an admin', async () => {
      const t = await team();
      const [owner, admin] = await Promise.all([
        patch(t.owner, t.memberM.id, 'ADMIN'),
        patch(t.admin, t.memberM.id, 'MEMBER'),
      ]);
      expect(owner.status).toBe(200);
      expect([200, 403]).toContain(admin.status);
      // The owner's promotion is the last word whichever order they ran in,
      // unless the admin ran after it (then it is refused with 403).
      if (admin.status === 403) expect(admin.body.error.code).toBe('FORBIDDEN');
      expect(await roleOf(t.memberM.id)).toBe('ADMIN');
    });

    it('two admins change the same member at once: one history row at most per real change', async () => {
      const t = await team();
      await patch(t.owner, t.memberM.id, 'MEMBER').expect(200);
      const results = await Promise.all([
        patch(t.admin, t.memberM.id, 'MEMBER'),
        patch(t.admin2, t.memberM.id, 'MEMBER'),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const rows = (await auditRows(prisma, t.workspaceId)).filter(
        (r) => r.action === 'member.role_changed' && r.entityId === t.memberM.id,
      );
      expect(rows).toHaveLength(0);
    });

    it('an admin removing a member while the owner removes the same member: one 204, one 404, one history row', async () => {
      const t = await team();
      const results = await Promise.all([
        remove(t.owner, t.memberM.id),
        remove(t.admin, t.memberM.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
      const rows = (await auditRows(prisma, t.workspaceId)).filter(
        (r) => r.action === 'member.removed' && r.entityId === t.memberM.id,
      );
      expect(rows).toHaveLength(1);
    });

    it('owner cancels an admin invite while an admin tries to resend it: the admin never succeeds', async () => {
      const t = await team();
      const address = inviteeAddress('race-inv');
      await inviteAddress(app, t.owner, address, 'ADMIN');
      const row = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      const [c, r] = await Promise.all([cancel(t.owner, row.id), resend(t.admin, row.id)]);
      expect(c.status).toBe(204);
      expect([403, 404]).toContain(r.status);
      expect(await prisma.invite.count({ where: { id: row.id } })).toBe(0);
    });

    it('an admin cannot reissue an expired admin invite, even with many parallel attempts', async () => {
      const t = await team();
      const address = inviteeAddress('race-reissue');
      await inviteAddress(app, t.owner, address, 'ADMIN');
      await expire(address);
      const before = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      const results = await Promise.all([
        invite(t.admin, [address], 'MEMBER'),
        invite(t.admin2, [address], 'MEMBER'),
        invite(t.admin, [address], 'ADMIN'),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201, 403]);
      const after = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      expect(after.role).toBe('ADMIN');
      expect(after.tokenHash).toBe(before.tokenHash);
    });
  });

  describe('role escalation through invites', () => {
    it('an admin cannot turn a pending MEMBER invite into ADMIN (403, role kept)', async () => {
      const t = await team();
      const address = inviteeAddress('esc1');
      await inviteAddress(app, t.admin, address, 'MEMBER');
      await invite(t.admin, [address], 'ADMIN').expect(403);
      expect((await prisma.invite.findFirstOrThrow({ where: { email: address } })).role).toBe(
        'MEMBER',
      );
    });

    it('the owner inviting ADMIN to a live pending MEMBER invite changes nothing (already_invited)', async () => {
      const t = await team();
      const address = inviteeAddress('esc2');
      await inviteAddress(app, t.admin, address, 'MEMBER');
      const res = await invite(t.owner, [address], 'ADMIN').expect(201);
      expect(res.body.results).toEqual([{ email: address, status: 'already_invited' }]);
      expect((await prisma.invite.findFirstOrThrow({ where: { email: address } })).role).toBe(
        'MEMBER',
      );
    });

    it('inviting an existing member as ADMIN does not change their role (already_member)', async () => {
      const t = await team();
      const res = await invite(t.owner, [t.member.email], 'ADMIN').expect(201);
      expect(res.body.results).toEqual([{ email: t.member.email, status: 'already_member' }]);
      expect(await roleOf(t.memberM.id)).toBe('MEMBER');
    });

    it('an admin inviting an existing admin or the owner learns only already_member (role MEMBER) and changes nothing', async () => {
      const t = await team();
      const res = await invite(t.admin, [t.admin2.email, t.owner.body.email], 'MEMBER').expect(201);
      expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
        'already_member',
        'already_member',
      ]);
      expect(await roleOf(t.admin2M.id)).toBe('ADMIN');
      expect(await roleOf(t.ownerM.id)).toBe('OWNER');
    });

    it('a mixed batch with ADMIN is refused whole by an admin: nothing is created or mailed', async () => {
      const t = await team();
      const a = inviteeAddress('mix1');
      const b = inviteeAddress('mix2');
      const sent = mailbox(app).outbox.length;
      await invite(t.admin, [a, b], 'ADMIN').expect(403);
      expect(await prisma.invite.count({ where: { email: { in: [a, b] } } })).toBe(0);
      expect(mailbox(app).outbox.length).toBe(sent);
    });

    it('case and whitespace of the address do not bypass the expired-admin-invite guard', async () => {
      const t = await team();
      const address = inviteeAddress('Case');
      await inviteAddress(app, t.owner, address.toLowerCase(), 'ADMIN');
      await expire(address.toLowerCase());
      const res = await invite(t.admin, [`  ${address.toUpperCase()}  `], 'MEMBER').expect(201);
      expect(res.body.results).toEqual([
        { email: address.toLowerCase(), status: 'already_invited' },
      ]);
      expect(
        (await prisma.invite.findFirstOrThrow({ where: { email: address.toLowerCase() } })).role,
      ).toBe('ADMIN');
      expect(await prisma.invite.count({ where: { email: address.toLowerCase() } })).toBe(1);
    });

    it('case variant of an existing admin address is already_member, not a new invite', async () => {
      const t = await team();
      const res = await invite(t.admin, [t.admin2.email.toUpperCase()], 'MEMBER').expect(201);
      expect(res.body.results).toEqual([{ email: t.admin2.email, status: 'already_member' }]);
    });

    it('an admin may reissue an expired MEMBER invite; the owner may upgrade it to ADMIN with one history row', async () => {
      const t = await team();
      const address = inviteeAddress('reissue');
      await inviteAddress(app, t.admin, address, 'MEMBER');
      await expire(address);
      expect(
        (await invite(t.admin, [address], 'ADMIN')).status, // refused first
      ).toBe(403);
      await invite(t.admin2, [address], 'MEMBER').expect(201);
      await expire(address);
      const res = await invite(t.owner, [address], 'ADMIN').expect(201);
      expect(res.body.results).toEqual([{ email: address, status: 'invited' }]);
      const row = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      expect(row.role).toBe('ADMIN');
      expect(row.invitedById).toBe(t.ownerM.userId);
      const reissued = (await auditRows(prisma, t.workspaceId)).filter(
        (r) => r.action === 'invite.reissued' && r.entityId === row.id,
      );
      expect(reissued).toHaveLength(2);
      expect(reissued[1]?.actorUserId).toBe(t.ownerM.userId);
      expect(reissued[1]?.before).toMatchObject({ role: 'MEMBER' });
      expect(reissued[1]?.after).toMatchObject({ role: 'ADMIN' });
    });
  });

  describe('the accept flow grants exactly the invite role', () => {
    const accept = (token: string) =>
      http()
        .post('/auth/invites/accept')
        .send({ token, name: 'New Person', password: 'a-long-enough-password-1' });

    it('an admin-created MEMBER invite yields a MEMBER, also after the admin is demoted or resends', async () => {
      const t = await team();
      const address = inviteeAddress('acc1');
      await inviteAddress(app, t.admin, address, 'MEMBER');
      const row = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      await resend(t.admin2, row.id).expect(200);
      const token = tokenFromEmail(mailbox(app).lastTo(address));
      await patch(t.owner, t.adminM.id, 'MEMBER').expect(200);
      const res = await accept(token).expect(200);
      expect(res.body.accessToken).toBeDefined();
      const joined = await membershipOf(prisma, address, t.workspaceId);
      expect(joined.role).toBe('MEMBER');
      // The new member has no admin access.
      await invite({ accessToken: res.body.accessToken }, [inviteeAddress('n')], 'MEMBER').expect(
        403,
      );
    });

    it('an owner-created ADMIN invite yields an ADMIN who cannot touch the owner', async () => {
      const t = await team();
      const address = inviteeAddress('acc2');
      const token = await inviteAddress(app, t.owner, address, 'ADMIN');
      const res = await accept(token).expect(200);
      const joined = await membershipOf(prisma, address, t.workspaceId);
      expect(joined.role).toBe('ADMIN');
      const fresh = { accessToken: res.body.accessToken as string };
      expect((await remove(fresh, t.ownerM.id)).body.error.code).toBe('OWNER_IMMUTABLE');
      expect((await patch(fresh, t.admin2M.id, 'MEMBER')).status).toBe(403);
    });

    it('a refused admin invite attempt leaves no accept token behind', async () => {
      const t = await team();
      const address = inviteeAddress('acc3');
      const sent = mailbox(app).outbox.length;
      await invite(t.admin, [address], 'ADMIN').expect(403);
      expect(mailbox(app).outbox.length).toBe(sent);
      expect(await prisma.invite.count({ where: { email: address } })).toBe(0);
    });
  });

  describe('cross-workspace ids are 404, never 403', () => {
    it('another workspace owner or admin gets 404 for members and invites, whatever the target role', async () => {
      const t = await team();
      const otherOwner = await ownerOf(app, 'other');
      const otherAdmin = await joinAs(app, otherOwner, 'ADMIN', 'oadmin');
      const address = inviteeAddress('xws');
      await inviteAddress(app, t.owner, address, 'ADMIN');
      const inv = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      for (const who of [otherOwner, otherAdmin]) {
        for (const id of [t.ownerM.id, t.adminM.id, t.memberM.id]) {
          expect((await patch(who, id, 'MEMBER')).status).toBe(404);
          expect((await patch(who, id, 'ADMIN')).status).toBe(404);
          expect((await remove(who, id)).status).toBe(404);
        }
        expect((await resend(who, inv.id)).status).toBe(404);
        expect((await cancel(who, inv.id)).status).toBe(404);
      }
      expect(await roleOf(t.adminM.id)).toBe('ADMIN');
      expect(await prisma.invite.count({ where: { id: inv.id } })).toBe(1);
      // Inviting ADMIN in your own workspace does not create anything in ours.
      expect(await prisma.membership.count({ where: { workspaceId: t.workspaceId } })).toBe(4);
    });

    it('a 404 body for a foreign id is identical to the one for a random id', async () => {
      const t = await team();
      const otherOwner = await ownerOf(app, 'other2');
      const foreign = await patch(otherOwner, t.adminM.id, 'MEMBER').expect(404);
      const random = await patch(
        otherOwner,
        '00000000-0000-4000-8000-000000000001',
        'MEMBER',
      ).expect(404);
      expect(foreign.body).toEqual(random.body);
    });
  });

  describe('audit trail', () => {
    it('refused attempts write nothing; allowed ones write exactly one row with the right actor', async () => {
      const t = await team();
      const mark = async () => (await auditRows(prisma, t.workspaceId)).length;
      const start = await mark();
      const address = inviteeAddress('aud');

      // Refused
      await patch(t.admin, t.admin2M.id, 'MEMBER').expect(403);
      await patch(t.admin, t.memberM.id, 'ADMIN').expect(403);
      await remove(t.admin, t.admin2M.id).expect(403);
      await invite(t.admin, [address], 'ADMIN').expect(403);
      await patch(t.admin, t.ownerM.id, 'MEMBER').expect(403);
      await patch(t.admin, t.adminM.id, 'MEMBER').expect(403);
      await patch(t.member, t.memberM.id, 'MEMBER').expect(403);
      expect(await mark()).toBe(start);

      // Allowed
      await patch(t.owner, t.memberM.id, 'ADMIN').expect(200);
      let rows = (await auditRows(prisma, t.workspaceId)).slice(start);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorUserId: t.ownerM.userId,
        action: 'member.role_changed',
        entityId: t.memberM.id,
      });
      expect(rows[0]?.before).toMatchObject({ role: 'MEMBER' });
      expect(rows[0]?.after).toMatchObject({ role: 'ADMIN' });

      await remove(t.owner, t.admin2M.id).expect(204);
      rows = (await auditRows(prisma, t.workspaceId)).slice(start);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        actorUserId: t.ownerM.userId,
        action: 'member.removed',
        entityId: t.admin2M.id,
      });
      expect(rows[1]?.before).toMatchObject({ role: 'ADMIN' });

      await invite(t.owner, [address], 'ADMIN').expect(201);
      rows = (await auditRows(prisma, t.workspaceId)).slice(start);
      expect(rows).toHaveLength(3);
      expect(rows[2]).toMatchObject({ actorUserId: t.ownerM.userId, action: 'invite.created' });
      expect(rows[2]?.after).toMatchObject({ role: 'ADMIN' });

      const inv = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      await resend(t.admin, inv.id).expect(403);
      await cancel(t.admin, inv.id).expect(403);
      expect(await mark()).toBe(start + 3);
      await resend(t.owner, inv.id).expect(200);
      await cancel(t.owner, inv.id).expect(204);
      rows = (await auditRows(prisma, t.workspaceId)).slice(start);
      expect(rows.map((r) => r.action)).toEqual([
        'member.role_changed',
        'member.removed',
        'invite.created',
        'invite.resent',
        'invite.cancelled',
      ]);
      expect(rows.every((r) => r.actorUserId === t.ownerM.userId)).toBe(true);
    });

    it('an admin acting on a member is recorded as the admin', async () => {
      const t = await team();
      const start = (await auditRows(prisma, t.workspaceId)).length;
      await remove(t.admin, t.memberM.id).expect(204);
      const rows = (await auditRows(prisma, t.workspaceId)).slice(start);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorUserId).toBe(t.adminM.userId);
    });
  });

  describe('403 bodies leak nothing', () => {
    it('only code and a generic message: no ids, emails, roles of the target, no details', async () => {
      const t = await team();
      const address = inviteeAddress('leak');
      await inviteAddress(app, t.owner, address, 'ADMIN');
      const inv = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      const responses = [
        await patch(t.admin, t.admin2M.id, 'MEMBER'),
        await patch(t.admin, t.memberM.id, 'ADMIN'),
        await remove(t.admin, t.admin2M.id),
        await invite(t.admin, [address], 'ADMIN'),
        await resend(t.admin, inv.id),
        await cancel(t.admin, inv.id),
      ];
      for (const res of responses) {
        expect(res.status).toBe(403);
        expect(Object.keys(res.body)).toEqual(['error']);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(res.body.error.details).toBeUndefined();
        const text = JSON.stringify(res.body);
        for (const secret of [
          t.admin2.email,
          t.member.email,
          address,
          t.admin2M.id,
          t.memberM.id,
          inv.id,
          t.workspaceId,
        ]) {
          expect(text).not.toContain(secret);
        }
        expect(text).not.toMatch(/prisma|stack|at .*\.ts/i);
      }
    });

    it('an admin cannot tell an existing ADMIN invite from a MEMBER one by status when resending a foreign id', async () => {
      const t = await team();
      const other = await ownerOf(app, 'leak2');
      const address = inviteeAddress('leak2inv');
      await inviteAddress(app, other, address, 'ADMIN');
      const inv = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      expect((await resend(t.admin, inv.id)).status).toBe(404);
    });
  });

  describe('check-then-write windows (deterministic, via a hook between the check and the write)', () => {
    // BUG (known failing): MembersService.remove checks the target in findTarget
    // (members.service.ts ~l.143) but the delete in the transaction (~l.119) is
    // unconditional on role, so an admin can delete someone the owner promoted
    // to ADMIN a moment after the check.
    it('an admin cannot remove a member who became an admin after the check', async () => {
      const t = await team();
      const service = app.get(MembersService);
      const original = (service as unknown as { findTarget: (...a: unknown[]) => Promise<unknown> })
        .findTarget;
      const spy = jest
        .spyOn(
          service as unknown as { findTarget: (...a: unknown[]) => Promise<unknown> },
          'findTarget',
        )
        .mockImplementation(async function (this: unknown, ...args: unknown[]) {
          const target = await original.apply(this, args);
          await prisma.membership.update({ where: { id: t.memberM.id }, data: { role: 'ADMIN' } });
          return target;
        });
      try {
        await remove(t.admin, t.memberM.id);
      } finally {
        spy.mockRestore();
      }
      expect(await roleOf(t.memberM.id)).toBe('ADMIN'); // still there
    });

    // BUG (known failing): InvitesService.resend/cancel assertMayManage reads the
    // role, then the update/delete (invites.service.ts ~l.108 / ~l.139) is only
    // conditional on acceptedAt, not on role. If the owner reissues the expired
    // MEMBER invite as ADMIN in between, the admin still rotates/cancels it.
    it('an admin cannot cancel an invite that became an admin invite after the check', async () => {
      const t = await team();
      const address = inviteeAddress('toctou');
      await inviteAddress(app, t.admin, address, 'MEMBER');
      const row = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      const service = app.get(InvitesService);
      type Guarded = { assertMayManage: (...a: unknown[]) => Promise<void> };
      const original = (service as unknown as Guarded).assertMayManage;
      const spy = jest
        .spyOn(service as unknown as Guarded, 'assertMayManage')
        .mockImplementation(async function (this: unknown, ...args: unknown[]) {
          await original.apply(this, args);
          await prisma.invite.update({ where: { id: row.id }, data: { role: 'ADMIN' } });
        });
      try {
        await cancel(t.admin, row.id);
      } finally {
        spy.mockRestore();
      }
      expect(await prisma.invite.count({ where: { id: row.id } })).toBe(1);
    });
  });
});
