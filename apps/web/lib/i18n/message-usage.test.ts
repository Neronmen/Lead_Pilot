import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import vi from '@/messages/vi.json';

/**
 * Every key a component asks for must exist in BOTH message files, otherwise
 * next-intl shows the raw key (or throws) at runtime. We read the source of the
 * components, find `t('key')` calls (honouring `useTranslations('ns')` /
 * `getTranslations('ns')`) and look the keys up in the JSON.
 */
const root = join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '.next', 'e2e', 'messages', 'ui']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (SKIP.has(name)) return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

type Dict = { [key: string]: string | Dict };

function has(messages: Dict, key: string): boolean {
  let node: string | Dict | undefined = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || !(part in node)) return false;
    node = node[part];
  }
  return typeof node === 'string';
}

// Dynamic keys: the template and every value it can take. A new dynamic
// template makes the test fail until it is listed here on purpose.
const ROLES = ['OWNER', 'ADMIN', 'MEMBER'];
const DYNAMIC: Record<string, string[]> = {
  'shell.roles.${me.role}': ROLES.map((r) => `shell.roles.${r}`),
  'shell.nav.${id}': ['leads', 'review', 'settings'].map((id) => `shell.nav.${id}`),
  'settings.nav.${id}': ['sources', 'ideal', 'team', 'advanced'].map((id) => `settings.nav.${id}`),
  'sources.kind.${source.type}': ['WEBHOOK', 'FORM', 'CSV'].map((t) => `sources.kind.${t}`),
  'sources.form.${value}': ['zapier', 'other'].map((v) => `sources.form.${v}`),
  'sources.form.${value}Hint': ['zapier', 'other'].map((v) => `sources.form.${v}Hint`),
  'sources.ready.steps.${made.tool}': ['zapier', 'other'].map((v) => `sources.ready.steps.${v}`),
  'sources.stats.reasons.${key}': [
    'invalid_email',
    'disposable_email',
    'invalid_phone',
    'invalid_text',
    'invalid_type',
    'invalid_domain',
    'invalid_country',
    'too_many_fields',
    'field_name_too_long',
    'contact_required',
    'invalid_json',
    'object_required',
    'nul_character',
    'invalid_unicode',
    'reserved_field',
    'too_deep',
    'invalid_idempotency_key',
    'unsupported_media_type',
    'idempotency_key_reused',
    'rate_limited',
    'other',
  ].map((r) => `sources.stats.reasons.${r}`),
  'leads.statusName.${status}': [
    'NEW',
    'PROCESSING',
    'NEEDS_REVIEW',
    'SCORED',
    'ROUTED',
    'FAILED',
  ].map((s) => `leads.statusName.${s}`),
  'leads.statusName.${lead.status}': [
    'NEW',
    'PROCESSING',
    'NEEDS_REVIEW',
    'SCORED',
    'ROUTED',
    'FAILED',
  ].map((s) => `leads.statusName.${s}`),
  'auth.signup.aside.steps.${step}.title': ['s1', 's2', 's3', 's4'].map(
    (step) => `auth.signup.aside.steps.${step}.title`,
  ),
  'auth.signup.aside.steps.${step}.body': ['s1', 's2', 's3', 's4'].map(
    (step) => `auth.signup.aside.steps.${step}.body`,
  ),
  'auth.signup.aside.reasons.${reason}': ['r1', 'r2', 'r3'].map(
    (reason) => `auth.signup.aside.reasons.${reason}`,
  ),
  'auth.signup.languages.${code}': ['en', 'vi'].map((code) => `auth.signup.languages.${code}`),
  'auth.signup.currencies.${code}': ['USD', 'VND'].map((code) => `auth.signup.currencies.${code}`),
  'auth.invite.roleHelp.${role}': ['MEMBER', 'ADMIN'].map((role) => `auth.invite.roleHelp.${role}`),
  'team.results.${status}': ['invited', 'already_member', 'already_invited', 'email_failed'].map(
    (status) => `team.results.${status}`,
  ),
  'team.roleHelp.${value}': ['OWNER', 'ADMIN', 'MEMBER'].map((value) => `team.roleHelp.${value}`),
  'auth.aside.chips.${chip}': ['web', 'zapier', 'csv', 'linkedin'].map(
    (chip) => `auth.aside.chips.${chip}`,
  ),
};

interface Use {
  file: string;
  key: string;
}

