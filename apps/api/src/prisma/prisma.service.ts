import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.schema';
import { PrismaClient } from '../generated/prisma/client';

/**
 * The raw Prisma client. Tenant tables must not be queried through it
 * directly: from M1 on, use the workspace-scoped helper (see CLAUDE.md).
 *
 * Prisma 7 talks to Postgres through a driver adapter (node-postgres here),
 * which owns the connection pool. Connections open lazily on first query.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        // Without this, a query against an unreachable host waits for the OS
        // TCP timeout (minutes) instead of failing.
        connectionTimeoutMillis: 5_000,
      }),
      // The default "pretty" format prints the whole query call, arguments
      // included (emails, password hashes), and errors end up in our logs.
      errorFormat: 'minimal',
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
