import { Prisma } from '../generated/prisma/client';
import {
  ARGUMENT_KEYWORDS,
  scopeArgs,
  scopeToWorkspace,
  TENANT_MODELS,
  TenancyViolationError,
} from './workspace-scope';

const WS = '0199a000-0000-7000-8000-00000000000a';
const OTHER = '0199a000-0000-7000-8000-00000000000b';

describe('TENANT_MODELS', () => {
  /**
   * Tables deliberately shared by all workspaces. A new model must either get
   * a workspaceId (and is then scoped automatically) or be added here after a
   * review that it holds no tenant data.
   */
  // UserToken (reset and verify links) belongs to a person, not a workspace, and holds no tenant data.
  const GLOBAL_MODELS = ['Workspace', 'User', 'UserToken', 'PromptVersion', 'Enrichment'];

  it('classifies every model as tenant or reviewed-global', () => {
    const unclassified = Object.values(Prisma.ModelName).filter(
      (model) => !TENANT_MODELS.has(model) && !GLOBAL_MODELS.includes(model),
    );
    expect(unclassified).toEqual([]);
  });

  it('treats the tables with workspaceId as tenant tables', () => {
    expect([...TENANT_MODELS].sort()).toEqual(
      [
        'ActionRun',
        'AuditLog',
        'Feedback',
        'IcpRubric',
        'IdempotencyKey',
        'IngestAttempt',
        'Integration',
        'Invite',
        'Lead',
        'LeadEvent',
        'Membership',
        'RefreshToken',
        'RoutingRule',
        'Score',
        'Source',
        'Team',
        'TeamMember',
      ].sort(),
    );
  });
});

describe('scopeArgs', () => {
  it.each([
    'findUnique',
    'findUniqueOrThrow',
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'count',
    'aggregate',
    'groupBy',
    'delete',
    'deleteMany',
  ])('%s: adds workspaceId to where and keeps the caller filter', (operation) => {
    const args = { where: { id: 'lead-1', status: 'NEW' }, take: 5 };
    expect(scopeArgs('Lead', operation, args, WS)).toEqual({
      where: { id: 'lead-1', status: 'NEW', workspaceId: WS },
      take: 5,
    });
  });

  it('scopes a query that has no where at all', () => {
    expect(scopeArgs('Lead', 'findMany', undefined, WS)).toEqual({ where: { workspaceId: WS } });
  });

  it('does not mutate the caller arguments', () => {
    const args = { where: { id: 'lead-1' } };
    scopeArgs('Lead', 'findUnique', args, WS);
    expect(args).toEqual({ where: { id: 'lead-1' } });
  });

  it('accepts a where that already names the same workspace', () => {
    expect(scopeArgs('Lead', 'findMany', { where: { workspaceId: WS } }, WS)).toEqual({
      where: { workspaceId: WS },
    });
  });

  it('throws when a where names another workspace', () => {
    expect(() => scopeArgs('Lead', 'findMany', { where: { workspaceId: OTHER } }, WS)).toThrow(
      TenancyViolationError,
    );
  });

  it.each(['update', 'updateMany', 'updateManyAndReturn'])(
    '%s: scopes where and leaves data alone',
    (operation) => {
      const args = { where: { id: 'lead-1' }, data: { status: 'ROUTED' } };
      expect(scopeArgs('Lead', operation, args, WS)).toEqual({
        where: { id: 'lead-1', workspaceId: WS },
        data: { status: 'ROUTED' },
      });
    },
  );

  it.each([{ workspaceId: OTHER }, { workspaceId: WS }, { workspace: { connect: { id: OTHER } } }])(
    'update: refuses data that moves a row (%o)',
    (data) => {
      expect(() => scopeArgs('Lead', 'update', { where: { id: 'x' }, data }, WS)).toThrow(
        TenancyViolationError,
      );
    },
  );

  it('create: sets workspaceId on data', () => {
    expect(scopeArgs('Lead', 'create', { data: { email: 'a@b.co' } }, WS)).toEqual({
      data: { email: 'a@b.co', workspaceId: WS },
    });
  });

  it.each(['createMany', 'createManyAndReturn'])('%s: sets workspaceId on every row', (op) => {
    const args = { data: [{ type: 'ingested' }, { type: 'merged' }], skipDuplicates: true };
    expect(scopeArgs('LeadEvent', op, args, WS)).toEqual({
      data: [
        { type: 'ingested', workspaceId: WS },
        { type: 'merged', workspaceId: WS },
      ],
      skipDuplicates: true,
    });
  });

  it('create: throws for another workspaceId or the workspace relation', () => {
    expect(() => scopeArgs('Lead', 'create', { data: { workspaceId: OTHER } }, WS)).toThrow(
      TenancyViolationError,
    );
    expect(() =>
      scopeArgs('Lead', 'create', { data: { workspace: { connect: { id: WS } } } }, WS),
    ).toThrow(TenancyViolationError);
  });

  it('upsert: scopes where and create, and refuses a moving update', () => {
    const args = {
      where: { workspaceId_email: { workspaceId: WS, email: 'a@b.co' } },
      create: { email: 'a@b.co' },
      update: { firstName: 'Ada' },
    };
    expect(scopeArgs('Lead', 'upsert', args, WS)).toEqual({
      where: { workspaceId_email: { workspaceId: WS, email: 'a@b.co' }, workspaceId: WS },
      create: { email: 'a@b.co', workspaceId: WS },
      update: { firstName: 'Ada' },
    });
    expect(() =>
      scopeArgs('Lead', 'upsert', { ...args, update: { workspaceId: OTHER } }, WS),
    ).toThrow(TenancyViolationError);
  });

  it('fails closed on an operation it does not know', () => {
    expect(() => scopeArgs('Lead', 'findRaw', {}, WS)).toThrow(/not supported/);
  });

  describe('Workspace', () => {
    it('scopes reads and updates to its own id', () => {
      expect(scopeArgs('Workspace', 'findFirst', undefined, WS)).toEqual({ where: { id: WS } });
      expect(
        scopeArgs('Workspace', 'update', { where: { id: WS }, data: { name: 'N' } }, WS),
      ).toEqual({ where: { id: WS }, data: { name: 'N' } });
    });

    it('throws for another workspace id', () => {
      expect(() => scopeArgs('Workspace', 'findUnique', { where: { id: OTHER } }, WS)).toThrow(
        TenancyViolationError,
      );
    });

    it.each(['create', 'createMany', 'delete', 'deleteMany', 'upsert'])(
      'refuses %s',
      (operation) => {
        expect(() => scopeArgs('Workspace', operation, { where: { id: WS } }, WS)).toThrow(
          TenancyViolationError,
        );
      },
    );
  });
});

