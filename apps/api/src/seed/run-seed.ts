/**
 * `pnpm --filter api seed`: fills a demo workspace so the app can be tried at once.
 *
 * It does not write leads into the database by hand. It starts the real API inside this process and
 * talks to it over HTTP like any customer would (sign up, make a source, send leads, set rules), then
 * runs the pipeline for each lead with the free mock AI. So the demo shows what the product really
 * does, and a seed that stops working means the product broke. Everything here is made up.
 *
 * Run it again any time: the demo workspace is deleted and made fresh. It never touches other data.
 * Needs the database and Redis (`docker compose up -d`).
 */
import './seed-env';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ActionsService } from '../actions/actions.service';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { SAMPLE_LEADS } from '../ingest/sample-leads';
import { PipelineService } from '../pipeline/pipeline.service';
import { PrismaService } from '../prisma/prisma.service';

export const DEMO_EMAIL = 'demo@leadpilot-demo.com';
export const DEMO_PASSWORD = 'demo-leadpilot-2026';

type Json = Record<string, unknown>;

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  configureApp(app as never, app.get(ConfigService));
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const prisma = app.get(PrismaService);

  async function call<T = Json>(
    path: string,
    options: { method?: string; token?: string; body?: unknown; key?: string } = {},
  ): Promise<{ status: number; body: T }> {
    const response = await fetch(base + path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        'Content-Type': 'application/json',
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
  }
  const must = async <T = Json>(
    what: string,
    request: Promise<{ status: number; body: T }>,
  ): Promise<T> => {
    const { status, body } = await request;
    if (status >= 300) throw new Error(`${what} failed (${status}): ${JSON.stringify(body)}`);
    return body;
  };

  // 1. A fresh demo workspace (the old one, if any, is removed first).
  const old = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true, memberships: { select: { workspaceId: true } } },
  });
  if (old) {
    await prisma.workspace.deleteMany({
      where: { id: { in: old.memberships.map((m) => m.workspaceId) } },
    });
    await prisma.user.delete({ where: { id: old.id } });
  }
  const session = await must<{ accessToken: string }>(
    'sign up',
    call('/auth/signup', {
      body: {
        name: 'Dana Demo',
        workspaceName: 'Northstar Logistics (demo)',
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        locale: 'en',
        currency: 'USD',
        defaultCountry: 'US',
      },
    }),
  );
  const token = session.accessToken;
  await prisma.user.update({ where: { email: DEMO_EMAIL }, data: { emailVerifiedAt: new Date() } });
  const workspaceId = (
    await prisma.membership.findFirstOrThrow({
      where: { user: { email: DEMO_EMAIL } },
      select: { workspaceId: true },
    })
  ).workspaceId;

  // 2. Who the ideal customer is.
  await must(
    'ideal customer',
    call('/icp-rubric', {
      method: 'PUT',
      token,
      body: {
        industries: ['Logistics', 'Freight', 'Supply chain'],
        companySizes: ['50-500 employees'],
        countries: ['US', 'CA', 'GB', 'DE', 'VN'],
        budgetSignals: ['Asks for pricing or a demo', 'Names a budget or a timeline'],
        disqualifiers: ['Students', 'Agencies and resellers', 'Freelancers'],
        notes: null,
      },
    }),
  );

  // 3. Where leads come from, where good ones go, and the rules between.
  const sources: { id: string; key: string; name: string }[] = [];
  for (const name of ['Website contact form', 'Zapier – LinkedIn lead ads']) {
    const made = await must<{ source: { id: string }; apiKey: string }>(
      'source',
      call('/sources', { token, body: { name, type: 'WEBHOOK' } }),
    );
    sources.push({ id: made.source.id, key: made.apiKey, name });
  }
  const slack = await must<{ id: string }>(
    'slack',
    call('/integrations', {
      token,
      body: {
        type: 'SLACK',
        name: '#hot-leads',
        config: {
          webhookUrl: 'https://hooks.slack.com/services/T000/B000/demo-not-a-real-address',
        },
      },
    }),
  );
  const rules: Json[] = [
    {
      name: 'Hot leads: tell the sales channel',
      conditions: { match: 'all', conditions: [{ field: 'tier', op: 'is', value: 'hot' }] },
      actions: [
        { type: 'slack', integrationId: slack.id },
        { type: 'email', template: 'hot_lead', to: 'admins' },
        { type: 'tag', tag: 'hot' },
      ],
    },
    {
      name: 'Warm leads: nurture',
      conditions: { match: 'all', conditions: [{ field: 'tier', op: 'is', value: 'warm' }] },
      actions: [{ type: 'tag', tag: 'nurture' }],
    },
    {
      name: 'Junk: keep out of sight',
      conditions: { match: 'all', conditions: [{ field: 'tier', op: 'is', value: 'junk' }] },
      actions: [{ type: 'tag', tag: 'spam' }],
    },
  ];
  for (const rule of rules) await must('rule', call('/routing/rules', { token, body: rule }));

  // 4. Leads arrive like real ones: over HTTP, with each source's key.
  let accepted = 0;
  let refused = 0;
  for (let i = 0; i < 40; i += 1) {
    const sample = SAMPLE_LEADS[i % SAMPLE_LEADS.length]!;
    const [local, domain] = sample.payload.email!.split('@') as [string, string];
    const source = sources[i % sources.length]!;
    const response = await call(`/v1/ingest/${source.id}`, {
      key: source.key,
      body: { ...sample.payload, email: `${local}+${i}@${domain}` },
    });
    if (response.status < 300) accepted += 1;
    else refused += 1;
  }
  // A few that a real form would also send: a throwaway address (refused) and a repeat (merged).
  for (const bad of ['x@mailinator.com', 'y@guerrillamail.com', 'not-an-email']) {
    const response = await call(`/v1/ingest/${sources[0]!.id}`, {
      key: sources[0]!.key,
      body: { name: 'Throwaway', email: bad, message: 'hello' },
    });
    if (response.status >= 300) refused += 1;
  }

  // 5. The pipeline for each lead (company info, rating, rules), then the sends it queued.
  const pipeline = app.get(PipelineService);
  const leads = await prisma.lead.findMany({ where: { workspaceId }, select: { id: true } });
  for (const lead of leads) await pipeline.run({ workspaceId, leadId: lead.id });
  const actions = app.get(ActionsService);
  const pending = await prisma.actionRun.findMany({
    where: { workspaceId, status: 'PENDING' },
    select: { id: true },
  });
  for (const run of pending)
    await actions.execute({ workspaceId, runId: run.id }, false).catch(() => undefined);

  // 6. A rep has already worked a few: two won, one a bad lead (real outcomes for the demo).
  const hot = await prisma.lead.findMany({
    where: { workspaceId, tier: 'HOT' },
    select: { id: true },
    take: 2,
  });
  for (const lead of hot) {
    await call(`/leads/${lead.id}/outcome`, { token, body: { outcome: 'WON' } });
  }

  const tiers = await prisma.lead.groupBy({
    by: ['tier'],
    where: { workspaceId },
    _count: true,
  });
  const needReview = await prisma.lead.count({ where: { workspaceId, status: 'NEEDS_REVIEW' } });
  console.log(
    `\nDemo workspace ready: ${leads.length} leads (${accepted} accepted, ${refused} refused).`,
  );
  console.log(
    `By tier: ${tiers.map((t) => `${t.tier ?? 'unrated'} ${t._count}`).join(', ')}. Waiting for review: ${needReview}.`,
  );
  console.log(
    `\nSign in at http://localhost:3000/login with:\n  email:    ${DEMO_EMAIL}\n  password: ${DEMO_PASSWORD}\n`,
  );
  await app.close();
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
