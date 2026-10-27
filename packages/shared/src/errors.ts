import { z } from 'zod';

/** Error codes every client can rely on. Domain modules may add their own. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',

  // Auth (M1). Wrong email and wrong password share one code, so the answer
  // never tells whether an account exists.
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  /** No usable session (no token, or expired or revoked): refresh, else sign in again. */
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  /** A rotated refresh token came back: every session of that login is revoked. */
  AUTH_REFRESH_REUSED: 'AUTH_REFRESH_REUSED',
  /** The account belongs to no workspace (all memberships removed). */
  AUTH_NO_WORKSPACE: 'AUTH_NO_WORKSPACE',
  EMAIL_TAKEN: 'EMAIL_TAKEN',

  // Team (M1).
  /** Unknown, expired, cancelled or already used: one code for all of them. */
  INVITE_INVALID: 'INVITE_INVALID',
  /** Nobody can grant, change or remove the OWNER role (transfer comes later). */
  OWNER_IMMUTABLE: 'OWNER_IMMUTABLE',
  /** Nobody can change their own role or remove themselves. */
  CANNOT_MODIFY_SELF: 'CANNOT_MODIFY_SELF',

  // Lead sources (M2).
  /** A source with leads cannot be deleted (the leads would lose their origin): switch it off instead. */
  SOURCE_HAS_LEADS: 'SOURCE_HAS_LEADS',
  /** The source already has a signing secret; it is shown once, so switch signing off first to get a new one. */
  HMAC_ALREADY_ENABLED: 'HMAC_ALREADY_ENABLED',

  // Ingest (M2): what a sending system can be told. Every authentication problem
  // is plain UNAUTHORIZED, so the answer never tells whether a source exists.
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  /** The same Idempotency-Key was sent with a different body. */
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
} as const;

export type KnownErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * One problem in `details` of a VALIDATION_FAILED error. `code` is zod's issue
 * code (`too_small`, `invalid_format`, ...); the web app turns code + field
 * into a translated message, so the API sends no human text here.
 */
export const validationIssueSchema = z.object({
  /** Dotted field path, e.g. "emails.2"; empty for the whole body. */
  path: z.string(),
  code: z.string(),
  /** For too_small / too_big: what was measured ("string", "array", "number"). */
  origin: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  /** For invalid_type: the expected type ("string", "object"...), so "required" can be told apart. */
  expected: z.string().optional(),
  /** e.g. "email" for an invalid_format issue, or the name of a custom check ("unknown_tld"). */
  format: z.string().optional(),
  /** Allowed values of an enum, or the unrecognized keys. */
  values: z.array(z.string()).optional(),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/**
 * Turns zod issues into `ValidationIssue`s. Used by the API's validation pipe
 * and by web forms, so both report the same problem the same way. zod's own
 * English `message` is dropped on purpose.
 */
export function toValidationIssues(issues: readonly z.core.$ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => {
    const result: ValidationIssue = { path: issue.path.map(String).join('.'), code: issue.code };
    switch (issue.code) {
      case 'invalid_type':
        result.expected = issue.expected;
        break;
      case 'too_small':
        result.origin = issue.origin;
        result.minimum = Number(issue.minimum);
        break;
      case 'too_big':
        result.origin = issue.origin;
        result.maximum = Number(issue.maximum);
        break;
      case 'invalid_format':
        result.format = issue.format;
        break;
      case 'custom':
        // A named check of ours (e.g. "unknown_tld"), so the web app can word it.
        if (typeof issue.params?.reason === 'string') result.format = issue.params.reason;
        break;
      case 'invalid_value':
        result.values = issue.values.map(String);
        break;
      case 'unrecognized_keys':
        // These are the client's own key names: capped, so a huge key is not
        // echoed back in full.
        result.values = issue.keys.slice(0, 10).map((key) => key.slice(0, 64));
        break;
    }
    return result;
  });
}

/** The one error shape the API returns: `{ error: { code, message, details? } }`. */
export const errorBodySchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;
