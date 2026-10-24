import { validateEnv } from './env.schema';

const DATABASE_URL = 'postgresql://user:pass@localhost:5432/leadpilot';

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv({ DATABASE_URL })).toEqual({
      NODE_ENV: 'development',
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
});
