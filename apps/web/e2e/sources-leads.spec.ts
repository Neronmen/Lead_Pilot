import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import en from '../messages/en.json';
import vi from '../messages/vi.json';
import {
  APP,
  MockApi,
  prepare,
  type Lang,
  type MockLead,
  type MockOptions,
  type Role,
  type Theme,
} from './mock-api';

const SHOTS = join(__dirname, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const messages = { en, vi };

async function open(
  browser: Browser,
  role: Role = 'OWNER',
  theme: Theme = 'dark',
  lang: Lang = 'en',
  options: MockOptions = {},
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context, theme, lang);
  const api = new MockApi({ role, ...options });
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

const PAGES = [
  { id: 'sources', url: `${APP}/settings/sources`, h1: (m: typeof en) => m.settingsSources.title },
  {
    id: 'advanced',
    url: `${APP}/settings/advanced`,
    h1: (m: typeof en) => m.settingsAdvanced.title,
  },
  { id: 'leads', url: `${APP}/leads`, h1: (m: typeof en) => m.leads.title },
] as const;

for (const { id, url, h1 } of PAGES) {
  for (const [theme, lang] of [
    ['dark', 'vi'],
    ['light', 'en'],
  ] as const) {
    test(`${id} renders correctly (${theme} / ${lang})`, async ({ browser }) => {
      const { context, page } = await open(browser, 'OWNER', theme, lang);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(h1(messages[lang]));
      if (id === 'leads') await expect(page.getByRole('table')).toBeVisible();
      else await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      await checkPage(page);
      expect(errors).toEqual([]);
      if (theme === 'dark' && lang === 'vi') await shot(page, `${id}-vi-dark`);
      await context.close();
    });
  }
}

test.describe('Lead sources', () => {
  const t = en.sources;

  test('shows a plain status per source, with a website form and a spreadsheet import', async ({
    browser,
  }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/settings/sources`);
    await expect(page.getByText('Working · 487 leads in the last 30 days')).toBeVisible();
    await expect(page.getByText(/Quiet · no leads for 20 days/)).toBeVisible();
    // The numbers add up, and repeated sends are labelled apart.
    await expect(
      page.getByText('Last 30 days: 560 submissions = 487 new + 61 merged + 12 rejected'),
    ).toBeVisible();
    await expect(
      page.getByText(/throwaway email address \(7\), phone number not valid \(3\)/),
    ).toBeVisible();
    await expect(page.getByText(/4 repeated sends were answered again/)).toBeVisible();
    // What each source sends, in plain words.
    await expect(
      page.getByText(
        /This source sends: name, email,? and phone \(3 of 8 useful fields\)\. Add company, message, budget,? and timeline to improve ratings\./,
      ),
    ).toBeVisible();
    await page.getByText(en.sources.help.title).click();
    await expect(page.getByText(/never merged by mistake/)).toBeVisible();
    await page.getByRole('button', { name: t.add }).click();
    await expect(page.getByRole('radio')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await context.close();
  });

  test('creating a source shows its key once, and it is gone after Done', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/settings/sources`);
    await page.getByRole('button', { name: t.add }).click();
    await page.getByRole('button', { name: t.form.create }).click();
    await expect(page.getByText(t.form.empty)).toBeVisible(); // a name is needed
    await page.getByLabel(t.form.name).fill('Make – partner referrals');
    await page.getByRole('button', { name: t.form.create }).click();
    await expect(
      page.getByRole('heading', { name: 'Make – partner referrals is ready' }),
    ).toBeVisible();
    await expect(page.getByLabel(t.ready.keyLabel, { exact: true })).toContainText('lp_0a1b2c3d.');
    expect(api.requests.find((r) => r.method === 'POST' && r.path === '/sources')?.body).toEqual({
      name: 'Make – partner referrals',
      type: 'WEBHOOK',
    });
    await page.getByRole('button', { name: t.ready.done }).click();
    await expect(page.getByText('lp_0a1b2c3d.')).toHaveCount(0);
    await expect(page.getByText('Make – partner referrals')).toBeVisible();
    await context.close();
  });

  test('switching off and deleting ask first and say what happened', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/settings/sources`);
    const card = page.getByRole('listitem').filter({ hasText: 'Livestorm' });
    await card.getByRole('button', { name: t.actions.switchOff }).click();
    await expect(card.getByText(/Switched off/)).toBeVisible();
    await card.getByRole('button', { name: t.actions.delete }).click();
    await expect(card.getByRole('alertdialog')).toContainText('Livestorm');
    await card.getByRole('button', { name: t.actions.confirmYes }).click();
    await expect(page.getByText('Livestorm')).toHaveCount(0);
    expect(api.sources).toHaveLength(1);
    await context.close();
  });

  test('has empty, loading and error states; a refused delete explains why', async ({
    browser,
  }) => {
    const empty = await open(browser);
    empty.api.sources = [];
    await empty.page.goto(`${APP}/settings/sources`);
    await expect(empty.page.getByRole('heading', { name: t.empty.title })).toBeVisible();
    await expect(empty.page.getByRole('button', { name: t.empty.cta })).toBeVisible();
    await empty.context.close();

    const slow = await open(browser);
    slow.api.delays.set('GET /sources', 1500);
    await slow.page.goto(`${APP}/settings/sources`);
    await expect(
      slow.page.locator('[aria-hidden] .animate-pulse, [aria-hidden]').first(),
    ).toBeAttached();
    await expect(slow.page.getByText('Zapier – website leads')).toBeVisible();
    await slow.context.close();

    const broken = await open(browser);
    broken.api.answers.set('GET /sources', () => ({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    }));
    await broken.page.goto(`${APP}/settings/sources`);
    await expect(broken.page.getByRole('heading', { name: t.loadTitle })).toBeVisible();
    await broken.context.close();

    const refused = await open(browser);
    refused.api.answers.set('DELETE /sources/dddddddd-0000-4000-8000-000000000001', () => ({
      status: 409,
      body: { error: { code: 'SOURCE_HAS_LEADS', message: 'x' } },
    }));
    await refused.page.goto(`${APP}/settings/sources`);
    const card = refused.page.getByRole('listitem').filter({ hasText: 'Zapier' });
    await card.getByRole('button', { name: t.actions.delete }).click();
    await card.getByRole('button', { name: t.actions.confirmYes }).click();
    // 409 is the "it changed meanwhile" notice; the leads rule is shown by its own code.
    await expect(refused.page.getByRole('alert').first()).toBeVisible();
    await refused.context.close();
  });
});

test.describe('Advanced / Developer', () => {
  const t = en.advanced;

  test('a new key and a signing secret are shown once, after a warning', async ({ browser }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/settings/advanced`);
    const card = page.getByRole('region', { name: 'Zapier – website leads' });
    await expect(card.getByLabel(t.url, { exact: true })).toContainText(
      'http://localhost:3999/v1/ingest/dddddddd-',
    );
    await expect(card.getByText('Authorization: Bearer YOUR_API_KEY')).toBeVisible();
    await expect(card.getByText(/lp_a1b2c3d4\./)).toBeVisible(); // the prefix only

    await card.getByRole('button', { name: t.newKey }).click();
    await expect(card.getByRole('alertdialog')).toContainText('stops working right away');
    await card.getByRole('button', { name: t.newKeyYes }).click();
    await expect(card.getByLabel(t.key, { exact: true }).last()).toContainText('lp_ffeeddcc.');

    await card.getByRole('button', { name: t.signingEnable }).click();
    await expect(card.getByLabel(t.signing, { exact: true })).toContainText('whsec_');
    await expect(card.getByText('YOUR_SIGNING_SECRET')).toBeVisible(); // the signed example appears

    await page.reload();
    await expect(page.getByText('lp_ffeeddcc.NEW')).toHaveCount(0);
    await expect(page.getByText('whsec_')).toHaveCount(0);
    await context.close();
  });
});

