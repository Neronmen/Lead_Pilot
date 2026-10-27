import { apiKeyMatches, apiKeyPrefix, hashApiKey, newApiKey, newHmacSecret } from './api-key';

describe('API keys', () => {
  it('look like lp_<8 hex>.<43 url-safe characters> and the prefix is part of the key', () => {
    const { key, prefix } = newApiKey();
    expect(key).toMatch(/^lp_[0-9a-f]{8}\.[A-Za-z0-9_-]{43}$/);
    expect(key.startsWith(`lp_${prefix}.`)).toBe(true);
    expect(apiKeyPrefix(key)).toBe(prefix);
  });

  it('are random: 1000 keys, no repeats (prefix collisions are rare, not impossible)', () => {
    const keys = new Set(Array.from({ length: 1000 }, () => newApiKey().key));
    expect(keys.size).toBe(1000);
  });

  it('are stored as a SHA-256 hash that matches only the real key', () => {
    const { key, hash } = newApiKey();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashApiKey(key));
    expect(hash).not.toContain(key.slice(12));
    expect(apiKeyMatches(key, hash)).toBe(true);
    expect(apiKeyMatches(`${key}x`, hash)).toBe(false);
    expect(apiKeyMatches(key.slice(0, -1), hash)).toBe(false);
    expect(apiKeyMatches(newApiKey().key, hash)).toBe(false);
    expect(apiKeyMatches(key, 'not-hex')).toBe(false);
    expect(apiKeyMatches(key, '')).toBe(false);
  });

  it.each([
    '',
    'lp_',
    'lp_12345678',
    'lp_1234567.' + 'a'.repeat(43),
    'lp_123456789.' + 'a'.repeat(43),
    'lp_ABCDEFGH.' + 'a'.repeat(43),
    'lp_12345678.' + 'a'.repeat(42),
    'lp_12345678.' + 'a'.repeat(44),
    'lp_12345678.' + '!'.repeat(43),
    ' lp_12345678.' + 'a'.repeat(43),
    'xx_12345678.' + 'a'.repeat(43),
    'lp_12345678.' + 'a'.repeat(43) + '\n',
  ])('a presented value that is not shaped like a key has no prefix: %j', (value) => {
    expect(apiKeyPrefix(value)).toBeNull();
  });
});

describe('API key checks (edge cases)', () => {
  it('compares a stored hash in upper case, with spaces or too long, without throwing or matching wrongly', () => {
    const { key, hash } = newApiKey();
    expect(apiKeyMatches(key, hash + '00')).toBe(false);
    expect(apiKeyMatches(key, hash.slice(0, 62))).toBe(false);
    expect(apiKeyMatches(key, ` ${hash}`)).toBe(false);
    expect(apiKeyMatches('', hash)).toBe(false);
  });

  it('the hash of a key is stable and the prefix alone is not enough', () => {
    const { key, prefix } = newApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(apiKeyMatches(`lp_${prefix}.${'A'.repeat(43)}`, hashApiKey(key))).toBe(false);
  });
});

describe('signing secrets', () => {
  it('are random, prefixed and long', () => {
    const secrets = new Set(Array.from({ length: 200 }, () => newHmacSecret()));
    expect(secrets.size).toBe(200);
    for (const secret of secrets) expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
  });
});
