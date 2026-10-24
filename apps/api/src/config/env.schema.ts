import { z } from 'zod';

/**
 * Every environment variable the API reads. Validated once at boot, so a bad
 * config fails fast with a readable message instead of failing mid-request.
 */
export const envSchema = z.object({
  // Safe default: an unset NODE_ENV behaves like production (JSON logs, no
  // dev-only packages). .env.example sets "development" for local work.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Compared verbatim with the browser's Origin header, so it must be a bare
  // origin: scheme + host (+ port), no path or trailing slash.
  WEB_ORIGIN: z
    .url({ protocol: /^https?$/ })
    // zod still runs refinements after the url check fails, hence canParse.
    .refine((value) => URL.canParse(value) && new URL(value).origin === value, {
      message: 'must be a bare origin such as http://localhost:3000 (no path or trailing slash)',
    })
    .default('http://localhost:3000'),
  // Required: no sensible default, and guessing could point at the wrong database.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).default('redis://localhost:6379'),
});

export type Env = z.infer<typeof envSchema>;

/** Used as `ConfigModule.forRoot({ validate })`. Messages never include values. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data;
}
