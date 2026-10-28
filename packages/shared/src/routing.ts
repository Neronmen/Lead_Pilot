import { z } from 'zod';
import { countrySchema, displayTextSchema, idSchema, timestampSchema } from './common.ts';
import { leadTierSchema } from './leads.ts';

// ─── Conditions ─────────────────────────────────────────────────────────────

export const CONDITION_FIELDS = [
  'score',
  'tier',
  'country',
  'source',
  'industry',
  'isFreeMail',
  'custom',
] as const;
export const conditionFieldSchema = z.enum(CONDITION_FIELDS);
export type ConditionField = z.infer<typeof conditionFieldSchema>;

export const CONDITION_OPS = ['is', 'is_not', 'at_least', 'at_most', 'in', 'contains'] as const;
export const conditionOpSchema = z.enum(CONDITION_OPS);
export type ConditionOp = z.infer<typeof conditionOpSchema>;

/** Which comparisons make sense for which field (the editor offers only these). */
export const OPS_FOR_FIELD: Record<ConditionField, readonly ConditionOp[]> = {
  score: ['is', 'at_least', 'at_most'],
  tier: ['is', 'is_not', 'in'],
  country: ['is', 'is_not', 'in'],
  source: ['is', 'is_not', 'in'],
  industry: ['is', 'is_not', 'in', 'contains'],
  isFreeMail: ['is'],
  custom: ['is', 'is_not', 'contains'],
};

const conditionValueSchema = z.union([
  z.string().trim().min(1).max(200),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().trim().min(1).max(100)).min(1).max(50),
]);

export const conditionSchema = z
  .strictObject({
    field: conditionFieldSchema,
    /** Only for `custom`: the name of the custom field. */
    key: z.string().trim().min(1).max(60).optional(),
    op: conditionOpSchema,
    value: conditionValueSchema,
  })
  .superRefine((c, ctx) => {
    const bad = (message: string, path: string) =>
      ctx.addIssue({ code: 'custom', message, path: [path] });
    if (!OPS_FOR_FIELD[c.field].includes(c.op)) bad('op does not fit the field', 'op');
    if (c.field === 'custom' && !c.key) bad('custom needs a key', 'key');
    if (c.field !== 'custom' && c.key !== undefined) bad('only custom has a key', 'key');
    const list = Array.isArray(c.value) ? c.value : [c.value];
    if ((c.op === 'in') !== Array.isArray(c.value))
      bad('"in" takes a list, nothing else does', 'value');
    if (c.field === 'score') {
      if (typeof c.value !== 'number' || c.value < 0 || c.value > 100)
        bad('score is 0 to 100', 'value');
    } else if (c.field === 'isFreeMail') {
      if (typeof c.value !== 'boolean') bad('isFreeMail is true or false', 'value');
    } else if (list.some((v) => typeof v !== 'string')) {
      bad('a text value is needed', 'value');
    } else if (c.field === 'tier') {
      if (!list.every((v) => leadTierSchema.safeParse(String(v).toUpperCase()).success)) {
        bad('tier is hot, warm, cold or junk', 'value');
      }
    } else if (c.field === 'country') {
      if (!list.every((v) => countrySchema.safeParse(v).success))
        bad('country is a 2-letter code', 'value');
    } else if (c.field === 'source') {
      if (!list.every((v) => idSchema.safeParse(v).success)) bad('source is a source id', 'value');
    }
  });
export type Condition = z.infer<typeof conditionSchema>;

const matchSchema = z.enum(['all', 'any']);

/** A group inside a group: "all of these" or "any of these". One level deep is enough for the editor. */
const innerGroupSchema = z.strictObject({
  match: matchSchema,
  conditions: z.array(conditionSchema).min(1).max(20),
});
export const conditionGroupSchema = z.strictObject({
  match: matchSchema,
  /** Empty means the rule matches every lead. */
  conditions: z.array(z.union([conditionSchema, innerGroupSchema])).max(20),
});
export type ConditionGroup = z.infer<typeof conditionGroupSchema>;
export type InnerConditionGroup = z.infer<typeof innerGroupSchema>;

