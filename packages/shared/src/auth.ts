import { z } from 'zod';
import {
  countrySchema,
  currencySchema,
  displayTextSchema,
  emailSchema,
  idSchema,
  localeSchema,
  newPasswordSchema,
  passwordSchema,
  personNameSchema,
  roleSchema,
} from './common.ts';

/** `POST /auth/signup`: creates the user, the workspace and the OWNER membership. */
export const signupRequestSchema = z.strictObject({
  name: personNameSchema,
  workspaceName: displayTextSchema(100),
  email: emailSchema,
  password: newPasswordSchema,
  /**
   * Sets `Workspace.defaultLocale`. The owner's own `User.locale` stays null,
   * so they follow the workspace language until they pick one.
   */
  locale: localeSchema,
  currency: currencySchema,
  /** Default region for phone numbers. */
  defaultCountry: countrySchema.nullish(),
});

/**
 * `POST /auth/login`. The address is only trimmed and lowercased: the account
 * lookup decides, not the syntax or ending check. An account created before an
 * ending was refused (or after one was removed from the list) must still be
 * able to sign in, and a bad address just fails as "invalid credentials", the
 * same answer as an unknown one.
 */
export const loginRequestSchema = z.strictObject({
  // No control characters: Postgres text cannot hold a NUL byte, and a
  // malformed value is a 400, not an unknown account.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(254)
    .regex(/^[^\p{Cc}]*$/u),
  password: passwordSchema,
});

/**
 * Returned by signup, login, refresh and accept invite. The refresh token is
 * never in the body: it travels in an httpOnly cookie.
 */
/** `POST /auth/forgot-password`: the answer is the same whether or not the address has an account. */
export const forgotPasswordRequestSchema = z.strictObject({ email: emailSchema });

/** `POST /auth/reset-password`: the token from the email link and the new password. */
export const resetPasswordRequestSchema = z.strictObject({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});

/** `POST /auth/verify-email`. */
export const verifyEmailRequestSchema = z.strictObject({ token: z.string().min(20).max(200) });

export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const authSessionSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
});

/** `GET /auth/me`: who is signed in, and into which workspace. */
export const meResponseSchema = z.object({
  user: z.object({
    id: idSchema,
    email: z.string(),
    name: z.string().nullable(),
    /** Null: follow the workspace default. */
    locale: localeSchema.nullable(),
    /** False until the person follows the link in the verification email. */
    emailVerified: z.boolean(),
  }),
  workspace: z.object({
    id: idSchema,
    name: z.string(),
    slug: z.string(),
    defaultLocale: localeSchema,
    currency: currencySchema,
    timezone: z.string(),
    defaultCountry: z.string().nullable(),
  }),
  role: roleSchema,
});

/** `PATCH /auth/me`: the language switcher saves the user's choice. */
export const updateMeRequestSchema = z.strictObject({
  /** Null goes back to the workspace default. */
  locale: localeSchema.nullable(),
});

export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type AuthSession = z.infer<typeof authSessionSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;
