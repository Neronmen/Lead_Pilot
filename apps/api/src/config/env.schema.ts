import { z } from 'zod';

/**
 * Every environment variable the API reads. Validated once at boot, so a bad
 * config fails fast with a readable message instead of failing mid-request.
 */
/** Never used in production (see the refinements below). */
const DEV_JWT_SECRET = 'leadpilot-dev-only-jwt-secret-not-for-production';

export const envSchema = z
  .object({
    // Safe default: an unset NODE_ENV behaves like production (JSON logs, no
    // dev-only packages). .env.example sets "development" for local work.
    NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
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
    // Signs the 15-minute access tokens (HS256). Required in production; in
    // development and tests a fixed dev value keeps the zero-config demo working.
    JWT_ACCESS_SECRET: z.string().min(32).optional(),
    // Requests per minute per IP on login, signup and accept invite.
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
    // Refresh runs on every page load and tab, so it gets a larger budget.
    AUTH_REFRESH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(60),
    // Invite and resend requests per workspace: they send email, so they are
    // limited per minute and per day (one request is up to 20 addresses).
    INVITE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(5),
    INVITE_RATE_LIMIT_PER_DAY: z.coerce.number().int().min(1).default(30),
    // Outgoing email. With no SMTP_HOST the app uses an in-memory mock (demo
    // mode); docker compose runs Mailpit on localhost:1025 for development.
    // The SMTP provider has no authentication or TLS yet: Mailpit only.
    SMTP_HOST: z
      .string()
      .optional()
      .transform((host) => (host ? host : undefined)),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    EMAIL_FROM: z
      .string()
      .regex(
        /^([^<>@]+ <[^\s<>@]+@[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+)$/,
        'must look like name@host or Name <name@host>',
      )
      .default('LeadPilot <no-reply@leadpilot.local>'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'is required in production',
      });
    }
    // A value copied from the dev default would make every token forgeable.
    if (env.NODE_ENV === 'production' && env.JWT_ACCESS_SECRET === DEV_JWT_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'must not be the development secret in production',
      });
    }
  })
  .transform((env) => ({ ...env, JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET ?? DEV_JWT_SECRET }));

export type Env = z.output<typeof envSchema>;

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
