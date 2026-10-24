import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErrorCode, errorBodySchema, healthResponseSchema } from '../src/index.ts';

test('errorBodySchema accepts the envelope with and without details', () => {
  assert.ok(
    errorBodySchema.safeParse({ error: { code: ErrorCode.NOT_FOUND, message: 'Lead not found' } })
      .success,
  );
  assert.ok(
    errorBodySchema.safeParse({
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: 'Invalid body',
        details: [{ path: 'email' }],
      },
    }).success,
  );
});

test('errorBodySchema rejects a bare message or an empty code', () => {
  assert.equal(errorBodySchema.safeParse({ message: 'oops' }).success, false);
  assert.equal(errorBodySchema.safeParse({ error: { code: '', message: 'x' } }).success, false);
});

test('healthResponseSchema accepts ok and error results', () => {
  assert.ok(healthResponseSchema.safeParse({ status: 'ok', checks: {} }).success);
  assert.ok(
    healthResponseSchema.safeParse({
      status: 'error',
      checks: { database: { status: 'down', message: 'timeout' }, redis: { status: 'up' } },
    }).success,
  );
});

test('healthResponseSchema rejects unknown check statuses', () => {
  assert.equal(
    healthResponseSchema.safeParse({ status: 'ok', checks: { redis: { status: 'maybe' } } })
      .success,
    false,
  );
});
