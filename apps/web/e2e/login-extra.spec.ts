import { expect, test, type Page } from '@playwright/test';
import en from '../messages/en.json';
import { API, APP, MockApi, prepare } from './mock-api';

const t = en.auth.login;
const EMAIL = 'daniel@northstargrowth.com';
const PASSWORD = 'Correct-Horse-Battery-9';

async function signedOut(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context, 'dark', 'en');
  const api = new MockApi({ refresh: 'expired', role: 'ADMIN' });
  await api.install(context);
  const page = await context.newPage();
  return { context, api, page };
}

const emailField = (page: Page) => page.getByLabel(t.email);
const passwordField = (page: Page) => page.getByLabel(t.password, { exact: true });

test.describe('login: keyboard and autofill', () => {
  test('Enter in the password field submits once', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    await emailField(page).fill(EMAIL);
    await passwordField(page).fill(PASSWORD);
    await passwordField(page).press('Enter');
    await expect(page).toHaveURL(/\/leads$/);
    expect(api.requests.filter((r) => r.path === '/auth/login')).toHaveLength(1);
    await context.close();
  });

  test('Enter in the email field with an empty password explains it and focuses the password', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    await emailField(page).fill(EMAIL);
    await emailField(page).press('Enter');
    await expect(passwordField(page)).toBeFocused();
    expect(api.requests.some((r) => r.path === '/auth/login')).toBe(false);
    await context.close();
  });

  test('pressing Enter twice quickly sends one request', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    api.answers.set('POST /auth/login', () => null);
    await page.goto(`${APP}/login`);
    await emailField(page).fill(EMAIL);
    await passwordField(page).fill(PASSWORD);
    await passwordField(page).press('Enter');
    await passwordField(page)
      .press('Enter')
      .catch(() => undefined);
    await expect(page).toHaveURL(/\/leads$/);
    expect(api.requests.filter((r) => r.path === '/auth/login')).toHaveLength(1);
    await context.close();
  });

  test('values set by script with input events (browser autofill) are submitted', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    // The page has hydrated once the form has moved the cursor to the email box;
    // values set earlier would not reach React's state.
    await expect(page.locator('input[name="email"]')).toBeFocused();
    await page.evaluate(
      ([email, password]) => {
        const set = (selector: string, value: string) => {
          const input = document.querySelector<HTMLInputElement>(selector)!;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('input[name="email"]', email!);
        set('input[name="password"]', password!);
      },
      [EMAIL, PASSWORD],
    );
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page).toHaveURL(/\/leads$/);
    const login = api.requests.find((r) => r.path === '/auth/login');
    expect(login?.body).toEqual({ email: EMAIL, password: PASSWORD });
    await context.close();
  });

  test('the email is trimmed and lower-cased but the password is sent exactly', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    await emailField(page).fill(`  ${EMAIL.toUpperCase()}  `);
    await passwordField(page).fill('  pass word  ');
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page).toHaveURL(/\/leads$/);
    const login = api.requests.find((r) => r.path === '/auth/login');
    expect(login?.body).toEqual({ email: EMAIL, password: '  pass word  ' });
    await context.close();
  });

  test('the fields have the autocomplete hints password managers need', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    await expect(emailField(page)).toHaveAttribute('autocomplete', 'username');
    await expect(passwordField(page)).toHaveAttribute('autocomplete', 'current-password');
    await context.close();
  });

  test('the email field has the focus when the page opens', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    await page.waitForTimeout(1000);
    await expect(emailField(page)).toBeFocused();
    await context.close();
  });
});

