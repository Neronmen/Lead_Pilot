import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../messages/en.json';
import vi from '../messages/vi.json';
import { APP, MockApi, prepare, type Lang, type Role, type Theme } from './mock-api';

const messages = { en, vi };
const SHOTS = join(__dirname, 'screenshots');
mkdirSync(SHOTS, { recursive: true });

/** Collects what the page logs as an error, so a test can assert there was none. */
function watchErrors(page: Page, expected?: RegExp): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (expected && expected.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

// ---------------------------------------------------------------------------
// The screens, in dark/light x English/Vietnamese
// ---------------------------------------------------------------------------

interface Screen {
  name: string;
  path: string;
  role?: Role;
  refresh?: 'ok' | 'down';
  heading: (m: typeof en) => string;
}

const SCREENS: Screen[] = [
  { name: 'leads', path: '/leads', role: 'OWNER', heading: (m) => m.leads.title },
  {
    name: 'settings-team',
    path: '/settings/team',
    role: 'ADMIN',
    heading: (m) => m.settingsTeam.title,
  },
  {
    name: 'no-access-member',
    path: '/settings/team',
    role: 'MEMBER',
    heading: (m) => m.noAccess.title,
  },
  {
    name: 'api-unavailable',
    path: '/leads',
    refresh: 'down',
    heading: (m) => m.session.unavailableTitle,
  },
];

const THEMES: Theme[] = ['dark', 'light'];
const LANGS: Lang[] = ['en', 'vi'];

for (const theme of THEMES) {
  for (const lang of LANGS) {
    test.describe(`${theme} / ${lang}`, () => {
      for (const screen of SCREENS) {
        test(`${screen.name} renders correctly`, async ({ browser }) => {
          const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
          await prepare(context, theme, lang);
          await new MockApi({ role: screen.role, refresh: screen.refresh }).install(context);
          const page = await context.newPage();
          // The browser logs the mocked 503 itself: expected on the "API down" screen only.
          const errors = watchErrors(page, screen.refresh === 'down' ? /503/ : undefined);

          await page.goto(`${APP}${screen.path}`);
          const h1 = page.getByRole('heading', { level: 1 });
          await expect(h1).toHaveText(screen.heading(messages[lang] as typeof en));

          // The theme and language really applied.
          await expect(page.locator('html')).toHaveAttribute('lang', lang);
          await expect(page.locator('html')).toHaveClass(
            theme === 'dark' ? /(^|\s)dark(\s|$)/ : /^((?!\bdark\b).)*$/,
          );

          // Nothing spills sideways, and no placeholder text leaked into the page.
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
          const text = await page.locator('body').innerText();
          expect(text).not.toMatch(/\[object Object\]|\bundefined\b|\bNaN\b/);

          // Contrast and the other WCAG A/AA rules axe can check automatically.
          const axe = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
          expect(
            axe.violations.map(
              (v) =>
                `${v.id}: ${v.nodes
                  .map((n) => `${n.target.join(' ')} (${n.failureSummary?.replace(/\s+/g, ' ')})`)
                  .join('; ')}`,
            ),
          ).toEqual([]);

          expect(errors).toEqual([]);
          await page.screenshot({ path: join(SHOTS, `${theme}-${lang}-${screen.name}.png`) });
          await context.close();
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

test.describe('session', () => {
  test('a signed-out visitor is sent to /login and comes back to the page they wanted', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    await new MockApi({ refresh: 'expired' }).install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/settings/team`);
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fteam$/);
    await context.close();
  });

  test('when the API is down the person stays signed in and can retry', async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    const api = new MockApi({ refresh: 'down' });
    await api.install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/leads`);
    await expect(page.getByRole('heading', { name: en.session.unavailableTitle })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/leads');
    await page.screenshot({ path: join(SHOTS, 'dark-en-unavailable.png') });

    api.refresh = 'ok';
    await page.getByRole('button', { name: en.common.tryAgain }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.leads.title);
    await context.close();
  });

  test('sign out calls the API and leaves for /login', async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    const api = new MockApi({ role: 'ADMIN' });
    await api.install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/settings/team`);
    await page.getByRole('button', { name: en.shell.account }).click();
    await page.getByRole('menuitem', { name: en.shell.signOut }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(api.logoutCalls).toBe(1);
    await context.close();
  });
});

test.describe('roles', () => {
  const nav = (page: Page) => page.getByRole('navigation', { name: en.shell.navLabel });

  test('an admin sees Settings, a member does not', async ({ browser }) => {
    for (const [role, sees] of [
      ['OWNER', true],
      ['ADMIN', true],
      ['MEMBER', false],
    ] as const) {
      const context = await browser.newContext();
      await prepare(context, 'dark', 'en');
      await new MockApi({ role }).install(context);
      const page = await context.newPage();
      await page.goto(`${APP}/leads`);
      await expect(nav(page).getByRole('link', { name: en.shell.nav.leads })).toBeVisible();
      await expect(nav(page).getByRole('link', { name: en.shell.nav.settings })).toHaveCount(
        sees ? 1 : 0,
      );
      await context.close();
    }
  });

  test('a member sees the no-access page on every Settings address, and its link works', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    await new MockApi({ role: 'MEMBER' }).install(context);
    const page = await context.newPage();
    for (const path of ['/settings', '/settings/team']) {
      await page.goto(`${APP}${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.noAccess.title);
      // The page behind it is not rendered at all.
      await expect(page.getByText(en.settingsTeam.sub)).toHaveCount(0);
    }
    await page.getByRole('link', { name: en.noAccess.back }).click();
    await expect(page).toHaveURL(/\/leads$/);
    await context.close();
  });
});

test.describe('theme and language', () => {
  test('language switch changes the page, is remembered, and is saved on the account', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    const api = new MockApi();
    await api.install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/leads`);
    await page.getByRole('button', { name: /^VI\s/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(vi.leads.title);
    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    await expect.poll(() => api.patches).toEqual([{ locale: 'vi' }]);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(vi.leads.title);
    await context.close();
  });

  test('theme toggle switches, is remembered, and a reload shows no flash of the other theme', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    await new MockApi().install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/leads`);
    await page.getByRole('button', { name: en.theme.toLight }).click();
    await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);
    expect(await page.evaluate(() => localStorage.getItem('lp-theme'))).toBe('light');

    // Reload, recording every value `<html class>` takes from the first moment
    // it exists. Not only the final value: a flash is a wrong value that lasts a moment.
    await page.addInitScript(() => {
      const w = window as unknown as { __classes: string[]; __atFirstFrame?: string };
      const seen: string[] = [];
      w.__classes = seen;
      const start = () => {
        const html = document.documentElement;
        if (!html) return false;
        seen.push(html.className);
        new MutationObserver(() => seen.push(html.className)).observe(html, {
          attributes: true,
          attributeFilter: ['class'],
        });
        return true;
      };
      // An init script runs before <html> exists: wait for it.
      if (!start()) {
        const waiting = new MutationObserver(() => start() && waiting.disconnect());
        waiting.observe(document, { childList: true });
      }
      // What the browser is about to paint in its very first frame.
      requestAnimationFrame(() => {
        w.__atFirstFrame = document.documentElement.className;
      });
    });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const result = await page.evaluate(() => {
      const w = window as unknown as { __classes: string[]; __atFirstFrame?: string };
      return { seen: w.__classes, atFirstFrame: w.__atFirstFrame };
    });
    expect(result.seen.length).toBeGreaterThan(0);
    expect(result.atFirstFrame, 'class at the first frame').toBeDefined();
    expect(result.atFirstFrame).not.toMatch(/(^|\s)dark(\s|$)/);
    expect(result.seen.at(-1)).not.toMatch(/(^|\s)dark(\s|$)/);
    await context.close();
  });
});

test.describe('two tabs', () => {
  test('two tabs loading at once never refresh at the same time', async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    const api = new MockApi({ refreshDelayMs: 2000 });
    await api.install(context);
    const [a, b] = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all([a.goto(`${APP}/leads`), b.goto(`${APP}/leads`)]);
    await expect(a.getByRole('heading', { level: 1 })).toHaveText(en.leads.title);
    await expect(b.getByRole('heading', { level: 1 })).toHaveText(en.leads.title);
    expect(api.overlaps, 'refreshes that overlapped').toBe(0);
    // Both tabs really went through the refresh path (one may reuse the other's token).
    expect(api.refreshCalls).toBeGreaterThanOrEqual(1);
    await context.close();
  });

  test('NEGATIVE CONTROL: without the lock the same two tabs do overlap', async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    // Pretend this browser has no Web Locks API.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    });
    const api = new MockApi({ refreshDelayMs: 2000 });
    await api.install(context);
    const [a, b] = await Promise.all([context.newPage(), context.newPage()]);
    await Promise.all([a.goto(`${APP}/leads`), b.goto(`${APP}/leads`)]);
    await expect(a.getByRole('heading', { level: 1 })).toHaveText(en.leads.title);
    expect(api.overlaps).toBeGreaterThan(0);
    await context.close();
  });

  test('signing out in one tab signs the other out', async ({ browser }) => {
    const context = await browser.newContext();
    await prepare(context, 'dark', 'en');
    await new MockApi().install(context);
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto(`${APP}/leads`);
    await b.goto(`${APP}/leads`);
    await expect(b.getByRole('heading', { level: 1 })).toHaveText(en.leads.title);
    await a.getByRole('button', { name: en.shell.account }).click();
    await a.getByRole('menuitem', { name: en.shell.signOut }).click();
    await expect(b).toHaveURL(/\/login/);
    await context.close();
  });
});

