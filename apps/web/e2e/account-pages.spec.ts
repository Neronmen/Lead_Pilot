import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../messages/en.json';
import vi from '../messages/vi.json';
import { APP, MockApi, prepare, type Lang, type Theme } from './mock-api';

const SHOTS = join(__dirname, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const messages = { en, vi };
const GOOD = `good${'x'.repeat(30)}`;
const BAD = `bad-${'y'.repeat(30)}`;

async function open(
  browser: Browser,
  theme: Theme = 'dark',
  lang: Lang = 'en',
  seed: (api: MockApi) => void = () => undefined,
) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await prepare(context, theme, lang);
  const api = new MockApi({ role: 'OWNER' });
  seed(api);
  await api.install(context);
  const page = await context.newPage();
  return { context, api, page };
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

async function checkPage(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join('; ')}`),
  ).toEqual([]);
}

for (const [theme, lang] of [
  ['dark', 'vi'],
  ['light', 'en'],
] as const) {
  test(`forgot-password and reset pages render correctly (${theme} / ${lang})`, async ({
    browser,
  }) => {
    const { context, page } = await open(browser, theme, lang);
    await page.goto(`${APP}/forgot-password`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      messages[lang].auth.account.forgot.title,
    );
    await checkPage(page);
    await page.goto(`${APP}/reset-password#t=${GOOD}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      messages[lang].auth.account.reset.title,
    );
    await checkPage(page);
    if (theme === 'dark') await shot(page, 'reset-password-vi-dark');
    await context.close();
  });
}

test.describe('Forgot password', () => {
  const t = en.auth.account;

  test('says the same thing for any address, and sends one request', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/forgot-password`);
    await page.getByLabel(t.forgot.email).fill('not-an-email');
    await page.getByRole('button', { name: t.forgot.submit }).click();
    await expect(page.getByText(t.forgot.emailInvalid)).toBeVisible();
    expect(api.requests.some((r) => r.path === '/auth/forgot-password')).toBe(false);

    await page.getByLabel(t.forgot.email).fill('anyone@acme-test.com');
    await page.getByRole('button', { name: t.forgot.submit }).click();
    await expect(page.getByRole('heading', { name: t.forgot.sentTitle })).toBeVisible();
    await expect(page.getByText(/anyone@acme-test\.com has an account/)).toBeVisible();
    expect(api.requests.filter((r) => r.path === '/auth/forgot-password')).toHaveLength(1);
    await context.close();
  });
});

test('the sign-in page links to it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await prepare(context, 'dark', 'en');
  await new MockApi({ refresh: 'expired' }).install(context);
  const page = await context.newPage();
  await page.goto(`${APP}/login`);
  await page.getByRole('link', { name: en.auth.login.forgot }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await context.close();
});

test.describe('Reset password', () => {
  const t = en.auth.account;

  test('a good link sets the password, takes the token out of the address, and offers sign-in', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/reset-password#t=${GOOD}`);
    await expect.poll(() => page.url()).not.toContain(GOOD);
    await page.getByLabel(t.reset.password).fill('short');
    await page.getByRole('button', { name: t.reset.submit }).click();
    await expect(page.getByText(t.reset.tooShort)).toBeVisible();
    await page.getByLabel(t.reset.password).fill('a-brand-new-password-2');
    await page.getByRole('button', { name: t.reset.submit }).click();
    await expect(page.getByRole('heading', { name: t.reset.doneTitle })).toBeVisible();
    await expect(page.getByRole('link', { name: t.reset.signIn })).toHaveAttribute(
      'href',
      '/login',
    );
    const call = api.requests.find((r) => r.path === '/auth/reset-password');
    expect(call?.body).toEqual({ token: GOOD, password: 'a-brand-new-password-2' });
    await context.close();
  });

  test('a link that is wrong or missing says so and offers a new one', async ({ browser }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/reset-password#t=${BAD}`);
    await page.getByLabel(t.reset.password).fill('a-brand-new-password-2');
    await page.getByRole('button', { name: t.reset.submit }).click();
    await expect(page.getByRole('heading', { name: t.invalid.title })).toBeVisible();
    await expect(page.getByRole('link', { name: t.invalid.requestNew })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    await page.goto(`${APP}/reset-password`);
    await expect(page.getByRole('heading', { name: t.invalid.title })).toBeVisible();
    await context.close();
  });
});

test.describe('Verify email', () => {
  const t = en.auth.account;

  test('a good link confirms the address', async ({ browser }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/verify-email#t=${GOOD}`);
    await expect(page.getByRole('heading', { name: t.verify.doneTitle })).toBeVisible();
    await context.close();
  });

  test('a used or expired link says so', async ({ browser }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/verify-email#t=${BAD}`);
    await expect(page.getByRole('heading', { name: t.invalid.title })).toBeVisible();
    await context.close();
  });

  test('until verified, the app shows a banner with "Send it again"', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'dark', 'en', (a) => {
      a.emailVerified = false;
    });
    await page.goto(`${APP}/overview`);
    await expect(page.getByText(/Confirm your email address/)).toBeVisible();
    await shot(page, 'verify-banner');
    await page.getByRole('button', { name: t.banner.resend }).click();
    await expect(page.getByText(/We sent a new link to/)).toBeVisible();
    expect(api.requests.some((r) => r.path === '/auth/resend-verification')).toBe(true);
    await context.close();
  });

  test('a verified person sees no banner', async ({ browser }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/overview`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/Confirm your email address/)).toHaveCount(0);
    await context.close();
  });
});
