import { z } from 'zod';
import { countrySchema, currencySchema, displayTextSchema, localeSchema } from './common.ts';

/** A real time zone name such as "Asia/Ho_Chi_Minh" (the browser and Node both know the list). */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'unknown time zone');

/** `PATCH /workspace` (Owner and Admin): any of these, at least one. */
export const updateWorkspaceRequestSchema = z
  .strictObject({
    name: displayTextSchema(100).optional(),
    defaultLocale: localeSchema.optional(),
    currency: currencySchema.optional(),
    timezone: timezoneSchema.optional(),
    defaultCountry: countrySchema.nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'nothing to change',
  });
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

/** `DELETE /workspace` (Owner only): the workspace's own name, typed, so it cannot happen by accident. */
export const deleteWorkspaceRequestSchema = z.strictObject({ confirm: z.string().min(1).max(200) });
export type DeleteWorkspaceRequest = z.infer<typeof deleteWorkspaceRequestSchema>;
