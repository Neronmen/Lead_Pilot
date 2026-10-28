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
  type MockAction,
  type MockIntegration,
  type MockRule,
  type Role,
  type Theme,
} from './mock-api';

const SHOTS = join(__dirname, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const messages = { en, vi };
const ANN = 'eeeeeeee-0000-4000-8000-000000000089';
const SLACK_ID = 'ffffffff-0000-4000-8000-000000000001';

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

const now = () => new Date().toISOString();
const rule = (over: Partial<MockRule> & Pick<MockRule, 'id' | 'name' | 'order'>): MockRule => ({
  conditions: { match: 'all', conditions: [{ field: 'tier', op: 'is', value: 'hot' }] },
  actions: [{ type: 'email', template: 'hot_lead', to: 'owner' }],
  enabled: true,
  alwaysRun: false,
  createdAt: now(),
  updatedAt: now(),
  ...over,
});
const slack = (over: Partial<MockIntegration> = {}): MockIntegration => ({
  id: SLACK_ID,
  type: 'SLACK',
  name: '#hot-leads',
  enabled: true,
  status: 'connected',
  lastError: null,
  lastTestedAt: null,
  summary: 'hooks.slack.com',
  createdAt: now(),
  ...over,
});
const seeded = (api: MockApi) => {
  api.integrations = [slack()];
  api.rules = [
    rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      name: 'Hot leads',
      order: 1,
      actions: [
        { type: 'tag', tag: 'vip' },
        { type: 'slack', integrationId: SLACK_ID },
        { type: 'email', template: 'hot_lead', to: 'owner' },
      ],
    }),
    rule({
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      name: 'Everyone else',
      order: 2,
      conditions: { match: 'all', conditions: [] },
      actions: [{ type: 'tag', tag: 'review' }],
      alwaysRun: true,
    }),
  ];
};

const PAGES = [
  { id: 'routing', url: `${APP}/settings/routing`, h1: (m: typeof en) => m.settingsRouting.title },
  {
    id: 'integrations',
    url: `${APP}/settings/integrations`,
    h1: (m: typeof en) => m.settingsIntegrations.title,
  },
] as const;

for (const { id, url, h1 } of PAGES) {
  for (const [theme, lang] of [
    ['dark', 'vi'],
    ['light', 'en'],
  ] as const) {
    test(`${id} renders correctly (${theme} / ${lang})`, async ({ browser }) => {
      const { context, page } = await open(browser, 'OWNER', theme, lang, seeded);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(h1(messages[lang]));
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      await checkPage(page);
      expect(errors).toEqual([]);
      if (theme === 'dark' && lang === 'vi') await shot(page, `${id}-vi-dark`);
      await context.close();
    });
  }
}

