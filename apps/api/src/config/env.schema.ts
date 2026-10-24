import { z } from 'zod';

/**
 * Every environment variable the API reads. Validated once at boot, so a bad
 * config fails fast with a readable message instead of failing mid-request.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  REDIS_URL: z.url().default('redis://localhost:6379'),
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
