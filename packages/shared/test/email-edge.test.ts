import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailSchema, hasRealTld, signupRequestSchema, toValidationIssues } from '../src/index.ts';

// Edge cases for the email ending check: case, whitespace, odd domains and
// newer endings. The check is offline, so none of this touches the network.

const parse = (value: unknown) => emailSchema.safeParse(value);

test('emailSchema trims, lowercases, and keeps plus-addressing', () => {
  assert.equal(parse('  A@B.COM ').data, 'a@b.com');
  assert.equal(parse('A+Promo.Tag@Example.Com').data, 'a+promo.tag@example.com');
  // Leading and trailing line breaks are whitespace: trimmed, not injected.
  assert.equal(parse('\n a@b.com\r\n').data, 'a@b.com');
});

test('emailSchema accepts new generic endings and country-code second levels', () => {
  for (const ok of [
    'a@b.dev',
    'a@b.app',
    'a@b.xyz',
    'a@b.vn',
    'a@b.com.vn',
    'a@mail.example.co.uk',
    'a@deep.sub.domain.example.com',
  ]) {
    assert.equal(parse(ok).success, true, ok);
  }
});

test('emailSchema checks only the last label: a real ending hides nothing else', () => {
  // ".om" is Oman, so this is a valid address by the rule, as is a subdomain named "test".
  assert.equal(parse('a@b.c.om').success, true);
  assert.equal(parse('a@test.example.com').success, true);
  // A real word earlier in the name does not rescue an unknown ending.
  assert.equal(parse('a@example.com.cmo').success, false);
});

test('emailSchema refuses malformed shapes as invalid_format, not as an unknown ending', () => {
  for (const bad of [
    'a@b.com.', // trailing dot
    'a@[1.2.3.4]', // IP literal
    'a@b..com',
    'a@.com',
    'a@localhost',
    'a@b.123', // numeric ending
    'a@b.xn--p1ai', // internationalised ending
    'a@b.Ｃom', // full-width letter
    'a@b.c​om', // zero-width space inside
    '"a b"@b.com',
    '',
    ' ',
  ]) {
    const result = parse(bad);
    assert.equal(result.success, false, JSON.stringify(bad));
    const formats = toValidationIssues(result.error.issues).map((issue) => issue.format);
    assert.ok(!formats.includes('unknown_tld'), `${JSON.stringify(bad)} -> ${formats}`);
  }
});

test('emailSchema refuses every non-string without throwing', () => {
  for (const bad of [undefined, null, 7, {}, ['a@b.com']]) {
    assert.equal(parse(bad).success, false);
  }
});

test('emailSchema keeps the 254 character limit', () => {
  assert.equal(parse(`${'a'.repeat(250)}@b.com`).success, false);
});

test('hasRealTld is case-insensitive and only looks after the last dot', () => {
  assert.equal(hasRealTld('a@b.COM'), true);
  assert.equal(hasRealTld('a@b.cmo'), false);
  assert.equal(hasRealTld('nodots'), false);
  assert.equal(hasRealTld('a@b.'), false);
});

test('signup reports an unknown ending on the email field, with the form-friendly format', () => {
  const result = signupRequestSchema.safeParse({
    name: 'Chloe Martin',
    workspaceName: 'Harbour & Pine',
    email: 'chloe@harbourandpine.cmo',
    password: 'harbour-pine-2026!',
    locale: 'en',
    currency: 'USD',
  });
  assert.equal(result.success, false);
  assert.deepEqual(toValidationIssues(result.error.issues), [
    { path: 'email', code: 'custom', format: 'unknown_tld' },
  ]);
});
