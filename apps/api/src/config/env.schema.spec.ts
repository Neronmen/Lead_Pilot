import { randomBytes } from 'node:crypto';
import { validateEnv } from './env.schema';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/leadpilot';
const JWT_ACCESS_SECRET = 'a-test-secret-that-is-at-least-32-chars';
/** 32 bytes of base64, made for the tests only. */
const ENCRYPTION_KEY = Buffer.alloc(32, 'test-key').toString('base64');
/** The minimum a production config needs. */
const base = { DATABASE_URL, JWT_ACCESS_SECRET, ENCRYPTION_KEY };

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv(base)).toEqual({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      API_PORT: 3001,
      WEB_ORIGIN: 'http://localhost:3000',
      DATABASE_URL,
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET,
      ENCRYPTION_KEY,
      QUEUE_WORKERS: 'on',
      ENRICHMENT_PROVIDER: 'mock',
      QUEUE_PREFIX: 'bull',
      AUTH_RATE_LIMIT_PER_MINUTE: 10,
      AUTH_REFRESH_RATE_LIMIT_PER_MINUTE: 60,
      INVITE_RATE_LIMIT_PER_MINUTE: 5,
      INVITE_RATE_LIMIT_PER_DAY: 30,
      SMTP_PORT: 1025,
      EMAIL_FROM: 'LeadPilot <no-reply@leadpilot.local>',
    });
  });

  it('QUEUE_WORKERS is on or off, and QUEUE_PREFIX is a plain word', () => {
    expect(validateEnv({ ...base, QUEUE_WORKERS: 'off' }).QUEUE_WORKERS).toBe('off');
    expect(() => validateEnv({ ...base, QUEUE_WORKERS: 'yes' })).toThrow(/QUEUE_WORKERS/);
    expect(() => validateEnv({ ...base, QUEUE_PREFIX: 'a b:c' })).toThrow(/QUEUE_PREFIX/);
  });

  it('requires DATABASE_URL and only accepts postgres URLs', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
    expect(validateEnv({ ...base, DATABASE_URL: 'postgres://localhost/db' }).DATABASE_URL).toBe(
      'postgres://localhost/db',
    );
  });

  it('only accepts WEB_ORIGIN values that can match a browser Origin header', () => {
    expect(validateEnv({ ...base, WEB_ORIGIN: 'https://app.example.com' }).WEB_ORIGIN).toBe(
      'https://app.example.com',
    );
    for (const bad of [
      'localhost:3000', // parsed as scheme "localhost:"
      'http://localhost:3000/', // trailing slash
      'http://localhost:3000/app', // path
      'ftp://localhost:3000',
    ]) {
      expect(() => validateEnv({ ...base, WEB_ORIGIN: bad })).toThrow(/WEB_ORIGIN/);
    }
  });

  it('only accepts redis:// or rediss:// for REDIS_URL', () => {
    expect(validateEnv({ ...base, REDIS_URL: 'rediss://cache:6380' }).REDIS_URL).toBe(
      'rediss://cache:6380',
    );
    expect(() => validateEnv({ ...base, REDIS_URL: 'http://cache:6379' })).toThrow(/REDIS_URL/);
  });

  it('coerces the port from a string', () => {
    expect(validateEnv({ ...base, API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('rejects invalid values and names the variable without echoing its value', () => {
    const bad = { ...base, API_PORT: '70000', REDIS_URL: 'secret-not-a-url' };
    expect(() => validateEnv(bad)).toThrow(/API_PORT.*REDIS_URL/);
    expect(() => validateEnv(bad)).not.toThrow(/secret-not-a-url/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects an invalid LOG_LEVEL or WEB_ORIGIN', () => {
    expect(() => validateEnv({ ...base, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
    expect(() => validateEnv({ ...base, WEB_ORIGIN: 'not a url' })).toThrow(/WEB_ORIGIN/);
  });

  it('rejects an empty or fractional API_PORT instead of silently defaulting', () => {
    // `API_PORT=` in a .env file arrives as an empty string, not undefined.
    expect(() => validateEnv({ ...base, API_PORT: '' })).toThrow(/API_PORT/);
    expect(() => validateEnv({ ...base, API_PORT: '3001.5' })).toThrow(/API_PORT/);
    expect(() => validateEnv({ ...base, API_PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it('rejects an empty DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('returns only known variables (the rest of process.env is dropped)', () => {
    const env = validateEnv({ ...base, PATH: '/usr/bin', SOME_SECRET: 's3cr3t' });
    expect(env).not.toHaveProperty('PATH');
    expect(env).not.toHaveProperty('SOME_SECRET');
  });

  it('requires JWT_ACCESS_SECRET in production, of at least 32 characters', () => {
    expect(() => validateEnv({ DATABASE_URL })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('checks EMAIL_FROM at boot instead of at the first send', () => {
    for (const ok of ['a@b.co', 'LeadPilot <no-reply@leadpilot.local>']) {
      expect(validateEnv({ ...base, EMAIL_FROM: ok }).EMAIL_FROM).toBe(ok);
    }
    const crlf = String.fromCharCode(13, 10);
    for (const bad of [
      'nonsense',
      'Name <not-an-address>',
      `a@b.co${crlf}Bcc: x@y.z`,
      '<a@b.co>',
    ]) {
      expect(() => validateEnv({ ...base, EMAIL_FROM: bad })).toThrow(/EMAIL_FROM/);
    }
  });

  it('treats an empty SMTP_HOST as unset (demo mode)', () => {
    expect(validateEnv({ ...base, SMTP_HOST: '' }).SMTP_HOST).toBeUndefined();
    expect(validateEnv({ ...base, SMTP_HOST: 'localhost' }).SMTP_HOST).toBe('localhost');
  });

  it('refuses the dev-only secret in production', () => {
    const devSecret = validateEnv({ DATABASE_URL, NODE_ENV: 'development' }).JWT_ACCESS_SECRET;
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: devSecret })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('uses a dev-only secret outside production so the demo needs no setup', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const env = validateEnv({ DATABASE_URL, NODE_ENV });
      expect(env.JWT_ACCESS_SECRET).toMatch(/dev-only/);
    }
  });

  it('coerces AUTH_RATE_LIMIT_PER_MINUTE and rejects zero', () => {
    expect(
      validateEnv({ ...base, AUTH_RATE_LIMIT_PER_MINUTE: '30' }).AUTH_RATE_LIMIT_PER_MINUTE,
    ).toBe(30);
    expect(() => validateEnv({ ...base, AUTH_RATE_LIMIT_PER_MINUTE: '0' })).toThrow(
      /AUTH_RATE_LIMIT_PER_MINUTE/,
    );
  });

  describe('ENCRYPTION_KEY', () => {
    const dev = { DATABASE_URL, NODE_ENV: 'development' };

    it('is required in production', () => {
      expect(() => validateEnv({ DATABASE_URL, JWT_ACCESS_SECRET })).toThrow(
        /ENCRYPTION_KEY: is required in production/,
      );
      expect(() => validateEnv({ ...base, ENCRYPTION_KEY: '' })).toThrow(
        /ENCRYPTION_KEY: is required/,
      );
    });

    it('is optional outside production, where a dev-only key is used', () => {
      for (const NODE_ENV of ['development', 'test']) {
        const env = validateEnv({ DATABASE_URL, NODE_ENV });
        expect(Buffer.from(env.ENCRYPTION_KEY, 'base64')).toHaveLength(32);
      }
    });

    it('must be exactly 32 bytes of base64, in every environment (too short fails)', () => {
      const bad = [
        'short',
        Buffer.alloc(16, 'a').toString('base64'),
        Buffer.alloc(24, 'a').toString('base64'),
        Buffer.alloc(33, 'a').toString('base64'),
        Buffer.alloc(64, 'a').toString('base64'),
        `${ENCRYPTION_KEY} `,
        ENCRYPTION_KEY.replace('=', ''),
        ENCRYPTION_KEY.slice(0, 40) + '!!!=',
        'x'.repeat(44),
      ];
      for (const value of bad) {
        expect(() => validateEnv({ ...base, ENCRYPTION_KEY: value })).toThrow(/ENCRYPTION_KEY/);
        expect(() => validateEnv({ ...dev, ENCRYPTION_KEY: value })).toThrow(/ENCRYPTION_KEY/);
      }
    });

    it('is required when NODE_ENV is unset (unset behaves like production)', () => {
      expect(() => validateEnv({ DATABASE_URL, JWT_ACCESS_SECRET })).toThrow(/ENCRYPTION_KEY/);
    });

    it('refuses url-safe base64 and keys with the wrong padding', () => {
      const urlSafe = Buffer.from(Array.from({ length: 32 }, () => 0xfb)).toString('base64url');
      const standard = Buffer.from(Array.from({ length: 32 }, () => 0xfb)).toString('base64');
      expect(standard).toMatch(/[+/]/);
      expect(() => validateEnv({ ...base, ENCRYPTION_KEY: urlSafe })).toThrow(/ENCRYPTION_KEY/);
      expect(validateEnv({ ...base, ENCRYPTION_KEY: standard }).ENCRYPTION_KEY).toBe(standard);
      expect(() => validateEnv({ ...base, ENCRYPTION_KEY: `${standard}=` })).toThrow(
        /ENCRYPTION_KEY/,
      );
    });

    it('refuses a key that is only whitespace, and an all-zero key is at least 32 bytes long', () => {
      expect(() => validateEnv({ ...dev, ENCRYPTION_KEY: '   ' })).toThrow(/ENCRYPTION_KEY/);
      // Documented gap: an all-zero (weak) key has the right shape and is accepted.
      const zeros = Buffer.alloc(32).toString('base64');
      expect(validateEnv({ ...base, ENCRYPTION_KEY: zeros }).ENCRYPTION_KEY).toBe(zeros);
    });

    it('accepts a real generated key', () => {
      const key = randomBytes(32).toString('base64');
      expect(validateEnv({ ...base, ENCRYPTION_KEY: key }).ENCRYPTION_KEY).toBe(key);
    });

    it('refuses the development key in production', () => {
      const devKey = validateEnv({ DATABASE_URL, NODE_ENV: 'development' }).ENCRYPTION_KEY;
      expect(() => validateEnv({ ...base, ENCRYPTION_KEY: devKey })).toThrow(
        /must not be the development key/,
      );
      expect(validateEnv({ ...dev, ENCRYPTION_KEY: devKey }).ENCRYPTION_KEY).toBe(devKey);
    });

    it('never puts the value in the error message', () => {
      for (const value of ['short-secret-value', Buffer.alloc(16, 'z').toString('base64')]) {
        try {
          validateEnv({ ...base, ENCRYPTION_KEY: value });
          throw new Error('should have thrown');
        } catch (error) {
          expect(String(error)).not.toContain(value);
        }
      }
    });
  });
});
