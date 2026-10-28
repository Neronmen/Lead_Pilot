import { Prisma, type PrismaClient } from '../generated/prisma/client';

/**
 * Tenant scoping in one place (CLAUDE.md, Tenancy). `scopeToWorkspace` wraps
 * the Prisma client so every query on a tenant model is limited to one
 * workspace: reads, updates and deletes get `workspaceId` added to `where`,
 * so services never write that filter by hand. Creates still pass
 * `workspaceId` (Prisma's types require it); the scope checks it matches and
 * fills it in if a caller ever leaves it out.
 *
 * Nested arguments (`include`, `select`, relation filters, nested writes) are
 * walked with the model each level belongs to:
 * - From a scoped row, relations between tenant models stay in the workspace,
 *   because the composite foreign keys keep every child in its parent's
 *   workspace.
 * - Global models (User, PromptVersion) are shared by all workspaces, so a
 *   path may enter one but never leave it towards tenant data again
 *   (membership -> user -> memberships would list every workspace).
 * - Nested writes may not `connect`, `connectOrCreate` or `set`: those rewrite
 *   the foreign key, workspaceId included, and could pull a row out of another
 *   workspace. Services set the scalar column (`sourceId`) instead.
 * - Global models cannot be queried or written through the scope at all; the
 *   few modules that need them use PrismaService (ESLint allowlist).
 * Raw SQL bypasses all of this, so ESLint bans it outside the allowlist.
 */

/** Thrown for a query that would leave the workspace: a bug, never user input. */
export class TenancyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenancyViolationError';
  }
}

type ModelName = Prisma.ModelName;

// The generated namespace has one `<Model>ScalarFieldEnum` per model; indexing
// it by a computed name needs this loose view of the namespace.
const scalarFieldEnums = Prisma as unknown as Record<string, Record<string, string> | undefined>;

const SCALAR_FIELDS = new Map<string, ReadonlySet<string>>(
  Object.values(Prisma.ModelName).map((model) => [
    model,
    new Set(Object.keys(scalarFieldEnums[`${model}ScalarFieldEnum`] ?? {})),
  ]),
);

/**
 * Every model with a `workspaceId` column, read from the generated client. A
 * model added later is scoped automatically; nobody has to update a list.
 */
export const TENANT_MODELS: ReadonlySet<ModelName> = new Set(
  Object.values(Prisma.ModelName).filter((model) => SCALAR_FIELDS.get(model)?.has('workspaceId')),
);

/** The workspace row itself: scoped by its `id`, never created or deleted here. */
const WORKSPACE_MODEL: ModelName = Prisma.ModelName.Workspace;

/** Shared by all workspaces: neither tenant tables nor the workspace row. */
const isGlobal = (model: ModelName) => model !== WORKSPACE_MODEL && !TENANT_MODELS.has(model);

// Relation field -> target model, for every model. The type is computed from
// Prisma's own payload types, so a missing, extra or wrong entry is a compile
// error: a schema change cannot silently leave a relation unchecked.
type Objects<M extends ModelName> = Prisma.TypeMap['model'][M]['payload']['objects'];
type NameOf<P> = P extends { name: infer N } ? N : never;
type TargetOf<T> = NonNullable<T> extends Array<infer P> ? NameOf<P> : NameOf<NonNullable<T>>;
type RelationMap = { [M in ModelName]: { [K in keyof Objects<M>]: TargetOf<Objects<M>[K]> } };

const RELATIONS: RelationMap = {
  Workspace: {
    memberships: 'Membership',
    teams: 'Team',
    sources: 'Source',
    leads: 'Lead',
    invites: 'Invite',
    icpRubric: 'IcpRubric',
    routingRules: 'RoutingRule',
    integrations: 'Integration',
    auditLogs: 'AuditLog',
  },
  User: {
    memberships: 'Membership',
    refreshTokens: 'RefreshToken',
    tokens: 'UserToken',
    invitesSent: 'Invite',
  },
  UserToken: { user: 'User' },
  Membership: {
    workspace: 'Workspace',
    user: 'User',
    teams: 'TeamMember',
    ownedLeads: 'Lead',
    refreshTokens: 'RefreshToken',
  },
  Team: { workspace: 'Workspace', members: 'TeamMember' },
  TeamMember: { team: 'Team', membership: 'Membership' },
  Invite: { workspace: 'Workspace', invitedBy: 'User' },
  RefreshToken: { user: 'User', membership: 'Membership' },
  Source: {
    workspace: 'Workspace',
    leads: 'Lead',
    idempotencyKeys: 'IdempotencyKey',
    ingestAttempts: 'IngestAttempt',
  },
  IdempotencyKey: { source: 'Source' },
  IngestAttempt: { source: 'Source' },
  Lead: {
    workspace: 'Workspace',
    source: 'Source',
    owner: 'Membership',
    possibleDuplicateOf: 'Lead',
    possibleDuplicates: 'Lead',
    events: 'LeadEvent',
    scores: 'Score',
    actionRuns: 'ActionRun',
    feedback: 'Feedback',
  },
  LeadEvent: { lead: 'Lead' },
  Enrichment: {},
  PromptVersion: { scores: 'Score' },
  Score: { lead: 'Lead', promptVersion: 'PromptVersion', feedback: 'Feedback' },
  IcpRubric: { workspace: 'Workspace' },
  Feedback: { lead: 'Lead', score: 'Score' },
  RoutingRule: { workspace: 'Workspace', actionRuns: 'ActionRun' },
  Integration: { workspace: 'Workspace', actionRuns: 'ActionRun' },
  ActionRun: { lead: 'Lead', rule: 'RoutingRule', integration: 'Integration' },
  AuditLog: { workspace: 'Workspace' },
};

