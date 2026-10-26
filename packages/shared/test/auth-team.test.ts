import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptInviteRequestSchema,
  changeRoleRequestSchema,
  createInvitesRequestSchema,
  emailSchema,
  loginRequestSchema,
  newAccountSchema,
  signupRequestSchema,
  toValidationIssues,
  updateMeRequestSchema,
} from '../src/index.ts';

const signup = {
  name: 'Chloe Martin',
  workspaceName: 'Harbour & Pine',
  email: 'chloe@harbourandpine.com.au',
  password: 'harbour-pine-2026!',
  locale: 'en',
  currency: 'USD',
  defaultCountry: 'au',
};

test('emailSchema trims and lowercases before checking', () => {
  assert.equal(emailSchema.parse('  Chloe@HarbourAndPine.com.au '), 'chloe@harbourandpine.com.au');
  assert.equal(emailSchema.safeParse('not-an-email').success, false);
});

test('signupRequestSchema accepts the Signup design fields and normalizes them', () => {
  const parsed = signupRequestSchema.parse(signup);
  assert.equal(parsed.defaultCountry, 'AU');
  assert.ok(signupRequestSchema.safeParse({ ...signup, defaultCountry: undefined }).success);
});

test('signupRequestSchema enforces the 12-character password and rejects extra keys', () => {
  assert.equal(signupRequestSchema.safeParse({ ...signup, password: 'short-pass' }).success, false);
  assert.equal(
    signupRequestSchema.safeParse({ ...signup, password: 'x'.repeat(129) }).success,
    false,
  );
  // Unknown keys are rejected, so a client cannot slip in e.g. a role.
  assert.equal(signupRequestSchema.safeParse({ ...signup, role: 'OWNER' }).success, false);
});

test('loginRequestSchema does not apply the new-password rule', () => {
  assert.ok(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'old' }).success);
  assert.equal(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success, false);
});

test('invites and role changes can never grant OWNER', () => {
  assert.equal(
    createInvitesRequestSchema.safeParse({ emails: ['a@b.co'], role: 'OWNER' }).success,
    false,
  );
  assert.equal(changeRoleRequestSchema.safeParse({ role: 'OWNER' }).success, false);
  assert.ok(changeRoleRequestSchema.safeParse({ role: 'ADMIN' }).success);
});

test('createInvitesRequestSchema takes 1 to 20 normalized addresses', () => {
  const parsed = createInvitesRequestSchema.parse({
    emails: [' Ethan@Northstar.com '],
    role: 'MEMBER',
  });
  assert.deepEqual(parsed.emails, ['ethan@northstar.com']);
  assert.equal(createInvitesRequestSchema.safeParse({ emails: [], role: 'MEMBER' }).success, false);
  const many = Array.from({ length: 21 }, (_, i) => `p${i}@example.com`);
  assert.equal(
    createInvitesRequestSchema.safeParse({ emails: many, role: 'MEMBER' }).success,
    false,
  );
});

test('accepting an invite: any password for an existing account, the new rules for a new one', () => {
  const token = 'a'.repeat(43);
  assert.ok(acceptInviteRequestSchema.safeParse({ token, password: 'old' }).success);
  assert.equal(newAccountSchema.safeParse({ name: 'Ethan', password: 'old' }).success, false);
  assert.equal(newAccountSchema.safeParse({ password: 'long-enough-pass' }).success, false);
  assert.equal(
    acceptInviteRequestSchema.safeParse({ token: 'short', password: 'x' }).success,
    false,
  );
});

test('updateMeRequestSchema accepts a locale or null', () => {
  assert.ok(updateMeRequestSchema.safeParse({ locale: 'vi' }).success);
  assert.ok(updateMeRequestSchema.safeParse({ locale: null }).success);
  assert.equal(updateMeRequestSchema.safeParse({ locale: 'fr' }).success, false);
});

test('toValidationIssues keeps the code, path and limits but no English text', () => {
  const result = signupRequestSchema.safeParse({
    ...signup,
    email: 'nope',
    password: 'short',
    locale: 'fr',
    extra: true,
  });
  assert.equal(result.success, false);
  const issues = toValidationIssues(result.error.issues);
  assert.deepEqual(issues, [
    { path: 'email', code: 'invalid_format', format: 'email' },
    { path: 'password', code: 'too_small', origin: 'string', minimum: 12 },
    { path: 'locale', code: 'invalid_value', values: ['en', 'vi'] },
    { path: '', code: 'unrecognized_keys', values: ['extra'] },
  ]);
  assert.ok(issues.every((issue) => !('message' in issue)));
});

test('toValidationIssues caps echoed unknown keys', () => {
  const body: Record<string, number> = { email: 0, password: 0 };
  for (let i = 0; i < 30; i += 1) body[`${'k'.repeat(1000)}${i}`] = i;
  const result = loginRequestSchema.safeParse(body);
  assert.equal(result.success, false);
  const unknown = toValidationIssues(result.error.issues).find(
    (issue) => issue.code === 'unrecognized_keys',
  );
  assert.equal(unknown?.values?.length, 10);
  assert.ok(unknown?.values?.every((key) => key.length === 64));
});

test('signupRequestSchema accepts null or no defaultCountry', () => {
  assert.equal(signupRequestSchema.parse({ ...signup, defaultCountry: null }).defaultCountry, null);
});

test('emailSchema accepts only real top-level domains, from an offline list', () => {
  for (const ok of [
    'a@gmail.com',
    'a@b.co',
    'a@x.museum',
    'a@x.technology',
    'a@x.vn',
    'a@x.com.vn',
  ]) {
    assert.ok(emailSchema.safeParse(ok).success, ok);
  }
  // Typos of real endings and names reserved for tests are refused.
  for (const bad of [
    'a@gmail.cmo',
    'a@gmail.con',
    'a@b.test',
    'a@b.local',
    'a@b.invalid',
    'a@b.example',
    'a@b.localhost',
  ]) {
    const result = emailSchema.safeParse(bad);
    assert.equal(result.success, false, bad);
    assert.deepEqual(toValidationIssues(result.error.issues), [
      { path: '', code: 'custom', format: 'unknown_tld' },
    ]);
  }
  // A malformed address is still reported as a malformed address.
  assert.deepEqual(toValidationIssues(emailSchema.safeParse('nope').error?.issues ?? []), [
    { path: '', code: 'invalid_format', format: 'email' },
  ]);
});

test('sign-up and invites apply the ending check; login does not, so legacy accounts can sign in', () => {
  const login = loginRequestSchema.safeParse({ email: ' A@B.cmo ', password: 'x' });
  assert.ok(login.success);
  assert.equal(login.data.email, 'a@b.cmo'); // normalised only
  const invite = createInvitesRequestSchema.safeParse({
    emails: ['a@b.co', 'c@d.cmo'],
    role: 'MEMBER',
  });
  assert.equal(invite.success, false);
  assert.deepEqual(toValidationIssues(invite.error.issues), [
    { path: 'emails.1', code: 'custom', format: 'unknown_tld' },
  ]);
});

test('the generated TLD list matches the installed tlds package', async () => {
  const { createRequire } = await import('node:module');
  const { TLDS } = await import('../src/tlds.ts');
  const installed = (createRequire(`${process.cwd()}/package.json`)('tlds') as string[])
    .filter((tld) => /^[a-z]+$/.test(tld))
    .sort();
  // Fails after upgrading `tlds` until `pnpm --filter @leadpilot/shared tlds` is run.
  assert.deepEqual([...TLDS], installed);
});
