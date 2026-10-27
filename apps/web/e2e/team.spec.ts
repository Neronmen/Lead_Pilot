import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../messages/en.json';
import vi from '../messages/vi.json';
import {
  APP,
  MockApi,
  prepare,
  type Lang,
  type MockOptions,
  type Role,
  type Theme,
} from './mock-api';

const SHOTS = join(__dirname, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const messages = { en, vi };
const t = en.team;
const URL = `${APP}/settings/team`;

async function open(
  browser: Browser,
  role: Role = 'OWNER',
  theme: Theme = 'dark',
  lang: Lang = 'en',
  options: MockOptions = {},
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context, theme, lang);
  const api = new MockApi({ role, ...options });
  await api.install(context);
  const page = await context.newPage();
  return { context, api, page };
}

const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
const answer = (api: MockApi, key: string, status: number, code: string) =>
  api.answers.set(key, () => ({ status, body: { error: { code, message: 'x' } } }));
const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

for (const theme of ['dark', 'light'] as const) {
  for (const lang of ['en', 'vi'] as const) {
    test(`team renders correctly (${theme} / ${lang})`, async ({ browser }) => {
      const { context, page } = await open(browser, 'OWNER', theme, lang);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(URL);
      const m = messages[lang];
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(m.settingsTeam.title);
      await expect(page.getByRole('heading', { name: m.team.invite.title })).toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();
      await expect(page.getByRole('heading', { name: /\(2\)$/ })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const axe = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        axe.violations.map(
          (v) =>
            `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary}`).join('; ')}`,
        ),
      ).toEqual([]);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test.describe('who sees which controls', () => {
  test('the owner: roles and Remove on admins and members, nothing on themselves', async ({
    browser,
  }) => {
    const { context, page } = await open(browser, 'OWNER');
    await page.goto(URL);
    await expect(page.getByLabel(t.people.roleOf.replace('{name}', 'Linh Tran'))).toBeVisible();
    await expect(page.getByLabel(t.people.roleOf.replace('{name}', 'Ethan Brooks'))).toBeVisible();
    await expect(row(page, 'Linh Tran').getByRole('button', { name: /Remove/ })).toBeVisible();
    const you = row(page, 'Daniel Park');
    await expect(you.getByText(t.people.you)).toBeVisible();
    await expect(you.getByRole('button')).toHaveCount(0);
    await expect(you.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('columnheader')).toHaveText([
      t.people.colPerson,
      t.people.colRole,
      t.people.colOpen,
      t.people.colActive,
      t.people.colActions,
    ]);
    await context.close();
  });

  test('an admin manages members only: no role selects, no Remove on the owner or admins', async ({
    browser,
  }) => {
    const { context, page } = await open(browser, 'ADMIN');
    await page.goto(URL);
    await expect(row(page, 'Ethan Brooks').getByRole('button', { name: /Remove/ })).toBeVisible();
    await expect(row(page, 'Mia Johnson').getByRole('button')).toHaveCount(0);
    await expect(row(page, 'Daniel Park').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: /Role for/ })).toHaveCount(0);
    // The invite form offers Member only.
    await expect(page.getByLabel(t.invite.as).locator('option')).toHaveText([
      t.invite.roles.MEMBER,
    ]);
    // The admin invite is the owner's: a note instead of buttons.
    const pending = page.getByRole('listitem').filter({ hasText: 'sam@northstargrowth.com' });
    await expect(pending.getByRole('button')).toHaveCount(0);
    await expect(pending.getByText(t.pending.ownerOnly)).toBeVisible();
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'olivia@northstargrowth.com' })
        .getByRole('button'),
    ).toHaveCount(2);
    await context.close();
  });

  test('a member gets the no-access page and the page makes no team request', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser, 'MEMBER');
    await page.goto(URL);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.noAccess.title);
    expect(api.requests.filter((r) => r.path === '/members' || r.path === '/invites')).toEqual([]);
    await context.close();
  });
});

test.describe('changing a role', () => {
  test('the owner makes a member an admin', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    await page.goto(URL);
    const select = page.getByLabel(t.people.roleOf.replace('{name}', 'Ethan Brooks'));
    await select.selectOption('ADMIN');
    await expect(select).toHaveValue('ADMIN');
    await expect(select).toBeEnabled();
    const call = api.requests.find((r) => r.method === 'PATCH' && r.path.startsWith('/members/'));
    expect(call?.body).toEqual({ role: 'ADMIN' });
    await context.close();
  });

  test('409: "this changed while you were looking", reload brings the real state back', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    await page.goto(URL);
    let first = true;
    api.answers.set(`PATCH /members/aaaaaaaa-0000-4000-8000-000000000004`, () => {
      if (!first) return null;
      first = false;
      return { status: 409, body: { error: { code: 'CONFLICT', message: 'x' } } };
    });
    const select = page.getByLabel(t.people.roleOf.replace('{name}', 'Ethan Brooks'));
    await select.selectOption('ADMIN');
    await expect(page.getByRole('alert').filter({ hasText: t.problem.changed })).toBeVisible();
    await expect(select).toHaveValue('MEMBER'); // back to what the server has
    const before = api.requests.filter((r) => r.path === '/members' && r.method === 'GET').length;
    await page.getByRole('button', { name: t.problem.reload }).click();
    await expect(page.getByRole('alert').filter({ hasText: t.problem.changed })).toHaveCount(0);
    await expect
      .poll(() => api.requests.filter((r) => r.path === '/members' && r.method === 'GET').length)
      .toBeGreaterThan(before);
    await shot(page, 'dark-en-team-conflict-after');
    await context.close();
  });

  test('a person who is gone, or a forbidden change, says so and keeps the page', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    await page.goto(URL);
    answer(api, 'PATCH /members/aaaaaaaa-0000-4000-8000-000000000004', 404, 'NOT_FOUND');
    await page.getByLabel(t.people.roleOf.replace('{name}', 'Ethan Brooks')).selectOption('ADMIN');
    await expect(page.getByRole('alert').filter({ hasText: t.problem.changed })).toBeVisible();
    answer(api, 'PATCH /members/aaaaaaaa-0000-4000-8000-000000000003', 403, 'OWNER_IMMUTABLE');
    await page.getByLabel(t.people.roleOf.replace('{name}', 'Linh Tran')).selectOption('MEMBER');
    await expect(
      page.getByRole('alert').filter({ hasText: en.errors.OWNER_IMMUTABLE }),
    ).toBeVisible();
    await context.close();
  });
});

test.describe('removing someone', () => {
  test('asks first, says what happens to their leads, and removes on confirm', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    await page.goto(URL);
    await row(page, 'Ethan Brooks')
      .getByRole('button', { name: /Remove/ })
      .click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Remove Ethan Brooks from Northstar Growth?');
    await expect(row(page, 'ethan.brooks@northstargrowth.com')).toContainText('14'); // the open-leads column
    await expect(dialog).toContainText('Their 14 open leads become unassigned');
    await expect(dialog).not.toContainText(/routing rules/i);
    await shot(page, 'dark-en-team-remove-confirm');
    await dialog.getByRole('button', { name: t.confirm.cancel }).click();
    await expect(dialog).toHaveCount(0);
    expect(api.requests.some((r) => r.method === 'DELETE')).toBe(false);

    await row(page, 'Ethan Brooks')
      .getByRole('button', { name: /Remove/ })
      .click();
    await page.getByRole('button', { name: 'Remove Ethan Brooks', exact: true }).last().click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // Someone with no open leads gets the short wording.
    await row(page, 'noah@northstargrowth.com')
      .getByRole('button', { name: /Remove/ })
      .click();
    await expect(page.getByRole('alertdialog')).toContainText('Their leads become unassigned');
    await page.getByRole('alertdialog').getByRole('button', { name: t.confirm.cancel }).click();
    await expect(row(page, 'Ethan Brooks')).toHaveCount(0);
    expect(api.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
    await context.close();
  });

  test('the same warning in Vietnamese', async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER', 'dark', 'vi');
    await page.goto(URL);
    await row(page, 'Ethan Brooks').getByRole('button', { name: /Gỡ/ }).click();
    await expect(page.getByRole('alertdialog')).toContainText(
      '14 khách tiềm năng đang mở của họ sẽ chưa có người phụ trách',
    );
    await context.close();
  });

  test('a refused removal shows the reason and closes the question', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'ADMIN');
    await page.goto(URL);
    answer(api, 'DELETE /members/aaaaaaaa-0000-4000-8000-000000000004', 403, 'FORBIDDEN');
    await row(page, 'Ethan Brooks')
      .getByRole('button', { name: /Remove/ })
      .click();
    await page.getByRole('button', { name: 'Remove Ethan Brooks', exact: true }).last().click();
    await expect(page.getByRole('alert').filter({ hasText: en.errors.FORBIDDEN })).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(row(page, 'Ethan Brooks')).toHaveCount(1);
    await context.close();
  });
});

test.describe('states', () => {
  test('loading: skeletons first, then the data', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    api.delays.set('GET /members', 1200);
    api.delays.set('GET /invites', 1200);
    await page.goto(URL);
    await expect(page.getByRole('status').first()).toHaveAttribute('aria-busy', 'true');
    await shot(page, 'dark-en-team-loading');
    await expect(page.getByRole('table')).toBeVisible();
    await context.close();
  });

  test('empty: just you, with a button that goes to the invite box', async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER', 'dark', 'en', { alone: true });
    await page.goto(URL);
    await expect(page.getByRole('heading', { name: t.empty.title })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Pending invites/ })).toHaveCount(0);
    await shot(page, 'dark-en-team-empty');
    await page.getByRole('button', { name: t.empty.cta }).click();
    await expect(page.getByLabel(t.invite.emails)).toBeFocused();
    await context.close();
  });

  test('error: the team does not load, and Try again works', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    let fail = true;
    api.answers.set('GET /members', () =>
      fail ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } } : null,
    );
    await page.goto(URL);
    await expect(page.getByRole('heading', { name: t.problem.loadTitle })).toBeVisible();
    await shot(page, 'dark-en-team-error');
    fail = false;
    await page.getByRole('button', { name: t.problem.retry }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await context.close();
  });

  test('error: pending invites do not load, the rest still works', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    api.answers.set('GET /invites', () => ({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    }));
    await page.goto(URL);
    await expect(
      page.getByRole('alert').filter({ hasText: t.problem.pendingFailed }),
    ).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await context.close();
  });
});

test.describe('inviting', () => {
  test('sends to several addresses, reports each, and lists them as pending', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    await page.goto(URL);
    await page.getByLabel(t.invite.emails).fill('Ava@Northstargrowth.com, ben@northstargrowth.com');
    await page.getByLabel(t.invite.as).selectOption('ADMIN');
    await page.getByRole('button', { name: t.invite.send }).click();
    await expect(page.getByText('Invite sent to ava@northstargrowth.com.')).toBeVisible();
    await expect(page.getByText('Invite sent to ben@northstargrowth.com.')).toBeVisible();
    expect(api.requests.find((r) => r.method === 'POST' && r.path === '/invites')?.body).toEqual({
      emails: ['ava@northstargrowth.com', 'ben@northstargrowth.com'],
      role: 'ADMIN',
    });
    await expect(page.getByLabel(t.invite.emails)).toHaveValue('');
    await expect(page.getByRole('heading', { name: /Pending invites \(4\)/ })).toBeVisible();
    await context.close();
  });

  test('says what is wrong before sending anything', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    await page.goto(URL);
    const send = page.getByRole('button', { name: t.invite.send });
    await send.click();
    await expect(page.getByText(t.invite.none)).toBeVisible();
    await page.getByLabel(t.invite.emails).fill('fine@northstargrowth.com, not-an-email, a@b.con');
    await send.click();
    await expect(page.getByText('Check these addresses: not-an-email, a@b.con.')).toBeVisible();
    const many = Array.from({ length: 21 }, (_, i) => `p${i}@northstargrowth.com`).join(', ');
    await page.getByLabel(t.invite.emails).fill(many);
    await send.click();
    await expect(page.getByText(t.invite.tooMany.replace('{max}', '20'))).toBeVisible();
    expect(api.requests.some((r) => r.method === 'POST' && r.path === '/invites')).toBe(false);
    await context.close();
  });

  test('offers the likely address for a typo of a common provider', async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER');
    await page.goto(URL);
    const box = page.getByLabel(t.invite.emails);
    await box.fill('ava@gmial.com');
    await page.getByLabel(t.invite.as).focus();
    await page
      .getByRole('button', { name: en.emailHint.apply.replace('{suggestion}', 'gmail.com') })
      .click();
    await expect(box).toHaveValue('ava@gmail.com');
    await context.close();
  });

  test('reports an address that is already on the team, and a failed email', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    api.answers.set('POST /invites', () => ({
      status: 201,
      body: {
        results: [
          { email: 'ethan.brooks@northstargrowth.com', status: 'already_member' },
          { email: 'olivia@northstargrowth.com', status: 'already_invited' },
          { email: 'zed@northstargrowth.com', status: 'email_failed' },
        ],
      },
    }));
    await page.goto(URL);
    await page
      .getByLabel(t.invite.emails)
      .fill(
        'ethan.brooks@northstargrowth.com, olivia@northstargrowth.com, zed@northstargrowth.com',
      );
    await page.getByRole('button', { name: t.invite.send }).click();
    await expect(
      page.getByText('ethan.brooks@northstargrowth.com is already on the team.'),
    ).toBeVisible();
    await expect(
      page.getByText('olivia@northstargrowth.com already has a pending invite.'),
    ).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'zed@northstargrowth.com' }),
    ).toBeVisible();
    await context.close();
  });

  test('too many invites in a minute: the rate-limit message', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    answer(api, 'POST /invites', 429, 'RATE_LIMITED');
    await page.goto(URL);
    await page.getByLabel(t.invite.emails).fill('ava@northstargrowth.com');
    await page.getByRole('button', { name: t.invite.send }).click();
    await expect(page.getByRole('alert').filter({ hasText: en.errors.RATE_LIMITED })).toBeVisible();
    await expect(page.getByLabel(t.invite.emails)).toHaveValue('ava@northstargrowth.com');
    await context.close();
  });
});

test.describe('pending invites', () => {
  test('resend says it was sent; cancel removes the row', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    await page.goto(URL);
    const olivia = page.getByRole('listitem').filter({ hasText: 'olivia@northstargrowth.com' });
    await expect(olivia).toContainText('Invited as Member by Mia Johnson');
    await olivia.getByRole('button', { name: /Resend/ }).click();
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Invite sent again to olivia@northstargrowth.com.' }),
    ).toBeVisible();
    await olivia.getByRole('button', { name: /Cancel invite/ }).click();
    await expect(olivia).toHaveCount(0);
    expect(api.requests.some((r) => r.method === 'DELETE' && r.path.startsWith('/invites/'))).toBe(
      true,
    );
    await shot(page, 'dark-en-team');
    await context.close();
  });

  test('a resend whose email fails says so', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    api.answers.set(`POST /invites/cccccccc-0000-4000-8000-000000000001/resend`, () => ({
      status: 200,
      body: { status: 'email_failed' },
    }));
    await page.goto(URL);
    await page
      .getByRole('listitem')
      .filter({ hasText: 'olivia@northstargrowth.com' })
      .getByRole('button', { name: /Resend/ })
      .click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'olivia@northstargrowth.com' }),
    ).toBeVisible();
    await context.close();
  });
});
