import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorCode, type ErrorBody } from '@leadpilot/shared';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { DomainError } from '../errors/domain-error';

export interface ErrorResponse {
  status: number;
  body: ErrorBody;
}

/** Codes that differ from the HttpStatus name (404 -> NOT_FOUND needs no entry). */
const CODE_BY_STATUS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCode.INTERNAL,
};

/**
 * Prisma errors a request can cause by itself (a duplicate, a row that is not
 * there or not in the caller's workspace, a reference that does not exist).
 * The message is generic on purpose: Prisma's own text names tables and
 * columns. Any other Prisma error is a bug and stays a 500.
 *
 * P2003 is meant for "still in use" (a delete blocked by a foreign key).
 * Services check ids taken from a request through the scoped client first and
 * throw a domain NOT_FOUND or VALIDATION error, so a missing or foreign
 * reference never reaches the database as P2003.
 */
const PRISMA_ERRORS: Partial<Record<string, ErrorResponse>> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    body: { error: { code: ErrorCode.CONFLICT, message: 'Resource already exists' } },
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    body: {
      error: { code: ErrorCode.CONFLICT, message: 'Referenced resource is missing or in use' },
    },
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    body: { error: { code: ErrorCode.NOT_FOUND, message: 'Resource not found' } },
  },
};

const INTERNAL_ERROR: ErrorResponse = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  body: { error: { code: ErrorCode.INTERNAL, message: 'Internal server error' } },
};

/** The one place where any thrown error becomes the API's error envelope. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = toErrorResponse(exception);
    if (status >= 500) {
      this.logger.error({ err: exception }, 'Unhandled exception');
    }
    response.status(status).json(body);
  }
}

export function toErrorResponse(exception: unknown): ErrorResponse {
  if (exception instanceof DomainError) {
    return {
      status: exception.status,
      body: envelope(exception.code, exception.message, exception.details),
    };
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    return PRISMA_ERRORS[exception.code] ?? INTERNAL_ERROR;
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    // Keep the real status (a 503 tells clients to retry, a 500 does not), but
    // never pass a server-side message through: it may describe internals.
    if (status >= 500) {
      return { status, body: envelope(codeForStatus(status), INTERNAL_ERROR.body.error.message) };
    }
    const { message, details } = readHttpExceptionBody(exception);
    return { status, body: envelope(codeForStatus(status), message, details) };
  }

  // Nest already turns malformed JSON into a BadRequestException, but other
  // body-parser errors (e.g. 413 payload too large) arrive as raw http-errors
  // objects with a 4xx status and `expose: true`.
  if (isExposedClientError(exception)) {
    return {
      status: exception.status,
      body: envelope(codeForStatus(exception.status), exception.message),
    };
  }

  return INTERNAL_ERROR;
}

function envelope(code: string, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

function codeForStatus(status: number): string {
  return CODE_BY_STATUS[status] ?? HttpStatus[status] ?? 'HTTP_ERROR';
}

function readHttpExceptionBody(exception: HttpException): { message: string; details?: unknown } {
  const response = exception.getResponse();
  if (typeof response === 'object' && response !== null && 'message' in response) {
    const { message } = response;
    // Validation pipes report a list of problems: keep them as details.
    if (Array.isArray(message)) return { message: 'Validation failed', details: message };
    if (typeof message === 'string') return { message };
  }
  return { message: exception.message };
}

interface ExposedClientError {
  status: number;
  message: string;
}

function isExposedClientError(value: unknown): value is ExposedClientError {
  if (!(value instanceof Error)) return false;
  const candidate = value as Error & { status?: unknown; expose?: unknown };
  return (
    candidate.expose === true &&
    typeof candidate.status === 'number' &&
    candidate.status >= 400 &&
    candidate.status < 500
  );
}
