import { expect, test } from '@playwright/test';
import en from '../messages/en.json';
import vi from '../messages/vi.json';
import { APP, MockApi, prepare } from './mock-api';

/**
 * Closes gaps found by mutation checks on render.spec.ts: that suite reads its
 * expected text from the same message file the app uses, so an untranslated
 * (or deleted) Vietnamese string could not fail it.
 */

type Tree = { [key: string]: string | Tree };
const flat = (tree: Tree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : flat(value, `${prefix}${key}.`),
  );

// Same in both languages on purpose: the language's own name and the brand.
const SAME_IN_BOTH = new Set([
  'language.en',
  'shell.brand',
  'shell.menuTitle',
  // Product and tool names, a person's name and sample data are the same in any language.
  'auth.footer',
  'auth.aside.chips.zapier',
  'auth.aside.chips.csv',
  'auth.aside.chips.linkedin',
  'auth.aside.sample.name',
  'auth.aside.sample.score',
  'auth.aside.sample.assignedValue',
  'auth.aside.sample.actionsValue',
  // Each language is always written in its own language.
  'auth.signup.languages.en',
  'auth.signup.languages.vi',
  'auth.invite.email',
]);

test('every Vietnamese message differs from the English one (nothing left untranslated)', () => {
  const english = new Map(flat(en as Tree));
  const untranslated = flat(vi as Tree)
    .filter(([key, text]) => english.get(key) === text && !SAME_IN_BOTH.has(key))
    .map(([key]) => key);
  expect(untranslated).toEqual([]);
});

test('no screen shows a raw message key or leaks English into Vietnamese', async ({ browser }) => {
  const rawKey = /\b(?:leads|shell|settings|settingsTeam|noAccess|session|common)\.[A-Za-z]+\b/;
  for (const [path, role] of [
    ['/leads', 'OWNER'],
    ['/settings/team', 'ADMIN'],
    ['/settings/team', 'MEMBER'],
  ] as const) {
    const context = await browser.newContext();
    await prepare(context, 'light', 'vi');
    await new MockApi({ role }).install(context);
    const page = await context.newPage();
    await page.goto(`${APP}${path}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text, `${role} ${path}`).not.toMatch(rawKey);
    // Sentences of the English file must not appear on the Vietnamese page.
    const english = flat(en as Tree)
      .map(([, value]) => value)
      .filter((value) => value.length > 12 && !value.includes('{'));
    expect(english.filter((value) => text.includes(value))).toEqual([]);
    await context.close();
  }
});
