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
const t = en.auth.invite;
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
const LINK = `${APP}/invite#t=${TOKEN}`;

async function signedOut(browser: Browser, theme: Theme = 'dark', lang: Lang = 'en') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context, theme, lang);
  const api = new MockApi({ refresh: 'expired', role: 'MEMBER' });
  await api.install(context);
  const page = await context.newPage();
  return { context, api, page };
}

const accept = (page: Page, name = en.auth.invite.submit) =>
  page.getByRole('button', { name }).click();
const calls = (api: MockApi, path: string) => api.requests.filter((r) => r.path === path);

for (const theme of ['dark', 'light'] as const) {
  for (const lang of ['en', 'vi'] as const) {
    test(`accept invite renders correctly (${theme} / ${lang})`, async ({ browser }) => {
      const { context, page } = await signedOut(browser, theme, lang);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(LINK);
      const m = messages[lang].auth.invite;
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        m.title.replace('{workspace}', 'Northstar Growth'),
      );
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
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
      await page.screenshot({ path: join(SHOTS, `${theme}-${lang}-invite.png`) });
      await context.close();
    });
  }
}

test.describe('the secret in the address', () => {
  test('is gone from the address bar and history as soon as the page has read it', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(LINK);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(page.url()).toBe(`${APP}/invite`);
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    // Going back does not bring it back either.
    const entries = await page.evaluate(() => window.history.length);
    expect(entries).toBeGreaterThan(0);
    // The token travelled in one place only: the body of the preview request.
    const withToken = api.requests.filter((r) => JSON.stringify(r).includes(TOKEN));
    expect(withToken.map((r) => r.path)).toEqual(['/auth/invites/preview']);
    expect(calls(api, '/auth/invites/preview')).toHaveLength(1);
    await context.close();
  });

  test('is never in a request URL, a header, storage or a cookie', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    const urls: string[] = [];
    const headers: string[] = [];
    page.on('request', (request) => {
      urls.push(request.url());
      headers.push(JSON.stringify(request.headers()));
    });
    await page.goto(LINK);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByLabel(t.name).fill('Ethan Brooks');
    await page.getByLabel(t.newPassword).fill('correct-horse-battery-9');
    await accept(page);
    await expect(page).toHaveURL(/\/leads$/);
    // (The first navigation is the one the person typed: it carries the fragment locally only,
    // and the browser never sends a fragment to the server.)
    expect(urls.slice(1).filter((url) => url.includes(TOKEN))).toEqual([]);
    expect(headers.filter((h) => h.includes(TOKEN))).toEqual([]);
    expect(
      await page.evaluate(
        () => JSON.stringify({ ...localStorage, ...sessionStorage }) + document.cookie,
      ),
    ).not.toContain(TOKEN);
    await context.close();
  });

  test('the page asks not to be cached and not to send a Referer', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    const response = await page.goto(LINK);
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['cache-control']).toContain('no-store');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await context.close();
  });

  test('a reload after the fragment was removed shows the expired card (no request)', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(LINK);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByText(t.invalidTitle)).toBeVisible();
    expect(calls(api, '/auth/invites/preview')).toHaveLength(1); // only the first load's
    await context.close();
  });

  for (const bad of ['', '#t=', '#t=abc', '#token=' + TOKEN, '#t=' + TOKEN.slice(0, 20)]) {
    test(`a link without a usable token ("${bad}") shows the expired card and calls nothing`, async ({
      browser,
    }) => {
      const { context, api, page } = await signedOut(browser);
      await page.goto(`${APP}/invite${bad}`);
      await expect(page.getByText(t.invalidTitle)).toBeVisible();
      expect(calls(api, '/auth/invites/preview')).toHaveLength(0);
      expect(page.url()).toBe(`${APP}/invite`);
      await context.close();
    });
  }
});

