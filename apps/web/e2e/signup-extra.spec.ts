import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import en from '../messages/en.json';
import vi from '../messages/vi.json';
import { APP, MockApi, prepare, type Lang, type Theme } from './mock-api';

const messages = { en, vi };
const t = en.auth.signup;

async function signedOut(
  browser: Browser,
  theme: Theme = 'dark',
  lang: Lang = 'en',
  viewport = { width: 1440, height: 900 },
) {
  const context = await browser.newContext({ viewport });
  await prepare(context, theme, lang);
  const api = new MockApi({ refresh: 'expired', role: 'OWNER' });
  await api.install(context);
  const page = await context.newPage();
  return { context, api, page };
}

type Fields = Partial<Record<'name' | 'workspace' | 'email' | 'password', string>>;
async function fill(page: Page, over: Fields = {}, m = t) {
  await page.getByLabel(m.name).fill(over.name ?? 'Chloe Martin');
  await page.getByLabel(m.workspace).fill(over.workspace ?? 'Harbour & Pine');
  await page.getByLabel(m.email).fill(over.email ?? 'chloe@harbourandpine.com.au');
  await page.getByLabel(m.password, { exact: true }).fill(over.password ?? 'harbour-pine-2026!');
}
const submit = (page: Page) => page.getByRole('button', { name: t.submit }).click();
const signups = (api: MockApi) => api.requests.filter((r) => r.path === '/auth/signup');

/** Filled bars of the password strength meter (aria-hidden spans after the password field). */
const filledBars = (page: Page) => page.locator('form div[aria-hidden="true"] > span.bg-primary');
const allBars = (page: Page) => page.locator('form div[aria-hidden="true"] > span.flex-1');

test.describe('password strength bars', () => {
  const boundaries: [number, number][] = [
    [0, 0],
    [1, 1],
    [11, 1],
    [12, 2],
    [15, 2],
    [16, 3],
    [19, 3],
    [20, 4],
    [128, 4],
    [129, 1],
  ];
  for (const [length, bars] of boundaries) {
    test(`${length} characters -> ${bars} bars`, async ({ browser }) => {
      const { context, page } = await signedOut(browser);
      await page.goto(`${APP}/signup`);
      await page.getByLabel(t.password, { exact: true }).fill('x'.repeat(length));
      await expect(allBars(page)).toHaveCount(4);
      await expect(filledBars(page)).toHaveCount(bars);
      // The hint flips to "good" exactly at the rule (12).
      await expect(
        page.getByText(
          length > 128 ? t.passwordTooLong : length >= 12 ? t.passwordGood : t.passwordHint,
        ),
      ).toBeVisible();
      await context.close();
    });
  }

  test('129 characters: submitting says it is too long', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page, { password: 'x'.repeat(129) });
    await submit(page);
    await expect(
      page.getByText(en.validation.too_big.string.replace('{maximum}', '128')),
    ).toBeVisible();
    expect(signups(api)).toHaveLength(0);
    await context.close();
  });

  // The schema allows at most 128 characters: past that the hint must not say "good".
  test('over 128 characters the hint must not say "good"', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await page.getByLabel(t.password, { exact: true }).fill('x'.repeat(129));
    await expect(page.getByText(t.passwordGood)).toHaveCount(0);
    await context.close();
  });

  // The schema counts code points, so 6 emoji are 6 characters (not 12 UTF-16 units).
  test('multibyte: 6 emoji are 6 characters, not 12', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await page.getByLabel(t.password, { exact: true }).fill('😀'.repeat(6));
    await expect(filledBars(page)).toHaveCount(1);
    await expect(page.getByText(t.passwordHint)).toBeVisible();
    await context.close();
  });

  test('multibyte letters (é x12) count as 12 and are accepted', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page, { password: 'é'.repeat(12) });
    await expect(filledBars(page)).toHaveCount(2);
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)).toHaveLength(1);
    await context.close();
  });
});

