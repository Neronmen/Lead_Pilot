import { z } from 'zod';
import {
  assignableRoleSchema,
  emailSchema,
  idSchema,
  newPasswordSchema,
  passwordSchema,
  personNameSchema,
  roleSchema,
  timestampSchema,
} from './common.ts';

/** The random token from an invite link. It travels in request bodies only. */
export const inviteTokenSchema = z
  .string()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/); // base64url

/**
 * `POST /invites`: invite several people at once (Settings > Team). The same
 * address typed twice is invited once: the service removes duplicates after
 * normalization, so `results` has one entry per distinct address.
 */
export const createInvitesRequestSchema = z.strictObject({
  emails: z.array(emailSchema).min(1).max(20),
  role: assignableRoleSchema,
});

/**
 * `email_failed`: the invite is saved but the email could not be sent; the
 * admin retries with Resend.
 */
export const inviteResultStatusSchema = z.enum([
  'invited',
  'already_member',
  'already_invited',
  'email_failed',
]);

export const createInvitesResponseSchema = z.object({
  results: z.array(z.object({ email: z.string(), status: inviteResultStatusSchema })),
});

/** `POST /invites/:id/resend`: `invited` or `email_failed`. */
export const resendInviteResponseSchema = z.object({ status: inviteResultStatusSchema });

/** A pending invite in `GET /invites`. */
export const pendingInviteSchema = z.object({
  id: idSchema,
  email: z.string(),
  role: assignableRoleSchema,
  /** Null once the inviting user's account is deleted. */
  invitedBy: z.object({ id: idSchema, name: z.string().nullable() }).nullable(),
  expiresAt: timestampSchema,
  createdAt: timestampSchema,
});

/** `POST /auth/invites/preview`: what the Accept invite page shows. */
export const invitePreviewRequestSchema = z.strictObject({ token: inviteTokenSchema });

export const invitePreviewResponseSchema = z.object({
  workspaceName: z.string(),
  inviterName: z.string().nullable(),
  role: assignableRoleSchema,
  email: z.string(),
  expiresAt: timestampSchema,
  /** True: ask for the existing password instead of a new name and password. */
  accountExists: z.boolean(),
});

/**
 * `POST /auth/invites/accept`. An existing account proves itself with its
 * current password. A new account also needs `name`, and its password must
 * pass `newPasswordSchema`: the server checks both once it knows which case
 * applies, and reports them as VALIDATION_FAILED like any other field. For an
 * existing account `name` is rejected (VALIDATION_FAILED, unrecognized_keys):
 * accepting an invite never renames anyone.
 */
export const acceptInviteRequestSchema = z.strictObject({
  token: inviteTokenSchema,
  name: personNameSchema.optional(),
  password: passwordSchema,
});

/** The extra rules for an invitee who has no account yet. */
export const newAccountSchema = z.object({ name: personNameSchema, password: newPasswordSchema });

/** A row in `GET /members`. */
export const memberSchema = z.object({
  /** The membership id, used by the change-role and remove endpoints. */
  id: idSchema,
  userId: idSchema,
  name: z.string().nullable(),
  email: z.string(),
  role: roleSchema,
  openLeads: z.number().int().nonnegative(),
  lastActiveAt: timestampSchema.nullable(),
  joinedAt: timestampSchema,
});

/** `PATCH /members/:id`. */
export const changeRoleRequestSchema = z.strictObject({ role: assignableRoleSchema });

export type CreateInvitesRequest = z.infer<typeof createInvitesRequestSchema>;
export type CreateInvitesResponse = z.infer<typeof createInvitesResponseSchema>;
export type InviteResultStatus = z.infer<typeof inviteResultStatusSchema>;
export type ResendInviteResponse = z.infer<typeof resendInviteResponseSchema>;
export type PendingInvite = z.infer<typeof pendingInviteSchema>;
export type InvitePreviewRequest = z.infer<typeof invitePreviewRequestSchema>;
export type InvitePreviewResponse = z.infer<typeof invitePreviewResponseSchema>;
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;
export type Member = z.infer<typeof memberSchema>;
export type ChangeRoleRequest = z.infer<typeof changeRoleRequestSchema>;
