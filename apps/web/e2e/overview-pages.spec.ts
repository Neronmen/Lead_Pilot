import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../messages/en.json';
import vi from '../messages/vi.json';
import { APP, MockApi, prepare, type Lang, type Role, type Theme } from './mock-api';

const SHOTS = join(__dirname, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const messages = { en, vi };

async function open(
  browser: Browser,
  role: Role = 'OWNER',
  theme: Theme = 'dark',
  lang: Lang = 'en',
  seed: (api: MockApi) => void = () => undefined,
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context, theme, lang);
  const api = new MockApi({ role });
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
    axe.violations.map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary}`).join('; ')}`,
    ),
  ).toEqual([]);
}

for (const [theme, lang] of [
  ['dark', 'vi'],
  ['light', 'en'],
] as const) {
  test(`overview renders correctly (${theme} / ${lang})`, async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER', theme, lang);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${APP}/overview`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(messages[lang].overview.title);
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    await checkPage(page);
    expect(errors).toEqual([]);
    if (theme === 'dark' && lang === 'vi') await shot(page, 'overview-vi-dark');
    await context.close();
  });
}

test.describe('Overview', () => {
  const t = en.overview;

  test('shows what LeadPilot did: leads, junk filtered, time to rating, tiers', async ({
    browser,
  }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/overview`);
    await expect(page.getByText('120', { exact: true })).toBeVisible();
    await expect(page.getByText('19%', { exact: true })).toBeVisible();
    await expect(page.getByText('12 seconds', { exact: true })).toBeVisible();
    await expect(page.getByText('41 · 35%')).toBeVisible();
    await shot(page, 'overview');
    await context.close();
  });

  test('before any lead arrives it says so and points to Lead sources', async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER', 'dark', 'en', (api) => {
      api.overview = { ...api.overview, leads: 0, rated: 0, junkPercent: null as never };
    });
    await page.goto(`${APP}/overview`);
    await expect(page.getByText(t.empty.title)).toBeVisible();
    await expect(page.getByRole('link', { name: t.empty.cta })).toBeVisible();
    await context.close();
  });

  test('a load error can be retried', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    let fail = true;
    api.answers.set('GET /overview', () =>
      fail ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } } : null,
    );
    await page.goto(`${APP}/overview`);
    await expect(page.getByText(t.loadTitle)).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: t.retry }).click();
    await expect(page.getByText('120', { exact: true })).toBeVisible();
    await context.close();
  });
});

test.describe('Get started', () => {
  const t = en.getStarted;

  test('shows what is done and what is not, with a link for each step', async ({ browser }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/overview`);
    await expect(page.getByRole('heading', { name: t.title })).toBeVisible();
    await expect(
      page.getByText(t.progress.replace('{done}', '1').replace('{total}', '3')),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: t.change })).toHaveAttribute(
      'href',
      '/settings/sources',
    );
    await expect(page.getByRole('link', { name: t.go }).first()).toHaveAttribute(
      'href',
      '/settings/ideal-customer',
    );
    await shot(page, 'get-started');
    await context.close();
  });

  test('goes away once all three steps are done', async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER', 'dark', 'en', (api) => {
      api.rubric = {
        industries: ['Logistics'],
        companySizes: [],
        countries: ['US'],
        budgetSignals: [],
        disqualifiers: [],
        notes: null,
      };
      api.integrations = [
        {
          id: 'ffffffff-0000-4000-8000-000000000001',
          type: 'SLACK',
          name: '#hot',
          enabled: true,
          status: 'connected',
          lastError: null,
          lastTestedAt: null,
          summary: null,
          createdAt: new Date().toISOString(),
        },
      ];
      api.rules = [
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          name: 'Hot',
          order: 1,
          conditions: { match: 'all', conditions: [] },
          actions: [{ type: 'tag', tag: 'x' }],
          enabled: true,
          alwaysRun: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
    });
    await page.goto(`${APP}/overview`);
    await expect(page.getByText('120', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: t.title })).toHaveCount(0);
    await context.close();
  });

  test('a Member sees the numbers but no checklist, and the page never asks for admin data', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser, 'MEMBER');
    await page.goto(`${APP}/overview`);
    await expect(page.getByText('120', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: t.title })).toHaveCount(0);
    expect(
      api.requests.some((r) => ['/sources', '/icp-rubric', '/integrations'].includes(r.path)),
    ).toBe(false);
    await context.close();
  });
});

test.describe('Send a sample lead', () => {
  const t = en.sources.sample;

  test('makes a sample lead and links to the list', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/settings/sources`);
    await page.getByRole('button', { name: t.button }).first().click();
    await expect(page.getByText(t.sent)).toBeVisible();
    await expect(page.getByRole('link', { name: t.open })).toHaveAttribute('href', '/leads');
    expect(api.requests.some((r) => r.method === 'POST' && r.path.endsWith('/sample-lead'))).toBe(
      true,
    );
    await context.close();
  });
});