test.describe('name and workspace text', () => {
  const bad: [string, string][] = [
    ['a tab', 'Chloe\tMartin'],
    ['a zero-width space', 'Chloe​Martin'],
    ['a NUL byte', 'Chloe\u0000Martin'],
    ['a line separator', 'Chloe Martin'],
    ['only spaces', '     '],
    ['101 characters', 'x'.repeat(101)],
  ];
  for (const [label, value] of bad) {
    for (const key of ['name', 'workspace'] as const) {
      test(`${key} with ${label} is refused without calling the API`, async ({ browser }) => {
        const { context, api, page } = await signedOut(browser);
        await page.goto(`${APP}/signup`);
        await fill(page, { [key]: value });
        await submit(page);
        await expect(page.getByLabel(t[key])).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByLabel(t[key])).toBeFocused();
        expect(signups(api)).toHaveLength(0);
        await context.close();
      });
    }
  }

  test('100 characters, emoji and Vietnamese letters are sent as typed (trimmed)', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page, { name: '  Nguyễn Thị Ánh 😀  ', workspace: 'w'.repeat(100) });
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)[0]?.body).toMatchObject({
      name: 'Nguyễn Thị Ánh 😀',
      workspaceName: 'w'.repeat(100),
    });
    await context.close();
  });

  test('pasting a line break into a name never reaches the API', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page);
    // An <input> strips newlines itself; whatever is left must still be valid or refused.
    await page.getByLabel(t.name).evaluate((el: HTMLInputElement) => {
      el.value = 'Chloe\nMartin';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await submit(page);
    const sent = signups(api)[0]?.body as { name: string } | undefined;
    if (sent) expect(sent.name).not.toMatch(/[\r\n]/);
    await context.close();
  });
});

test.describe('email', () => {
  test('is trimmed and lowercased before it is sent', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page, { email: '  CHLOE@HarbourAndPine.com.au  ' });
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)[0]?.body).toMatchObject({ email: 'chloe@harbourandpine.com.au' });
    await context.close();
  });

  for (const bad of ['a@b', 'a@', '@b.com', 'chloe', 'chloé@harbourandpine.com.au']) {
    test(`${JSON.stringify(bad)} is refused with the email message`, async ({ browser }) => {
      const { context, api, page } = await signedOut(browser);
      await page.goto(`${APP}/signup`);
      await fill(page, { email: bad });
      await submit(page);
      await expect(page.getByText(en.validation.invalid_format.email)).toBeVisible();
      await expect(page.getByLabel(t.email)).toBeFocused();
      expect(signups(api)).toHaveLength(0);
      await context.close();
    });
  }

  test('hint with an uppercase domain', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await page.getByLabel(t.email).fill('Chloe@GMIAL.COM');
    await page.getByLabel(t.name).focus();
    await expect(page.getByRole('status')).toContainText('gmail.com');
    await page
      .getByRole('button', { name: en.emailHint.apply.replace('{suggestion}', 'gmail.com') })
      .click();
    // The local part keeps what was typed; the schema lowercases it on submit.
    await expect(page.getByLabel(t.email)).toHaveValue('Chloe@gmail.com');
    await context.close();
  });

  test('hint then edit: the old hint is gone and a new blur can bring a new one', async ({
    browser,
  }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    const email = page.getByLabel(t.email);
    await email.fill('a@gmial.com');
    await page.getByLabel(t.name).focus();
    await expect(page.getByRole('status')).toHaveCount(1);
    await email.fill('a@yaho.com');
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.getByLabel(t.name).focus();
    await expect(page.getByRole('status')).toContainText('yahoo.com');
    await context.close();
  });

  test('the hint button is reachable from the keyboard and Enter applies it', async ({
    browser,
  }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await page.getByLabel(t.email).fill('a@gmial.com');
    await page.keyboard.press('Tab'); // out of the email box: the hint appears
    await expect(page.getByRole('status')).toHaveCount(1);
    // Focus has already moved on to the password box (the hint renders after the blur);
    // one Shift+Tab goes back to the "Use gmail.com" button, which sits before it.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: /gmail\.com/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel(t.email)).toHaveValue('a@gmail.com');
    await context.close();
  });

  test('typing a typo and pressing Enter (no blur) sends it as typed: no hint is shown', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page, { email: 'chloe@gmial.com' });
    await page.getByLabel(t.email).press('Enter');
    await expect(page).toHaveURL(/\/leads$/);
    // Documented behaviour: a real-looking domain is not blocked; the hint only appears on blur.
    expect(signups(api)[0]?.body).toMatchObject({ email: 'chloe@gmial.com' });
    await context.close();
  });

  test('clicking Create workspace blurs the email: the hint does not stop the submit', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page, { email: 'chloe@gmial.com' });
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)).toHaveLength(1);
    await context.close();
  });
});