test.describe('login: errors and recovery', () => {
  test('focus goes to the first invalid field, and the error is wired to it', async ({
    browser,
  }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    await emailField(page).fill(EMAIL);
    await page.getByRole('button', { name: t.submit }).click();
    const password = passwordField(page);
    await expect(password).toBeFocused();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(emailField(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect(emailField(page)).not.toHaveAttribute('aria-describedby', /.+/);
    const describedBy = await password.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const error = page.locator(`[id="${describedBy}"]`);
    await expect(error).toHaveText(en.validation.invalid_type);
    await context.close();
  });

  test('with both fields empty the email (first) gets the focus', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    // Move the focus away first so the test sees it being moved back.
    await page.getByRole('link', { name: t.create }).focus();
    await page.getByRole('button', { name: t.submit }).click();
    await expect(emailField(page)).toBeFocused();
    await expect(emailField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(passwordField(page)).toHaveAttribute('aria-invalid', 'true');
    await context.close();
  });

  test('typing after an error does not clear it until the next submit, and a fix clears it', async ({
    browser,
  }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/login`);
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page.getByText(en.validation.invalid_type)).toHaveCount(2);
    await emailField(page).fill(EMAIL);
    await passwordField(page).fill(PASSWORD);
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page).toHaveURL(/\/leads$/);
    await context.close();
  });

  test('a failed login followed by a good one clears the error and signs in', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    let calls = 0;
    api.answers.set('POST /auth/login', () =>
      ++calls === 1
        ? { status: 401, body: { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'x' } } }
        : null,
    );
    await page.goto(`${APP}/login`);
    await emailField(page).fill(EMAIL);
    await passwordField(page).fill('wrong-password');
    await page.getByRole('button', { name: t.submit }).click();
    const alert = page.getByRole('alert').filter({ hasText: en.errors.AUTH_INVALID_CREDENTIALS });
    await expect(alert).toBeVisible();
    await passwordField(page).fill(PASSWORD);
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page).toHaveURL(/\/leads$/);
    expect(calls).toBe(2);
    await context.close();
  });

  test('a server-side validation error is shown under its field', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    api.answers.set('POST /auth/login', () => ({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'x',
          details: [{ path: 'email', code: 'invalid_format', format: 'email' }],
        },
      },
    }));
    await page.goto(`${APP}/login`);
    await emailField(page).fill('nope');
    await passwordField(page).fill(PASSWORD);
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page.getByText(en.validation.invalid_format.email)).toBeVisible();
    await expect(emailField(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(emailField(page)).toBeFocused();
    await context.close();
  });

  test('a lost connection shows the NETWORK message and keeps what was typed', async ({
    browser,
  }) => {
    const { context, page } = await signedOut(browser);
    await page.route(`${API}/auth/login`, (route) => route.abort('connectionrefused'));
    await page.goto(`${APP}/login`);
    await emailField(page).fill(EMAIL);
    await passwordField(page).fill(PASSWORD);
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page.getByRole('alert').filter({ hasText: en.errors.NETWORK })).toBeVisible();
    await expect(emailField(page)).toHaveValue(EMAIL);
    await expect(passwordField(page)).toHaveValue(PASSWORD);
    await expect(page.getByRole('button', { name: t.submit })).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe('/login');
    // And once the connection is back, the same form works.
    await page.unroute(`${API}/auth/login`);
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page).toHaveURL(/\/leads$/);
    await context.close();
  });
});

test.describe('login: /auth/me after a good login', () => {
  for (const [name, answer] of [
    ['a 500', { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }],
    ['a 401', { status: 401, body: { error: { code: 'AUTH_SESSION_EXPIRED', message: 'x' } } }],
    ['bad JSON shape', { status: 200, body: { nonsense: true } }],
  ] as const) {
    test(`still goes to the app when /auth/me answers ${name}`, async ({ browser }) => {
      const { context, api, page } = await signedOut(browser);
      let first = true;
      // Only the first /auth/me (inside the sign-in) fails; the app shell may ask again.
      api.answers.set('GET /auth/me', () => {
        if (!first) return null;
        first = false;
        return answer;
      });
      await page.goto(`${APP}/login`);
      await emailField(page).fill(EMAIL);
      await passwordField(page).fill(PASSWORD);
      await passwordField(page).press('Enter');
      await expect(page).toHaveURL(/\/leads$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.leads.title);
      expect(api.requests.filter((r) => r.path === '/auth/login')).toHaveLength(1);
      await context.close();
    });
  }

  test('a double submit while /auth/me is failing still ends on the app, with one login', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    api.answers.set('GET /auth/me', () => ({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    }));
    // The app shell's own /auth/me will also fail: the page must still not bounce to /login.
    await page.goto(`${APP}/login`);
    await emailField(page).fill(EMAIL);
    await passwordField(page).fill(PASSWORD);
    const button = page.getByRole('button', { name: t.submit });
    await button.dblclick();
    await expect(page).toHaveURL(/\/leads/);
    expect(api.requests.filter((r) => r.path === '/auth/login')).toHaveLength(1);
    await context.close();
  });

  test('a slow /auth/me keeps the form on screen (no flash of a loading screen) until it navigates', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(`${API}/auth/me`, async (route) => {
      if (route.request().method() === 'GET') await gate;
      await route.fallback();
    });
    await page.goto(`${APP}/login`);
    await emailField(page).fill(EMAIL);
    await passwordField(page).fill(PASSWORD);
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page.getByRole('button', { name: t.submitting })).toBeDisabled();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    expect(new URL(page.url()).pathname).toBe('/login');
    release();
    await expect(page).toHaveURL(/\/leads$/);
    expect(api.requests.filter((r) => r.path === '/auth/login')).toHaveLength(1);
    await context.close();
  });
});

test.describe('login: nothing secret leaks', () => {
  test('the email and password never appear in a URL, the console or the page address', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    const seen: string[] = [];
    const consoleLines: string[] = [];
    page.on('console', (m) => consoleLines.push(m.text()));
    page.on('pageerror', (e) => consoleLines.push(e.message));
    page.on('request', (r) => seen.push(r.url()));
    page.on('framenavigated', (f) => seen.push(f.url()));

    // One failed and one good attempt, both with distinctive values.
    const secret = 'Zx9-unique-secret-Qw7';
    const address = 'leak.check@northstargrowth.com';
    let calls = 0;
    api.answers.set('POST /auth/login', () =>
      ++calls === 1
        ? { status: 401, body: { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'x' } } }
        : null,
    );
    await page.goto(`${APP}/login?next=${encodeURIComponent('/settings/team')}`);
    await emailField(page).fill(address);
    await passwordField(page).fill(secret);
    await page.getByRole('button', { name: t.submit }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: en.errors.AUTH_INVALID_CREDENTIALS }),
    ).toBeVisible();
    await page.getByRole('button', { name: t.submit }).click();
    await expect(page).toHaveURL(/\/settings\/team$/);

    for (const url of seen) {
      const decoded = decodeURIComponent(url);
      expect(decoded).not.toContain(secret);
      expect(decoded.toLowerCase()).not.toContain(address);
    }
    for (const line of consoleLines) {
      expect(line).not.toContain(secret);
      expect(line.toLowerCase()).not.toContain(address);
    }
    // The only place the password travelled is the body of the login call.
    expect(JSON.stringify(api.requests.filter((r) => r.path !== '/auth/login'))).not.toContain(
      secret,
    );
    await context.close();
  });

  // A native POST to this page is refused by the server (405): the person sees an error
  // page instead of the form, which is acceptable for a no-JavaScript visit; what matters is
  // that the password is never put in the address bar, history or logs.
  test('a native submit before JavaScript runs does not put the password in the URL', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await prepare(context, 'dark', 'en');
    await new MockApi({ refresh: 'expired' }).install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/login`);
    await emailField(page).fill(EMAIL);
    await passwordField(page).fill('Zx9-unique-secret-Qw7');
    await passwordField(page).press('Enter');
    await page.waitForLoadState('load');
    expect(page.url()).not.toContain('Zx9-unique-secret-Qw7');
    await context.close();
  });
});
