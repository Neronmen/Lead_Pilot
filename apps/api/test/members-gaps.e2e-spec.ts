import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { createTestApp } from './utils/create-test-app';
import {
  INVITES_EMAIL_PREFIX,
  inviteAddress,
  inviteeAddress,
  joinAs,
  ownerOf,
} from './utils/invites';
import { auditRows, makeLead, membershipOf, workspaceOf } from './utils/workspace-data';

/**
 * Gaps found while reviewing step 6: races, sessions after removal, the
 * completeness of the change history, "exists elsewhere" vs "does not
 * exist", and the cost of the Team list in a big workspace.
 */
describe('Members: races, sessions, history and scale (e2e)', () => {
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

  const http = () => request(app.getHttpServer());
  const bearer = (user: { accessToken: string }) => `Bearer ${user.accessToken}`;
  const patch = (who: { accessToken: string }, id: string, body: unknown) =>
    http()
      .patch(`/members/${id}`)
      .set('authorization', bearer(who))
      .send(body as object);
  const remove = (who: { accessToken: string }, id: string) =>
    http().delete(`/members/${id}`).set('authorization', bearer(who));

  /** An owner, two admins and a member. */
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

  describe('races', () => {
    it('two admins removing the same member: one 204, one 404, one history row, no 500', async () => {
      const t = await team();
      const lead = await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId });
      const results = await Promise.all([
        remove(t.admin, t.memberM.id),
        remove(t.admin2, t.memberM.id),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
      expect(await prisma.membership.count({ where: { id: t.memberM.id } })).toBe(0);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).ownerId).toBeNull();
      const removed = (await auditRows(prisma, t.workspaceId)).filter(
        (row) => row.action === 'member.removed',
      );
      expect(removed).toHaveLength(1);
      expect(removed[0]?.after).toEqual({ unassignedLeads: 1 });
    });

    it('the owner making the same member an admin twice at once: one wins, the other 200 or 409, one history row', async () => {
      const t = await team();
      const results = await Promise.all([
        patch(t.owner, t.memberM.id, { role: 'ADMIN' }),
        patch(t.owner, t.memberM.id, { role: 'ADMIN' }),
      ]);
      // One request wins. The other either arrived after it committed (the role
      // is already ADMIN: an idempotent 200) or collided with it (409). Never a 500.
      const statuses = results.map((r) => r.status).sort();
      expect([JSON.stringify([200, 200]), JSON.stringify([200, 409])]).toContain(
        JSON.stringify(statuses),
      );
      expect((await membershipOf(prisma, t.member.email, t.workspaceId)).role).toBe('ADMIN');
      const changes = (await auditRows(prisma, t.workspaceId)).filter(
        (row) => row.action === 'member.role_changed',
      );
      // The role changed once (MEMBER to ADMIN), so the history says so once.
      expect(changes).toHaveLength(1);
    });

    it('a role change racing a removal: no 500, and the history never contradicts the end state', async () => {
      for (let i = 0; i < 4; i += 1) {
        const t = await team();
        const [changed, removed] = await Promise.all([
          patch(t.owner, t.memberM.id, { role: 'ADMIN' }),
          // The owner removes them (an admin could not once they became an admin: the next test).
          remove(t.owner, t.memberM.id),
        ]);
        expect(removed.status).toBe(204);
        expect([200, 404]).toContain(changed.status);
        const rows = await auditRows(prisma, t.workspaceId);
        const roleRows = rows.filter((row) => row.action === 'member.role_changed');
        // A 404 change leaves no row; a 200 change leaves exactly one.
        expect(roleRows).toHaveLength(changed.status === 200 ? 1 : 0);
        const removedRow = rows.find((row) => row.action === 'member.removed');
        // "before" of the removal is what the person was when they were removed.
        expect(removedRow?.before).toMatchObject({
          role: changed.status === 200 ? 'ADMIN' : 'MEMBER',
        });
      }
    });

    it('an admin removing a member while the owner promotes them: never an admin removed by an admin', async () => {
      for (let i = 0; i < 6; i += 1) {
        const t = await team();
        const [promoted, removed] = await Promise.all([
          patch(t.owner, t.memberM.id, { role: 'ADMIN' }),
          remove(t.admin2, t.memberM.id),
        ]);
        // Either the removal won (204, then the promotion finds nobody: 404), or the
        // promotion won and the admin may no longer remove them (403, they stay an admin).
        const rows = await auditRows(prisma, t.workspaceId);
        const stillThere = await prisma.membership.findUnique({ where: { id: t.memberM.id } });
        if (removed.status === 204) {
          expect(promoted.status).toBe(404);
          expect(stillThere).toBeNull();
          expect(rows.filter((row) => row.action === 'member.removed')).toHaveLength(1);
        } else {
          expect(removed.status).toBe(403);
          expect(promoted.status).toBe(200);
          expect(stillThere?.role).toBe('ADMIN');
          expect(rows.filter((row) => row.action === 'member.removed')).toHaveLength(0);
        }
      }
    });

    it('a removal racing a refresh rotation leaves no usable session in the workspace', async () => {
      for (let i = 0; i < 4; i += 1) {
        const t = await team();
        const [refreshed, removed] = await Promise.all([
          http().post('/auth/refresh').set('cookie', t.member.refreshCookie),
          remove(t.owner, t.memberM.id),
        ]);
        expect(removed.status).toBe(204);
        expect([200, 401]).toContain(refreshed.status);
        // Whatever the rotation produced, no token of this person survives here...
        expect(
          await prisma.refreshToken.count({
            where: { workspaceId: t.workspaceId, userId: t.memberM.userId },
          }),
        ).toBe(0);
        // ...and every access token and cookie they hold is dead.
        if (refreshed.status === 200) {
          const fresh = refreshed.body.accessToken as string;
          await http().get('/auth/me').set('authorization', `Bearer ${fresh}`).expect(401);
          const cookie = (refreshed.headers['set-cookie'] as unknown as string[])[0] ?? '';
          await http()
            .post('/auth/refresh')
            .set('cookie', cookie.split(';')[0] ?? '')
            .expect(401);
        }
        await http().get('/auth/me').set('authorization', bearer(t.member)).expect(401);
      }
    });

    it('a removal racing an accept into another workspace leaves both consistent', async () => {
      const a = await team();
      const b = await ownerOf(app, 'b-owner');
      const bWorkspaceId = await workspaceOf(prisma, b.body.email);
      const token = await inviteAddress(app, b, a.member.email);
      const [removed, accepted] = await Promise.all([
        remove(a.owner, a.memberM.id),
        http().post('/auth/invites/accept').send({ token, password: a.member.password }),
      ]);
      expect(removed.status).toBe(204);
      expect(accepted.status).toBe(200);
      expect(await membershipOf(prisma, a.member.email, bWorkspaceId)).toBeTruthy();
      expect(await prisma.membership.count({ where: { id: a.memberM.id } })).toBe(0);
      await http().get('/auth/me').set('authorization', bearer(accepted.body)).expect(200);
    });

    it('two accepts of one link: one member.joined row, the loser leaves nothing behind', async () => {
      const owner = await ownerOf(app);
      const workspaceId = await workspaceOf(prisma, owner.body.email);
      const email = inviteeAddress('double');
      const token = await inviteAddress(app, owner, email);
      const body = { token, name: 'Double Dee', password: 'a-long-enough-password-1' };
      const results = await Promise.all([
        http().post('/auth/invites/accept').send(body),
        http().post('/auth/invites/accept').send(body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      const joined = (await auditRows(prisma, workspaceId)).filter(
        (row) => row.action === 'member.joined',
      );
      expect(joined).toHaveLength(1);
      expect(await prisma.membership.count({ where: { workspaceId } })).toBe(2);
    });
  });

  describe('sessions after removal', () => {
    it('ends every session in the workspace, not those in another one, and removes team seats', async () => {
      const a = await team();
      const b = await ownerOf(app, 'b-owner');
      const bWorkspaceId = await workspaceOf(prisma, b.body.email);
      const token = await inviteAddress(app, b, a.member.email);
      const inB = await http()
        .post('/auth/invites/accept')
        .send({ token, password: a.member.password })
        .expect(200);
      const sales = await prisma.team.create({
        data: { workspaceId: a.workspaceId, name: 'Sales' },
      });
      await prisma.teamMember.create({
        data: { teamId: sales.id, membershipId: a.memberM.id, workspaceId: a.workspaceId },
      });

      await remove(a.owner, a.memberM.id).expect(204);

      expect(await prisma.teamMember.count({ where: { membershipId: a.memberM.id } })).toBe(0);
      expect(
        await prisma.refreshToken.count({
          where: { workspaceId: a.workspaceId, userId: a.memberM.userId },
        }),
      ).toBe(0);
      // The session in B is untouched, including its refresh token.
      expect(
        await prisma.refreshToken.count({
          where: { workspaceId: bWorkspaceId, userId: a.memberM.userId, revokedAt: null },
        }),
      ).toBeGreaterThan(0);
      await http().get('/auth/me').set('authorization', bearer(inB.body)).expect(200);
    });

    it('after being invited back, the old access token works only as the new membership (role from the database)', async () => {
      const t = await team();
      await remove(t.owner, t.adminM.id).expect(204);
      await http().get('/members').set('authorization', bearer(t.admin)).expect(401);
      const token = await inviteAddress(app, t.owner, t.admin.email, 'MEMBER');
      await http()
        .post('/auth/invites/accept')
        .send({ token, password: t.admin.password })
        .expect(200);
      // Same token as before the removal; the person is now a plain member.
      await http().get('/members').set('authorization', bearer(t.admin)).expect(403);
    });
  });

  describe('change history', () => {
    it('failed, forbidden and no-op requests leave no rows', async () => {
      const t = await team();
      const other = await ownerOf(app, 'other');
      const otherWorkspaceId = await workspaceOf(prisma, other.body.email);
      const before = await prisma.auditLog.count({ where: { workspaceId: t.workspaceId } });
      const unknown = crypto.randomUUID();

      await patch(t.admin, t.ownerM.id, { role: 'MEMBER' }).expect(403);
      await patch(t.admin, t.adminM.id, { role: 'MEMBER' }).expect(403);
      await patch(t.admin, t.memberM.id, { role: 'OWNER' }).expect(400);
      await patch(t.admin, t.memberM.id, {}).expect(400);
      await patch(t.admin, t.memberM.id, { role: 'MEMBER' }).expect(200); // no-op
      await patch(t.member, t.admin2M.id, { role: 'MEMBER' }).expect(403);
      await patch(t.admin, unknown, { role: 'ADMIN' }).expect(404);
      await patch(other, t.memberM.id, { role: 'ADMIN' }).expect(404);
      await remove(t.admin, t.ownerM.id).expect(403);
      await remove(t.admin, t.adminM.id).expect(403);
      await remove(t.member, t.admin2M.id).expect(403);
      await remove(t.admin, unknown).expect(404);
      await remove(other, t.memberM.id).expect(404);
      await remove(t.admin, 'not-a-uuid').expect(400);

      expect(await prisma.auditLog.count({ where: { workspaceId: t.workspaceId } })).toBe(before);
      expect(await prisma.auditLog.count({ where: { workspaceId: otherWorkspaceId } })).toBe(0);
    });

    it('a wrong-password accept leaves no member.joined row', async () => {
      const t = await team();
      const outsider = await ownerOf(app, 'outsider');
      const token = await inviteAddress(app, t.owner, outsider.body.email);
      await http()
        .post('/auth/invites/accept')
        .send({ token, password: 'wrong-password-123' })
        .expect(401);
      const joined = (await auditRows(prisma, t.workspaceId)).filter(
        (row) => row.action === 'member.joined',
      );
      // team() joined three people; the failed accept added nobody.
      expect(joined).toHaveLength(3);
    });

    it('every row names its actor and carries no secret key or value, across all team actions', async () => {
      const t = await team();
      const email = inviteeAddress('later');
      const token = await inviteAddress(app, t.owner, email);
      await http()
        .post('/auth/invites/accept')
        .send({ token, name: 'Later Lee', password: 'a-long-enough-password-1' })
        .expect(200);
      const later = await membershipOf(prisma, email, t.workspaceId);
      await patch(t.owner, later.id, { role: 'ADMIN' }).expect(200);
      await remove(t.owner, later.id).expect(204);

      const rows = await auditRows(prisma, t.workspaceId);
      expect(rows.length).toBeGreaterThan(6);
      for (const row of rows) {
        expect(row.actorUserId).toEqual(expect.any(String));
        expect(row.entityId).toEqual(expect.any(String));
        for (const side of [row.before, row.after]) {
          if (side === null) continue;
          expect(Object.keys(side as object).join(',')).not.toMatch(/token|hash|password|secret/i);
        }
      }
      const dump = JSON.stringify(rows);
      expect(dump).not.toContain(token);
      expect(dump).not.toContain('argon2');
      expect(dump).not.toContain('a-long-enough-password-1');
      const hashes = await prisma.user.findMany({
        where: { email: { startsWith: INVITES_EMAIL_PREFIX } },
        select: { passwordHash: true },
      });
      for (const { passwordHash } of hashes) expect(dump).not.toContain(passwordHash);
    });
  });

  describe('exists elsewhere vs does not exist', () => {
    it('answers the same for admins and owners of another workspace', async () => {
      const a = await team();
      const b = await team();
      const unknown = crypto.randomUUID();
      const strip = (res: request.Response) => ({ status: res.status, body: res.body as unknown });

      for (const who of [b.owner, b.admin]) {
        const missingPatch = strip(await patch(who, unknown, { role: 'ADMIN' }));
        expect(missingPatch.status).toBe(404);
        expect(strip(await patch(who, a.memberM.id, { role: 'ADMIN' }))).toEqual(missingPatch);
        expect(strip(await patch(who, a.ownerM.id, { role: 'ADMIN' }))).toEqual(missingPatch);

        const missingDelete = strip(await remove(who, unknown));
        expect(missingDelete.status).toBe(404);
        expect(strip(await remove(who, a.memberM.id))).toEqual(missingDelete);
        expect(strip(await remove(who, a.ownerM.id))).toEqual(missingDelete);
      }
      // A user id, or an invite id, is not a membership id.
      await inviteAddress(app, a.owner, inviteeAddress('pending'));
      const pending = await prisma.invite.findFirstOrThrow({
        where: { workspaceId: a.workspaceId },
      });
      for (const id of [a.memberM.userId, pending.id]) {
        expect((await patch(a.owner, id, { role: 'ADMIN' })).status).toBe(404);
        expect((await remove(a.owner, id)).status).toBe(404);
      }
      // Validation runs the same for both, so a bad body does not reveal existence either.
      expect((await patch(b.owner, a.memberM.id, { role: 'x' })).status).toBe(400);
      expect((await patch(b.owner, unknown, { role: 'x' })).status).toBe(400);
      expect(await prisma.membership.count({ where: { workspaceId: a.workspaceId } })).toBe(4);
    });

    it('a Member (not admin) gets the same 403 for a real, foreign and unknown id', async () => {
      const a = await team();
      const b = await team();
      const bodies: unknown[] = [];
      for (const id of [a.admin2M.id, b.memberM.id, crypto.randomUUID()]) {
        const res = await patch(a.member, id, { role: 'ADMIN' });
        expect(res.status).toBe(403);
        bodies.push(res.body);
        const del = await remove(a.member, id);
        expect(del.status).toBe(403);
        expect(del.body).toEqual(res.body);
      }
      expect(bodies[0]).toEqual(bodies[1]);
      expect(bodies[1]).toEqual(bodies[2]);
    });
  });

  describe('open leads', () => {
    it('does not count the leads of someone who left, and a leaver rejoining starts at zero', async () => {
      const t = await team();
      await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId });
      await makeLead(prisma, t.workspaceId, { ownerId: t.memberM.userId, outcome: 'QUALIFIED' });
      await remove(t.owner, t.memberM.id).expect(204);
      const token = await inviteAddress(app, t.owner, t.member.email);
      await http()
        .post('/auth/invites/accept')
        .send({ token, password: t.member.password })
        .expect(200);
      const res = await http().get('/members').set('authorization', bearer(t.owner)).expect(200);
      const back = (res.body as Array<{ email: string; openLeads: number }>).find(
        (m) => m.email === t.member.email,
      );
      expect(back?.openLeads).toBe(0);
      expect(
        await prisma.lead.count({ where: { workspaceId: t.workspaceId, ownerId: null } }),
      ).toBe(2);
    });
  });

  describe('scale', () => {
    /** Counts the SQL statements node-postgres sends while `fn` runs. */
    async function countQueries(fn: () => Promise<unknown>): Promise<number> {
      const proto = Client.prototype as unknown as {
        query: (...args: unknown[]) => unknown;
      };
      const original = proto.query;
      let count = 0;
      proto.query = function (this: unknown, ...args: unknown[]) {
        count += 1;
        return original.apply(this, args);
      };
      try {
        await fn();
      } finally {
        proto.query = original;
      }
      return count;
    }

    it('lists 200 members with leads in the same number of queries as 1', async () => {
      const small = await ownerOf(app, 'small');
      const big = await ownerOf(app, 'big');
      const bigId = await workspaceOf(prisma, big.body.email);
      const get = (who: { accessToken: string }) =>
        http().get('/members').set('authorization', bearer(who));

      await get(small).expect(200); // warm up the connection pool
      const baseline = await countQueries(() => get(small).expect(200));

      const stamp = `${INVITES_EMAIL_PREFIX}scale-${Date.now()}`;
      await prisma.user.createMany({
        data: Array.from({ length: 199 }, (_, i) => ({
          email: `${stamp}-${i}@example.com`,
          passwordHash: 'x',
          name: `Person ${i}`,
        })),
      });
      const users = await prisma.user.findMany({
        where: { email: { startsWith: stamp } },
        select: { id: true },
      });
      await prisma.membership.createMany({
        data: users.map((u) => ({ workspaceId: bigId, userId: u.id, role: 'MEMBER' as const })),
      });
      const source = await prisma.source.create({
        data: {
          workspaceId: bigId,
          name: 'Bulk',
          type: 'FORM',
          apiKeyPrefix: `lp_bulk_${Date.now()}`,
          apiKeyHash: 'x',
        },
      });
      await prisma.lead.createMany({
        data: users.flatMap((u, i) =>
          [0, 1, 2].map((n) => ({
            workspaceId: bigId,
            sourceId: source.id,
            email: `lead-${i}-${n}-${stamp}@example.com`,
            rawPayload: {},
            ownerId: u.id,
            outcome: n === 2 ? ('WON' as const) : ('NONE' as const),
          })),
        ),
      });

      let body: Array<{ openLeads: number }> = [];
      const queries = await countQueries(async () => {
        const res = await get(big).expect(200);
        body = res.body as typeof body;
      });
      expect(body).toHaveLength(200);
      expect(body.filter((m) => m.openLeads === 2)).toHaveLength(199);
      expect(queries).toBe(baseline);
      expect(queries).toBeLessThanOrEqual(8);
    });
  });
});
