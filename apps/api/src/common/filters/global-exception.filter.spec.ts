import {
  type ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  ServiceUnavailableException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ErrorCode } from '@leadpilot/shared';
import { Prisma } from '../../generated/prisma/client';
import { DomainError } from '../errors/domain-error';
import { GlobalExceptionFilter, toErrorResponse } from './global-exception.filter';

describe('toErrorResponse', () => {
  it('maps a DomainError to its own status, code and details', () => {
    const error = new DomainError('LEAD_NOT_FOUND', 'Lead not found', HttpStatus.NOT_FOUND, {
      leadId: 'abc',
    });
    expect(toErrorResponse(error)).toEqual({
      status: 404,
      body: {
        error: { code: 'LEAD_NOT_FOUND', message: 'Lead not found', details: { leadId: 'abc' } },
      },
    });
  });

  it('omits details when a DomainError has none', () => {
    const { body } = toErrorResponse(
      new DomainError('CONFLICT', 'Already exists', HttpStatus.CONFLICT),
    );
    expect(body.error).not.toHaveProperty('details');
  });

  it('derives the code from the HTTP status for Nest exceptions', () => {
    expect(toErrorResponse(new NotFoundException('Cannot GET /nope'))).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Cannot GET /nope' } },
    });
    expect(toErrorResponse(new ForbiddenException()).body.error.code).toBe('FORBIDDEN');
  });

  it('maps 400 to VALIDATION_FAILED and keeps a list of problems as details', () => {
    const error = new BadRequestException(['email must be an email', 'name is required']);
    expect(toErrorResponse(error)).toEqual({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: ['email must be an email', 'name is required'],
        },
      },
    });
  });

  it('handles raw http-errors from Express middleware (e.g. 413)', () => {
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });
    expect(toErrorResponse(error)).toEqual({
      status: 413,
      body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'request entity too large' } },
    });
  });

  it('never leaks the message of unknown or 5xx errors', () => {
    const expected = {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'Internal server error' } },
    };
    expect(toErrorResponse(new Error('connect ECONNREFUSED 10.0.0.5:5432'))).toEqual(expected);
    expect(toErrorResponse(new InternalServerErrorException('db password wrong'))).toEqual(
      expected,
    );
    expect(toErrorResponse('a thrown string')).toEqual(expected);
    // An Error with a status but without `expose` is not trusted.
    expect(toErrorResponse(Object.assign(new Error('x'), { status: 400 }))).toEqual(expected);
  });

  it('keeps the status of other 5xx exceptions but hides their message', () => {
    expect(toErrorResponse(new ServiceUnavailableException('redis at 10.0.0.7 is down'))).toEqual({
      status: 503,
      body: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Internal server error' } },
    });
  });
});

describe('toErrorResponse for Prisma errors', () => {
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`workspaceId`,`email`) in table "Lead"',
      { code, clientVersion: 'test', meta: { modelName: 'Lead' } },
    );

  it.each([
    ['P2002', 409, ErrorCode.CONFLICT],
    ['P2003', 409, ErrorCode.CONFLICT],
    ['P2025', 404, ErrorCode.NOT_FOUND],
  ])('maps %s to %i %s', (code, status, errorCode) => {
    expect(toErrorResponse(prismaError(code))).toMatchObject({
      status,
      body: { error: { code: errorCode } },
    });
  });

  it('never passes Prisma text (table and column names) to the client', () => {
    const { body } = toErrorResponse(prismaError('P2002'));
    expect(JSON.stringify(body)).not.toMatch(/Lead|workspaceId|email|constraint/);
    expect(body.error).not.toHaveProperty('details');
  });

  it('keeps other Prisma errors a 500', () => {
    expect(toErrorResponse(prismaError('P2034'))).toEqual({
      status: 500,
      body: { error: { code: ErrorCode.INTERNAL, message: 'Internal server error' } },
    });
  });
});