// ─── Actions ────────────────────────────────────────────────────────────────

export const ACTION_TYPES = [
  'assign',
  'tag',
  'email',
  'slack',
  'telegram',
  'webhook',
  'hubspot',
] as const;

export const ruleActionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('assign'),
    /** A person, or a team (the next member in turn gets it: round-robin). */
    to: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('user'), userId: idSchema }),
      z.strictObject({ kind: z.literal('team'), teamId: idSchema }),
    ]),
  }),
  z.strictObject({ type: z.literal('tag'), tag: displayTextSchema(40) }),
  /** The "New Hot lead" alert. `owner` is whoever the lead is assigned to; `admins` every Owner and Admin. */
  z.strictObject({
    type: z.literal('email'),
    template: z.literal('hot_lead'),
    to: z.enum(['owner', 'admins']),
  }),
  z.strictObject({ type: z.literal('slack'), integrationId: idSchema }),
  z.strictObject({ type: z.literal('telegram'), integrationId: idSchema }),
  z.strictObject({ type: z.literal('webhook'), integrationId: idSchema }),
  z.strictObject({ type: z.literal('hubspot'), integrationId: idSchema }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

// ─── Rules ──────────────────────────────────────────────────────────────────

export const createRoutingRuleRequestSchema = z.strictObject({
  name: displayTextSchema(100),
  conditions: conditionGroupSchema,
  actions: z.array(ruleActionSchema).min(1).max(10),
  enabled: z.boolean().default(true),
  /** Runs even after an earlier rule matched, and does not stop the later ones. */
  alwaysRun: z.boolean().default(false),
});
export type CreateRoutingRuleRequest = z.infer<typeof createRoutingRuleRequestSchema>;

export const updateRoutingRuleRequestSchema = z
  .strictObject({
    name: displayTextSchema(100).optional(),
    conditions: conditionGroupSchema.optional(),
    actions: z.array(ruleActionSchema).min(1).max(10).optional(),
    enabled: z.boolean().optional(),
    alwaysRun: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'nothing to change',
  });
export type UpdateRoutingRuleRequest = z.infer<typeof updateRoutingRuleRequestSchema>;

/** `PUT /routing/rules/order`: every rule id, in the new order. */
export const reorderRoutingRulesRequestSchema = z.strictObject({
  ids: z.array(idSchema).min(1).max(200),
});
export type ReorderRoutingRulesRequest = z.infer<typeof reorderRoutingRulesRequestSchema>;

export const routingRuleSchema = z.object({
  id: idSchema,
  name: z.string(),
  order: z.number().int(),
  conditions: conditionGroupSchema,
  actions: z.array(ruleActionSchema),
  enabled: z.boolean(),
  alwaysRun: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type RoutingRule = z.infer<typeof routingRuleSchema>;

// ─── Test a rule against a sample lead ──────────────────────────────────────

export const sampleLeadSchema = z.strictObject({
  score: z.number().int().min(0).max(100).nullable().default(null),
  tier: leadTierSchema.nullable().default(null),
  country: countrySchema.nullable().default(null),
  sourceId: idSchema.nullable().default(null),
  industry: z.string().trim().max(100).nullable().default(null),
  isFreeMail: z.boolean().default(false),
  customFields: z
    .record(z.string().max(60), z.union([z.string().max(200), z.number(), z.boolean()]))
    .default({}),
});
export type SampleLead = z.infer<typeof sampleLeadSchema>;

export const testRoutingRequestSchema = z.strictObject({ lead: sampleLeadSchema });
export type TestRoutingRequest = z.infer<typeof testRoutingRequestSchema>;

/** One comparison and what the sample lead had, so the page can say why a rule did or did not match. */
export const conditionCheckSchema = z.object({
  field: conditionFieldSchema,
  key: z.string().optional(),
  op: conditionOpSchema,
  expected: conditionValueSchema,
  actual: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  passed: z.boolean(),
});
export type ConditionCheck = z.infer<typeof conditionCheckSchema>;

export const ruleVerdictSchema = z.object({
  ruleId: idSchema,
  name: z.string(),
  /** Why this rule did not run, when it did not: switched off, or an earlier rule already decided. */
  skipped: z.enum(['disabled', 'earlier_rule_decided']).nullable(),
  matched: z.boolean(),
  checks: z.array(conditionCheckSchema),
  actions: z.array(ruleActionSchema),
});
export type RuleVerdict = z.infer<typeof ruleVerdictSchema>;

export const testRoutingResponseSchema = z.object({
  /** The first rule that matched and is not "always run": it decides. Null when none does. */
  decidingRuleId: idSchema.nullable(),
  verdicts: z.array(ruleVerdictSchema),
  /** Nothing was sent, assigned or saved. */
  dryRun: z.literal(true),
});
export type TestRoutingResponse = z.infer<typeof testRoutingResponseSchema>;

// ─── Integrations ───────────────────────────────────────────────────────────

export const integrationTypeSchema = z.enum(['EMAIL', 'SLACK', 'TELEGRAM', 'HUBSPOT', 'WEBHOOK']);
export type IntegrationType = z.infer<typeof integrationTypeSchema>;

export const integrationStatusSchema = z.enum(['connected', 'needs_attention', 'paused']);

const httpsUrl = z.url({ protocol: /^https$/, hostname: z.regexes.domain }).max(500);

/** What an admin types to connect a tool. Secrets go in, never come back out. */
export const createIntegrationRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('SLACK'),
    name: displayTextSchema(100),
    config: z.strictObject({ webhookUrl: httpsUrl }),
  }),
  z.strictObject({
    type: z.literal('TELEGRAM'),
    name: displayTextSchema(100),
    config: z.strictObject({
      botToken: z.string().trim().min(10).max(200),
      chatId: z.string().trim().min(1).max(100),
    }),
  }),
  z.strictObject({
    type: z.literal('WEBHOOK'),
    name: displayTextSchema(100),
    config: z.strictObject({ url: httpsUrl }),
  }),
  z.strictObject({
    type: z.literal('HUBSPOT'),
    name: displayTextSchema(100),
    config: z.strictObject({ token: z.string().trim().min(10).max(300) }),
  }),
]);
export type CreateIntegrationRequest = z.infer<typeof createIntegrationRequestSchema>;

