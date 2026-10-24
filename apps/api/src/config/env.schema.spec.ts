import { validateEnv } from './env.schema';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/leadpilot';

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      API_PORT: 3001,
      WEB_ORIGIN: 'http://localhost:3000',
      DATABASE_URL,
      REDIS_URL: 'redis://localhost:6379',
    });
  });

  it('requires DATABASE_URL and only accepts postgres URLs', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/);
    expect(validateEnv({ DATABASE_URL: 'postgres://localhost/db' }).DATABASE_URL).toBe(
      'postgres://localhost/db',
    );
  });

  it('only accepts WEB_ORIGIN values that can match a browser Origin header', () => {
    expect(validateEnv({ DATABASE_URL, WEB_ORIGIN: 'https://app.example.com' }).WEB_ORIGIN).toBe(
      'https://app.example.com',
    );
    for (const bad of [
      'localhost:3000', // parsed as scheme "localhost:"
      'http://localhost:3000/', // trailing slash
      'http://localhost:3000/app', // path
      'ftp://localhost:3000',
    ]) {
      expect(() => validateEnv({ DATABASE_URL, WEB_ORIGIN: bad })).toThrow(/WEB_ORIGIN/);
    }
  });

  it('only accepts redis:// or rediss:// for REDIS_URL', () => {
    expect(validateEnv({ DATABASE_URL, REDIS_URL: 'rediss://cache:6380' }).REDIS_URL).toBe(
      'rediss://cache:6380',
    );
    expect(() => validateEnv({ DATABASE_URL, REDIS_URL: 'http://cache:6379' })).toThrow(
      /REDIS_URL/,
    );
  });

  it('coerces the port from a string', () => {
    expect(validateEnv({ DATABASE_URL, API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('rejects invalid values and names the variable without echoing its value', () => {
    const bad = { DATABASE_URL, API_PORT: '70000', REDIS_URL: 'secret-not-a-url' };
    expect(() => validateEnv(bad)).toThrow(/API_PORT.*REDIS_URL/);
    expect(() => validateEnv(bad)).not.toThrow(/secret-not-a-url/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ DATABASE_URL, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects an invalid LOG_LEVEL or WEB_ORIGIN', () => {
    expect(() => validateEnv({ DATABASE_URL, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
    expect(() => validateEnv({ DATABASE_URL, WEB_ORIGIN: 'not a url' })).toThrow(/WEB_ORIGIN/);
  });

  it('rejects an empty or fractional API_PORT instead of silently defaulting', () => {
    // `API_PORT=` in a .env file arrives as an empty string, not undefined.
    expect(() => validateEnv({ DATABASE_URL, API_PORT: '' })).toThrow(/API_PORT/);
    expect(() => validateEnv({ DATABASE_URL, API_PORT: '3001.5' })).toThrow(/API_PORT/);
    expect(() => validateEnv({ DATABASE_URL, API_PORT: 'abc' })).toThrow(/API_PORT/);
  });

  it('rejects an empty DATABASE_URL', () => {
    expect(() => validateEnv({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('returns only known variables (the rest of process.env is dropped)', () => {
    const env = validateEnv({ DATABASE_URL, PATH: '/usr/bin', SOME_SECRET: 's3cr3t' });
    expect(env).not.toHaveProperty('PATH');
    expect(env).not.toHaveProperty('SOME_SECRET');
  });
});
