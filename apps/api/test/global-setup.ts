import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { applyTestEnv } from './test-env';

/** Runs once before all e2e files: bring the test database schema up to date. */
export default function globalSetup(): void {
  applyTestEnv();
  // `migrate deploy` only applies pending migrations, so it is safe to run every time.
  const prismaCli = resolve(__dirname, '../node_modules/prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: resolve(__dirname, '..'),
    env: process.env,
    stdio: 'pipe',
  });
}
