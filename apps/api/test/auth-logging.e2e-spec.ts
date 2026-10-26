import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PARAMS_PROVIDER_TOKEN, type Params, PinoLogger } from 'nestjs-pino';
import type { Options } from 'pino-http';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { buildLoggerParams } from '../src/common/logging/logger.config';
import type { Env } from '../src/config/env.schema';
import { PrismaClient } from '../src/generated/prisma/client';
import { signUp } from './utils/auth';

// Own prefix: another file's cleanup of 'e2e-auth-' users must not hit ours mid-test.
const PREFIX = 'e2e-authlog-';
let counter = 0;

type LogLine = Record<string, unknown> & { msg?: string; req?: { id?: string; url?: string } };

/** A protected route that logs once from inside the request, like any service would. */
@Controller('__log-probe')
class LogProbeController {
  constructor(private readonly logger: PinoLogger) {}

  @Get()
  probe(): { ok: true } {
    this.logger.info('probe');
    return { ok: true };
  }
}

/**
 * CLAUDE.md (Logging): every log line of an authenticated request carries
 * `requestId` and `workspaceId`. The real logger config is used, with its
 * output captured in memory instead of written to stdout.
 */
describe('Auth logging context (e2e)', () => {
  let app: NestExpressApplication;
  const lines: LogLine[] = [];
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [LogProbeController],
    })
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useFactory({
        inject: [ConfigService],
        factory: (config: ConfigService<Env, true>): Params => {
          const base = buildLoggerParams(config);
          const options = { ...(base.pinoHttp as Options), level: 'info', transport: undefined };
          const stream = { write: (line: string) => lines.push(JSON.parse(line) as LogLine) };
          return { ...base, pinoHttp: [options, stream] };
        },
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
    await app.init();
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: PREFIX } },
      select: { memberships: { select: { workspaceId: true } } },
    });
    const workspaceIds = users.flatMap((user) => user.memberships.map((m) => m.workspaceId));
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.$disconnect();
    await app.close();
  });

  async function signedIn(): Promise<{ token: string; userId: string; workspaceId: string }> {
    counter += 1;
    const { accessToken } = await signUp(app, {
      email: `${PREFIX}${Date.now()}-${counter}@example.com`,
    });
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);
    return { token: accessToken, userId: me.body.user.id, workspaceId: me.body.workspace.id };
  }

  /** The lines logged for one request, found by the request id it answered with. */
  async function logsOf(path: string, token: string): Promise<LogLine[]> {
    lines.length = 0;
    const requestId = `log-test-${Date.now()}`;
    await request(app.getHttpServer())
      .get(path)
      .set('authorization', `Bearer ${token}`)
      .set('x-request-id', requestId)
      .expect(200);
    const mine = lines.filter((line) => line.req?.id === requestId);
    expect(mine.length).toBeGreaterThan(0);
    return mine;
  }

  it('tags a log made inside an authenticated request with workspaceId and userId', async () => {
    const { token, userId, workspaceId } = await signedIn();
    const mine = await logsOf('/__log-probe', token);
    const probe = mine.find((line) => line.msg === 'probe');
    expect(probe).toMatchObject({ workspaceId, userId });
  });

  it('tags the "request completed" line of an authenticated request with workspaceId and userId', async () => {
    const { token, userId, workspaceId } = await signedIn();
    const mine = await logsOf('/auth/me', token);
    const completed = mine.find((line) => line.msg === 'request completed');
    // For most requests this is the only line logged, so it must carry the tenant.
    expect(completed).toMatchObject({ workspaceId, userId });
  });

  it('never writes the bearer token or the refresh cookie to the log', async () => {
    const { token } = await signedIn();
    const mine = await logsOf('/auth/me', token);
    expect(JSON.stringify(mine)).not.toContain(token);
  });

  describe('what the real pipeline leaves out of a log line', () => {
    const SECRET_COOKIE = 'lp_refresh=cookie-secret-value-123';
    const SECRET_QUERY = 'leak-me@example.com';

    it('drops every header and the query string from the request line', async () => {
      const { token } = await signedIn();
      lines.length = 0;
      const requestId = `log-hdr-${Date.now()}`;
      await request(app.getHttpServer())
        .get(`/auth/me?email=${SECRET_QUERY}&token=query-secret-456`)
        .set('authorization', `Bearer ${token}`)
        .set('cookie', SECRET_COOKIE)
        .set('x-api-key', 'api-key-secret-789')
        .set('x-request-id', requestId)
        .expect(200);
      const mine = lines.filter((line) => line.req?.id === requestId);
      expect(mine.length).toBeGreaterThan(0);
      const raw = JSON.stringify(mine);
      for (const secret of [
        token,
        'cookie-secret-value-123',
        SECRET_QUERY,
        'query-secret-456',
        'api-key-secret-789',
        '?',
      ]) {
        expect(raw).not.toContain(secret);
      }
      expect(mine.find((line) => line.msg === 'request completed')?.req).toEqual({
        id: requestId,
        method: 'GET',
        url: '/auth/me',
      });
      for (const line of mine) {
        expect(line).not.toHaveProperty('req.headers');
        expect(line).not.toHaveProperty('res.headers');
      }
    });

    it('never logs the password or token of a failed login, nor the Set-Cookie of a good one', async () => {
      const user = await signUp(app, { email: `${PREFIX}${Date.now()}-login@example.com` });
      lines.length = 0;
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-request-id', 'log-login-bad')
        .send({ email: user.body.email, password: 'wrong-password-secret-1' })
        .expect(401);
      const ok = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-request-id', 'log-login-ok')
        .send({ email: user.body.email, password: user.body.password })
        .expect(200);
      const raw = JSON.stringify(lines);
      expect(raw).not.toContain('wrong-password-secret-1');
      expect(raw).not.toContain(user.body.password);
      expect(raw).not.toContain(ok.body.accessToken);
      expect(raw).not.toContain('lp_refresh');
    });

    it('skips health probes (with or without a query) but logs routes that merely start with /health', async () => {
      lines.length = 0;
      await request(app.getHttpServer()).get('/health?probe=1').set('x-request-id', 'hp-1');
      await request(app.getHttpServer()).get('/healthy-x').set('x-request-id', 'hp-2').expect(404);
      expect(lines.filter((line) => line.req?.id === 'hp-1')).toHaveLength(0);
      expect(lines.filter((line) => line.req?.id === 'hp-2').length).toBeGreaterThan(0);
    });
  });
});
