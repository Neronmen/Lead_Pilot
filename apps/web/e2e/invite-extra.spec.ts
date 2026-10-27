import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import en from '../messages/en.json';
import vi from '../messages/vi.json';
import { APP, MockApi, prepare, type Lang, type Theme } from './mock-api';

const messages = { en, vi };
const t = en.auth.invite;
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
const OTHER = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-ZyXwV';
const LINK = `${APP}/invite#t=${TOKEN}`;

async function open(
  browser: Browser,
  options: {
    theme?: Theme;
    lang?: Lang;
    width?: number;
    refresh?: 'ok' | 'expired';
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1440, height: options.width ? 844 : 900 },
  });
  await prepare(context, options.theme ?? 'dark', options.lang ?? 'en');
  const api = new MockApi({ refresh: options.refresh ?? 'expired', role: 'MEMBER' });
  await api.install(context);
  const page = await context.newPage();
  return { context, api, page };
}
const calls = (api: MockApi, path: string) => api.requests.filter((r) => r.path === path);
const previewBody = (over: Record<string, unknown> = {}) => ({
  workspaceName: 'Northstar Growth',
  inviterName: 'Mia Johnson',
  role: 'MEMBER',
  email: 'ethan.brooks@northstargrowth.com',
  expiresAt: new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString(),
  accountExists: false,
  ...over,
});

async function expectNoAxeViolations(page: Page) {
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

type State = 'loading' | 'new' | 'existing' | 'invalid' | 'noToken' | 'error';
async function arrange(api: MockApi, state: State) {
  if (state === 'loading') {
    api.answers.set('POST /auth/invites/preview', () => ({ status: 200, body: previewBody() }));
  }
  if (state === 'existing') {
    api.answers.set('POST /auth/invites/preview', () => ({
      status: 200,
      body: previewBody({ accountExists: true, role: 'ADMIN' }),
    }));
  }
  if (state === 'invalid') {
    api.answers.set('POST /auth/invites/preview', () => ({
      status: 400,
      body: { error: { code: 'INVITE_INVALID', message: 'x' } },
    }));
  }
  if (state === 'error') {
    api.answers.set('POST /auth/invites/preview', () => ({
      status: 503,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    }));
  }
}

for (const width of [390, 1440]) {
  for (const theme of ['dark', 'light'] as const) {
    for (const lang of ['en', 'vi'] as const) {
      for (const state of ['loading', 'new', 'existing', 'invalid', 'noToken', 'error'] as const) {
        test(`axe + no overflow: ${state} (${theme}/${lang}/${width}px)`, async ({ browser }) => {
          const { context, api, page } = await open(browser, { theme, lang, width });
          await arrange(api, state);
          if (state === 'loading') {
            // Hold the answer so the skeleton stays on screen while axe runs.
            await context.unroute(`http://localhost:3999/**`);
            await context.route('http://localhost:3999/**', async (route) => {
              if (route.request().url().endsWith('/auth/invites/preview')) {
                await new Promise((r) => setTimeout(r, 4000));
              }
              await route.fulfill({
                status: 401,
                headers: { 'access-control-allow-origin': APP },
                json: { error: { code: 'AUTH_SESSION_EXPIRED', message: 'x' } },
              });
            });
          }
          await page.goto(state === 'noToken' ? `${APP}/invite` : LINK);
          const m = messages[lang].auth.invite;
          if (state === 'loading') {
            await expect(page.getByRole('status')).toBeVisible();
          } else if (state === 'invalid' || state === 'noToken') {
            await expect(page.getByRole('heading', { level: 1 })).toHaveText(m.invalidTitle);
          } else if (state === 'error') {
            await expect(
              page.getByRole('button', { name: messages[lang].common.tryAgain }),
            ).toBeVisible();
          } else {
            await expect(page.getByRole('heading', { level: 1 })).toContainText('Northstar Growth');
          }
          await expectNoAxeViolations(page);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow).toBeLessThanOrEqual(0);
          await context.close();
        });
      }
    }
  }
}

test.describe('headings', () => {
  // The retry state is the one invite state with no <h1>.
  test('the retry state has an h1', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await arrange(api, 'error');
    await page.goto(LINK);
    await expect(page.getByRole('button', { name: en.common.tryAgain })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1, { timeout: 1000 });
    await context.close();
  });
});