const WHERE_OPERATIONS = new Set([
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
]);
const UPDATE_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);

/** What the scope allows on the workspace row: read it and change its settings. */
const WORKSPACE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  ...UPDATE_OPERATIONS,
]);

/** Top-level argument keys that hold writes; every other key is a read. */
const WRITE_ARGS = new Set(['data', 'create', 'update']);
/** Nested write operations that rewrite a foreign key (see the file comment). */
const FOREIGN_KEY_WRITES = new Set(['connect', 'connectOrCreate', 'set']);

/**
 * Prisma argument keywords. The walker reads a key as a keyword before it
 * reads it as a field, and a unit test fails if a scoped model ever gets a
 * field with one of these names, so no nested argument is skipped by mistake.
 */
export const ARGUMENT_KEYWORDS: ReadonlySet<string> = new Set([
  'where',
  'data',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'connect',
  'connectOrCreate',
  'set',
  'disconnect',
  'select',
  'include',
  'omit',
  'orderBy',
  'cursor',
  'take',
  'skip',
  'distinct',
  'some',
  'every',
  'none',
  'is',
  'isNot',
  'AND',
  'OR',
  'NOT',
  '_count',
  '_avg',
  '_sum',
  '_min',
  '_max',
  'by',
  'having',
  'skipDuplicates',
  'relationLoadStrategy',
]);

type Args = Record<string, unknown>;

/**
 * Returns the query arguments with the workspace filter applied. Pure, so the
 * rules are unit-tested without a database.
 */
export function scopeArgs(
  model: string,
  operation: string,
  args: Args | undefined,
  workspaceId: string,
): Args {
  const input = args ?? {};
  const root = model as ModelName;

  if (isGlobal(root)) {
    throw new TenancyViolationError(
      `${model} is shared by all workspaces; query it through PrismaService (ESLint allowlist)`,
    );
  }
  checkNested(input, root, workspaceId);

  if (root === WORKSPACE_MODEL) return scopeWorkspaceArgs(operation, input, workspaceId);

  if (WHERE_OPERATIONS.has(operation)) {
    return { ...input, where: scopeWhere(input.where, workspaceId, model) };
  }
  if (UPDATE_OPERATIONS.has(operation)) {
    assertNotMoved(input.data, model);
    return { ...input, where: scopeWhere(input.where, workspaceId, model) };
  }
  if (CREATE_OPERATIONS.has(operation)) {
    return { ...input, data: scopeData(input.data, workspaceId, model) };
  }
  if (operation === 'upsert') {
    assertNotMoved(input.update, model);
    return {
      ...input,
      where: scopeWhere(input.where, workspaceId, model),
      create: scopeData(input.create, workspaceId, model),
    };
  }
  // Fail closed: an operation Prisma adds later must be reviewed before use.
  throw new TenancyViolationError(`${model}.${operation} is not supported by the workspace scope`);
}

function scopeWorkspaceArgs(operation: string, args: Args, workspaceId: string): Args {
  // Fail closed: signup creates workspaces, and nothing deletes one yet.
  if (!WORKSPACE_OPERATIONS.has(operation)) {
    throw new TenancyViolationError(`Workspace.${operation} is not allowed in the workspace scope`);
  }
  if (((args.data ?? {}) as Args).id !== undefined) {
    throw new TenancyViolationError('Workspace.id never changes');
  }
  const where = (args.where ?? {}) as Args;
  if (where.id !== undefined && where.id !== workspaceId) {
    throw new TenancyViolationError('Workspace query names another workspace id');
  }
  return { ...args, where: { ...where, id: workspaceId } };
}

/** Walks every top-level argument with the model and mode it belongs to. */
function checkNested(args: Args, model: ModelName, workspaceId: string): void {
  for (const [key, value] of Object.entries(args)) {
    walk({ model, mode: WRITE_ARGS.has(key) ? 'write' : 'read', path: key, workspaceId }, value);
  }
}