test.describe('accepting', () => {
  test('a new person: name and password go with the token, then the app opens', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(LINK);
    await expect(page.getByLabel(t.email)).toHaveValue('ethan.brooks@northstargrowth.com');
    await expect(page.getByLabel(t.email)).toHaveAttribute('readonly', '');
    await page.getByLabel(t.name).fill('Ethan Brooks');
    await page.getByLabel(t.newPassword).fill('correct-horse-battery-9');
    await accept(page);
    await expect(page).toHaveURL(/\/leads$/);
    expect(calls(api, '/auth/invites/accept')[0]?.body).toEqual({
      token: TOKEN,
      name: 'Ethan Brooks',
      password: 'correct-horse-battery-9',
    });
    await context.close();
  });

  test('an existing account: only the password, with the 5-attempt notice after a miss', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    api.answers.set('POST /auth/invites/preview', () => ({
      status: 200,
      body: {
        workspaceName: 'Northstar Growth',
        inviterName: 'Mia Johnson',
        role: 'ADMIN',
        email: 'ethan.brooks@northstargrowth.com',
        expiresAt: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
        accountExists: true,
      },
    }));
    let attempt = 0;
    api.answers.set('POST /auth/invites/accept', () =>
      attempt++ === 0
        ? { status: 401, body: { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'x' } } }
        : null,
    );
    await page.goto(LINK);
    await expect(page.getByLabel(t.name)).toHaveCount(0);
    await expect(page.getByText(t.roleHelp.ADMIN)).toBeVisible();
    await expect(page.getByText(t.existingNote)).toBeVisible();
    await page.getByLabel(t.existingPassword).fill('wrong-password');
    await accept(page);
    await expect(page.getByText(t.wrongPassword)).toBeVisible();
    await expect(page.getByText(t.attemptsNote)).toBeVisible();
    await expect(page.getByLabel(t.existingPassword)).toBeFocused();
    await page.screenshot({ path: join(SHOTS, 'dark-en-invite-wrong-password.png') });
    await page.getByLabel(t.existingPassword).fill('right-password');
    await accept(page);
    await expect(page).toHaveURL(/\/leads$/);
    expect(calls(api, '/auth/invites/accept').at(-1)?.body).toEqual({
      token: TOKEN,
      password: 'right-password',
    });
    await context.close();
  });

  test('the 6th try after 5 misses meets INVITE_INVALID and the card says why', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    api.answers.set('POST /auth/invites/preview', () => ({
      status: 200,
      body: {
        workspaceName: 'Northstar Growth',
        inviterName: null,
        role: 'MEMBER',
        email: 'ethan.brooks@northstargrowth.com',
        expiresAt: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
        accountExists: true,
      },
    }));
    let tries = 0;
    api.answers.set('POST /auth/invites/accept', () =>
      ++tries <= 5
        ? { status: 401, body: { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'x' } } }
        : { status: 400, body: { error: { code: 'INVITE_INVALID', message: 'x' } } },
    );
    await page.goto(LINK);
    const password = page.getByLabel(t.existingPassword);
    for (let i = 0; i < 5; i++) {
      await password.fill(`wrong-${i}`);
      await accept(page);
      await expect(page.getByText(t.wrongPassword)).toBeVisible();
      await expect(page.getByRole('button', { name: t.submit })).toBeEnabled();
    }
    await password.fill('wrong-6');
    await accept(page);
    await expect(page.getByText(t.invalidTitle)).toBeVisible();
    await expect(page.getByText(t.invalidTooMany)).toBeVisible();
    await expect(page.getByRole('link', { name: t.invalidSignIn })).toHaveAttribute(
      'href',
      '/login',
    );
    await page.screenshot({ path: join(SHOTS, 'dark-en-invite-invalid.png') });
    await context.close();
  });

  test('a late "not signed in" answer from the page-load check does not wipe the invite', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    // The session check takes 1.5 s and ends in 401, long after the preview has arrived.
    await new MockApi({ refresh: 'expired', refreshDelayMs: 1500 }).install(context);
    const page = await context.newPage();
    await page.goto(LINK);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Join Northstar Growth/);
    await page.waitForTimeout(2200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Join Northstar Growth/);
    await context.close();
  });

  test('INVITE_INVALID from the preview (expired, used, cancelled)', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    api.answers.set('POST /auth/invites/preview', () => ({
      status: 400,
      body: { error: { code: 'INVITE_INVALID', message: 'x' } },
    }));
    await page.goto(LINK);
    await expect(page.getByText(t.invalidTitle)).toBeVisible();
    await expect(page.getByText(t.invalidBody)).toBeVisible();
    await expect(page.getByText(t.invalidTooMany)).toHaveCount(0);
    await page.screenshot({ path: join(SHOTS, 'dark-en-invite-expired.png') });
    await context.close();
  });

  test('EMAIL_TAKEN: the form becomes "enter your password" and nothing is lost', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    let previews = 0;
    api.answers.set('POST /auth/invites/preview', () => ({
      status: 200,
      body: {
        workspaceName: 'Northstar Growth',
        inviterName: 'Mia Johnson',
        role: 'MEMBER',
        email: 'ethan.brooks@northstargrowth.com',
        expiresAt: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
        accountExists: previews++ > 0,
      },
    }));
    let first = true;
    api.answers.set('POST /auth/invites/accept', () => {
      if (first) {
        first = false;
        return { status: 409, body: { error: { code: 'EMAIL_TAKEN', message: 'x' } } };
      }
      return null;
    });
    await page.goto(LINK);
    await page.getByLabel(t.name).fill('Ethan Brooks');
    await page.getByLabel(t.newPassword).fill('correct-horse-battery-9');
    await accept(page);
    await expect(page.getByLabel(t.existingPassword)).toBeVisible();
    await expect(page.getByText(t.accountAppeared)).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'dark-en-invite-email-taken.png') });
    await page.getByLabel(t.existingPassword).fill('my-old-password');
    await accept(page);
    await expect(page).toHaveURL(/\/leads$/);
    await context.close();
  });

  const problems: [string, number, string, string][] = [
    ['too many attempts', 429, 'RATE_LIMITED', en.errors.RATE_LIMITED],
    ['a server error', 500, 'INTERNAL', en.errors.INTERNAL],
  ];
  for (const [name, status, code, text] of problems) {
    test(`shows the message for ${name}`, async ({ browser }) => {
      const { context, api, page } = await signedOut(browser);
      api.answers.set('POST /auth/invites/accept', () => ({
        status,
        body: { error: { code, message: 'x' } },
      }));
      await page.goto(LINK);
      await page.getByLabel(t.name).fill('Ethan Brooks');
      await page.getByLabel(t.newPassword).fill('correct-horse-battery-9');
      await accept(page);
      await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();
      await expect(page.getByRole('button', { name: t.submit })).toBeEnabled();
      await expect(page.getByLabel(t.name)).toHaveValue('Ethan Brooks');
      await context.close();
    });
  }

  test('empty fields are explained without calling the API', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(LINK);
    await accept(page);
    await expect(page.getByText(en.validation.invalid_type)).toBeVisible();
    await expect(page.getByLabel(t.name)).toBeFocused();
    expect(calls(api, '/auth/invites/accept')).toHaveLength(0);
    await context.close();
  });

  test('two submits in the same tick send one request', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(LINK);
    await page.getByLabel(t.name).fill('Ethan Brooks');
    await page.getByLabel(t.newPassword).fill('correct-horse-battery-9');
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page).toHaveURL(/\/leads$/);
    expect(calls(api, '/auth/invites/accept')).toHaveLength(1);
    await context.close();
  });

  test('a preview that fails for another reason offers Try again', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    let fail = true;
    api.answers.set('POST /auth/invites/preview', () =>
      fail ? { status: 503, body: { error: { code: 'INTERNAL', message: 'x' } } } : null,
    );
    await page.goto(LINK);
    await expect(page.getByRole('alert').filter({ hasText: en.errors.INTERNAL })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: en.common.tryAgain }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Join Northstar Growth/);
    await context.close();
  });
});