test.describe('selects', () => {
  test('offer only the listed values', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    const values = (label: string) =>
      page
        .getByLabel(label)
        .locator('option')
        .evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value));
    expect(await values(t.language)).toEqual(['en', 'vi']);
    expect(await values(t.currency)).toEqual(['USD', 'VND']);
    expect(await values(t.country)).toEqual(['US', 'GB', 'AU', 'DE', 'VN']);
    await context.close();
  });

  test('a value outside the list cannot be selected', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await expect(
      page.getByLabel(t.currency).selectOption('EUR', { timeout: 1000 }),
    ).rejects.toThrow();
    await expect(
      page.getByLabel(t.country).selectOption('FR', { timeout: 1000 }),
    ).rejects.toThrow();
    await context.close();
  });

  test('a tampered value is refused by the schema, not sent', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page);
    await page.getByLabel(t.currency).evaluate((el: HTMLSelectElement) => {
      const o = document.createElement('option');
      o.value = 'EUR';
      el.append(o);
      el.value = 'EUR';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await submit(page);
    expect(signups(api)).toHaveLength(0);
    await expect(page.getByText(en.validation.invalid_value)).toBeVisible();
    await expect(page.getByLabel(t.currency)).toBeFocused();
    await context.close();
  });

  test('every country in the list can be sent (valid codes)', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page);
    await page.getByLabel(t.country).selectOption('DE');
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)[0]?.body).toMatchObject({ defaultCountry: 'DE' });
    await context.close();
  });

  test('country names follow the page language', async ({ browser }) => {
    const { context, page } = await signedOut(browser, 'dark', 'vi');
    await page.goto(`${APP}/signup`);
    await expect(page.getByLabel(vi.auth.signup.country)).toContainText('Việt Nam (+84)');
    await context.close();
  });

  test('switching the language switcher after load does not make the choices jump', async ({
    browser,
  }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page);
    await page.getByLabel(t.currency).selectOption('USD');
    await page.getByRole('button', { name: /^VI/ }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    // What was typed and chosen stays (client state survives the refresh).
    await expect(page.getByLabel(vi.auth.signup.name)).toHaveValue('Chloe Martin');
    await expect(page.getByLabel(vi.auth.signup.currency)).toHaveValue('USD');
    await expect(page.getByLabel(vi.auth.signup.language)).toHaveValue('en');
    await expect(page.getByLabel(vi.auth.signup.country)).toHaveValue('US');
    await context.close();
  });

  test('a Vietnamese page that switches to English before typing keeps VND and VN', async ({
    browser,
  }) => {
    const { context, page } = await signedOut(browser, 'dark', 'vi');
    await page.goto(`${APP}/signup`);
    await page.getByRole('button', { name: /^EN/ }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // Defaults were taken once at load: switching does not re-derive them (no silent jump).
    await expect(page.getByLabel(t.currency)).toHaveValue('VND');
    await expect(page.getByLabel(t.country)).toHaveValue('VN');
    await expect(page.getByLabel(t.language)).toHaveValue('vi');
    await context.close();
  });
});

