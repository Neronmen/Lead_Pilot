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
import { DomainError } from '../errors/domain-error';

export interface ErrorResponse {
  status: number;
  body: ErrorBody;
}

/** Codes that differ from the HttpStatus name (404 -> NOT_FOUND needs no entry). */
const CODE_BY_STATUS: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_FAILED,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
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

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status >= 500) return INTERNAL_ERROR;
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
