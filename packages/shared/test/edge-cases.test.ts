import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import {
  countrySchema,
  createInvitesRequestSchema,
  emailSchema,
  loginRequestSchema,
  newPasswordSchema,
  passwordSchema,
  personNameSchema,
  signupRequestSchema,
  toValidationIssues,
} from '../src/index.ts';

// Edge cases for the M1 auth/team schemas: Unicode, whitespace, length
// units, and how zod issues are turned into ValidationIssues.

const workspaceNameSchema = signupRequestSchema.shape.workspaceName;

test('personNameSchema rejects names that are only whitespace, including Unicode spaces', () => {
  for (const blank of ['     ', '\t\n', '  ', '　', ' ']) {
    assert.equal(personNameSchema.safeParse(blank).success, false, JSON.stringify(blank));
  }
});

test('personNameSchema keeps Vietnamese diacritics and trims the ends', () => {
  assert.equal(personNameSchema.parse('  Nguyễn Văn Ánh '), 'Nguyễn Văn Ánh');
  assert.equal(personNameSchema.parse('Trần Thị Ngọc Hương'), 'Trần Thị Ngọc Hương');
});

test('personNameSchema and workspaceName cap at 100 characters after trimming', () => {
  assert.ok(personNameSchema.safeParse(` ${'a'.repeat(100)} `).success);
  assert.equal(personNameSchema.safeParse('a'.repeat(101)).success, false);
  assert.ok(workspaceNameSchema.safeParse('ễ'.repeat(100)).success);
  assert.equal(workspaceNameSchema.safeParse('ễ'.repeat(101)).success, false);
});

// Names (and the workspace name) end up in invite emails: the inviter's name in
// the subject or the From display name. CR/LF there allows header injection,
// and other control or invisible characters make spoofed or blank-looking
// names. The schema refuses them (displayTextSchema in common.ts).
const unsafeNames = [
  'Eve\r\nBcc: victim@example.com',
  'Eve\nAdmin',
  'Eve\u0000',
  'Eve\u0007',
  '​', // zero-width space only: looks blank
  `Ann${String.fromCharCode(0xd800)}`, // lone surrogate: stored as U+FFFD
  `Ann${String.fromCharCode(0xe000)}`, // private use: renders as an empty box
  'Eve‮etamrehtO', // right-to-left override
];

test('personNameSchema rejects control, line-break and invisible characters', () => {
  for (const name of unsafeNames) {
    assert.equal(personNameSchema.safeParse(name).success, false, JSON.stringify(name));
  }
});

test('workspaceName rejects control, line-break and invisible characters', () => {
  for (const name of unsafeNames) {
    assert.equal(workspaceNameSchema.safeParse(name).success, false, JSON.stringify(name));
  }
});

test('emailSchema trims Unicode spaces too (NBSP from copy-paste)', () => {
  assert.equal(emailSchema.parse(' Ethan@Northstar.com '), 'ethan@northstar.com');
});

test('emailSchema rejects line breaks and NUL inside, so no header injection via the address', () => {
  for (const value of ['a@b.co\nBcc: c@d.co', 'a\n@b.co', 'a@b.co\r\nX: y', 'a@b\u0000.co']) {
    assert.equal(emailSchema.safeParse(value).success, false, JSON.stringify(value));
  }
});

test('emailSchema only takes ASCII addresses (no IDN or Unicode local part)', () => {
  // Documents today's rule: zod's email regex is ASCII-only, so a Vietnamese
  // diacritic in the local part or an IDN domain is VALIDATION_FAILED.
  for (const value of ['ánh@example.vn', 'a@bücher.de', 'İ@b.co']) {
    assert.equal(emailSchema.safeParse(value).success, false, value);
  }
});

test('emailSchema allows 254 characters and rejects 255', () => {
  const at254 = `${'a'.repeat(64)}@${'b'.repeat(185)}.com`;
  assert.equal(at254.length, 254);
  assert.ok(emailSchema.safeParse(at254).success);
  const result = emailSchema.safeParse(`a${at254}`);
  assert.equal(result.success, false);
  assert.deepEqual(toValidationIssues(result.error.issues), [
    { path: '', code: 'too_big', origin: 'string', maximum: 254 },
  ]);
});

test('password limits count Unicode code points, not UTF-16 units or bytes', () => {
  // An emoji is 2 UTF-16 units and 4 UTF-8 bytes; zod 4 measures code points.
  assert.equal(newPasswordSchema.safeParse('😀'.repeat(11)).success, false);
  assert.ok(newPasswordSchema.safeParse('😀'.repeat(12)).success);
  assert.ok(newPasswordSchema.safeParse('😀'.repeat(128)).success);
  assert.equal(newPasswordSchema.safeParse('😀'.repeat(129)).success, false);
  assert.equal(passwordSchema.safeParse('😀'.repeat(129)).success, false);
});