test.describe('language after sign-up', () => {
  test('a Vietnamese page where English is chosen lands in English', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser, 'dark', 'vi');
    await page.goto(`${APP}/signup`);
    const v = vi.auth.signup;
    await fill(page, {}, v as unknown as typeof t);
    await page.getByLabel(v.language).selectOption('en');
    await page.getByRole('button', { name: v.submit }).click();
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)[0]?.body).toMatchObject({ locale: 'en' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.leads.title);
    await context.close();
  });

  test('an account language wins over the workspace language', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    api.locale = 'en';
    api.answers.set('POST /auth/signup', () => {
      api.workspaceLocale = 'vi';
      return { status: 201, body: { accessToken: 't', expiresIn: 900 } };
    });
    await page.goto(`${APP}/signup`);
    await fill(page);
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.leads.title);
    await context.close();
  });

  test('when /auth/me fails the sign-up still completes', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    let me = 0;
    api.answers.set('GET /auth/me', () =>
      me++ === 0 ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } } : null,
    );
    await page.goto(`${APP}/signup`);
    await fill(page);
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)).toHaveLength(1);
    await context.close();
  });
});

test.describe('errors and repeated sends', () => {
  test('EMAIL_TAKEN, then a new address: the error clears and the second send works', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    let calls = 0;
    api.answers.set('POST /auth/signup', () =>
      calls++ === 0
        ? { status: 409, body: { error: { code: 'EMAIL_TAKEN', message: 'x' } } }
        : null,
    );
    await page.goto(`${APP}/signup`);
    await fill(page);
    await submit(page);
    await expect(page.getByText(en.errors.EMAIL_TAKEN)).toBeVisible();
    await page.getByLabel(t.email).fill('chloe2@harbourandpine.com.au');
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)).toHaveLength(2);
    await context.close();
  });

  test('the same error twice moves focus back each time', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    api.answers.set('POST /auth/signup', () => ({
      status: 409,
      body: { error: { code: 'EMAIL_TAKEN', message: 'x' } },
    }));
    await page.goto(`${APP}/signup`);
    await fill(page);
    await submit(page);
    await expect(page.getByLabel(t.email)).toBeFocused();
    await page.getByLabel(t.name).focus();
    await submit(page);
    await expect(page.getByLabel(t.email)).toBeFocused();
    expect(signups(api)).toHaveLength(2);
    await context.close();
  });

  test('a server error then a retry sends the same data twice and succeeds', async ({
    browser,
  }) => {
    const { context, api, page } = await signedOut(browser);
    let calls = 0;
    api.answers.set('POST /auth/signup', () =>
      calls++ === 0 ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } } : null,
    );
    await page.goto(`${APP}/signup`);
    await fill(page);
    await submit(page);
    await expect(page.getByRole('alert').filter({ hasText: en.errors.INTERNAL })).toBeVisible();
    await submit(page);
    await expect(page).toHaveURL(/\/leads$/);
    const [first, second] = signups(api);
    expect(second?.body).toEqual(first?.body);
    await context.close();
  });

  // `busy` is state: two submits dispatched before React re-renders must still send one request.
  test('two submit events in the same tick send one request', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page);
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)).toHaveLength(1);
    await context.close();
  });

  test('Enter pressed twice quickly sends one request', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page);
    await page.getByLabel(t.password, { exact: true }).press('Enter');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)).toHaveLength(1);
    await context.close();
  });
});