test.describe('navigation and history', () => {
  test('Link to /login and Back to /invite keeps the form without a new preview call', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    await page.goto(LINK);
    await expect(page.getByLabel(t.name)).toBeVisible();
    await page.getByRole('link', { name: t.signIn }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/invite$/);
    await expect(page.getByLabel(t.name)).toBeVisible();
    expect(calls(api, '/auth/invites/preview')).toHaveLength(1);
    await context.close();
  });

  test('window focus / tab visibility do not refetch the preview', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(LINK);
    await expect(page.getByLabel(t.name)).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const other = await context.newPage();
    await other.goto(`${APP}/status`);
    await page.bringToFront();
    await page.waitForTimeout(500);
    expect(calls(api, '/auth/invites/preview')).toHaveLength(1);
    await context.close();
  });

  test('after accepting, Back does not return to a working invite form', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/status`);
    await page.goto(LINK);
    await page.getByLabel(t.name).fill('Ethan Brooks');
    await page.getByLabel(t.newPassword).fill('correct-horse-battery-9');
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page).toHaveURL(/\/leads$/);
    await page.goBack();
    // router.replace swapped /invite for /leads, so Back lands before the invite.
    await expect(page).toHaveURL(/\/status$/);
    expect(calls(api, '/auth/invites/accept')).toHaveLength(1);
    await context.close();
  });

  // Known gap: pasting a second invite link into a tab that is already on /invite is a
  // hash-only navigation (no reload). The module-level token memo keeps the FIRST token and
  // the query key is constant, so the new link is ignored and the old preview is shown.
  test('a second invite link pasted into the same tab is used', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(LINK);
    await expect(page.getByLabel(t.name)).toBeVisible();
    await page.evaluate((token) => {
      window.location.hash = `t=${token}`;
    }, OTHER);
    await expect.poll(() => calls(api, '/auth/invites/preview').length, { timeout: 2000 }).toBe(2);
    expect(calls(api, '/auth/invites/preview')[1]?.body).toEqual({ token: OTHER });
    await context.close();
  });

  test('a fragment with a query string: query kept, fragment removed, token used', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/invite?ref=mail&utm=x#t=${TOKEN}`);
    await expect(page.getByLabel(t.name)).toBeVisible();
    expect(page.url()).toBe(`${APP}/invite?ref=mail&utm=x`);
    expect(calls(api, '/auth/invites/preview')[0]?.body).toEqual({ token: TOKEN });
    await context.close();
  });

  test('a percent-encoded token and an extra fragment parameter work', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/invite#x=1&t=${TOKEN.replace('-', '%2D')}`);
    await expect(page.getByLabel(t.name)).toBeVisible();
    expect(calls(api, '/auth/invites/preview')[0]?.body).toEqual({ token: TOKEN });
    await context.close();
  });

  for (const bad of [`#/t=${TOKEN}`, `#T=${TOKEN}`, `#t=%20${TOKEN}`, `#t=${'a'.repeat(5000)}`]) {
    test(`unusable fragment ${bad.slice(0, 14)}... shows the expired card, no request`, async ({
      browser,
    }) => {
      const { context, api, page } = await open(browser);
      await page.goto(`${APP}/invite${bad}`);
      await expect(page.getByText(t.invalidTitle)).toBeVisible();
      expect(calls(api, '/auth/invites/preview')).toHaveLength(0);
      await context.close();
    });
  }
});

test.describe('someone already signed in', () => {
  test('opening an invite shows the form (no bounce) and accepting ends on /leads', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser, { refresh: 'ok' });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(LINK);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Northstar Growth');
    await expect(page).toHaveURL(/\/invite$/);
    await page.getByLabel(t.name).fill('Ethan Brooks');
    await page.getByLabel(t.newPassword).fill('correct-horse-battery-9');
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page).toHaveURL(/\/leads$/);
    // The new session's identity is loaded after the accept call, never before.
    const order = api.requests.map((r) => r.path);
    expect(order.indexOf('/auth/me')).toBeGreaterThan(order.indexOf('/auth/invites/accept'));
    expect(errors).toEqual([]);
    await context.close();
  });
});

test.describe('no JavaScript', () => {
  test('a native submit never puts the password in the address', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await prepare(context, 'dark', 'en');
    await new MockApi({ refresh: 'expired' }).install(context);
    const page = await context.newPage();
    await page.goto(LINK);
    // Without JS only the loading card is rendered: there is no form to submit at all.
    await expect(page.locator('form')).toHaveCount(0);
    expect(page.url()).not.toContain('password');
    await context.close();
  });
});

test.describe('Vietnamese wording', () => {
  test('the form reads in Vietnamese with a Vietnamese expiry', async ({ browser }) => {
    const { context, page } = await open(browser, { lang: 'vi' });
    await page.goto(LINK);
    const m = vi.auth.invite;
    await expect(page.getByLabel(m.name)).toBeVisible();
    await expect(page.getByText(m.roleHelp.MEMBER)).toBeVisible();
    await expect(page.getByText(/^Hết hạn .*ngày/)).toBeVisible();
    await expect(page.getByRole('button', { name: m.submit })).toBeVisible();
    await context.close();
  });
});
