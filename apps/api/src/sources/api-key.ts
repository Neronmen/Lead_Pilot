import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * API keys look like `lp_<prefix>.<secret>`:
 * - the prefix (8 hex characters) is public. It is stored in clear, shown in the
 *   UI, and used to find the source quickly;
 * - the secret (32 random bytes) is shown once, then only its SHA-256 hash is kept.
 *
 * Why a fast hash and not argon2 here: a password is short and guessable, so it
 * needs a slow hash. This secret is 256 random bits, so guessing is hopeless and a
 * fast hash is both safe and cheap enough to check on every request.
 */
const KEY = /^lp_([0-9a-f]{8})\.([A-Za-z0-9_-]{43})$/;

export interface NewApiKey {
  /** The whole key: show it once, never store it. */
  key: string;
  prefix: string;
  hash: string;
}

export function newApiKey(): NewApiKey {
  const prefix = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { key: `lp_${prefix}.${secret}`, prefix, hash: hashApiKey(`lp_${prefix}.${secret}`) };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** The prefix inside a presented key, or null when it is not shaped like one. */
export function apiKeyPrefix(key: string): string | null {
  return KEY.exec(key)?.[1] ?? null;
}

/** Constant-time comparison of a presented key with the stored hash. */
export function apiKeyMatches(key: string, storedHash: string): boolean {
  const presented = Buffer.from(hashApiKey(key), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

/** A signing secret for HMAC (shown once, kept encrypted so requests can be checked). */
export function newHmacSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}
