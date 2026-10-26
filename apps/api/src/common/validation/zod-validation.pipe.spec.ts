import { ErrorCode, loginRequestSchema } from '@leadpilot/shared';
import { DomainError } from '../errors/domain-error';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(loginRequestSchema);

  it('returns the parsed, normalized value', () => {
    expect(pipe.transform({ email: '  Daniel.Park@Northstar.com ', password: 'secret' })).toEqual({
      email: 'daniel.park@northstar.com',
      password: 'secret',
    });
  });

  it('throws VALIDATION_FAILED with one issue per problem and no English text', () => {
    let thrown: unknown;
    try {
      pipe.transform({ email: 'nope', password: '', admin: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      status: 400,
      details: [
        { path: 'email', code: 'invalid_format', format: 'email' },
        { path: 'password', code: 'too_small', origin: 'string', minimum: 1 },
        { path: '', code: 'unrecognized_keys', values: ['admin'] },
      ],
    });
  });

  it('rejects a missing body', () => {
    expect(() => pipe.transform(undefined)).toThrow(DomainError);
  });
});
