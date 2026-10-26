import { z } from 'zod';

/** UI languages (SPEC §4.9). Matches the `Locale` enum in the database. */
export const localeSchema = z.enum(['en', 'vi']);
/** Workspace currency. VND has no minor units. */
export const currencySchema = z.enum(['USD', 'VND']);
/** Workspace roles, highest first. */
export const roleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
/** Roles an invite or a role change may grant: never OWNER. */
export const assignableRoleSchema = z.enum(['ADMIN', 'MEMBER']);

/** Trimmed and lowercased before it is checked, as the database stores it. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/**
 * At least 12 characters (the Signup design). The upper bound keeps a huge
 * body from making argon2 hash megabytes.
 */
export const newPasswordSchema = z.string().min(12).max(128);
/** Login checks the stored hash, so it does not repeat today's length rule. */
export const passwordSchema = z.string().min(1).max(128);

/**
 * Text people type and others see: names, workspace names. Control and
 * invisible format characters are refused: a line break in a name would let
 * it inject a header into an invite email, and a zero-width space would look
 * blank. Lone surrogates (\p{Cs}) would be stored as U+FFFD, and private-use
 * characters (\p{Co}) render as empty boxes. Letters of every script,
 * including Vietnamese, are fine.
 */
export const displayTextSchema = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]*$/u);

export const personNameSchema = displayTextSchema(100);
/** ISO 3166-1 alpha-2, e.g. "VN". Letters are checked before uppercasing ('ß' would become 'SS'). */
export const countrySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/)
  .toUpperCase();

export const idSchema = z.uuid();
/** Dates travel as ISO 8601 strings. */
export const timestampSchema = z.iso.datetime({ offset: true });

export type Locale = z.infer<typeof localeSchema>;
export type Currency = z.infer<typeof currencySchema>;
export type Role = z.infer<typeof roleSchema>;
export type AssignableRole = z.infer<typeof assignableRoleSchema>;
