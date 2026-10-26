import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../config/env.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { ACCESS_TOKEN_TTL_SECONDS, SessionService } from './session.service';

const JWT_ISSUER = 'leadpilot';
const JWT_AUDIENCE = 'leadpilot-api';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        },
        // Pinning the algorithm rejects `alg: none` and algorithm-confusion tokens.
        verifyOptions: { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
      }),
    }),
    // In-memory counters: per API instance. Moves to Redis in M3 (docs/backlog.md).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: config.get('AUTH_RATE_LIMIT_PER_MINUTE', { infer: true }),
          },
          {
            name: 'refresh',
            ttl: 60_000,
            limit: config.get('AUTH_REFRESH_RATE_LIMIT_PER_MINUTE', { infer: true }),
          },
          // Email-sending invite routes, counted per workspace (not per IP).
          {
            name: 'invites',
            ttl: 60_000,
            limit: config.get('INVITE_RATE_LIMIT_PER_MINUTE', { infer: true }),
          },
          {
            name: 'invitesDay',
            ttl: 24 * 60 * 60_000,
            limit: config.get('INVITE_RATE_LIMIT_PER_DAY', { infer: true }),
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    // Order matters: authenticate first, then check the role.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SessionService, PasswordService],
})
export class AuthModule {}
