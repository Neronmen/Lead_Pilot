import { describe, expect, it } from 'vitest';
import { draftToRequest, emptyDraft, hasInnerGroups, ruleToDraft, type RuleDraft } from './draft';

const base = (): RuleDraft => ({
  ...emptyDraft(),
  name: 'Hot US leads',
  conditions: [
    { field: 'tier', key: '', op: 'is', value: 'hot' },
    { field: 'country', key: '', op: 'in', value: 'us, ca' },
    { field: 'score', key: '', op: 'at_least', value: '80' },
  ],
  actions: [
    { kind: 'tag', target: 'vip' },
    { kind: 'email_owner', target: '' },
  ],
});

describe('rule form draft', () => {
  it('turns the form into the request the API expects (numbers, lists, upper-case countries)', () => {
    const result = draftToRequest(base());
    expect(result).toMatchObject({
      ok: true,
      request: {
        conditions: {
          match: 'all',
          conditions: [
            { field: 'tier', op: 'is', value: 'hot' },
            { field: 'country', op: 'in', value: ['US', 'CA'].map((c) => c) },
            { field: 'score', op: 'at_least', value: 80 },
          ],
        },
        actions: [
          { type: 'tag', tag: 'vip' },
          { type: 'email', template: 'hot_lead', to: 'owner' },
        ],
      },
    });
  });

  it('a stored rule goes back into the form and out again unchanged', () => {
    const first = draftToRequest(base());
    if (!first.ok) throw new Error('should be valid');
    const draft = ruleToDraft({
      id: 'x',
      order: 1,
      createdAt: '',
      updatedAt: '',
      ...first.request,
    });
    const second = draftToRequest(draft);
    expect(second).toEqual(first);
  });

  it.each([
    ['an empty name', { ...base(), name: ' ' }, 'name'],
    [
      'a score that is not a number',
      { ...base(), conditions: [{ field: 'score', key: '', op: 'at_least', value: '' }] },
      'conditions',
    ],
    [
      'a custom field without a name',
      { ...base(), conditions: [{ field: 'custom', key: '', op: 'is', value: 'x' }] },
      'conditions',
    ],
    ['no actions', { ...base(), actions: [] }, 'actions'],
    ['a tag left empty', { ...base(), actions: [{ kind: 'tag', target: '' }] }, 'actions'],
    [
      'an integration not chosen',
      { ...base(), actions: [{ kind: 'slack', target: '' }] },
      'actions',
    ],
  ] as const)('says which part is incomplete: %s', (_label, draft, field) => {
    expect(draftToRequest(draft as RuleDraft)).toEqual({ ok: false, field });
  });

  it('spots a rule with a group inside a group, which the flat form cannot show', () => {
    expect(
      hasInnerGroups({
        match: 'all',
        conditions: [{ match: 'any', conditions: [{ field: 'tier', op: 'is', value: 'hot' }] }],
      }),
    ).toBe(true);
    expect(hasInnerGroups({ match: 'all', conditions: [] })).toBe(false);
  });

  it('shows an upper-case tier from the API in the lower-case list of the form', () => {
    const draft = ruleToDraft({
      id: 'x',
      name: 'r',
      order: 1,
      createdAt: '',
      updatedAt: '',
      enabled: true,
      alwaysRun: false,
      conditions: {
        match: 'all',
        conditions: [{ field: 'tier', op: 'in', value: ['WARM', 'HOT'] }],
      },
      actions: [{ type: 'tag', tag: 'x' }],
    });
    expect(draft.conditions[0]?.value).toBe('warm, hot');
  });
});
