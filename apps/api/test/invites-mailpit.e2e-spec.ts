import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { Env } from '../src/config/env.schema';
import { EMAIL_PROVIDER } from '../src/email/email.provider';
import { SmtpEmailProvider } from '../src/email/smtp-email.provider';
import { PrismaClient } from '../src/generated/prisma/client';
import { signUp } from './utils/auth';
import { INVITES_EMAIL_PREFIX, inviteeAddress } from './utils/invites';

/**
 * The real path in development: an invite goes out over SMTP and lands in
 * Mailpit (docker compose; the CI workflow runs it as a service too).
 */
describe('Invite email through Mailpit (e2e)', () => {
  const smtpHost = process.env.SMTP_HOST ?? 'localhost';
  const smtpPort = Number(process.env.SMTP_PORT ?? 1025);
  const mailpit = process.env.MAILPIT_API_URL ?? 'http://localhost:8025';
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue(
        new SmtpEmailProvider({
          host: smtpHost,
          port: smtpPort,
          from: 'LeadPilot <no-reply@leadpilot.local>',
        }),
      )
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
    await app.init();
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: INVITES_EMAIL_PREFIX } },
      select: { memberships: { select: { workspaceId: true } } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: users.flatMap((u) => u.memberships.map((m) => m.workspaceId)) } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: INVITES_EMAIL_PREFIX } } });
    await prisma.$disconnect();
    await app.close();
  });

  it('delivers the invite to Mailpit, and the link in it accepts the invite', async () => {
    const owner = await signUp(app, { email: inviteeAddress('mailpit-owner') });
    const address = inviteeAddress('mailpit-invitee');
    const res = await request(app.getHttpServer())
      .post('/invites')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ emails: [address], role: 'MEMBER' })
      .expect(201);
    expect(res.body.results).toEqual([{ email: address, status: 'invited' }]);

    const found = (await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    ).then((r) => r.json())) as { messages: Array<{ ID: string; Subject: string }> };
    expect(found.messages).toHaveLength(1);
    expect(found.messages[0]?.Subject).toBe(
      'Chloe Martin invited you to Harbour & Pine on LeadPilot',
    );
    const message = (await fetch(`${mailpit}/api/v1/message/${found.messages[0]?.ID}`).then((r) =>
      r.json(),
    )) as { Text: string; HTML: string };
    const token = /#t=([A-Za-z0-9_-]{43})/.exec(message.Text)?.[1];
    expect(token).toBeDefined();
    expect(message.HTML).toContain('Accept invite');

    const preview = await request(app.getHttpServer())
      .post('/auth/invites/preview')
      .send({ token })
      .expect(200);
    expect(preview.body).toMatchObject({ email: address, role: 'MEMBER' });
  });

  it('sends both a text and an HTML part, in Vietnamese, with names that need escaping', async () => {
    const inviterName = 'Nguyễn Văn <Ánh> & "B"';
    const workspaceName = 'Cửa hàng Ánh & Co';
    const owner = await signUp(app, {
      email: inviteeAddress('mailpit-vi-owner'),
      name: inviterName,
      workspaceName,
      locale: 'vi',
    });
    const address = inviteeAddress('mailpit-vi-invitee');
    await request(app.getHttpServer())
      .post('/invites')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ emails: [address], role: 'ADMIN' })
      .expect(201);

    const found = (await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
    ).then((r) => r.json())) as { messages: Array<{ ID: string }> };
    expect(found.messages).toHaveLength(1);
    const message = (await fetch(`${mailpit}/api/v1/message/${found.messages[0]?.ID}`).then((r) =>
      r.json(),
    )) as {
      Subject: string;
      Text: string;
      HTML: string;
      Attachments: unknown[];
      Inline: unknown[];
    };

    // Subject survives the header encoding with diacritics, on one line.
    expect(message.Subject).toBe(
      `${inviterName} đã mời bạn tham gia ${workspaceName} trên LeadPilot`,
    );
    // Both parts arrive, in the workspace language.
    expect(message.Text).toContain('Chấp nhận lời mời:');
    expect(message.Text).toContain('quản trị viên');
    expect(message.HTML).toContain('lang="vi"');
    expect(message.HTML).toContain('Chấp nhận lời mời');
    // Text is as typed; HTML is escaped once.
    expect(message.Text).toContain(inviterName);
    expect(message.Text).not.toMatch(/&(amp|lt|gt|quot|#\d+);/);
    expect(message.HTML).toContain('Nguyễn Văn &lt;Ánh&gt; &amp; &quot;B&quot;');
    expect(message.HTML).not.toContain('&amp;amp;');
    // The token survives both transports (quoted-printable can mangle "=" and long lines).
    const textToken = /#t=([A-Za-z0-9_-]{43})/.exec(message.Text)?.[1];
    const htmlTokens = [...message.HTML.matchAll(/#t=([A-Za-z0-9_-]{43})/g)].map((m) => m[1]);
    expect(textToken).toBeDefined();
    expect(htmlTokens).toHaveLength(3);
    expect(new Set(htmlTokens)).toEqual(new Set([textToken]));
    // Nothing attached or inlined: the logo is a remote image, not a tracking asset.
    expect(message.Attachments ?? []).toHaveLength(0);
    expect(message.Inline ?? []).toHaveLength(0);
    expect([...message.HTML.matchAll(/<img\b/g)]).toHaveLength(1);
  });
});