test('the password cap bounds the argon2 input at 512 UTF-8 bytes', () => {
  // The worst case is 128 code points of 4 bytes each.
  const longest = '😀'.repeat(128);
  assert.ok(passwordSchema.safeParse(longest).success);
  assert.equal(Buffer.byteLength(longest, 'utf8'), 512);
  assert.ok(newPasswordSchema.safeParse('x'.repeat(128)).success);
  assert.equal(newPasswordSchema.safeParse('x'.repeat(129)).success, false);
});

test('passwords are not trimmed: surrounding spaces are part of the secret', () => {
  assert.equal(passwordSchema.parse('  secret  '), '  secret  ');
});

test('countrySchema rejects non-ASCII input that uppercases into two letters', () => {
  assert.equal(countrySchema.safeParse('ß').success, false);
});

test('toValidationIssues gives array items a dotted index path', () => {
  const result = createInvitesRequestSchema.safeParse({
    emails: ['a@b.co', 'b@c.co', 'c@d.co', 'not-an-email', 42],
    role: 'MEMBER',
  });
  assert.equal(result.success, false);
  assert.deepEqual(toValidationIssues(result.error.issues), [
    { path: 'emails.3', code: 'invalid_format', format: 'email' },
    { path: 'emails.4', code: 'invalid_type', expected: 'string' },
  ]);
});

test('toValidationIssues reports array size limits on the array path', () => {
  const emails = Array.from({ length: 21 }, (_, i) => `p${i}@example.com`);
  const result = createInvitesRequestSchema.safeParse({ emails, role: 'MEMBER' });
  assert.equal(result.success, false);
  assert.deepEqual(toValidationIssues(result.error.issues), [
    { path: 'emails', code: 'too_big', origin: 'array', maximum: 20 },
  ]);
});

test('toValidationIssues reports invalid_type for a non-object body and for missing fields', () => {
  for (const body of [null, [], 'text']) {
    const result = loginRequestSchema.safeParse(body);
    assert.equal(result.success, false);
    assert.deepEqual(toValidationIssues(result.error.issues), [
      { path: '', code: 'invalid_type', expected: 'object' },
    ]);
  }
  const missing = loginRequestSchema.safeParse({});
  assert.equal(missing.success, false);
  assert.deepEqual(toValidationIssues(missing.error.issues), [
    { path: 'email', code: 'invalid_type', expected: 'string' },
    { path: 'password', code: 'invalid_type', expected: 'string' },
  ]);
});

test('toValidationIssues reduces invalid_union to its code and drops the nested errors', () => {
  const plain = z.union([z.string(), z.object({ a: z.number() })]).safeParse({ a: 'x' });
  assert.equal(plain.success, false);
  assert.deepEqual(toValidationIssues(plain.error.issues), [{ path: '', code: 'invalid_union' }]);

  const tagged = z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('a') }),
      z.object({ type: z.literal('b') }),
    ])
    .safeParse({ type: 'c' });
  assert.equal(tagged.success, false);
  assert.deepEqual(toValidationIssues(tagged.error.issues), [
    { path: 'type', code: 'invalid_union' },
  ]);
});

test('no issue type leaks English text into ValidationIssues', () => {
  // One failing value per zod issue code, each with a custom message, to
  // check that zod's default text and custom messages are both dropped.
  const english = 'ENGLISH TEXT SHOULD NOT LEAK';
  const cases: Array<[z.ZodType, unknown]> = [
    [z.string({ error: english }), 1],
    [z.string().min(3, english), 'a'],
    [z.string().max(1, english), 'ab'],
    [z.email({ error: english }), 'x'],
    [z.number().multipleOf(5, english), 3],
    [z.strictObject({}, { error: english }), { a: 1 }],
    [z.record(z.string().min(2, english), z.string()), { b: 'x' }],
    [z.union([z.string(), z.number()], { error: english }), true],
    [z.enum(['a'], { error: english }), 'b'],
    // invalid_element: zod only emits it for a Map value under a non-string key.
    [z.map(z.object({}), z.number({ error: english })), new Map([[{}, 'x']])],
    [z.string().refine(() => false, english), 'x'],
  ];
  const seen = new Set<string>();
  for (const [schema, value] of cases) {
    const result = schema.safeParse(value);
    assert.equal(result.success, false);
    const issues = toValidationIssues(result.error.issues);
    for (const issue of issues) seen.add(issue.code);
    const json = JSON.stringify(issues);
    assert.ok(!json.includes(english), json);
    assert.ok(!/Invalid|received|Too (small|big)/.test(json), json);
    // `expected` is a type name ("string"), never a sentence.
    assert.ok(
      issues.every((issue) => issue.expected === undefined || /^[a-z]+$/.test(issue.expected)),
      json,
    );
    assert.ok(
      issues.every((issue) => !('message' in issue)),
      json,
    );
  }
  for (const code of [
    'invalid_type',
    'too_small',
    'too_big',
    'invalid_format',
    'not_multiple_of',
    'unrecognized_keys',
    'invalid_key',
    'invalid_union',
    'invalid_value',
    'invalid_element',
    'custom',
  ]) {
    assert.ok(seen.has(code), `no case produced ${code}`);
  }
});
