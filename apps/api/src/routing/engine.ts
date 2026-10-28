import type {
  Condition,
  ConditionCheck,
  ConditionGroup,
  InnerConditionGroup,
  RuleAction,
  RuleVerdict,
} from '@leadpilot/shared';

/** What a rule can look at. Built from a stored lead, or typed in as a sample. */
export interface LeadFacts {
  score: number | null;
  /** "HOT" | "WARM" | "COLD" | "JUNK" */
  tier: string | null;
  country: string | null;
  sourceId: string | null;
  industry: string | null;
  isFreeMail: boolean;
  customFields: Record<string, string | number | boolean>;
}

/** A rule as the engine needs it (a stored rule, already read through the shared zod schema). */
export interface EngineRule {
  id: string;
  name: string;
  enabled: boolean;
  alwaysRun: boolean;
  conditions: ConditionGroup;
  actions: RuleAction[];
}

type Actual = string | number | boolean | null;

function actualOf(condition: Condition, facts: LeadFacts): Actual {
  switch (condition.field) {
    case 'score':
      return facts.score;
    case 'tier':
      return facts.tier;
    case 'country':
      return facts.country;
    case 'source':
      return facts.sourceId;
    case 'industry':
      return facts.industry;
    case 'isFreeMail':
      return facts.isFreeMail;
    case 'custom':
      return (condition.key ? facts.customFields[condition.key] : undefined) ?? null;
  }
}

const norm = (value: unknown): string => String(value).trim().toLowerCase();

/** One comparison. A missing value never satisfies "is", "in", "contains" or a number test. */
function passes(condition: Condition, actual: Actual): boolean {
  const { op, value } = condition;
  if (op === 'is_not') return actual === null || norm(actual) !== norm(value);
  if (actual === null) return false;
  switch (op) {
    case 'is':
      return norm(actual) === norm(value);
    case 'in':
      return Array.isArray(value) && value.some((item) => norm(item) === norm(actual));
    case 'contains':
      return typeof value === 'string' && norm(actual).includes(norm(value));
    case 'at_least':
      return typeof actual === 'number' && typeof value === 'number' && actual >= value;
    case 'at_most':
      return typeof actual === 'number' && typeof value === 'number' && actual <= value;
  }
}

function check(condition: Condition, facts: LeadFacts): ConditionCheck {
  const actual = actualOf(condition, facts);
  return {
    field: condition.field,
    ...(condition.key === undefined ? {} : { key: condition.key }),
    op: condition.op,
    expected: condition.value,
    actual,
    passed: passes(condition, actual),
  };
}

const isInner = (item: Condition | InnerConditionGroup): item is InnerConditionGroup =>
  'match' in item;

/** Every comparison made (so the tester can show them) and whether the rule's conditions hold. */
export function evaluateConditions(
  group: ConditionGroup,
  facts: LeadFacts,
): { matched: boolean; checks: ConditionCheck[] } {
  const checks: ConditionCheck[] = [];
  const results: boolean[] = [];
  for (const item of group.conditions) {
    if (isInner(item)) {
      const inner = item.conditions.map((condition) => check(condition, facts));
      checks.push(...inner);
      results.push(
        item.match === 'all' ? inner.every((c) => c.passed) : inner.some((c) => c.passed),
      );
    } else {
      const one = check(item, facts);
      checks.push(one);
      results.push(one.passed);
    }
  }
  // No conditions: the rule is for every lead.
  const matched =
    results.length === 0
      ? true
      : group.match === 'all'
        ? results.every(Boolean)
        : results.some(Boolean);
  return { matched, checks };
}

/**
 * Rules in order, first match wins: the first enabled rule that matches and is not
 * "always run" decides, and later normal rules are skipped. "Always run" rules are
 * checked every time and never stop the others. Pure: nothing is sent or saved,
 * so the editor's "Test with a sample lead" and the real pipeline use the same code.
 */
export function evaluateRules(
  rules: EngineRule[],
  facts: LeadFacts,
): { decidingRuleId: string | null; verdicts: RuleVerdict[] } {
  let decidingRuleId: string | null = null;
  const verdicts: RuleVerdict[] = [];
  for (const rule of rules) {
    const base = { ruleId: rule.id, name: rule.name, actions: rule.actions };
    if (!rule.enabled) {
      verdicts.push({ ...base, skipped: 'disabled', matched: false, checks: [] });
      continue;
    }
    if (decidingRuleId !== null && !rule.alwaysRun) {
      verdicts.push({ ...base, skipped: 'earlier_rule_decided', matched: false, checks: [] });
      continue;
    }
    const { matched, checks } = evaluateConditions(rule.conditions, facts);
    if (matched && !rule.alwaysRun) decidingRuleId = rule.id;
    verdicts.push({ ...base, skipped: null, matched, checks });
  }
  return { decidingRuleId, verdicts };
}
