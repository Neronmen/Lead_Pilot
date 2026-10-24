import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv({})).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_PORT: 3001,
      WEB_ORIGIN: 'http://localhost:3000',
      REDIS_URL: 'redis://localhost:6379',
    });
  });

  it('coerces the port from a string', () => {
    expect(validateEnv({ API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('rejects invalid values and names the variable without echoing its value', () => {
    expect(() => validateEnv({ API_PORT: '70000', REDIS_URL: 'secret-not-a-url' })).toThrow(
      /API_PORT.*REDIS_URL/,
    );
    expect(() => validateEnv({ REDIS_URL: 'secret-not-a-url' })).not.toThrow(/secret-not-a-url/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
