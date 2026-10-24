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
} as const;

export type KnownErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The one error shape the API returns: `{ error: { code, message, details? } }`. */
export const errorBodySchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorBody = z.infer<typeof errorBodySchema>;
