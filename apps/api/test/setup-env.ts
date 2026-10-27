// Runs before each e2e test file.
import { randomBytes } from 'node:crypto';
import { applyTestEnv } from './test-env';

applyTestEnv();
// Each file gets its own Redis namespace for queues and rate-limit counters: files run in
// parallel from one IP, and must neither share counters nor touch a dev server's jobs.
process.env.QUEUE_PREFIX = `bull-test-${randomBytes(4).toString('hex')}`;
