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
const ANN = 'eeeeeeee-0000-4000-8000-000000000089';
// Oldest waiting first: sam@gmail.com (3 h ago), then Nguyễn Văn An (2 h ago).
const NEEDS_REVIEW = 'eeeeeeee-0000-4000-8000-000000000087';

async function open(
  browser: Browser,
  role: Role = 'OWNER',
  theme: Theme = 'dark',
  lang: Lang = 'en',
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await prepare(context, theme, lang);
  const api = new MockApi({ role });
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
  { id: 'lead-detail', url: `${APP}/leads/${ANN}`, h1: () => 'Ann Lee', h1vi: () => 'Ann Lee' },
  {
    id: 'review',
    url: `${APP}/review`,
    h1: (m: typeof en) => m.review.title,
    h1vi: (m: typeof vi) => m.review.title,
  },
  {
    id: 'ideal-customer',
    url: `${APP}/settings/ideal-customer`,
    h1: (m: typeof en) => m.settingsIdeal.title,
    h1vi: (m: typeof vi) => m.settingsIdeal.title,
  },
] as const;

for (const { id, url } of PAGES) {
  for (const [theme, lang] of [
    ['dark', 'vi'],
    ['light', 'en'],
  ] as const) {
    test(`${id} renders correctly (${theme} / ${lang})`, async ({ browser }) => {
      const { context, page } = await open(browser, 'OWNER', theme, lang);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (id === 'lead-detail') {
        await expect(
          page.getByRole('heading', { name: messages[lang].leadDetail.disagree }),
        ).toBeVisible();
      }
      if (id === 'review')
        await expect(page.getByRole('heading', { name: 'sam@gmail.com', level: 2 })).toBeVisible();
      await checkPage(page);
      expect(errors).toEqual([]);
      if (theme === 'dark' && lang === 'vi') await shot(page, `${id}-vi-dark`);
      await context.close();
    });
  }
}

test.describe('Lead detail', () => {
  const t = en.leadDetail;

  test('explains the rating in plain words, with the timeline newest first', async ({
    browser,
  }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/leads/${ANN}`);
    await expect(page.getByRole('heading', { name: 'Why it’s Hot' })).toBeVisible();
    await expect(page.getByText('Uses a company email address.')).toBeVisible();
    await expect(page.getByText('How sure the AI is: 91%')).toBeVisible();
    await expect(page.getByText(/When is a good time for a short call/)).toBeVisible();
    const items = page.getByRole('listitem').filter({ hasText: /Rated|Looked up|Received/ });
    await expect(items).toHaveText([
      /Rated Hot \(88\) by the AI/,
      /Looked up acme\.com/,
      /Received a submission/,
    ]);
    await expect(page.getByText(t.technical)).toBeVisible(); // Owner sees technical details
    await context.close();
  });

  test('"Disagree with the AI?" sends the new rating and the note, and says it was saved', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/leads/${ANN}`);
    await page.getByLabel('Cold').check();
    await page.getByLabel(t.note).fill('A student, not a buyer');
    await page.getByRole('button', { name: t.saveRating }).click();
    await expect(page.getByRole('status').filter({ hasText: t.saved })).toBeVisible();
    const sent = api.requests.find((r) => r.path.endsWith('/review'));
    expect(sent?.body).toEqual({
      action: 'override',
      tier: 'COLD',
      note: 'A student, not a buyer',
    });
    await context.close();
  });

  test('shows what they said, how much information we have, and records Won / Lost / Bad lead', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/leads/${ANN}`);
    await expect(page.getByRole('heading', { name: t.said })).toBeVisible();
    await expect(page.getByText(/We need a tracking tool for our drivers/)).toBeVisible();
    await expect(page.getByText('$10k-20k')).toBeVisible();
    await expect(page.getByText('Head of Logistics')).toBeVisible();
    await expect(page.getByText(t.infoLevel.enough)).toBeVisible();

    await page.getByRole('button', { name: t.outcome.bad, exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: t.outcome.saved })).toBeVisible();
    expect(api.requests.find((r) => r.path === `/leads/${ANN}/outcome`)?.body).toEqual({
      outcome: 'BAD',
    });
    await expect(page.getByRole('button', { name: t.outcome.bad, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText(/Set by Daniel Park/)).toBeVisible();
    await page.getByRole('button', { name: t.outcome.clear }).click();
    await expect(page.getByRole('button', { name: t.outcome.bad, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await context.close();
  });

  test('a lead that is not found, a member (no technical details), and an error', async ({
    browser,
  }) => {
    const missing = await open(browser);
    await missing.page.goto(`${APP}/leads/00000000-0000-4000-8000-00000000dead`);
    await expect(missing.page.getByRole('heading', { name: t.notFoundTitle })).toBeVisible();
    await missing.context.close();

    const member = await open(browser, 'MEMBER');
    await member.page.goto(`${APP}/leads/${ANN}`);
    await expect(member.page.getByRole('heading', { name: 'Why it’s Hot' })).toBeVisible();
    await expect(member.page.getByText(t.technical)).toHaveCount(0);
    await member.context.close();

    const broken = await open(browser);
    broken.api.answers.set(`GET /leads/${ANN}`, () => ({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    }));
    await broken.page.goto(`${APP}/leads/${ANN}`);
    await expect(broken.page.getByRole('heading', { name: t.loadTitle })).toBeVisible();
    await broken.context.close();
  });
});

test.describe('Review queue', () => {
  const t = en.review;

  test('shows the oldest waiting lead first and moves on after Approve (button and key A)', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/review`);
    await expect(page.getByRole('heading', { name: 'sam@gmail.com', level: 2 })).toBeVisible();
    await expect(page.getByRole('meter')).toHaveAttribute('aria-valuenow', '35');
    await page.getByRole('button', { name: new RegExp(`^${t.approve}`) }).click();
    await expect(page.getByRole('heading', { name: 'Nguyễn Văn An', level: 2 })).toBeVisible();
    expect(api.requests.find((r) => r.path === `/leads/${NEEDS_REVIEW}/review`)?.body).toEqual({
      action: 'approve',
    });
    await page.keyboard.press('a');
    await expect(page.getByRole('heading', { name: t.emptyTitle })).toBeVisible();
    await expect(page.getByText('2 reviewed in this session')).toBeVisible();
    await context.close();
  });

  test('keys 1-4 set the rating, S skips, and typing in the note does not trigger keys', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/review`);
    await expect(page.getByRole('heading', { name: 'sam@gmail.com', level: 2 })).toBeVisible();
    await page.keyboard.press('s');
    await expect(page.getByRole('heading', { name: 'Nguyễn Văn An', level: 2 })).toBeVisible();
    await page.getByLabel(t.note).fill('as 1 2 3 4');
    expect(api.requests.some((r) => r.path.endsWith('/review'))).toBe(false);
    await page.getByLabel(t.note).blur();
    await page.keyboard.press('4');
    await expect
      .poll(() => api.requests.find((r) => r.path.endsWith('/review'))?.body)
      .toEqual({
        action: 'override',
        tier: 'JUNK',
        note: 'as 1 2 3 4',
      });
    await context.close();
  });

  test('says in plain words why a lead is waiting for a person', async ({ browser }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/review`);
    await expect(page.getByText(en.leadDetail.reviewReasons.limited_info)).toBeVisible(); // sam: limited
    await page.keyboard.press('s');
    await expect(page.getByText(en.leadDetail.reviewReasons.low_confidence)).toBeVisible(); // An
    await context.close();
  });

  test('empty and error states; a conflict says someone else was first', async ({ browser }) => {
    const empty = await open(browser);
    empty.api.leads = [];
    await empty.page.goto(`${APP}/review`);
    await expect(empty.page.getByRole('heading', { name: t.emptyTitle })).toBeVisible();
    await empty.context.close();

    const broken = await open(browser);
    broken.api.answers.set('GET /leads', () => ({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    }));
    await broken.page.goto(`${APP}/review`);
    await expect(broken.page.getByRole('heading', { name: t.loadTitle })).toBeVisible();
    await broken.context.close();

    const raced = await open(browser, 'MEMBER');
    raced.api.answers.set(`POST /leads/${NEEDS_REVIEW}/review`, () => ({
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'x' } },
    }));
    await raced.page.goto(`${APP}/review`);
    await raced.page.getByRole('button', { name: new RegExp(`^${t.approve}`) }).click();
    await expect(raced.page.getByRole('alert').filter({ hasText: t.conflict })).toBeVisible();
    await raced.context.close();
  });
});

