import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Points the process at the test database. Called by both the Jest global
 * setup (migrations) and the per-file setup (the app under test).
 *
 * Safety: refuses to run unless the target database name ends in "_test",
 * so e2e tests can never wipe the dev database.
 */
export function applyTestEnv(): void {
  // Quiet by default; set LOG_LEVEL in the shell to debug a test. Must come
  // before the .env load, which would otherwise set the dev level.
  process.env.LOG_LEVEL ??= 'silent';
  // e2e files sign up and log in many times from one IP; the rate-limit test
  // sets its own low limit.
  process.env.AUTH_RATE_LIMIT_PER_MINUTE ??= '1000';
  process.env.AUTH_REFRESH_RATE_LIMIT_PER_MINUTE ??= '1000';

  const rootEnv = resolve(__dirname, '../../../.env');
  // loadEnvFile never overrides variables that are already set (e.g. in CI).
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) throw new Error('DATABASE_URL_TEST must be set to run e2e tests');

  const dbName = new URL(testUrl).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run e2e tests against "${dbName}": name must end in "_test"`);
  }

  process.env.DATABASE_URL = testUrl;
}