describe('ARGUMENT_KEYWORDS', () => {
  it('collides with no field of a model the scope walks', () => {
    const scalarFieldEnums = Prisma as unknown as Record<
      string,
      Record<string, string> | undefined
    >;
    // Enrichment is global and has no relations, so no query path reaches it.
    const walked = Object.values(Prisma.ModelName).filter((model) => model !== 'Enrichment');
    const collisions = walked.flatMap((model) =>
      Object.keys(scalarFieldEnums[`${model}ScalarFieldEnum`] ?? {})
        .filter((field) => ARGUMENT_KEYWORDS.has(field))
        .map((field) => `${model}.${field}`),
    );
    expect(collisions).toEqual([]);
  });
});

describe('scopeArgs: nested arguments', () => {
  const scope = (model: string, operation: string, args: Record<string, unknown>) => () =>
    scopeArgs(model, operation, args, WS);

  it.each(['User', 'PromptVersion', 'Enrichment'])('refuses %s as the root model', (model) => {
    expect(scope(model, 'findMany', {})).toThrow(/shared by all workspaces/);
  });

  it('allows reading scalars of a global model from a tenant row', () => {
    const args = { include: { user: { select: { name: true, email: true } } } };
    expect(scopeArgs('Membership', 'findMany', args, WS)).toEqual({
      ...args,
      where: { workspaceId: WS },
    });
  });

  it.each([
    ['include', 'Membership', { include: { user: { include: { memberships: true } } } }],
    ['select', 'Invite', { select: { invitedBy: { select: { memberships: true } } } }],
    [
      '_count',
      'Score',
      { include: { promptVersion: { select: { _count: { select: { scores: true } } } } } },
    ],
    [
      'relation filter',
      'Membership',
      { where: { user: { memberships: { some: { workspaceId: OTHER } } } } },
    ],
    [
      'nested OR',
      'Membership',
      { where: { OR: [{ user: { is: { invitesSent: { some: {} } } } }] } },
    ],
  ])('refuses leaving a global model towards tenant data (%s)', (_name, root, args) => {
    expect(scope(root, 'findMany', args)).toThrow(/cannot lead back/);
  });

  it('allows nested reads between tenant models', () => {
    const args = {
      include: { source: true, events: { where: { type: 'ingested' } }, workspace: true },
      where: { owner: { is: { role: 'ADMIN' } } },
    };
    expect(() => scopeArgs('Lead', 'findMany', args, WS)).not.toThrow();
  });

  it.each([
    ['to-many connect', { events: { connect: { id: 'x' } } }],
    ['to-one connect', { source: { connect: { id: 'x' } } }],
    ['connectOrCreate', { owner: { connectOrCreate: { where: {}, create: {} } } }],
    ['set', { events: { set: [{ id: 'x' }] } }],
    ['deep connect', { events: { create: { lead: { connect: { id: 'x' } } } } }],
  ])('refuses nested foreign-key writes: %s', (_name, data) => {
    expect(scope('Lead', 'update', { where: { id: 'a' }, data })).toThrow(/foreign key/);
  });

  it('refuses connect through the Workspace row too', () => {
    expect(
      scope('Workspace', 'update', {
        where: { id: WS },
        data: { invites: { connect: { id: 'x' } } },
      }),
    ).toThrow(/foreign key/);
  });

  it('refuses nested writes into a global model', () => {
    expect(
      scope('Membership', 'update', {
        where: { id: 'm' },
        data: { user: { update: { name: 'Eve' } } },
      }),
    ).toThrow(/nested writes into User/);
  });

  it('allows nested creates and scalar list updates', () => {
    expect(() =>
      scopeArgs(
        'Lead',
        'update',
        {
          where: { id: 'a' },
          data: { events: { create: { type: 'merged' } }, firstName: { set: 'Ada' } },
        },
        WS,
      ),
    ).not.toThrow();
    expect(() =>
      scopeArgs(
        'IcpRubric',
        'update',
        { where: { id: 'r' }, data: { industries: { set: ['SaaS'] } } },
        WS,
      ),
    ).not.toThrow();
  });

  it('never inspects JSON values, whatever keys they contain', () => {
    const rawPayload = { connect: { id: 'x' }, set: 1, user: { memberships: true } };
    expect(() =>
      scopeArgs(
        'Lead',
        'create',
        { data: { sourceId: 's', rawPayload, customFields: rawPayload } },
        WS,
      ),
    ).not.toThrow();
  });
});

