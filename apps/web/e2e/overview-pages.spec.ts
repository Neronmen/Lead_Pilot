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

for (const [theme, lang] of [
  ['dark', 'en'],
  ['light', 'vi'],
] as const) {
  test(`the front page renders correctly (${theme} / ${lang})`, async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER', theme, lang);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${APP}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      messages[lang].landing.hero.title,
    );
    await expect(
      page.getByRole('link', { name: messages[lang].landing.hero.create }).first(),
    ).toHaveAttribute('href', '/signup');
    await checkPage(page);
    expect(errors).toEqual([]);
    if (theme === 'dark') await shot(page, 'landing-dark');
    await context.close();
  });
}

test('the front page fits a phone without sideways scrolling', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  await prepare(context, 'dark', 'en');
  const page = await context.newPage();
  await page.goto(`${APP}/`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await checkPage(page);
  await context.close();
});

test.describe('Import a spreadsheet', () => {
  const t = en.sources.import;

  test('reads a CSV, shows what it found, imports it and says how it went', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/settings/sources`);
    await page.getByRole('button', { name: t.button }).first().click();
    const csv = 'Name,E-mail,Company\nAnn,ann@acme-test.com,Acme\nBob,bob@acme-test.com,Globex\n';
    await page.getByLabel(t.choose).setInputFiles({
      name: 'leads.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await expect(page.getByText('Found 2 rows in 3 columns.')).toBeVisible();
    await page.getByRole('button', { name: 'Import 2 rows' }).click();
    await expect(
      page.getByText(/2 new leads, 0 added to leads you already had, 0 skipped/),
    ).toBeVisible();
    const call = api.requests.find((r) => r.path.endsWith('/import'));
    expect(call?.body).toEqual({
      rows: [
        { Name: 'Ann', 'E-mail': 'ann@acme-test.com', Company: 'Acme' },
        { Name: 'Bob', 'E-mail': 'bob@acme-test.com', Company: 'Globex' },
      ],
    });
    await context.close();
  });

  test('warns when no column looks like an email or phone', async ({ browser }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/settings/sources`);
    await page.getByRole('button', { name: t.button }).first().click();
    await page.getByLabel(t.choose).setInputFiles({
      name: 'x.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('Name,Company\nAnn,Acme\n'),
    });
    await expect(page.getByText(/No column looks like an email/)).toBeVisible();
    await context.close();
  });
});

test.describe('Website form', () => {
  const t = en.sources.webForm;
  const f = en.publicForm;
  const SOURCE = 'dddddddd-0000-4000-8000-000000000001';

  test('turning it on shows the link and the embed code', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/settings/sources`);
    const card = page.getByRole('region', { name: t.title }).first();
    await card.getByRole('button', { name: t.turnOn }).click();
    await expect(card.getByText(t.link)).toBeVisible();
    await expect(card.locator(`code[aria-label="${t.linkLabel}"]`)).toContainText(`/f/${SOURCE}`);
    await expect(card.locator(`code[aria-label="${t.embedLabel}"]`)).toContainText('<iframe');
    expect(api.requests.find((r) => r.method === 'PATCH')?.body).toEqual({ formEnabled: true });
    await context.close();
  });

  test('a visitor fills the public form and sees a thank-you; the trap field stays empty', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/f/${SOURCE}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contact Northstar Growth');
    await page.getByRole('button', { name: f.submit }).click();
    await expect(page.getByText(f.problem.invalid)).toBeVisible();
    await page.getByLabel(f.email, { exact: true }).fill('visitor@acme-test.com');
    await page.getByLabel(f.name).fill('Vera Visitor');
    await page.getByRole('button', { name: f.submit }).click();
    await expect(page.getByRole('heading', { name: f.thanks.title })).toBeVisible();
    const call = api.requests.find((r) => r.method === 'POST' && r.path === `/v1/forms/${SOURCE}`);
    expect(call?.body).toMatchObject({
      email: 'visitor@acme-test.com',
      name: 'Vera Visitor',
      website: '',
    });
    await shot(page, 'public-form');
    await context.close();
  });

  test('a form that is off says so', async ({ browser }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/f/00000000-0000-4000-8000-00000000dead`);
    await expect(page.getByRole('heading', { name: f.unavailable.title })).toBeVisible();
    await context.close();
  });

  test('the public form passes the accessibility check on a phone', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    await prepare(context, 'light', 'vi');
    await new MockApi({ role: 'OWNER' }).install(context);
    const page = await context.newPage();
    await page.goto(`${APP}/f/${SOURCE}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await checkPage(page);
    await context.close();
  });
});

test.describe('Change history', () => {
  const t = en.history;
  const entry = (n: number, area: string, action: string, after: Record<string, string>) => ({
    id: `aaaaaaaa-0000-4000-8000-00000000010${n}`,
    createdAt: new Date(Date.now() - n * 3_600_000).toISOString(),
    area,
    action,
    entityType: 'x',
    entityId: null,
    actor: {
      id: 'bbbbbbbb-0000-4000-8000-000000000001',
      name: 'Daniel Park',
      email: 'daniel@acme-test.com',
    },
    before: null,
    after,
  });
  const seed = (api: MockApi) => {
    api.history = [
      entry(1, 'rules', 'rule.updated', { name: 'Partner leads', enabled: 'false' }),
      entry(2, 'sources', 'source.created', { name: 'Zapier' }),
      entry(3, 'integrations', 'integration.connected', { name: '#hot-leads' }),
    ];
  };

  test('says each change as a sentence, grouped by day, and loads more', async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER', 'dark', 'en', seed);
    await page.goto(`${APP}/settings/history`);
    await expect(page.getByText('Daniel Park changed the rule “Partner leads”.')).toBeVisible();
    await expect(page.getByText('Daniel Park added the source “Zapier”.')).toBeVisible();
    await expect(page.getByText('Daniel Park connected “#hot-leads”.')).toHaveCount(0);
    await page.getByRole('button', { name: t.more }).click();
    await expect(page.getByText('Daniel Park connected “#hot-leads”.')).toBeVisible();
    await shot(page, 'change-history');
    await context.close();
  });

  test('filters by area, and an empty result says so', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER', 'dark', 'en', seed);
    await page.goto(`${APP}/settings/history`);
    await page.getByLabel(t.filter.area).selectOption('team');
    await expect(page.getByText(t.empty.title)).toBeVisible();
    await page.getByLabel(t.filter.area).selectOption('rules');
    await expect(page.getByText('Daniel Park changed the rule “Partner leads”.')).toBeVisible();
    expect(api.requests.some((r) => r.path === '/history')).toBe(true);
    await context.close();
  });

  test('the page passes the accessibility check in Vietnamese and light', async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER', 'light', 'vi', seed);
    await page.goto(`${APP}/settings/history`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(vi.settingsHistory.title);
    await checkPage(page);
    await context.close();
  });
});
