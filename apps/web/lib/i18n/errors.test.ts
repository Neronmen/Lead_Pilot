import { ErrorCode, type ValidationIssue } from '@leadpilot/shared';
import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '@/lib/api';
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

function flatten(messages: Dict, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string' ? [prefix + key] : flatten(value, `${prefix}${key}.`),
  );
}

const both = { en: en as Dict, vi: vi as Dict };

function expectMessage(ref: MessageRef) {
  for (const [name, messages] of Object.entries(both)) {
    expect(lookup(messages, ref.key), `${name}: ${ref.key}`).toBeTypeOf('string');
  }
}

describe('messages', () => {
  it('have the same keys in English and Vietnamese', () => {
    expect(flatten(both.vi).sort()).toEqual(flatten(both.en).sort());
  });

  it('use the same {placeholders} in both languages', () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
    for (const key of flatten(both.en)) {
      expect(names(lookup(both.vi, key)!), key).toEqual(names(lookup(both.en, key)!));
    }
  });

  it('have no empty text', () => {
    for (const [name, messages] of Object.entries(both)) {
      for (const key of flatten(messages)) {
        expect(lookup(messages, key)!.trim(), `${name}: ${key}`).not.toBe('');
      }
    }
  });
});

describe('errorMessageRef', () => {
  it.each(Object.values(ErrorCode))('has a message in both languages for %s', (code) => {
    const ref = errorMessageRef(code);
    expect(ref.key).toBe(`errors.${code}`);
    expectMessage(ref);
  });

  it('maps a code this app does not know to UNKNOWN', () => {
    expect(errorMessageRef('SOMETHING_NEW')).toEqual({ key: 'errors.UNKNOWN' });
    expect(errorMessageRef('constructor')).toEqual({ key: 'errors.UNKNOWN' });
  });
});

describe('issueMessageRef', () => {
  const issue = (over: Partial<ValidationIssue>): ValidationIssue => ({
    path: 'field',
    code: 'invalid_type',
    ...over,
  });

  const cases: ValidationIssue[] = [
    issue({ code: 'invalid_type', expected: 'string' }),
    issue({ code: 'too_small', origin: 'string', minimum: 12 }),
    issue({ code: 'too_small', origin: 'array', minimum: 1 }),
    issue({ code: 'too_small', origin: 'number', minimum: 1 }),
    issue({ code: 'too_big', origin: 'string', maximum: 128 }),
    issue({ code: 'too_big', origin: 'array', maximum: 20 }),
    issue({ code: 'too_big', origin: 'number', maximum: 5 }),
    issue({ code: 'invalid_format', format: 'email' }),
    issue({ code: 'invalid_format', format: 'regex' }),
    issue({ code: 'custom', format: 'unknown_tld' }),
    issue({ code: 'custom' }),
    issue({ code: 'invalid_value', values: ['a'] }),
    issue({ code: 'unrecognized_keys', values: ['x'] }),
    issue({ code: 'not_multiple_of' }),
  ];

  it.each(cases)('$code ($origin $format) has a message in both languages', (c) => {
    expectMessage(issueMessageRef(c));
  });

  it('passes the limit so the message can show it', () => {
    expect(issueMessageRef(issue({ code: 'too_small', origin: 'string', minimum: 12 }))).toEqual({
      key: 'validation.too_small.string',
      values: { minimum: 12 },
    });
  });

  it('tells a bad email from an unknown ending', () => {
    expect(issueMessageRef(issue({ code: 'invalid_format', format: 'email' })).key).toBe(
      'validation.invalid_format.email',
    );
    expect(issueMessageRef(issue({ code: 'custom', format: 'unknown_tld' })).key).toBe(
      'validation.custom.unknown_tld',
    );
  });
});

describe('formErrors', () => {
  const validation = (details: unknown) =>
    new ApiError(400, ErrorCode.VALIDATION_FAILED, 'x', details);

  it('puts field problems under their fields only', () => {
    const result = formErrors(
      validation([
        { path: 'email', code: 'custom', format: 'unknown_tld' },
        { path: 'email', code: 'invalid_format', format: 'email' },
        { path: 'password', code: 'too_small', origin: 'string', minimum: 12 },
      ]),
    );
    expect(result.form).toBeNull();
    expect(result.fields.email?.key).toBe('validation.custom.unknown_tld');
    expect(result.fields.password?.key).toBe('validation.too_small.string');
  });

  it('shows a form message when a problem has no field', () => {
    const result = formErrors(validation([{ path: '', code: 'unrecognized_keys', values: ['x'] }]));
    expect(result.form?.key).toBe('errors.VALIDATION_FAILED');
  });

  it('shows a form message when the details are not issues', () => {
    expect(formErrors(validation('nope')).form?.key).toBe('errors.VALIDATION_FAILED');
    expect(formErrors(validation(undefined)).form?.key).toBe('errors.VALIDATION_FAILED');
  });

  it('maps other API errors, network errors and surprises', () => {
    expect(formErrors(new ApiError(401, ErrorCode.AUTH_INVALID_CREDENTIALS, 'x')).form?.key).toBe(
      'errors.AUTH_INVALID_CREDENTIALS',
    );
    expect(formErrors(new ApiError(502, 'UNKNOWN', 'x')).form?.key).toBe('errors.UNKNOWN');
    expect(formErrors(new NetworkError(new Error('down'))).form?.key).toBe('errors.NETWORK');
    expect(formErrors(new Error('boom')).form?.key).toBe('errors.UNKNOWN');
    expect(formErrors('boom').form?.key).toBe('errors.UNKNOWN');
  });
});
