import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import type { Env } from '../../src/config/env.schema';
import { EMAIL_PROVIDER } from '../../src/email/email.provider';
import { MockEmailProvider } from '../../src/email/mock-email.provider';

/**
 * Boots the real AppModule with the same setup as main.ts. Email goes to an
 * in-memory `MockEmailProvider` (read it with `app.get(EMAIL_PROVIDER)`), so
 * tests never depend on an SMTP server. Pass `override` to swap other
 * providers (e.g. an unreachable Redis client), or the email provider again.
 */
export async function createTestApp(
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<NestExpressApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(new MockEmailProvider());
  const moduleRef = await (override ? override(builder) : builder).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
  await app.init();
  return app;
}