interface WalkContext {
  model: ModelName;
  mode: 'read' | 'write';
  path: string;
  workspaceId: string;
}

/**
 * One level of nested arguments. Each key is a Prisma keyword such as
 * `include`, `where`, `some` or `create` (continue in the same model), a
 * relation (continue in the target model), or a scalar field (skipped:
 * filters, values and JSON payloads cannot reach other rows).
 */
function walk(ctx: WalkContext, value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(ctx, item));
    return;
  }
  if (!isPlainObject(value)) return;

  const { model, mode, workspaceId } = ctx;
  const relations = RELATIONS[model] as Record<string, ModelName | undefined>;
  for (const [key, child] of Object.entries(value)) {
    const at = `${ctx.path}.${key}`;

    if (ARGUMENT_KEYWORDS.has(key)) {
      if (mode === 'write' && FOREIGN_KEY_WRITES.has(key)) {
        throw new TenancyViolationError(
          `${at}: nested ${key} rewrites a foreign key; set the scalar id column instead`,
        );
      }
      // A filter inside a write (`updateMany.where`) only selects rows.
      walk({ ...ctx, mode: key === 'where' ? 'read' : mode, path: at }, child);
      continue;
    }

    const target = relations[key];
    if (target !== undefined) {
      if (isGlobal(model) && !isGlobal(target)) {
        throw new TenancyViolationError(
          `${at}: ${model} is shared by all workspaces, so it cannot lead back to ${target}`,
        );
      }
      if (mode === 'write' && (isGlobal(target) || target === WORKSPACE_MODEL)) {
        throw new TenancyViolationError(`${at}: nested writes into ${target} are not allowed`);
      }
      walk({ ...ctx, model: target, path: at }, child);
      continue;
    }

    if (SCALAR_FIELDS.get(model)?.has(key)) {
      if (mode === 'write' && key === 'workspaceId' && child !== workspaceId) {
        throw new TenancyViolationError(`${at}: rows never change workspace`);
      }
      continue;
    }

    // Anything else (a compound unique key such as `workspaceId_email`).
    walk({ ...ctx, path: at }, child);
  }
}

function isPlainObject(value: unknown): value is Args {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function scopeWhere(where: unknown, workspaceId: string, model: string): Args {
  const filter = (where ?? {}) as Args;
  if (filter.workspaceId !== undefined && filter.workspaceId !== workspaceId) {
    throw new TenancyViolationError(`${model} query names another workspaceId`);
  }
  return { ...filter, workspaceId };
}

function scopeData(data: unknown, workspaceId: string, model: string): unknown {
  if (Array.isArray(data)) return data.map((row) => scopeRow(row, workspaceId, model));
  return scopeRow(data, workspaceId, model);
}

function scopeRow(row: unknown, workspaceId: string, model: string): Args {
  const values = (row ?? {}) as Args;
  if (values.workspaceId !== undefined && values.workspaceId !== workspaceId) {
    throw new TenancyViolationError(`${model} create names another workspaceId`);
  }
  // `workspace: { connect }` would bypass the column; use the unchecked input.
  if (values.workspace !== undefined) {
    throw new TenancyViolationError(`${model} create must set workspaceId, not the relation`);
  }
  return { ...values, workspaceId };
}

function assertNotMoved(data: unknown, model: string): void {
  const values = (data ?? {}) as Args;
  if (values.workspaceId !== undefined || values.workspace !== undefined) {
    throw new TenancyViolationError(`${model} rows never change workspace`);
  }
}

/** A Prisma client limited to one workspace. */
export function scopeToWorkspace(client: PrismaClient, workspaceId: string) {
  if (!workspaceId) throw new TenancyViolationError('A workspace id is required');
  return client.$extends({
    name: 'workspace-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result: unknown = await query(
            scopeArgs(model, operation, args as Args, workspaceId),
          );
          // Postgres runs upsert as INSERT ... ON CONFLICT DO UPDATE ... WHERE
          // workspaceId = $1. When the unique key (a token hash, a job key)
          // belongs to another workspace, the conflict fires, the WHERE skips
          // the update and no row comes back.
          if (operation === 'upsert' && result === null) {
            throw new TenancyViolationError(
              `${model}.upsert matched a row in another workspace by its unique key`,
            );
          }
          return result;
        },
      },
    },
  });
}

/**
 * The scoped client without what cannot be used through the scope: global
 * models (they throw), raw SQL (it bypasses the scope), and connection
 * control (`$disconnect` would close the shared pool).
 */
export type WorkspaceClient = Omit<
  ReturnType<typeof scopeToWorkspace>,
  | 'user'
  | 'promptVersion'
  | 'enrichment'
  | '$queryRaw'
  | '$queryRawUnsafe'
  | '$executeRaw'
  | '$executeRawUnsafe'
  | '$connect'
  | '$disconnect'
  | '$extends'
>;
