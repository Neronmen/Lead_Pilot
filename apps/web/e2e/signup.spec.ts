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
const t = en.auth.signup;

async function signedOut(browser: Browser, theme: Theme = 'dark', lang: Lang = 'en') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context, theme, lang);
  const api = new MockApi({ refresh: 'expired', role: 'OWNER' });
  await api.install(context);
  const page = await context.newPage();
  return { context, api, page };
}

async function fill(
  page: Page,
  over: Partial<Record<'name' | 'workspace' | 'email' | 'password', string>> = {},
) {
  await page.getByLabel(t.name).fill(over.name ?? 'Chloe Martin');
  await page.getByLabel(t.workspace).fill(over.workspace ?? 'Harbour & Pine');
  await page.getByLabel(t.email).fill(over.email ?? 'chloe@harbourandpine.com.au');
  await page.getByLabel(t.password, { exact: true }).fill(over.password ?? 'harbour-pine-2026!');
}
const submit = (page: Page) => page.getByRole('button', { name: t.submit }).click();

for (const theme of ['dark', 'light'] as const) {
  for (const lang of ['en', 'vi'] as const) {
    test(`signup renders correctly (${theme} / ${lang})`, async ({ browser }) => {
      const { context, page } = await signedOut(browser, theme, lang);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${APP}/signup`);
      const m = messages[lang].auth.signup;
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(m.title);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(m.aside.title);
      await expect(
        page.getByRole('listitem').filter({ hasText: m.aside.steps.s1.title }),
      ).toBeVisible();
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
      await page.screenshot({ path: join(SHOTS, `${theme}-${lang}-signup.png`) });
      await context.close();
    });
  }
}

test.describe('creating a workspace', () => {
  test('sends what was typed and lands on the leads page', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await expect(page.getByLabel(t.name)).toBeFocused();
    await fill(page, { email: 'Chloe@HarbourAndPine.com.au' });
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    const body = api.requests.find((r) => r.path === '/auth/signup')?.body;
    expect(body).toEqual({
      name: 'Chloe Martin',
      workspaceName: 'Harbour & Pine',
      email: 'chloe@harbourandpine.com.au',
      password: 'harbour-pine-2026!',
      locale: 'en',
      currency: 'USD',
      defaultCountry: 'US',
    });
    await context.close();
  });

  test('the workspace language chosen becomes the language of the app', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page);
    await page.getByLabel(t.language).selectOption('vi');
    await page.getByLabel(t.currency).selectOption('VND');
    await page.getByLabel(t.country).selectOption('VN');
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(vi.leads.title);
    const body = api.requests.find((r) => r.path === '/auth/signup')?.body as Record<
      string,
      string
    >;
    expect(body).toMatchObject({ locale: 'vi', currency: 'VND', defaultCountry: 'VN' });
    await context.close();
  });

  test('a Vietnamese page starts with Vietnamese, VND and Vietnam', async ({ browser }) => {
    const { context, page } = await signedOut(browser, 'dark', 'vi');
    await page.goto(`${APP}/signup`);
    await expect(page.getByLabel(vi.auth.signup.language)).toHaveValue('vi');
    await expect(page.getByLabel(vi.auth.signup.currency)).toHaveValue('VND');
    await expect(page.getByLabel(vi.auth.signup.country)).toHaveValue('VN');
    await context.close();
  });

  test('follows a safe ?next= and keeps it for Sign in', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup?next=${encodeURIComponent('/settings/team')}`);
    await expect(page.getByRole('link', { name: t.signIn })).toHaveAttribute(
      'href',
      '/login?next=%2Fsettings%2Fteam',
    );
    await fill(page);
    await submit(page);
    await expect(page).toHaveURL(/\/settings\/team$/);
    await context.close();
  });

  test('ignores an unsafe ?next=', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup?next=${encodeURIComponent('//evil.example')}`);
    await fill(page);
    await submit(page);
    await expect(page).toHaveURL(`${APP}/leads`);
    await context.close();
  });

  test('a second click while sending does not create two workspaces', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page);
    // Two submit events in the same tick: only the guard (not a disabled button) stops the second.
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page).toHaveURL(/\/leads$/);
    expect(api.requests.filter((r) => r.path === '/auth/signup')).toHaveLength(1);
    await context.close();
  });
});

test.describe('the email typo hint', () => {
  test('offers the likely address and applies it with one click', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    const email = page.getByLabel(t.email);
    await email.fill('chloe@gmial.com');
    await page.getByLabel(t.name).focus(); // leaving the box
    const hint = page.getByRole('status').filter({ hasText: 'gmail.com' });
    await expect(hint).toContainText(en.emailHint.didYouMean.replace('{suggestion}', 'gmail.com'));
    await page.screenshot({ path: join(SHOTS, 'dark-en-signup-email-hint.png') });
    await hint
      .getByRole('button', { name: en.emailHint.apply.replace('{suggestion}', 'gmail.com') })
      .click();
    await expect(email).toHaveValue('chloe@gmail.com');
    await expect(page.getByRole('status')).toHaveCount(0);
    await context.close();
  });

  test('stays quiet for real addresses and goes away when the address changes', async ({
    browser,
  }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    const email = page.getByLabel(t.email);
    for (const ok of ['a@gmail.com', 'a@mail.com', 'a@harbourandpine.com.au']) {
      await email.fill(ok);
      await page.getByLabel(t.name).focus();
      await expect(page.getByRole('status')).toHaveCount(0);
    }
    await email.fill('a@gmial.com');
    await page.getByLabel(t.name).focus();
    await expect(page.getByRole('status')).toHaveCount(1);
    await email.fill('a@gmial.co');
    await expect(page.getByRole('status')).toHaveCount(0);
    await context.close();
  });

  test('is in Vietnamese too', async ({ browser }) => {
    const { context, page } = await signedOut(browser, 'dark', 'vi');
    await page.goto(`${APP}/signup`);
    await page.getByLabel(vi.auth.signup.email).fill('chloe@gmial.com');
    await page.getByLabel(vi.auth.signup.name).focus();
    await expect(page.getByRole('status')).toContainText(
      vi.emailHint.didYouMean.replace('{suggestion}', 'gmail.com'),
    );
    await context.close();
  });
});

test.describe('signup problems', () => {
  test('explains every empty field without calling the API', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await submit(page);
    // Name and workspace are "required"; the email and the password say what they need.
    await expect(page.getByText(en.validation.invalid_type)).toHaveCount(2);
    await expect(page.getByText(en.validation.invalid_format.email)).toBeVisible();
    await expect(
      page.getByText(en.validation.too_small.string.replace('{minimum}', '12')),
    ).toBeVisible();
    expect(api.requests.some((r) => r.path === '/auth/signup')).toBe(false);
    await expect(page.getByLabel(t.name)).toBeFocused();
    await context.close();
  });

  test('refuses a short password and an ending that does not exist', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page, { email: 'chloe@harbourandpine.con', password: 'short' });
    await submit(page);
    await expect(page.getByText(en.validation.custom.unknown_tld)).toBeVisible();
    await expect(
      page.getByText(en.validation.too_small.string.replace('{minimum}', '12')),
    ).toBeVisible();
    expect(api.requests.some((r) => r.path === '/auth/signup')).toBe(false);
    await page.screenshot({ path: join(SHOTS, 'dark-en-signup-field-errors.png') });
    await context.close();
  });

  test('EMAIL_TAKEN is shown under the email box with a way to sign in', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    api.answers.set('POST /auth/signup', () => ({
      status: 409,
      body: { error: { code: 'EMAIL_TAKEN', message: 'x' } },
    }));
    await page.goto(`${APP}/signup`);
    await fill(page);
    await submit(page);
    const email = page.getByLabel(t.email);
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(en.errors.EMAIL_TAKEN)).toBeVisible();
    await expect(email).toBeFocused();
    // The address is not carried to the sign-in page (no personal data in a URL).
    await expect(page.getByRole('link', { name: t.signInInstead })).toHaveAttribute(
      'href',
      '/login',
    );
    await page.screenshot({ path: join(SHOTS, 'dark-en-signup-email-taken.png') });
    // Nothing typed is lost.
    await expect(page.getByLabel(t.workspace)).toHaveValue('Harbour & Pine');
    await expect(page.getByLabel(t.password, { exact: true })).toHaveValue('harbour-pine-2026!');
    await context.close();
  });

  test('a field problem reported by the API appears under its field', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    api.answers.set('POST /auth/signup', () => ({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: [{ path: 'workspaceName', code: 'too_big', origin: 'string', maximum: 100 }],
        },
      },
    }));
    await page.goto(`${APP}/signup`);
    await fill(page);
    await submit(page);
    await expect(
      page.getByText(en.validation.too_big.string.replace('{maximum}', '100')),
    ).toBeVisible();
    await expect(page.getByLabel(t.workspace)).toBeFocused();
    await context.close();
  });

  const cases: [string, number, string, string][] = [
    ['too many attempts', 429, 'RATE_LIMITED', en.errors.RATE_LIMITED],
    ['a server error', 500, 'INTERNAL', en.errors.INTERNAL],
    ['an unknown code', 400, 'SOMETHING_NEW', en.errors.UNKNOWN],
  ];
  for (const [name, status, code, text] of cases) {
    test(`shows the message for ${name}`, async ({ browser }) => {
      const { context, api, page } = await signedOut(browser);
      api.answers.set('POST /auth/signup', () => ({
        status,
        body: { error: { code, message: 'x' } },
      }));
      await page.goto(`${APP}/signup`);
      await fill(page);
      await submit(page);
      await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();
      await expect(page.getByRole('button', { name: t.submit })).toBeEnabled();
      await expect(page.getByLabel(t.name)).toHaveValue('Chloe Martin');
      await context.close();
    });
  }

  test('EMAIL_TAKEN in Vietnamese', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser, 'dark', 'vi');
    api.answers.set('POST /auth/signup', () => ({
      status: 409,
      body: { error: { code: 'EMAIL_TAKEN', message: 'x' } },
    }));
    await page.goto(`${APP}/signup`);
    const v = vi.auth.signup;
    await page.getByLabel(v.name).fill('Chloe Martin');
    await page.getByLabel(v.workspace).fill('Harbour');
    await page.getByLabel(v.email).fill('chloe@harbourandpine.com.au');
    await page.getByLabel(v.password, { exact: true }).fill('harbour-pine-2026!');
    await page.getByRole('button', { name: v.submit }).click();
    await expect(page.getByText(vi.errors.EMAIL_TAKEN)).toBeVisible();
    await context.close();
  });
});
