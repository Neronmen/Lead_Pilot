import { ErrorCode, toValidationIssues } from '@leadpilot/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError } from '@/lib/api';
import en from '@/messages/en.json';
import vi from '@/messages/vi.json';
import { errorMessageRef, formErrors, issueMessageRef, type MessageRef } from './errors';

type Dict = { [key: string]: string | Dict };

function lookup(messages: Dict, key: string): string | undefined {
  let node: string | Dict | undefined = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function expectMessage(ref: MessageRef) {
  for (const [name, messages] of [
    ['en', en],
    ['vi', vi],
  ] as const) {
    expect(lookup(messages as Dict, ref.key), `${name}: ${ref.key}`).toBeTypeOf('string');
  }
}

const validation = (details: unknown) =>
  new ApiError(400, ErrorCode.VALIDATION_FAILED, 'x', details);

describe('formErrors edge cases', () => {
  // BUG (errors.ts formErrors): `fields[path] ??=` on a plain {} skips inherited names. Remove .fails once fixed (Object.create(null) or Map).
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'handles "%s" as a field path',
    (path) => {
      const result = formErrors(validation([{ path, code: 'invalid_type', expected: 'string' }]));
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
      expect(Object.getOwnPropertyDescriptor(result.fields, path)?.value).toEqual({
        key: 'validation.invalid_type',
      });
      expect(result.form).toBeNull();
    },
  );

  it('keeps the first problem when a path repeats, also for "constructor"', () => {
    for (const path of ['a', 'constructor', '__proto__']) {
      const result = formErrors(
        validation([
          { path, code: 'too_small', origin: 'string', minimum: 3 },
          { path, code: 'invalid_type' },
        ]),
      );
      expect(Object.getOwnPropertyDescriptor(result.fields, path)?.value.key, path).toBe(
        'validation.too_small.string',
      );
    }
  });

  it('shows the form message too when field and whole-body problems are mixed', () => {
    const result = formErrors(
      validation([
        { path: 'a', code: 'invalid_type' },
        { path: '', code: 'unrecognized_keys', values: ['z'] },
      ]),
    );
    expect(result.form?.key).toBe('errors.VALIDATION_FAILED');
    expect(result.fields.a?.key).toBe('validation.invalid_type');
  });

  it('falls back to the form message for an empty list', () => {
    const result = formErrors(validation([]));
    expect(result.form?.key).toBe('errors.VALIDATION_FAILED');
    expect(result.fields).toEqual({});
  });

  it.each([
    ['null', null],
    ['an object', { path: 'a', code: 'x' }],
    ['numbers', [1, 2]],
    ['a missing code', [{ path: 'a' }]],
    ['a non-string path', [{ path: 3, code: 'x' }]],
    ['a string minimum', [{ path: 'a', code: 'too_small', minimum: '3' }]],
  ])('treats details that are %s as no field problems', (_name, details) => {
    const result = formErrors(validation(details));
    expect(result.form?.key).toBe('errors.VALIDATION_FAILED');
    expect(result.fields).toEqual({});
  });

  it('ignores details on other error codes', () => {
    const e = new ApiError(409, ErrorCode.EMAIL_TAKEN, 'x', [{ path: 'email', code: 'custom' }]);
    expect(formErrors(e)).toEqual({ form: { key: 'errors.EMAIL_TAKEN' }, fields: {} });
  });

  it('copes with a missing limit or an unknown origin', () => {
    expect(issueMessageRef({ path: 'a', code: 'too_small' })).toEqual({
      key: 'validation.too_small.string',
      values: { minimum: 0 },
    });
    expect(issueMessageRef({ path: 'a', code: 'too_big', origin: 'set' }).key).toBe(
      'validation.too_big.string',
    );
  });

  it('does not map prototype names to a known error code', () => {
    expect(errorMessageRef('__proto__').key).toBe('errors.UNKNOWN');
    expect(errorMessageRef('').key).toBe('errors.UNKNOWN');
  });
});

describe('every issue the API can produce has text', () => {
  it.each([
    'invalid_type',
    'too_big',
    'too_small',
    'invalid_format',
    'not_multiple_of',
    'unrecognized_keys',
    'invalid_union',
    'invalid_key',
    'invalid_element',
    'invalid_value',
    'custom',
  ])('%s', (code) => {
    expectMessage(issueMessageRef({ path: 'a', code }));
  });

  it('real zod failures map to messages in both languages', () => {
    const schema = z.object({
      s: z.string().min(3).max(5),
      e: z.email(),
      n: z.number().int().min(1).max(2).multipleOf(5),
      a: z.array(z.string()).min(1).max(2),
      v: z.enum(['x', 'y']),
      u: z.union([z.string(), z.number()]),
      r: z.record(z.string().min(2), z.string()),
    });
    const bad = { s: 'ab', e: 'nope', n: 7.5, a: [], v: 'z', u: true, r: { a: 1 }, extra: 1 };
    for (const candidate of [schema, schema.strict()]) {
      const parsed = candidate.safeParse(bad);
      expect(parsed.success).toBe(false);
      if (parsed.success) continue;
      const issues = toValidationIssues(parsed.error.issues);
      expect(issues.length).toBeGreaterThan(5);
      for (const issue of issues) expectMessage(issueMessageRef(issue));
    }
  });
});