test.describe('Routing rules', () => {
  const t = en.routing;

  test('each rule reads as one sentence, with names looked up', async ({ browser }) => {
    const { context, page } = await open(browser, 'OWNER', 'dark', 'en', seeded);
    await page.goto(`${APP}/settings/routing`);
    await expect(
      page.getByText(
        'If tier is Hot → add the tag “vip”, send to #hot-leads on Slack, email the owner',
      ),
    ).toBeVisible();
    await expect(page.getByText('If every lead → add the tag “review”')).toBeVisible();
    await expect(page.getByText(t.alwaysRuns, { exact: true })).toBeVisible();
    await context.close();
  });

  test('empty: says what happens without rules; adding one saves it and shows it', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/settings/routing`);
    await expect(page.getByText(t.empty.title)).toBeVisible();
    await shot(page, 'routing-empty');
    await page.getByRole('button', { name: t.empty.cta }).click();

    // Saving an unfinished rule says what is missing and sends nothing.
    await page.getByRole('button', { name: t.form.save }).click();
    await expect(page.getByText(t.form.incomplete.name)).toBeVisible();
    expect(api.requests.some((r) => r.method === 'POST' && r.path === '/routing/rules')).toBe(
      false,
    );

    await page.getByLabel(t.form.name).fill('Hot to the team');
    await page.getByRole('button', { name: t.form.addCondition }).click();
    await page.getByLabel(t.form.actionLabel.replace('{n}', '1')).selectOption('tag');
    await page.getByLabel(t.form.tagLabel.replace('{n}', '1')).fill('vip');
    await page.getByRole('button', { name: t.form.save }).click();

    await expect(page.getByRole('heading', { name: 'Hot to the team' })).toBeVisible();
    await expect(page.getByText('If tier is Hot → add the tag “vip”')).toBeVisible();
    expect(
      api.requests.find((r) => r.method === 'POST' && r.path === '/routing/rules')?.body,
    ).toMatchObject({
      name: 'Hot to the team',
      conditions: { match: 'all', conditions: [{ field: 'tier', op: 'is', value: 'hot' }] },
      actions: [{ type: 'tag', tag: 'vip' }],
    });
    await context.close();
  });

  test('moves a rule down, switches it off, and asks before deleting', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER', 'dark', 'en', seeded);
    await page.goto(`${APP}/settings/routing`);
    await page.getByRole('button', { name: t.moveDown.replace('{name}', 'Hot leads') }).click();
    await expect.poll(() => api.rules.map((r) => r.name)).toEqual(['Everyone else', 'Hot leads']);

    const everyone = page.getByRole('listitem').filter({ hasText: 'Everyone else' });
    await everyone.getByRole('button', { name: t.switchOff }).click();
    await expect.poll(() => api.rules[0]?.enabled).toBe(false);
    await expect(page.getByText(t.off, { exact: true })).toBeVisible();

    await everyone.getByRole('button', { name: t.delete, exact: true }).click();
    await expect(page.getByText(t.deleteAsk.replace('{name}', 'Everyone else'))).toBeVisible();
    await page.getByRole('button', { name: t.deleteYes }).click();
    await expect.poll(() => api.rules.length).toBe(1);
    await context.close();
  });

  test('"Test with a sample lead" says which rule decides and why', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER', 'dark', 'en', seeded);
    await page.goto(`${APP}/settings/routing`);
    await page.getByRole('button', { name: t.test.open }).click();
    await page.getByRole('button', { name: t.test.run, exact: true }).click();
    await expect(page.getByText('“Hot leads” decides.')).toBeVisible();
    await expect(page.getByText(t.test.verdictDecides, { exact: true })).toBeVisible();
    await shot(page, 'routing-test');

    await page.getByLabel(t.test.tier).selectOption('COLD');
    await page.getByRole('button', { name: t.test.run, exact: true }).click();
    await expect(page.getByText('“Everyone else” decides.')).toHaveCount(0);
    await expect(page.getByText(t.test.noRule)).toBeVisible();
    // Dry run: only the test call was made, no rule was changed.
    expect(
      api.requests.filter(
        (r) => r.method !== 'GET' && r.path.startsWith('/routing/') && r.path !== '/routing/test',
      ),
    ).toEqual([]);
    await context.close();
  });

  test('load error can be retried', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    api.answers.set('GET /routing/rules', () => ({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    }));
    await page.goto(`${APP}/settings/routing`);
    await expect(page.getByText(t.loadTitle)).toBeVisible();
    await context.close();
  });

  test('a Member cannot open it', async ({ browser }) => {
    const { context, page } = await open(browser, 'MEMBER');
    await page.goto(`${APP}/settings/routing`);
    await expect(page.getByText(en.noAccess.title)).toBeVisible();
    await context.close();
  });
});

test.describe('Integrations', () => {
  const t = en.integrations;

  test('connects Slack; the address is sent once and never shown again', async ({ browser }) => {
    const { context, api, page } = await open(browser);
    await page.goto(`${APP}/settings/integrations`);
    await expect(page.getByText(t.email.always)).toBeVisible();
    const slackCard = page.getByRole('region', { name: t.type.SLACK.title });
    await slackCard.getByRole('button', { name: t.connect }).click();
    await slackCard.getByLabel(t.field.name).fill('#sales');
    await slackCard
      .getByLabel(t.field.slackUrl)
      .fill('https://hooks.slack.com/services/T0/B0/SLACKTOKEN123');
    await slackCard.getByRole('button', { name: t.connectSubmit }).click();
    await expect(slackCard.getByText('#sales')).toBeVisible();
    await expect(slackCard.getByText(t.status.connected)).toBeVisible();
    expect(await page.content()).not.toContain('SLACKTOKEN123');
    expect(api.integrations).toHaveLength(1);
    await context.close();
  });

  test('a webhook shows its signing secret once', async ({ browser }) => {
    const { context, page } = await open(browser);
    await page.goto(`${APP}/settings/integrations`);
    const card = page.getByRole('region', { name: t.type.WEBHOOK.title });
    await card.getByRole('button', { name: t.connect }).click();
    await card.getByLabel(t.field.name).fill('n8n');
    await card.getByLabel(t.field.webhookUrl).fill('https://n8n.example.com/webhook/abc');
    await card.getByRole('button', { name: t.connectSubmit }).click();
    await expect(page.getByText(t.secret.title)).toBeVisible();
    await expect(page.getByText('whsec_mock_signing_secret')).toBeVisible();
    await shot(page, 'integrations-secret');
    await page.getByRole('button', { name: t.secret.done }).click();
    await expect(page.getByText('whsec_mock_signing_secret')).toHaveCount(0);
    await context.close();
  });

  test('"Send test message" shows the result, and a failure says what to do', async ({
    browser,
  }) => {
    const { context, api, page } = await open(browser, 'OWNER', 'dark', 'en', seeded);
    await page.goto(`${APP}/settings/integrations`);
    await page.getByRole('button', { name: t.sendTest }).click();
    await expect(page.getByText(t.testOk)).toBeVisible();

    api.failTest = 'http_401';
    await page.getByRole('button', { name: t.sendTest }).click();
    await expect(page.getByText(t.problem.refused).first()).toBeVisible();
    await expect(page.getByText(t.status.needs_attention)).toBeVisible();
    await shot(page, 'integrations-needs-attention');
    await context.close();
  });

  test('switching off pauses it; disconnecting asks first', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER', 'dark', 'en', seeded);
    await page.goto(`${APP}/settings/integrations`);
    await page.getByRole('button', { name: t.switchOff }).click();
    await expect(page.getByText(t.status.paused)).toBeVisible();
    await page.getByRole('button', { name: t.disconnect, exact: true }).click();
    await expect(page.getByText(t.disconnectAsk.replace('{name}', '#hot-leads'))).toBeVisible();
    await page.getByRole('button', { name: t.disconnectYes }).click();
    await expect.poll(() => api.integrations.length).toBe(0);
    await context.close();
  });
});

test.describe('What the rules did (Lead detail)', () => {
  const t = en.leadActions;
  const run = (over: Partial<MockAction>): MockAction => ({
    id: crypto.randomUUID(),
    leadId: ANN,
    ruleId: null,
    integrationId: null,
    type: 'slack',
    status: 'SUCCEEDED',
    attempts: 1,
    lastError: null,
    createdAt: now(),
    finishedAt: now(),
    ...over,
  });

  test('an admin sees each action, and can retry a failed one', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'OWNER', 'dark', 'en', (a) => {
      a.actions[ANN] = [
        run({ type: 'assign' }),
        run({ type: 'slack', status: 'DEAD', lastError: 'http_401' }),
      ];
    });
    await page.goto(`${APP}/leads/${ANN}`);
    await expect(page.getByRole('heading', { name: t.title })).toBeVisible();
    await expect(page.getByText(t.type.assign)).toBeVisible();
    await expect(page.getByText(en.integrations.problem.refused)).toBeVisible();
    await shot(page, 'lead-actions');
    await page.getByRole('button', { name: t.retry }).click();
    await expect.poll(() => api.requests.some((r) => r.path.endsWith('/retry'))).toBe(true);
    await context.close();
  });

  test('a Member does not see it and the page never asks for it', async ({ browser }) => {
    const { context, api, page } = await open(browser, 'MEMBER');
    await page.goto(`${APP}/leads/${ANN}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: t.title })).toHaveCount(0);
    expect(api.requests.some((r) => r.path === '/actions')).toBe(false);
    await context.close();
  });
});

test('one condition can cover several ratings: "is one of" shows tick boxes (Hot and Warm)', async ({
  browser,
}) => {
  const { context, api, page } = await open(browser);
  await page.goto(`${APP}/settings/routing`);
  await page.getByRole('button', { name: en.routing.empty.cta }).click();
  await page.getByLabel(en.routing.form.name).fill('Hot and warm');
  await page.getByRole('button', { name: en.routing.form.addCondition }).click();
  await page.getByLabel(en.routing.form.opLabel.replace('{n}', '1')).selectOption('in');
  const group = page.getByRole('group', { name: en.routing.form.valueLabel.replace('{n}', '1') });
  await group.getByLabel(en.tiers.WARM).check();
  await page.getByRole('button', { name: en.routing.form.save }).click();
  await expect(page.getByText(/If tier is one of Hot, Warm/)).toBeVisible();
  expect(
    api.requests.find((r) => r.method === 'POST' && r.path === '/routing/rules')?.body,
  ).toMatchObject({
    conditions: { conditions: [{ field: 'tier', op: 'in', value: ['hot', 'warm'] }] },
  });
  await context.close();
});
