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

/** `POST /auth/login`. */
export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema,
});

/**
 * Returned by signup, login, refresh and accept invite. The refresh token is
 * never in the body: it travels in an httpOnly cookie.
 */
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
