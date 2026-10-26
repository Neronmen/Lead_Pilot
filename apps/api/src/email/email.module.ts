import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { EMAIL_PROVIDER, type EmailProvider } from './email.provider';
import { MockEmailProvider } from './mock-email.provider';
import { SmtpEmailProvider } from './smtp-email.provider';

/**
 * SMTP when SMTP_HOST is set (docker compose runs Mailpit for it), otherwise
 * the in-memory mock, so the app still runs with nothing configured.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): EmailProvider => {
        const host = config.get('SMTP_HOST', { infer: true });
        if (!host) return new MockEmailProvider();
        return new SmtpEmailProvider({
          host,
          port: config.get('SMTP_PORT', { infer: true }),
          from: config.get('EMAIL_FROM', { infer: true }),
        });
      },
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
