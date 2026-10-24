import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { buildLoggerParams } from './common/logging/logger.config';
import { validateEnv } from './config/env.schema';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

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
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
