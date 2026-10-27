import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../messages/en.json';
import vi from '../messages/vi.json';
import { APP, MockApi, prepare, type Lang, type Theme } from './mock-api';

const SHOTS = join(__dirname, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const messages = { en, vi };

async function signedOut(
  browser: import('@playwright/test').Browser,
  theme: Theme = 'dark',
  lang: Lang = 'en',
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context, theme, lang);
  const api = new MockApi({ refresh: 'expired', role: 'ADMIN' });
  await api.install(context);
  const page = await context.newPage();
  return { context, api, page };
}

const t = en.auth.login;

async function submit(page: Page, email: string, password: string) {
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: t.submit }).click();
}

for (const theme of ['dark', 'light'] as const) {
  for (const lang of ['en', 'vi'] as const) {
    test(`login renders correctly (${theme} / ${lang})`, async ({ browser }) => {
      const { context, page } = await signedOut(browser, theme, lang);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${APP}/login`);
      const m = messages[lang].auth;
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(m.login.title);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.getByText(m.aside.pitch)).toBeVisible();
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
      await page.screenshot({ path: join(SHOTS, `${theme}-${lang}-login.png`) });
      await context.close();
    });
  }
}

test.describe('signing in', () => {
  test('goes to the leads page and loads who is signed in', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    await submit(page, 'Daniel@NorthstarGrowth.com', 'Correct-Horse-Battery-9');
    await expect(page).toHaveURL(/\/leads$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.leads.title);
    const login = api.requests.find((r) => r.method === 'POST' && r.path === '/auth/login');
    expect(login?.body).toEqual({
      email: 'daniel@northstargrowth.com',
      password: 'Correct-Horse-Battery-9',
    });
    await context.close();
  });

  test('follows a safe ?next= and nothing else', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/login?next=${encodeURIComponent('/settings/team')}`);
    await submit(page, 'daniel@northstargrowth.com', 'Correct-Horse-Battery-9');
    await expect(page).toHaveURL(/\/settings\/team$/);
    await context.close();
  });

  for (const evil of [
    'https://evil.example/steal',
    '//evil.example',
    '/x/..//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
  ]) {
    test(`ignores the unsafe ?next=${evil}`, async ({ browser }) => {
      const { context, page } = await signedOut(browser);
      await page.goto(`${APP}/login?next=${encodeURIComponent(evil)}`);
      await submit(page, 'daniel@northstargrowth.com', 'Correct-Horse-Battery-9');
      await expect(page).toHaveURL(`${APP}/leads`);
      await context.close();
    });
  }

  test('a person already signed in is moved on, to ?next= when it is safe', async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    await new MockApi({ role: 'ADMIN' }).install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/login?next=${encodeURIComponent('/settings/team')}`);
    await expect(page).toHaveURL(/\/settings\/team$/);
    await page.goto(`${APP}/login?next=${encodeURIComponent('//evil.example')}`);
    await expect(page).toHaveURL(`${APP}/leads`);
    await context.close();
  });

  test('the account language wins on a new browser', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser, 'dark', 'en');
    api.locale = 'vi';
    await page.goto(`${APP}/login`);
    await submit(page, 'daniel@northstargrowth.com', 'Correct-Horse-Battery-9');
    await expect(page).toHaveURL(/\/leads$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(vi.leads.title);
    await context.close();
  });

  test('"Create a workspace" keeps ?next=', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/login?next=${encodeURIComponent('/settings/team')}`);
    await page.getByRole('link', { name: t.create }).click();
    await expect(page).toHaveURL(/\/signup\?next=%2Fsettings%2Fteam$/);
    await context.close();
  });
});

test.describe('login problems', () => {
  test('empty fields are explained without calling the API', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page.getByText(en.validation.invalid_type)).toHaveCount(2);
    expect(api.requests.some((r) => r.path === '/auth/login')).toBe(false);
    await expect(page.getByLabel(t.email)).toBeFocused();
    await context.close();
  });

  const cases: [string, number, string, string][] = [
    ['wrong password', 401, 'AUTH_INVALID_CREDENTIALS', en.errors.AUTH_INVALID_CREDENTIALS],
    ['too many attempts', 429, 'RATE_LIMITED', en.errors.RATE_LIMITED],
    ['no workspace left', 403, 'AUTH_NO_WORKSPACE', en.errors.AUTH_NO_WORKSPACE],
    ['server error', 500, 'INTERNAL', en.errors.INTERNAL],
    ['an unknown code', 400, 'SOMETHING_NEW', en.errors.UNKNOWN],
  ];
  for (const [name, status, code, text] of cases) {
    test(`shows the message for ${name}`, async ({ browser }) => {
      const { context, api, page } = await signedOut(browser);
      api.answers.set('POST /auth/login', () => ({
        status,
        body: { error: { code, message: 'x' } },
      }));
      await page.goto(`${APP}/login`);
      await submit(page, 'daniel@northstargrowth.com', 'wrong-password-123');
      await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();
      // Nothing is lost: the person can fix it and try again.
      await expect(page.getByLabel(t.email)).toHaveValue('daniel@northstargrowth.com');
      await expect(page.getByLabel(t.password, { exact: true })).toHaveValue('wrong-password-123');
      await expect(page.getByRole('button', { name: t.submit })).toBeEnabled();
      expect(new URL(page.url()).pathname).toBe('/login');
      if (name === 'wrong password') {
        await page.screenshot({ path: join(SHOTS, 'dark-en-login-wrong-password.png') });
      }
      await context.close();
    });
  }

  test('the same message in Vietnamese', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser, 'dark', 'vi');
    api.answers.set('POST /auth/login', () => ({
      status: 401,
      body: { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'x' } },
    }));
    await page.goto(`${APP}/login`);
    await page.getByLabel(vi.auth.login.email).fill('daniel@northstargrowth.com');
    await page.getByLabel(vi.auth.login.password, { exact: true }).fill('wrong-password-123');
    await page.getByRole('button', { name: vi.auth.login.submit }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: vi.errors.AUTH_INVALID_CREDENTIALS }),
    ).toBeVisible();
    await context.close();
  });

  test('the show-password button reveals and hides the password', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    const field = page.getByLabel(t.password, { exact: true });
    await expect(field).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: en.auth.showPassword }).click();
    await expect(field).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: en.auth.hidePassword }).click();
    await expect(field).toHaveAttribute('type', 'password');
    await context.close();
  });

  test('a second click while sending does not send twice', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    await page.getByLabel(t.email).fill('daniel@northstargrowth.com');
    await page.getByLabel(t.password, { exact: true }).fill('Correct-Horse-Battery-9');
    const button = page.getByRole('button', { name: t.submit });
    await button.dblclick();
    await expect(page).toHaveURL(/\/leads$/);
    expect(api.requests.filter((r) => r.path === '/auth/login')).toHaveLength(1);
    await context.close();
  });
});