test.describe('Ideal customer', () => {
  const t = en.ideal;

  test('add phrases with Enter or Add, remove them, save, and ask for a second look', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/settings/ideal-customer`);
    await page.getByLabel(t.industries).fill('Logistics');
    await page.getByLabel(t.industries).press('Enter'); // must not submit the form
    expect(api.requests.some((r) => r.method === 'PUT')).toBe(false);
    await page.getByLabel(t.industries).fill('Retail');
    await page.getByRole('button', { name: t.add }).first().click();
    await page.getByRole('button', { name: 'Remove Retail' }).click();

    await page.getByLabel(t.countries).fill('vietnam');
    await page.getByLabel(t.countries).press('Enter');
    await expect(page.getByText(t.badCountry)).toBeVisible();
    await page.getByLabel(t.countries).fill('vn');
    await page.getByLabel(t.countries).press('Enter');
    await page.getByLabel(t.notes).fill('We sell to teams.');
    await page.getByLabel(t.rescore).check();
    await page.getByRole('button', { name: t.save }).click();

    await expect(page.getByRole('status')).toContainText(t.saved);
    await expect(page.getByRole('status')).toContainText('queued for another look');
    expect(api.requests.find((r) => r.method === 'PUT')?.body).toEqual({
      industries: ['Logistics'],
      companySizes: [],
      countries: ['VN'],
      budgetSignals: [],
      disqualifiers: [],
      notes: 'We sell to teams.',
    });
    expect(api.requests.some((r) => r.path === '/leads/rescore')).toBe(true);
    await context.close();
  });

  test('a member cannot open it; an error can be retried', async ({ browser }) => {
    const member = await open(browser, 'MEMBER');
    await member.page.goto(`${APP}/settings/ideal-customer`);
    await expect(member.page.getByRole('heading', { name: en.noAccess.title })).toBeVisible();
    expect(member.api.requests.some((r) => r.path === '/icp-rubric')).toBe(false);
    await member.context.close();

    const broken = await open(browser);
    let failing = true;
    broken.api.answers.set('GET /icp-rubric', () =>
      failing ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } } : null,
    );
    await broken.page.goto(`${APP}/settings/ideal-customer`);
    await expect(broken.page.getByRole('heading', { name: t.loadTitle })).toBeVisible();
    failing = false;
    await broken.page.getByRole('button', { name: t.retry }).click();
    await expect(broken.page.getByLabel(t.industries)).toBeVisible();
    await broken.context.close();
  });
});