test.describe('phone width', () => {
  test('the menu opens a drawer with the pages, closes on navigation and on Escape', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await prepare(context, 'dark', 'en');
    await new MockApi({ role: 'ADMIN' }).install(context);
    const page = await context.newPage();
    const errors = watchErrors(page);
    await page.goto(`${APP}/leads`);

    // No fixed sidebar, no sideways scroll.
    await expect(page.getByRole('navigation', { name: en.shell.navLabel })).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: join(SHOTS, 'dark-en-mobile-leads.png') });

    await page.getByRole('button', { name: en.shell.menu }).click();
    const drawer = page.getByRole('dialog', { name: en.shell.menuTitle });
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: join(SHOTS, 'dark-en-mobile-drawer.png') });

    await drawer.getByRole('link', { name: en.shell.nav.settings }).click();
    await expect(page).toHaveURL(/\/settings\/team$/);
    await expect(drawer).toHaveCount(0);

    await page.getByRole('button', { name: en.shell.menu }).click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  test('growing the window past the breakpoint closes an open drawer', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 800, height: 900 } });
    await prepare(context, 'dark', 'en');
    await new MockApi().install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/leads`);
    await page.getByRole('button', { name: en.shell.menu }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The page is usable again (not aria-hidden, not scroll-locked).
    await expect(page.getByRole('navigation', { name: en.shell.navLabel })).toBeVisible();
    await context.close();
  });
});
