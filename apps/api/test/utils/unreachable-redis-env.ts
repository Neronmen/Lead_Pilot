/**
 * Import this FIRST in a test file to point the real Redis factory at a port
 * where nothing listens. It must run before AppModule is loaded, because
 * ConfigModule reads and validates the environment at import time.
 * Real env vars win over the .env file, so this override sticks.
 */
export const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:1';

process.env.REDIS_URL = UNREACHABLE_REDIS_URL;