test.describe('keyboard and screen reader', () => {
  test('Tab order follows the visual order and Enter submits', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await expect(page.getByLabel(t.name)).toBeFocused();
    const order: string[] = [];
    const current = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return el.getAttribute('name') ?? el.getAttribute('aria-label') ?? el.textContent ?? '';
      });
    const typed = [
      'Chloe Martin',
      'Harbour & Pine',
      'chloe@harbourandpine.com.au',
      'harbour-pine-2026!',
    ];
    for (const text of typed) {
      order.push(await current());
      await page.keyboard.type(text);
      await page.keyboard.press('Tab');
    }
    // After the password: the show/hide button, then the three selects, then Submit.
    for (let i = 0; i < 4; i++) {
      order.push(await current());
      await page.keyboard.press('Tab');
    }
    order.push(await current());
    expect(order).toEqual([
      'name',
      'workspaceName',
      'email',
      'password',
      en.auth.showPassword,
      'locale',
      'currency',
      'defaultCountry',
      t.submit,
    ]);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)).toHaveLength(1);
    await context.close();
  });

  test('Enter in the password box submits', async ({ browser }) => {
    const { context, api, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    await fill(page);
    await page.getByLabel(t.password, { exact: true }).press('Enter');
    await expect(page).toHaveURL(/\/leads$/);
    expect(signups(api)).toHaveLength(1);
    await context.close();
  });

  test('show/hide password toggles the type and keeps the value', async ({ browser }) => {
    const { context, page } = await signedOut(browser);
    await page.goto(`${APP}/signup`);
    const input = page.getByLabel(t.password, { exact: true });
    await input.fill('harbour-pine-2026!');
    await page.getByRole('button', { name: en.auth.showPassword }).click();
    await expect(input).toHaveAttribute('type', 'text');
    await expect(input).toHaveValue('harbour-pine-2026!');
    await expect(page.getByRole('button', { name: en.auth.hidePassword })).toBeVisible();
    await context.close();
  });

  for (const lang of ['en', 'vi'] as const) {
    test(`form controls have unique accessible names (${lang})`, async ({ browser }) => {
      const { context, page } = await signedOut(browser, 'dark', lang);
      await page.goto(`${APP}/signup`);
      const names = await page.locator('form').evaluate((form) => {
        const out: string[] = [];
        for (const el of form.querySelectorAll<HTMLElement>('input,select,button,a')) {
          const label = el.getAttribute('aria-label');
          const id = el.getAttribute('id');
          const forLabel = id ? form.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
          out.push((label ?? forLabel?.textContent ?? el.textContent ?? '').trim());
        }
        return out;
      });
      const dupes = names.filter((n, i) => names.indexOf(n) !== i);
      expect(dupes).toEqual([]);
      expect(names.every((n) => n.length > 0)).toBe(true);
      await context.close();
    });

    test(`every control is tied to a visible label and errors are described (${lang})`, async ({
      browser,
    }) => {
      const { context, page } = await signedOut(browser, 'dark', lang);
      await page.goto(`${APP}/signup`);
      await page.getByRole('button', { name: messages[lang].auth.signup.submit }).click();
      const bad = await page.locator('form [aria-invalid="true"]').evaluateAll((els) =>
        els.map((el) => {
          const ids = (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
          return ids.length > 0 && ids.every((id) => document.getElementById(id)?.textContent);
        }),
      );
      expect(bad.length).toBeGreaterThanOrEqual(3);
      expect(bad.every(Boolean)).toBe(true);
      await context.close();
    });
  }
});

const sizes = [
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '390', width: 390, height: 844 },
];
const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const size of sizes) {
  for (const theme of ['dark', 'light'] as const) {
    for (const lang of ['en', 'vi'] as const) {
      test(`${size.name}px ${theme}/${lang}: axe clean, no horizontal overflow, also with errors`, async ({
        browser,
      }) => {
        const { context, page } = await signedOut(browser, theme, lang, size);
        await page.goto(`${APP}/signup`);
        const axe = () =>
          new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const report = (r: Awaited<ReturnType<typeof axe>>) =>
          r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join('; ')}`);
        expect(report(await axe())).toEqual([]);
        expect(await overflowOf(page)).toBeLessThanOrEqual(0);

        // Errors (longest Vietnamese messages) must not widen the page or break contrast.
        await page.getByRole('button', { name: messages[lang].auth.signup.submit }).click();
        await expect(page.locator('form [aria-invalid="true"]').first()).toBeVisible();
        expect(report(await axe())).toEqual([]);
        expect(await overflowOf(page)).toBeLessThanOrEqual(0);
        await context.close();
      });
    }
  }
}

test('at 390px the long email-taken and field errors stay inside the viewport', async ({
  browser,
}) => {
  const { context, api, page } = await signedOut(browser, 'dark', 'vi', {
    width: 390,
    height: 844,
  });
  api.answers.set('POST /auth/signup', () => ({
    status: 409,
    body: { error: { code: 'EMAIL_TAKEN', message: 'x' } },
  }));
  await page.goto(`${APP}/signup`);
  const v = vi.auth.signup;
  await fill(page, { email: 'chloe@harbourandpine.com.au' }, v as unknown as typeof t);
  await page.getByRole('button', { name: v.submit }).click();
  await expect(page.getByText(vi.errors.EMAIL_TAKEN)).toBeVisible();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await context.close();
});
