import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@leadpilot/shared';
import { DomainError } from '../common/errors/domain-error';

// Messages are for developers reading logs or Swagger; the web app shows its
// own translated text for each code (SPEC §4.9).

export const invalidCredentials = () =>
  new DomainError(
    ErrorCode.AUTH_INVALID_CREDENTIALS,
    'Invalid email or password',
    HttpStatus.UNAUTHORIZED,
  );

export const tokenInvalid = () =>
  new DomainError(
    ErrorCode.AUTH_TOKEN_INVALID,
    'This link is wrong, already used or expired',
    HttpStatus.BAD_REQUEST,
  );

export const sessionExpired = () =>
  new DomainError(
    ErrorCode.AUTH_SESSION_EXPIRED,
    'Session expired; sign in again',
    HttpStatus.UNAUTHORIZED,
  );

export const refreshReused = () =>
  new DomainError(
    ErrorCode.AUTH_REFRESH_REUSED,
    'Refresh token reused; all sessions of this sign-in were revoked',
    HttpStatus.UNAUTHORIZED,
  );

/** Same code as an expired session: the web client handles both by refreshing. */
export const missingToken = () =>
  new DomainError(ErrorCode.AUTH_SESSION_EXPIRED, 'Missing bearer token', HttpStatus.UNAUTHORIZED);

export const noWorkspace = () =>
  new DomainError(
    ErrorCode.AUTH_NO_WORKSPACE,
    'This account is not a member of any workspace',
    HttpStatus.FORBIDDEN,
  );

export const emailTaken = () =>
  new DomainError(ErrorCode.EMAIL_TAKEN, 'An account with this email exists', HttpStatus.CONFLICT);

export const forbidden = () =>
  new DomainError(ErrorCode.FORBIDDEN, 'Your role cannot do this', HttpStatus.FORBIDDEN);
