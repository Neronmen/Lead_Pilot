import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import vi from '@/messages/vi.json';

type Dict = { [key: string]: string | Dict };
type Translate = (key: string, values?: Record<string, unknown>) => string;

function entries(messages: Dict, prefix = ''): [string, string][] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [[prefix + key, value] as [string, string]]
      : entries(value, `${prefix}${key}.`),
  );
}

const values = {
  count: 3,
  minimum: 3,
  maximum: 3,
  suggestion: 'gmail.com',
  year: 2026,
  name: 'Mia',
  workspace: 'Northstar',
  when: 'in 6 days',
  max: 20,
  list: 'a@b, c@d',
  email: 'a@b.co',
  role: 'Member',
  by: 'Mia',
  ago: '2 days ago',
  expires: 'in 5 days',
  days: 3,
  prefix: 'lp_ab12.',
  what: 'API key',
  received: 8,
  created: 3,
  merged: 1,
  rejected: 4,
  replayed: 1,
  who: 'Ann Lee',
  score: 82,
  tier: 'Hot',
  percent: 70,
  domain: 'acme.com',
  sends: 'name, email',
  missing: 'company, message',
  outcome: 'Won',
  n: 1,
  field: 'Tier',
  op: 'is',
  value: 'Hot',
  conditions: 'tier is Hot',
  actions: 'email the owner',
};

describe.each([
  ['en', en],
  ['vi', vi],
] as const)('%s messages are valid ICU', (locale, messages) => {
  const errors: unknown[] = [];
  const t = createTranslator({
    locale,
    messages: messages as never,
    onError: (e) => errors.push(e),
  }) as unknown as Translate;

  it.each(entries(messages as Dict))('%s formats', (key) => {
    errors.length = 0;
    const text = t(key, values);
    expect(errors, key).toEqual([]);
    expect(text).not.toMatch(/[{}]/);
  });
});

describe('plurals', () => {
  const fmt = (locale: 'en' | 'vi', messages: unknown, count: number) =>
    (createTranslator({ locale, messages: messages as never }) as unknown as Translate)(
      'shell.workspaceMembers',
      { count },
    );

  it('English separates one from many', () => {
    expect(fmt('en', en, 1)).toBe('1 member');
    expect(fmt('en', en, 0)).toBe('0 members');
    expect(fmt('en', en, 2)).toBe('2 members');
  });

  it('Vietnamese has only the other form, for every count', () => {
    for (const n of [0, 1, 2, 5, 100]) expect(fmt('vi', vi, n)).toBe(`${n} thành viên`);
  });

  it('vi plurals use only "other"; en plurals only one/other', () => {
    for (const [key, text] of entries(vi as Dict)) {
      expect(text, key).not.toMatch(/\b(zero|one|two|few|many)\s*\{/);
    }
    for (const [key, text] of entries(en as Dict)) {
      if (text.includes('plural')) expect(text, key).toMatch(/other\s*\{/);
      expect(text, key).not.toMatch(/\b(zero|two|few|many)\s*\{/);
    }
  });
});
