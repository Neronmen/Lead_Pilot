import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { EmailModule } from './email/email.module';
import { InvitesModule } from './invites/invites.module';
import { MembersModule } from './members/members.module';
import { CryptoModule } from './crypto/crypto.module';
import { LeadsModule } from './leads/leads.module';
import { IngestModule } from './ingest/ingest.module';
import { SourcesModule } from './sources/sources.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { buildLoggerParams } from './common/logging/logger.config';
import { validateEnv } from './config/env.schema';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { MaintenanceModule } from './maintenance/maintenance.module';

// One .env at the repo root, shared by all apps. Same depth from src/ and dist/.
// Real environment variables take precedence over the file.
const ROOT_ENV_FILE = resolve(__dirname, '../../../.env');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ROOT_ENV_FILE,
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({ inject: [ConfigService], useFactory: buildLoggerParams }),
    PrismaModule,
    RedisModule,
    QueueModule,
    PipelineModule,
    MaintenanceModule,
    HealthModule,
    AuditModule,
    EmailModule,
    AuthModule,
    InvitesModule,
    MembersModule,
    CryptoModule,
    SourcesModule,
    IngestModule,
    LeadsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
