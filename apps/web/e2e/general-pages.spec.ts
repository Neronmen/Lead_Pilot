import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../messages/en.json';
import vi from '../messages/vi.json';
import { APP, MockApi, prepare, type Lang, type Role, type Theme } from './mock-api';

const SHOTS = join(__dirname, 'screenshots');
mkdirSync(SHOTS, { recursive: true });

async function open(browser: Browser, role: Role, theme: Theme = 'dark', lang: Lang = 'en') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context, theme, lang);
  const api = new MockApi({ role });
  await api.install(context);
  const page = await context.newPage();
  return { context, api, page };
}

async function checkPage(page: Page) {
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
}

test.describe('Settings > General', () => {
  const t = en.general;

  test('owner: saves the workspace, changes the password, downloads the leads, deletes', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser, 'OWNER');
    await page.goto(`${APP}/settings/general`);
    await expect(
      page.getByRole('heading', { name: en.settingsGeneral.title, level: 1 }),
    ).toBeVisible();
    await checkPage(page);
    await page.screenshot({ path: join(SHOTS, 'settings-general.png'), fullPage: true });

    // Workspace: rename it and save.
    const name = page.getByLabel(t.workspace.name);
    await name.fill('Northstar Labs');
    await page.getByRole('button', { name: t.workspace.save }).click();
    await expect(page.getByText(t.workspace.saved)).toBeVisible();
    expect(
      api.requests.find((r) => r.path === '/workspace' && r.method === 'PATCH')?.body,
    ).toMatchObject({
      name: 'Northstar Labs',
    });

    // Password: a wrong current password says so; a right one confirms.
    await page.getByLabel(t.password.current).fill('wrong-password');
    await page.getByLabel(t.password.new, { exact: true }).fill('a-brand-new-password-9');
    await page.getByRole('button', { name: t.password.save }).click();
    await expect(page.locator('[data-form-alert]')).toContainText(t.password.wrongCurrent);
    await page.getByLabel(t.password.current).fill('the-right-password');
    await page.getByRole('button', { name: t.password.save }).click();
    await expect(page.getByText(t.password.saved)).toBeVisible();

    // Export: the browser gets a CSV file.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: t.export.button }).click();
    expect((await download).suggestedFilename()).toMatch(
      /^leadpilot-leads-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    // Delete: the button stays off until the name is typed exactly.
    await page.getByRole('button', { name: t.delete.open }).click();
    const confirm = page.getByRole('button', { name: t.delete.confirm });
    await expect(confirm).toBeDisabled();
    await page
      .getByLabel(t.delete.confirmLabel.replace('{name}', 'Northstar Labs'))
      .fill('Northstar Labs');
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page).toHaveURL(/\/login/);
    expect(api.requests.some((r) => r.path === '/workspace' && r.method === 'DELETE')).toBe(true);
    await context.close();
  });

  test('admin: no delete card; member: the "only admins" page', async ({ browser }) => {
    const admin = await open(browser, 'ADMIN');
    await admin.page.goto(`${APP}/settings/general`);
    await expect(admin.page.getByRole('button', { name: t.export.button })).toBeVisible();
    await expect(admin.page.getByRole('button', { name: t.delete.open })).toHaveCount(0);
    await admin.context.close();

    const member = await open(browser, 'MEMBER');
    await member.page.goto(`${APP}/settings/general`);
    await expect(member.page.getByText(en.noAccess.title)).toBeVisible();
    await member.context.close();
  });

  test('Vietnamese, light theme: no overflow, no accessibility problems', async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER', 'light', 'vi');
    await page.goto(`${APP}/settings/general`);
    await expect(
      page.getByRole('heading', { name: vi.settingsGeneral.title, level: 1 }),
    ).toBeVisible();
    await checkPage(page);
    await context.close();
  });
});

test.describe('Privacy and Terms', () => {
  for (const [path, kind] of [
    ['/privacy', 'privacy'],
    ['/terms', 'terms'],
  ] as const) {
    test(`${path} is public and readable in both languages`, async ({ browser }) => {
      for (const [lang, messages, theme] of [
        ['en', en, 'light'],
        ['vi', vi, 'dark'],
      ] as const) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await prepare(context, theme, lang);
        await new MockApi({ role: 'OWNER' }).install(context);
        const page = await context.newPage();
        await page.goto(`${APP}${path}`);
        await expect(
          page.getByRole('heading', { name: messages.legal[kind].title, level: 1 }),
        ).toBeVisible();
        await expect(page.getByRole('heading', { level: 2 })).toHaveCount(6);
        await checkPage(page);
        await context.close();
      }
    });
  }

  test('the sign-up page links to both', async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context, 'light', 'en');
    await new MockApi({ role: 'OWNER' }).install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/signup`);
    await expect(page.getByRole('link', { name: 'Terms', exact: true })).toHaveAttribute(
      'href',
      '/terms',
    );
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    await context.close();
  });
});
