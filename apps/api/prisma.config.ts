import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env by itself. Load the shared root .env when it
// exists (local dev); in CI the variables come from the environment.
const rootEnv = resolve(__dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Left undefined when unset, so `prisma generate` works without a database;
  // `migrate` then fails with a clear "datasource.url is required" message.
  datasource: { url: process.env.DATABASE_URL },
});
