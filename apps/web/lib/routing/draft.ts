import {
  createRoutingRuleRequestSchema,
  OPS_FOR_FIELD,
  type Condition,
  type ConditionField,
  type ConditionGroup,
  type ConditionOp,
  type CreateRoutingRuleRequest,
  type RoutingRule,
  type RuleAction,
} from '@leadpilot/shared';

/**
 * What the rule form edits: everything is a string or a flag, so inputs stay simple. `draftToRequest`
 * turns it into the request the API checks again.
 */
export interface ConditionDraft {
  field: ConditionField;
  /** Only for a custom field. */
  key: string;
  op: ConditionOp;
  /** Text as typed; a list ("in") is comma-separated. */
  value: string;
}

export type ActionKind =
  | 'assign'
  | 'assign_team'
  | 'tag'
  | 'email_owner'
  | 'email_admins'
  | 'slack'
  | 'telegram'
  | 'webhook'
  | 'hubspot';

export interface ActionDraft {
  kind: ActionKind;
  /** A person's user id, a tag, or an integration id, depending on the kind. */
  target: string;
}

export interface RuleDraft {
  name: string;
  match: 'all' | 'any';
  conditions: ConditionDraft[];
  actions: ActionDraft[];
  enabled: boolean;
  alwaysRun: boolean;
}

export const emptyCondition = (): ConditionDraft => ({
  field: 'tier',
  key: '',
  op: 'is',
  value: 'hot',
});
export const emptyAction = (): ActionDraft => ({ kind: 'tag', target: '' });
export const emptyDraft = (): RuleDraft => ({
  name: '',
  match: 'all',
  conditions: [],
  actions: [{ kind: 'email_admins', target: '' }],
  enabled: true,
  alwaysRun: false,
});

/** The first operator that fits a field (what a row switches to when the field changes). */
export const defaultOp = (field: ConditionField): ConditionOp => OPS_FOR_FIELD[field][0]!;

/** A sensible starting value for a field, so a new row is valid as soon as it is added. */
export function defaultValue(field: ConditionField): string {
  if (field === 'tier') return 'hot';
  if (field === 'score') return '80';
  if (field === 'isFreeMail') return 'false';
  return '';
}

/** A rule with a group inside a group (made through the API) cannot be shown in the flat form. */
export function hasInnerGroups(group: ConditionGroup): boolean {
  return group.conditions.some((item) => 'match' in item);
}

const asText = (value: Condition['value'], field: Condition['field']): string => {
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  // The API accepts "HOT" as well as "hot"; the form's tier list uses lower case.
  return field === 'tier' ? text.toLowerCase() : text;
};

export function ruleToDraft(rule: RoutingRule): RuleDraft {
  const conditions = rule.conditions.conditions.filter((c): c is Condition => !('match' in c));
  return {
    name: rule.name,
    match: rule.conditions.match,
    conditions: conditions.map((c) => ({
      field: c.field,
      key: c.key ?? '',
      op: c.op,
      value: asText(c.value, c.field),
    })),
    actions: rule.actions.map((action): ActionDraft => {
      switch (action.type) {
        case 'assign':
          return action.to.kind === 'user'
            ? { kind: 'assign', target: action.to.userId }
            : { kind: 'assign_team', target: action.to.teamId };
        case 'tag':
          return { kind: 'tag', target: action.tag };
        case 'email':
          return { kind: action.to === 'owner' ? 'email_owner' : 'email_admins', target: '' };
        default:
          return { kind: action.type, target: action.integrationId };
      }
    }),
    enabled: rule.enabled,
    alwaysRun: rule.alwaysRun,
  };
}

function conditionOf(draft: ConditionDraft): unknown {
  const text = draft.value.trim();
  let value: unknown = text;
  if (draft.op === 'in') {
    value = text
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => (draft.field === 'country' ? part.toUpperCase() : part));
  } else if (draft.field === 'score') {
    value = text === '' ? Number.NaN : Number(text);
  } else if (draft.field === 'isFreeMail') {
    value = text === 'true';
  } else if (draft.field === 'country') {
    value = text.toUpperCase();
  }
  return {
    field: draft.field,
    ...(draft.field === 'custom' ? { key: draft.key.trim() } : {}),
    op: draft.op,
    value,
  };
}

function actionOf(draft: ActionDraft): unknown {
  switch (draft.kind) {
    case 'assign':
      return { type: 'assign', to: { kind: 'user', userId: draft.target } };
    case 'assign_team':
      return { type: 'assign', to: { kind: 'team', teamId: draft.target } };
    case 'tag':
      return { type: 'tag', tag: draft.target.trim() };
    case 'email_owner':
      return { type: 'email', template: 'hot_lead', to: 'owner' };
    case 'email_admins':
      return { type: 'email', template: 'hot_lead', to: 'admins' };
    default:
      return { type: draft.kind, integrationId: draft.target };
  }
}

export type DraftResult =
  | { ok: true; request: CreateRoutingRuleRequest }
  | { ok: false; field: 'name' | 'conditions' | 'actions' };

/** The same shared schema the API uses decides whether the form is complete. */
export function draftToRequest(draft: RuleDraft): DraftResult {
  const parsed = createRoutingRuleRequestSchema.safeParse({
    name: draft.name,
    conditions: { match: draft.match, conditions: draft.conditions.map(conditionOf) },
    actions: draft.actions.map(actionOf),
    enabled: draft.enabled,
    alwaysRun: draft.alwaysRun,
  });
  if (parsed.success) return { ok: true, request: parsed.data };
  const first = parsed.error.issues[0]?.path[0];
  return { ok: false, field: first === 'conditions' || first === 'actions' ? first : 'name' };
}

/** A rule's action in the shape the sentence needs: the kind and the id or tag it points at. */
export function actionKind(action: RuleAction): { kind: ActionKind; target: string } {
  return ruleToDraft({
    id: '',
    name: '',
    order: 0,
    conditions: { match: 'all', conditions: [] },
    actions: [action],
    enabled: true,
    alwaysRun: false,
    createdAt: '',
    updatedAt: '',
  }).actions[0]!;
}
