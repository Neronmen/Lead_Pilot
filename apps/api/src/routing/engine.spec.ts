import { conditionGroupSchema, createRoutingRuleRequestSchema } from '@leadpilot/shared';
import { type EngineRule, evaluateRules, type LeadFacts } from './engine';

const SOURCE = '0194f7a0-0000-7000-8000-000000000001';

const facts = (overrides: Partial<LeadFacts> = {}): LeadFacts => ({
  score: 90,
  tier: 'HOT',
  country: 'US',
  sourceId: SOURCE,
  industry: 'Logistics',
  isFreeMail: false,
  customFields: {},
  ...overrides,
});

const rule = (id: string, over: Partial<EngineRule>): EngineRule => ({
  id,
  name: id,
  enabled: true,
  alwaysRun: false,
  conditions: { match: 'all', conditions: [] },
  actions: [{ type: 'tag', tag: id }],
  ...over,
});

describe('routing engine', () => {
  it('first matching rule decides; later normal rules are skipped', () => {
    const result = evaluateRules(
      [
        rule('cold-only', {
          conditions: { match: 'all', conditions: [{ field: 'tier', op: 'is', value: 'cold' }] },
        }),
        rule('hot-us', {
          conditions: {
            match: 'all',
            conditions: [
              { field: 'tier', op: 'is', value: 'hot' },
              { field: 'country', op: 'in', value: ['US', 'CA'] },
            ],
          },
        }),
        rule('catch-all', {}),
      ],
      facts(),
    );
    expect(result.decidingRuleId).toBe('hot-us');
    expect(result.verdicts.map((v) => [v.ruleId, v.matched, v.skipped])).toEqual([
      ['cold-only', false, null],
      ['hot-us', true, null],
      ['catch-all', false, 'earlier_rule_decided'],
    ]);
  });

  it('an "always run" rule runs after a decision and never decides', () => {
    const result = evaluateRules(
      [rule('log', { alwaysRun: true }), rule('main', {}), rule('later', {})],
      facts(),
    );
    expect(result.decidingRuleId).toBe('main');
    expect(result.verdicts.map((v) => v.matched && v.skipped === null)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('skips a rule that is switched off, and says why', () => {
    const result = evaluateRules([rule('off', { enabled: false }), rule('on', {})], facts());
    expect(result.verdicts[0]).toMatchObject({ skipped: 'disabled', matched: false });
    expect(result.decidingRuleId).toBe('on');
  });

  it('shows each comparison with what the lead had, for the tester', () => {
    const [verdict] = evaluateRules(
      [
        rule('r', {
          conditions: { match: 'any', conditions: [{ field: 'score', op: 'at_least', value: 95 }] },
        }),
      ],
      facts({ score: 90 }),
    ).verdicts;
    expect(verdict?.matched).toBe(false);
    expect(verdict?.checks).toEqual([
      { field: 'score', op: 'at_least', expected: 95, actual: 90, passed: false },
    ]);
  });

  it('supports AND/OR groups, free mail and custom fields', () => {
    const conditions = {
      match: 'all' as const,
      conditions: [
        { field: 'isFreeMail' as const, op: 'is' as const, value: false },
        {
          match: 'any' as const,
          conditions: [
            { field: 'custom' as const, key: 'plan', op: 'is' as const, value: 'Enterprise' },
            { field: 'score' as const, op: 'at_least' as const, value: 80 },
          ],
        },
      ],
    };
    expect(evaluateRules([rule('r', { conditions })], facts()).decidingRuleId).toBe('r');
    expect(
      evaluateRules([rule('r', { conditions })], facts({ isFreeMail: true })).decidingRuleId,
    ).toBeNull();
    expect(
      evaluateRules(
        [rule('r', { conditions })],
        facts({ score: 10, customFields: { plan: 'enterprise' } }),
      ).decidingRuleId,
    ).toBe('r');
  });

  it('a missing value never satisfies "is" or a number test, but does satisfy "is not"', () => {
    const of = (condition: EngineRule['conditions']['conditions']) =>
      evaluateRules(
        [rule('r', { conditions: { match: 'all', conditions: condition } })],
        facts({ country: null, score: null }),
      ).decidingRuleId;
    expect(of([{ field: 'country', op: 'is', value: 'US' }])).toBeNull();
    expect(of([{ field: 'score', op: 'at_least', value: 1 }])).toBeNull();
    expect(of([{ field: 'country', op: 'is_not', value: 'US' }])).toBe('r');
  });
});

describe('routing rule schema', () => {
  const valid = {
    name: 'Hot US',
    conditions: { match: 'all', conditions: [{ field: 'tier', op: 'in', value: ['hot'] }] },
    actions: [{ type: 'tag', tag: 'vip' }],
  };

  it('accepts a good rule and fills the defaults', () => {
    expect(createRoutingRuleRequestSchema.parse(valid)).toMatchObject({
      enabled: true,
      alwaysRun: false,
    });
  });

  it.each([
    ['an operator that does not fit the field', { field: 'tier', op: 'at_least', value: 5 }],
    ['a score above 100', { field: 'score', op: 'is', value: 150 }],
    ['a tier that does not exist', { field: 'tier', op: 'is', value: 'lukewarm' }],
    ['a custom field without a key', { field: 'custom', op: 'is', value: 'x' }],
    ['a list without "in"', { field: 'country', op: 'is', value: ['US'] }],
    ['an unknown field', { field: 'password', op: 'is', value: 'x' }],
  ])('refuses %s', (_label, condition) => {
    expect(conditionGroupSchema.safeParse({ match: 'all', conditions: [condition] }).success).toBe(
      false,
    );
  });

  it('refuses a rule with no actions and an unknown action', () => {
    expect(createRoutingRuleRequestSchema.safeParse({ ...valid, actions: [] }).success).toBe(false);
    expect(
      createRoutingRuleRequestSchema.safeParse({ ...valid, actions: [{ type: 'rm_rf' }] }).success,
    ).toBe(false);
  });
});
