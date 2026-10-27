import { ErrorCode, validationIssueSchema, type ValidationIssue } from '@leadpilot/shared';
import { z } from 'zod';
import { ApiError, NetworkError } from '@/lib/api';

/**
 * The API sends codes and data, never text for people (SPEC §4.9). This file
 * turns them into a *reference* to a message (`errors.NOT_FOUND`) plus values;
 * `useMessage()` looks the reference up in the person's language. Keeping the
 * mapping free of React makes it testable: a test checks that every code the
 * API can send has an English and a Vietnamese message.
 */
export interface MessageRef {
  key: string;
  values?: Record<string, string | number>;
}

const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set(Object.values(ErrorCode));

/** The message for an API error code; a code this app does not know is `UNKNOWN`. */
export function errorMessageRef(code: string): MessageRef {
  return { key: KNOWN_ERROR_CODES.has(code) ? `errors.${code}` : 'errors.UNKNOWN' };
}

type Origin = 'string' | 'array' | 'number';
const origin = (value: string | undefined): Origin =>
  value === 'array' || value === 'number' ? value : 'string';

/** The message for one problem with one field. */
export function issueMessageRef(issue: ValidationIssue): MessageRef {
  switch (issue.code) {
    case 'too_small':
      // An empty text box (this applies to every string field with a minimum of 1): "at least 1 character" reads oddly, so say it is required.
      if (origin(issue.origin) === 'string' && (issue.minimum ?? 0) <= 1) {
        return { key: 'validation.invalid_type' };
      }
      return {
        key: `validation.too_small.${origin(issue.origin)}`,
        values: { minimum: issue.minimum ?? 0 },
      };
    case 'too_big':
      return {
        key: `validation.too_big.${origin(issue.origin)}`,
        values: { maximum: issue.maximum ?? 0 },
      };
    case 'invalid_format':
      return {
        key:
          issue.format === 'email'
            ? 'validation.invalid_format.email'
            : 'validation.invalid_format.other',
      };
    case 'custom':
      return {
        key:
          issue.format === 'unknown_tld'
            ? 'validation.custom.unknown_tld'
            : 'validation.custom.other',
      };
    case 'invalid_type':
    case 'invalid_value':
    case 'unrecognized_keys':
      return { key: `validation.${issue.code}` };
    default:
      return { key: 'validation.fallback' };
  }
}

export interface FormErrors {
  /** A message for the whole form, or null when every problem belongs to a field. */
  form: MessageRef | null;
  /** The first problem of each field, by dotted path (`email`, `emails.2`). */
  fields: Record<string, MessageRef>;
}

/**
 * What to show for a failed request: field problems under their fields, and
 * anything else (a wrong password, a lost connection, a 500) for the form.
 */
export function formErrors(error: unknown): FormErrors {
  if (error instanceof NetworkError) return { form: { key: 'errors.NETWORK' }, fields: {} };
  if (!(error instanceof ApiError)) return { form: { key: 'errors.UNKNOWN' }, fields: {} };

  if (error.code === ErrorCode.VALIDATION_FAILED) {
    const parsed = z.array(validationIssueSchema).safeParse(error.details);
    if (parsed.success) return issuesToFormErrors(parsed.data);
  }
  return { form: errorMessageRef(error.code), fields: {} };
}

/**
 * Field problems from a list of validation issues, whether they came from the
 * API or from checking the form in the browser with the shared schema first.
 */
export function issuesToFormErrors(issues: readonly ValidationIssue[]): FormErrors {
  // No prototype: a field named `constructor` must not collide with Object's members.
  const fields: Record<string, MessageRef> = Object.create(null);
  let general = false;
  for (const issue of issues) {
    // A problem with the whole body (an unexpected key) has no field.
    if (!issue.path) general = true;
    else if (!(issue.path in fields)) fields[issue.path] = issueMessageRef(issue);
  }
  const only = Object.keys(fields).length > 0 && !general;
  return { form: only ? null : errorMessageRef(ErrorCode.VALIDATION_FAILED), fields };
}