export const updateIntegrationRequestSchema = z
  .strictObject({
    name: displayTextSchema(100).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.enabled !== undefined, {
    message: 'send a name or enabled',
  });
export type UpdateIntegrationRequest = z.infer<typeof updateIntegrationRequestSchema>;

export const integrationSchema = z.object({
  id: idSchema,
  type: integrationTypeSchema,
  name: z.string(),
  enabled: z.boolean(),
  status: integrationStatusSchema,
  /** A short code for the last failure ("http_401", "timeout"), never a secret. */
  lastError: z.string().nullable(),
  lastTestedAt: timestampSchema.nullable(),
  /** Where it points, without anything secret: the host of a webhook address, a chat id. */
  summary: z.string().nullable(),
  createdAt: timestampSchema,
});
export type Integration = z.infer<typeof integrationSchema>;

/** The signing secret of an outgoing webhook is in the create response only. */
export const integrationWithSecretSchema = integrationSchema.extend({
  signingSecret: z.string().nullable(),
});
export type IntegrationWithSecret = z.infer<typeof integrationWithSecretSchema>;

export const testIntegrationResponseSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type TestIntegrationResponse = z.infer<typeof testIntegrationResponseSchema>;

// ─── Action runs ────────────────────────────────────────────────────────────

export const actionStatusSchema = z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD']);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export const actionRunSchema = z.object({
  id: idSchema,
  leadId: idSchema,
  ruleId: idSchema.nullable(),
  integrationId: idSchema.nullable(),
  type: z.string(),
  status: actionStatusSchema,
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: timestampSchema,
  finishedAt: timestampSchema.nullable(),
});
export type ActionRun = z.infer<typeof actionRunSchema>;

export const listActionsQuerySchema = z.strictObject({
  status: actionStatusSchema.optional(),
  leadId: idSchema.optional(),
});
export type ListActionsQuery = z.infer<typeof listActionsQuerySchema>;