describe('toErrorResponse edge cases', () => {
  it('maps every shared ErrorCode that has an HTTP status', () => {
    const cases: [HttpException, string][] = [
      [new BadRequestException(), ErrorCode.VALIDATION_FAILED],
      [new UnauthorizedException(), ErrorCode.UNAUTHORIZED],
      [new ForbiddenException(), ErrorCode.FORBIDDEN],
      [new NotFoundException(), ErrorCode.NOT_FOUND],
      [new ConflictException(), ErrorCode.CONFLICT],
      [new HttpException('Slow down', HttpStatus.TOO_MANY_REQUESTS), ErrorCode.RATE_LIMITED],
    ];
    for (const [exception, code] of cases) {
      const { status, body } = toErrorResponse(exception);
      expect({ status, code: body.error.code }).toEqual({ status: exception.getStatus(), code });
    }
  });

  it('uses a plain string response as the message', () => {
    expect(toErrorResponse(new HttpException('Gone for good', HttpStatus.GONE))).toEqual({
      status: 410,
      body: { error: { code: 'GONE', message: 'Gone for good' } },
    });
  });

  it('keeps a single-string 400 message without details', () => {
    expect(toErrorResponse(new BadRequestException('email is invalid'))).toEqual({
      status: 400,
      body: { error: { code: 'VALIDATION_FAILED', message: 'email is invalid' } },
    });
  });

  it('falls back to the exception message for an object response without `message`', () => {
    const exception = new HttpException({ reason: 'internal-detail' }, HttpStatus.CONFLICT);
    const { status, body } = toErrorResponse(exception);
    expect(status).toBe(409);
    expect(body).toEqual({ error: { code: 'CONFLICT', message: exception.message } });
    expect(JSON.stringify(body)).not.toContain('internal-detail');
  });

  it('uses HTTP_ERROR for a 4xx status that has no HttpStatus name', () => {
    expect(toErrorResponse(new HttpException('Client closed', 499)).body.error.code).toBe(
      'HTTP_ERROR',
    );
  });

  it('maps an exposed 401 http-error and does not trust an exposed 5xx', () => {
    const unauthorized = Object.assign(new Error('bad credentials'), { status: 401, expose: true });
    expect(toErrorResponse(unauthorized)).toEqual({
      status: 401,
      body: { error: { code: 'UNAUTHORIZED', message: 'bad credentials' } },
    });
    const server = Object.assign(new Error('upstream at 10.0.0.9'), { status: 502, expose: true });
    expect(toErrorResponse(server).body.error).toEqual({
      code: 'INTERNAL',
      message: 'Internal server error',
    });
  });

  it('DomainError defaults to 400 and subclasses keep their own name', () => {
    class LeadNotFoundError extends DomainError {
      constructor() {
        super('LEAD_NOT_FOUND', 'Lead not found', HttpStatus.NOT_FOUND);
      }
    }
    const error = new LeadNotFoundError();
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe('LeadNotFoundError');
    expect(toErrorResponse(error).status).toBe(404);
    expect(toErrorResponse(new DomainError('BAD_INPUT', 'Bad input')).status).toBe(400);
  });
});

describe('GlobalExceptionFilter', () => {
  function mockHost() {
    const response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    return { host, response };
  }

  it('writes the status and envelope to the response', () => {
    const { host, response } = mockHost();
    new GlobalExceptionFilter().catch(new NotFoundException('missing'), host);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'missing' },
    });
  });

  it('logs 5xx errors but not client errors', () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      new GlobalExceptionFilter().catch(new NotFoundException('missing'), mockHost().host);
      expect(logError).not.toHaveBeenCalled();

      const { host, response } = mockHost();
      const boom = new Error('db exploded');
      new GlobalExceptionFilter().catch(boom, host);
      expect(logError).toHaveBeenCalledWith({ err: boom }, 'Unhandled exception');
      expect(response.status).toHaveBeenCalledWith(500);
    } finally {
      logError.mockRestore();
    }
  });
});