function usesIn(file: string, rel: string): { literal: Use[]; dynamic: Use[] } {
  const text = readFileSync(file, 'utf8');
  // Which namespace does `t` have in this file? (one translator per file today)
  const decl =
    /const\s+t\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']*)')?\s*\)/g;
  const namespaces = [...text.matchAll(decl)].map((m) => m[1] ?? '');
  const literal: Use[] = [];
  const dynamic: Use[] = [];
  if (namespaces.length === 0) return { literal, dynamic };
  expect(new Set(namespaces).size, `${rel}: several namespaces for t`).toBe(1);
  const ns = namespaces[0]!;
  const full = (k: string) => (ns ? `${ns}.${k}` : k);
  for (const m of text.matchAll(/\bt\(\s*'([^']+)'/g))
    literal.push({ file: rel, key: full(m[1]!) });
  for (const m of text.matchAll(/\bt\(\s*`([^`]+)`/g)) {
    const k = full(m[1]!);
    (k.includes('${') ? dynamic : literal).push({ file: rel, key: k });
  }
  return { literal, dynamic };
}

const scanned = [
  'components/app-shell',
  'components/settings',
  'components/state-views.tsx',
  'components/brand',
  'app/(app)',
  'components/auth',
  'components/team',
  'components/sources',
  'components/leads',
  'app/login',
  'app/signup',
  'app/invite',
];

const all = sources(root)
  .map((file) => ({ file, rel: relative(root, file).replaceAll('\\', '/') }))
  .filter(({ rel }) => scanned.some((p) => rel === p || rel.startsWith(`${p}/`)));

describe('message keys used by the app shell exist in EN and VI', () => {
  it('finds the shell sources', () => {
    expect(all.length).toBeGreaterThanOrEqual(10);
  });

  const found = all.map(({ file, rel }) => usesIn(file, rel));
  const literal = found.flatMap((f) => f.literal);
  const dynamic = found.flatMap((f) => f.dynamic);

  it('sees the keys we expect (guards against a scanner that matches nothing)', () => {
    const keys = literal.map((u) => u.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'shell.navLabel',
        'shell.brand',
        'shell.account',
        'shell.signOut',
        'shell.signOutFailed',
        'shell.menu',
        'shell.closeMenu',
        'common.skipToContent',
        'noAccess.title',
        'leads.title',
        'leads.emptyTitle',
        'settingsTeam.title',
        'settingsTeam.sub',
        'settings.navLabel',
        'settings.title',
      ]),
    );
  });

  it.each([...new Set(literal.map((u) => u.key))])('literal key %s', (key) => {
    expect(has(en as Dict, key), `en: ${key}`).toBe(true);
    expect(has(vi as Dict, key), `vi: ${key}`).toBe(true);
  });

  it.each([...new Set(dynamic.map((u) => u.key))])('dynamic template %s is known', (tpl) => {
    expect(Object.keys(DYNAMIC), `unlisted dynamic key ${tpl}`).toContain(tpl);
    for (const key of DYNAMIC[tpl]!) {
      expect(has(en as Dict, key), `en: ${key}`).toBe(true);
      expect(has(vi as Dict, key), `vi: ${key}`).toBe(true);
    }
  });

  it('sidebar nav ids and role values in the source match what this test enumerates', () => {
    const sidebar = readFileSync(join(root, 'components/app-shell/sidebar.tsx'), 'utf8');
    const ids = [...sidebar.matchAll(/id: '(\w+)',\s*href/g)].map((m) => m[1]);
    expect(ids.sort()).toEqual(['leads', 'review', 'settings']);
    const settings = readFileSync(join(root, 'components/settings/settings-frame.tsx'), 'utf8');
    expect([...settings.matchAll(/id: '(\w+)',\s*href/g)].map((m) => m[1])).toEqual([
      'sources',
      'ideal',
      'team',
      'advanced',
    ]);
  });
});

describe('EN and VI have the same keys', () => {
  function keys(messages: Dict, prefix = ''): string[] {
    return Object.entries(messages).flatMap(([k, v]) =>
      typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`),
    );
  }
  it('no key exists in only one language', () => {
    const e = new Set(keys(en as Dict));
    const v = new Set(keys(vi as Dict));
    expect([...e].filter((k) => !v.has(k))).toEqual([]);
    expect([...v].filter((k) => !e.has(k))).toEqual([]);
  });

  it('no message is empty', () => {
    for (const messages of [en, vi]) {
      for (const k of keys(messages as Dict)) {
        expect(has(messages as Dict, k)).toBe(true);
      }
    }
  });
});