describe('scopeArgs: nested writes stay in the workspace', () => {
  const update = (model: string, data: Record<string, unknown>) => () =>
    scopeArgs(model, 'update', { where: { id: 'x' }, data }, WS);

  it.each([
    ['nested workspaceId', { source: { update: { workspaceId: OTHER } } }],
    [
      'nested workspaceId in createMany',
      { events: { createMany: { data: [{ workspaceId: OTHER }] } } },
    ],
  ])('refuses %s naming another workspace', (_name, data) => {
    expect(update('Lead', data)).toThrow(/never change workspace/);
  });

  it('allows a nested workspaceId that names the scope', () => {
    expect(
      update('Lead', { events: { createMany: { data: [{ workspaceId: WS, type: 't' }] } } }),
    ).not.toThrow();
  });

  it.each([
    ['create', { source: { update: { workspace: { create: { name: 'N', slug: 'n' } } } } }],
    ['update', { workspace: { update: { name: 'Renamed' } } }],
  ])('refuses nested %s of the Workspace row', (_name, data) => {
    expect(update('Lead', data)).toThrow(/nested writes into Workspace/);
  });

  it('reads a where inside a write as a filter, not a write', () => {
    expect(
      update('Lead', {
        events: {
          updateMany: { where: { lead: { owner: { user: { email: 'a@b.co' } } } }, data: {} },
        },
      }),
    ).not.toThrow();
  });

  it('walks a keyword even where a field of the same name could hide it', () => {
    expect(
      update('Lead', {
        events: { update: { where: { id: 'e' }, data: { lead: { connect: { id: 'x' } } } } },
      }),
    ).toThrow(/foreign key/);
  });
});

describe('scopeArgs: the Workspace row', () => {
  it.each(['findRaw', 'aggregateRaw', 'createManyAndReturn'])('fails closed on %s', (operation) => {
    expect(() => scopeArgs('Workspace', operation, {}, WS)).toThrow(TenancyViolationError);
  });

  it('refuses changing the workspace id', () => {
    expect(() =>
      scopeArgs('Workspace', 'update', { where: { id: WS }, data: { id: OTHER } }, WS),
    ).toThrow(/never changes/);
  });
});

describe('scopeToWorkspace', () => {
  it('requires a workspace id', () => {
    // The client is never touched before the guard, so a stub is enough.
    expect(() => scopeToWorkspace({} as never, '')).toThrow(TenancyViolationError);
  });
});
