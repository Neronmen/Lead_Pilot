import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import type { Env } from '../config/env.schema';
import { CryptoService } from './crypto.service';

const AAD = 'source:w:1';
const keyOf = (bytes: Buffer) => bytes.toString('base64');
const serviceWith = (key: string) =>
  new CryptoService({ get: () => key } as unknown as ConfigService<Env, true>);

describe('CryptoService (AES-256-GCM)', () => {
  const key = keyOf(randomBytes(32));
  const crypto = serviceWith(key);

  it('gives back what was put in, for any text', () => {
    for (const text of ['', 'whsec_abc', 'tiếng Việt ✓ 🚀', 'a'.repeat(10_000), 'line\nbreak']) {
      expect(crypto.decrypt(crypto.encrypt(text, AAD), AAD)).toBe(text);
    }
  });

  it('stores a versioned value that does not contain the text', () => {
    const stored = crypto.encrypt('whsec_super-secret-value', AAD);
    expect(stored).toMatch(/^v1:[A-Za-z0-9+/]+=*$/);
    expect(stored).not.toContain('super-secret');
    expect(Buffer.from(stored.slice(3), 'base64').toString('latin1')).not.toContain('super-secret');
  });

  it('uses a fresh random IV every time: the same text never encrypts the same way twice', () => {
    const values = new Set(Array.from({ length: 50 }, () => crypto.encrypt('same text', AAD)));
    expect(values.size).toBe(50);
  });

  it('refuses a value that was changed anywhere (the GCM tag protects every byte)', () => {
    const stored = crypto.encrypt('whsec_abcdefghijklmnop', AAD);
    const raw = Buffer.from(stored.slice(3), 'base64');
    for (let i = 0; i < raw.length; i += 1) {
      const changed = Buffer.from(raw);
      changed[i] = changed[i]! ^ 0x01;
      expect(() => crypto.decrypt(`v1:${changed.toString('base64')}`, AAD)).toThrow();
    }
  });

  it('refuses a value made with another key', () => {
    const other = serviceWith(keyOf(randomBytes(32)));
    expect(() => crypto.decrypt(other.encrypt('secret', AAD), AAD)).toThrow();
  });

  it.each(['', 'v1:', 'v2:abc', 'plain text', 'v1:AAAA', 'v1:not base64 !!'])(
    'rejects the malformed stored value %j without returning anything',
    (stored) => {
      expect(() => crypto.decrypt(stored, AAD)).toThrow();
    },
  );

  it('refuses a value cut short, or with the tag or the IV removed', () => {
    const raw = Buffer.from(crypto.encrypt('whsec_abcdefghijklmnop', AAD).slice(3), 'base64');
    for (const cut of [raw.subarray(0, raw.length - 1), raw.subarray(0, 27), raw.subarray(12)]) {
      expect(() => crypto.decrypt(`v1:${cut.toString('base64')}`, AAD)).toThrow();
    }
    // A tag-only value (empty text) must still verify, but not with its tag swapped for zeros.
    const empty = Buffer.from(crypto.encrypt('', AAD).slice(3), 'base64');
    expect(empty).toHaveLength(28);
    empty.fill(0, 12, 28);
    expect(() => crypto.decrypt(`v1:${empty.toString('base64')}`, AAD)).toThrow();
  });

  it('refuses a value with a swapped-in version or extra parts after the payload', () => {
    const stored = crypto.encrypt('whsec_abc', AAD);
    expect(() => crypto.decrypt(stored.replace('v1:', 'V1:'), AAD)).toThrow();
    expect(() => crypto.decrypt(stored.replace('v1:', 'v1::'), AAD)).toThrow();
    // Anything after a second colon is not part of the format: a strict reader refuses it.
    expect(() => crypto.decrypt(`${stored}:extra`, AAD)).toThrow();
  });

  it('refuses a value with whitespace or other non-base64 characters mixed in', () => {
    const stored = crypto.encrypt('whsec_abc', AAD);
    expect(() => crypto.decrypt(`${stored}\n`, AAD)).toThrow();
    expect(() => crypto.decrypt(`v1:${stored.slice(3, 10)} ${stored.slice(10)}`, AAD)).toThrow();
  });

  it('error messages are generic: no plaintext, no key, no stored value', () => {
    const stored = crypto.encrypt('whsec_plain-secret', AAD);
    const raw = Buffer.from(stored.slice(3), 'base64');
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    const tampered = `v1:${raw.toString('base64')}`;
    try {
      crypto.decrypt(tampered, AAD);
      throw new Error('should have thrown');
    } catch (error) {
      const text = String(error);
      expect(text).not.toContain('plain-secret');
      expect(text).not.toContain(key);
      expect(text).not.toContain(tampered);
    }
  });

  it('refuses a value moved to another row (different aad)', () => {
    const stored = crypto.encrypt('whsec_abc', 'source:w:1');
    expect(() => crypto.decrypt(stored, 'source:w:2')).toThrow();
    expect(() => crypto.decrypt(stored, '')).toThrow();
    expect(crypto.decrypt(stored, 'source:w:1')).toBe('whsec_abc');
  });

  it('does not start with a key that is not 32 bytes', () => {
    expect(() => serviceWith(keyOf(randomBytes(16)))).toThrow('32 bytes');
    expect(() => serviceWith(keyOf(randomBytes(33)))).toThrow('32 bytes');
    expect(() => serviceWith('')).toThrow('32 bytes');
  });

  it('never puts the key or the text into an error message', () => {
    try {
      crypto.decrypt('v1:AAAA', AAD);
    } catch (error) {
      expect(String(error)).not.toContain(key);
    }
    try {
      serviceWith('short');
    } catch (error) {
      expect(String(error)).not.toContain('short');
    }
  });
});