test.describe('Leads list', () => {
  const t = en.leads;

  test('shows rows without tier or score, flags free email, and truncates nothing off-screen', async ({
    browser,
  }) => {
    const { context, page } = await open(browser);
    const consoleProblems: string[] = [];
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) consoleProblems.push(message.text());
    });
    await page.goto(`${APP}/leads`);
    await expect(page.getByRole('row')).toHaveCount(6); // header + 5
    // Relative times use an explicit clock: no next-intl ENVIRONMENT_FALLBACK in the console.
    expect(consoleProblems.filter((text) => text.includes('ENVIRONMENT_FALLBACK'))).toEqual([]);
    await expect(page.getByRole('columnheader')).toHaveText([
      t.colLead,
      t.colRating,
      t.colCompany,
      t.colSource,
      t.colStatus,
      t.colAdded,
    ]);
    // Ratings show with their tier name (colour is never the only signal).
    await expect(page.getByRole('row').filter({ hasText: 'Ann Lee' })).toContainText('Hot');
    await expect(page.getByRole('row').filter({ hasText: 'Tom Becker' })).toContainText('Failed');
    await expect(page.getByRole('row').filter({ hasText: 'sam@gmail.com' })).toContainText(
      t.freeBadge,
    );
    await expect(page.getByRole('row').filter({ hasText: 'Ann Lee' })).toContainText('Scored');
    await expect(page.getByRole('row').filter({ hasText: 'Ann Lee' })).toContainText(
      'Sent 3 times',
    );
    await expect(page.getByRole('row').filter({ hasText: 'sam@gmail.com' })).toContainText(
      t.possibleDuplicate,
    );
    await context.close();
  });

  test('searches, filters and clears; a search with no match says so', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/leads`);
    await page.getByLabel(t.search).fill('100% pure');
    await expect(page.getByRole('heading', { name: t.noMatchTitle })).toBeVisible();
    expect(api.requests.some((r) => r.path === '/leads')).toBe(true);
    await page.getByRole('button', { name: t.clear }).first().click();
    await expect(page.getByRole('row')).toHaveCount(6);

    await page.getByLabel(t.status).selectOption('NEEDS_REVIEW');
    await expect(page.getByRole('row')).toHaveCount(3);
    await page.getByLabel(t.status).selectOption('');
    await page.getByLabel(t.email).selectOption('true');
    await expect(page.getByRole('row')).toHaveCount(2);
    await expect(page.getByLabel(t.source)).toBeVisible(); // Owner sees the source filter
    await context.close();
  });

  test('shows 25 at a time with Previous / Next and a page size, so the list never grows without end', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    const base = api.leads[0]!;
    api.leads = Array.from({ length: 30 }, (_, i): MockLead => ({
      ...base,
      id: `eeeeeeee-0000-4000-8000-0000000001${String(99 - i).padStart(2, '0')}`,
      email: `lead${i}@example.com`,
      name: `Lead ${i}`,
    }));
    await page.goto(`${APP}/leads`);
    await expect(page.getByRole('row')).toHaveCount(26); // header + 25
    await expect(page.getByText('Showing 1–25')).toBeVisible();
    await expect(page.getByRole('button', { name: t.pager.prev })).toBeDisabled();
    await page.getByRole('button', { name: t.pager.next }).click();
    await expect(page.getByText('Showing 26–30')).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(6); // header + 5
    await expect(page.getByRole('button', { name: t.pager.next })).toBeDisabled();
    await page.getByRole('button', { name: t.pager.prev }).click();
    await expect(page.getByText('Showing 1–25')).toBeVisible();
    // A bigger page shows everything at once and goes back to page 1.
    await page.getByLabel(t.pager.size).selectOption('50');
    await expect(page.getByRole('row')).toHaveCount(31);
    await expect(page.getByRole('button', { name: t.pager.next })).toBeDisabled();
    await context.close();
  });

  test('empty: an admin is pointed to sources, a member is not; error can retry', async ({
    browser,
  }) => {
    const admin = await open(browser);
    admin.api.leads = [];
    await admin.page.goto(`${APP}/leads`);
    await expect(admin.page.getByRole('link', { name: t.connect })).toHaveAttribute(
      'href',
      '/settings/sources',
    );
    await admin.context.close();

    const member = await open(browser, 'MEMBER');
    member.api.leads = [];
    await member.page.goto(`${APP}/leads`);
    await expect(member.page.getByRole('heading', { name: t.emptyTitle })).toBeVisible();
    await expect(member.page.getByRole('link', { name: t.connect })).toHaveCount(0);
    expect(member.api.requests.some((r) => r.path === '/sources')).toBe(false);
    await member.context.close();

    const broken = await open(browser);
    let failing = true;
    broken.api.answers.set('GET /leads', () =>
      failing ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } } : null,
    );
    await broken.page.goto(`${APP}/leads`);
    await expect(broken.page.getByRole('heading', { name: t.loadTitle })).toBeVisible();
    failing = false;
    await broken.page.getByRole('button', { name: t.retry }).click();
    await expect(broken.page.getByRole('table')).toBeVisible();
    await broken.context.close();
  });
});
