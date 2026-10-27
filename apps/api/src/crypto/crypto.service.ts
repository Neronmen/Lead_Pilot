import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.schema';

const VERSION = 'v1';
const IV_BYTES = 12; // the size AES-GCM is designed for
const TAG_BYTES = 16;

/**
 * Encrypts small secrets for the database (HMAC signing secrets, later
 * integration tokens) with AES-256-GCM.
 *
 * Why GCM: it encrypts AND authenticates. A changed byte in the stored value
 * makes `decrypt` throw instead of returning garbage. Every value gets its own
 * random IV (the "nonce"): reusing an IV with the same key would break GCM, so
 * it is never derived or reused.
 *
 * `aad` (additional authenticated data) ties a value to the row it belongs to,
 * e.g. `source:<workspaceId>:<id>`: a ciphertext copied onto another row fails
 * to decrypt. It is not stored; the caller rebuilds it.
 *
 * Stored form: `v1:<base64 of iv | tag | ciphertext>`. The version prefix lets
 * the format (or the key) change later without guessing.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    this.key = Buffer.from(config.get('ENCRYPTION_KEY', { infer: true }), 'base64');
    if (this.key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes');
  }

  encrypt(plaintext: string, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
  }

  /** Throws when the value was changed, was made with another key, or belongs to another `aad`. */
  decrypt(stored: string, aad: string): string {
    const parts = stored.split(':');
    const [version, payload] = parts;
    // Strict on purpose: Buffer.from(…, 'base64') silently skips stray characters.
    if (
      parts.length !== 2 ||
      version !== VERSION ||
      !payload ||
      !/^[A-Za-z0-9+/]+=*$/.test(payload)
    ) {
      throw new Error('Unsupported encrypted value');
    }
    const raw = Buffer.from(payload, 'base64');
    if (raw.length < IV_BYTES + TAG_BYTES) throw new Error('Encrypted value is too short');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    return Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}
