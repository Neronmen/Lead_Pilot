import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { createTestApp } from './utils/create-test-app';
import {
  OWN,
  PUBLIC,
  registeredRoutes as routesOf,
  WORKSPACE_BY_ID,
  WORKSPACE_COLLECTION,
} from './utils/routes';
import {
  INVITES_EMAIL_PREFIX,
  inviteAddress,
  inviteeAddress,
  joinAs,
  ownerOf,
} from './utils/invites';
import { makeLead, membershipOf, workspaceOf } from './utils/workspace-data';

/**
 * The isolation matrix (CLAUDE.md, Tenancy: every endpoint needs a
 * cross-workspace test). It reads every route the app registers and makes
 * the developer say what each one is:
 *
 * - PUBLIC: needs no sign-in (and is rate limited or harmless).
 * - OWN: acts on the caller's own account only, never on an id from the URL.
 * - WORKSPACE: acts on the caller's workspace; admin only. Split into
 *   collection routes (workspace comes from the token) and by-id routes
 *   (an id from another workspace must be a 404 that changes nothing).
 *
 * A new route that is in none of these lists fails the first test below, so
 * it cannot ship without a decision (and, for by-id routes, without a test).
 */
describe('Tenant isolation matrix (e2e)', () => {
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

  /** "POST /invites/:id/resend" -> a call with the given id. */
  function call(route: string, id: string) {
    const [method, path] = route.split(' ') as [string, string];
    const url = path.replace(':id', id);
    const req = http()[method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete'](url);
    // Valid bodies, so a rejection is about access and not about validation.
    if (route === 'PATCH /members/:id') return req.send({ role: 'ADMIN' });
    if (route === 'POST /invites')
      return req.send({ emails: [inviteeAddress('matrix')], role: 'MEMBER' });
    if (route === 'PATCH /auth/me') return req.send({ locale: 'vi' });
    return req;
  }

  it('has a decision for every route the app registers', () => {
    const classified = new Set([...PUBLIC, ...OWN, ...WORKSPACE_COLLECTION, ...WORKSPACE_BY_ID]);
    const routes = routesOf(app);
    // A new route lands here: classify it above, and add its cross-workspace test.
    expect(routes.filter((route) => !classified.has(route))).toEqual([]);
    // And the lists name no route that does not exist (a stale entry).
    expect([...classified].filter((route) => !routes.includes(route))).toEqual([]);
  });

  it('answers 401 without a token on every route that is not public', async () => {
    const id = crypto.randomUUID();
    for (const route of routesOf(app).filter((r) => !PUBLIC.has(r))) {
      const res = await call(route, id);
      expect({ route, status: res.status }).toEqual({ route, status: 401 });
    }
  });

  describe('two workspaces', () => {
    // A: owner, admin, member and a pending invite. B: just an owner.
    let a: Awaited<ReturnType<typeof setup>>;
    let b: Awaited<ReturnType<typeof setup>>;

    async function setup(label: string) {
      const owner = await ownerOf(app, `${label}-owner`);
      const admin = await joinAs(app, owner, 'ADMIN', `${label}-admin`);
      const member = await joinAs(app, owner, 'MEMBER', `${label}-member`);
      const workspaceId = await workspaceOf(prisma, owner.body.email);
      const inviteEmail = inviteeAddress(`${label}-pending`);
      await inviteAddress(app, owner, inviteEmail);
      const memberM = await membershipOf(prisma, member.email, workspaceId);
      await makeLead(prisma, workspaceId, { ownerId: memberM.userId });
      return {
        owner,
        admin,
        member,
        workspaceId,
        memberM,
        adminM: await membershipOf(prisma, admin.email, workspaceId),
        invite: await prisma.invite.findFirstOrThrow({ where: { email: inviteEmail } }),
      };
    }

    beforeAll(async () => {
      a = await setup('a');
      b = await setup('b');
    });

    /** Everything about A that the by-id routes could change. */
    async function snapshotOfA() {
      return {
        memberships: await prisma.membership.findMany({
          where: { workspaceId: a.workspaceId },
          orderBy: { id: 'asc' },
          select: { id: true, role: true, userId: true },
        }),
        invites: await prisma.invite.findMany({
          where: { workspaceId: a.workspaceId },
          orderBy: { id: 'asc' },
          select: { id: true, tokenHash: true, expiresAt: true, failedAttempts: true },
        }),
        leads: await prisma.lead.findMany({
          where: { workspaceId: a.workspaceId },
          orderBy: { id: 'asc' },
          select: { id: true, ownerId: true },
        }),
        audit: await prisma.auditLog.count({ where: { workspaceId: a.workspaceId } }),
      };
    }

    // The id each by-id route is called with. A route in WORKSPACE_BY_ID that is
    // missing here fails (see below), so a new one cannot get a wrong id and a
    // vacuous 404.
    const TARGET_ID: Record<string, (w: typeof a) => string> = {
      'POST /invites/:id/resend': (w) => w.invite.id,
      'DELETE /invites/:id': (w) => w.invite.id,
      'PATCH /members/:id': (w) => w.memberM.id,
      'DELETE /members/:id': (w) => w.memberM.id,
    };
    const idFor = (route: string, w: typeof a): string => {
      const pick = TARGET_ID[route];
      if (!pick)
        throw new Error(`${route} has no entry in TARGET_ID: say which resource its :id is`);
      return pick(w);
    };

    it('names a target resource for every by-id route', () => {
      expect([...WORKSPACE_BY_ID].filter((route) => !(route in TARGET_ID))).toEqual([]);
      expect(Object.keys(TARGET_ID).filter((route) => !WORKSPACE_BY_ID.has(route))).toEqual([]);
    });

    // Collection routes (GET and POST /invites, GET /members) take no id: the
    // workspace comes from the token. Besides the 401 and the member-403 tests
    // that run over this set, the tests below on "show only the callers own
    // workspace" and "creates in the callers workspace only" cover them.

    it.each([...WORKSPACE_BY_ID])(
      "%s: another workspace's id is a 404 and changes nothing",
      async (route) => {
        const before = await snapshotOfA();
        // B's owner knows an id of A (a leaked or guessed one).
        const res = await call(route, idFor(route, a)).set('authorization', bearer(b.owner));
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
        expect(await snapshotOfA()).toEqual(before);
      },
    );

    it.each([...WORKSPACE_BY_ID])(
      '%s: an admin of the other workspace gets the same 404, not a 403',
      async (route) => {
        // 404 for both, so the answer does not reveal that the id exists elsewhere.
        const res = await call(route, idFor(route, a)).set('authorization', bearer(b.admin));
        expect(res.status).toBe(404);
      },
    );

    it.each([...WORKSPACE_BY_ID, ...WORKSPACE_COLLECTION])(
      '%s: a member of the workspace gets 403, whatever the id',
      async (route) => {
        // Collection routes take no id; by-id routes get a real one of this workspace.
        const id = WORKSPACE_BY_ID.has(route) ? idFor(route, a) : crypto.randomUUID();
        const res = await call(route, id).set('authorization', bearer(a.member));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      },
    );

    it('GET /members and GET /invites show only the callers own workspace', async () => {
      const members = await http()
        .get('/members')
        .set('authorization', bearer(b.owner))
        .expect(200);
      expect((members.body as Array<{ id: string }>).map((m) => m.id).sort()).toEqual(
        (await prisma.membership.findMany({ where: { workspaceId: b.workspaceId } }))
          .map((m) => m.id)
          .sort(),
      );
      expect(JSON.stringify(members.body)).not.toContain(a.member.email);

      const invites = await http()
        .get('/invites')
        .set('authorization', bearer(b.owner))
        .expect(200);
      expect((invites.body as Array<{ id: string }>).map((i) => i.id)).toEqual([b.invite.id]);
      expect(JSON.stringify(invites.body)).not.toContain(a.invite.email);
    });

    it('POST /invites creates in the callers workspace only', async () => {
      const address = inviteeAddress('matrix-create');
      await http()
        .post('/invites')
        .set('authorization', bearer(b.owner))
        .send({ emails: [address], role: 'MEMBER' })
        .expect(201);
      const row = await prisma.invite.findFirstOrThrow({ where: { email: address } });
      expect(row.workspaceId).toBe(b.workspaceId);
      // A request cannot name another workspace.
      await http()
        .post('/invites')
        .set('authorization', bearer(b.owner))
        .send({ emails: [inviteeAddress('x')], role: 'MEMBER', workspaceId: a.workspaceId })
        .expect(400);
    });

    it('GET and PATCH /auth/me only ever show and change the callers own account', async () => {
      const me = await http().get('/auth/me').set('authorization', bearer(b.owner)).expect(200);
      expect(me.body.workspace.id).toBe(b.workspaceId);
      expect(me.body.user.email).toBe(b.owner.body.email);
      await http()
        .patch('/auth/me')
        .set('authorization', bearer(b.owner))
        .send({ locale: 'vi' })
        .expect(200);
      // A's owner is unchanged.
      const aOwner = await prisma.user.findUniqueOrThrow({ where: { email: a.owner.body.email } });
      expect(aOwner.locale).toBeNull();
    });

    it('a token for one workspace cannot be used on another, even for the same person', async () => {
      // A person who belongs to both: the token names exactly one workspace.
      const both = await joinAs(app, a.owner, 'ADMIN', 'both');
      const token = await inviteAddress(app, b.owner, both.email, 'MEMBER');
      const inB = await http()
        .post('/auth/invites/accept')
        .send({ token, password: both.password })
        .expect(200);

      const inAList = await http().get('/members').set('authorization', bearer(both)).expect(200);
      expect(JSON.stringify(inAList.body)).toContain(a.member.email);
      expect(JSON.stringify(inAList.body)).not.toContain(b.owner.body.email);
      // In B they are only a member: no admin routes there.
      await http().get('/members').set('authorization', bearer(inB.body)).expect(403);
    });
  });
});
