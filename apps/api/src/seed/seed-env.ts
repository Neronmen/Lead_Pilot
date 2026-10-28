import { randomBytes } from 'node:crypto';

// Must be the first import of run-seed.ts: the settings are read when AppModule is loaded.
// Its own queue name, so a running `pnpm dev` (which also has workers) never picks these jobs up
// halfway; and workers off here, because the seed runs each step itself, in order.
process.env.QUEUE_PREFIX = `seed-${randomBytes(3).toString('hex')}`;
process.env.QUEUE_WORKERS = 'off';
process.env.ACTIONS_MODE = 'mock';
process.env.LLM_PROVIDER = 'mock';
process.env.LOG_LEVEL = 'warn';
