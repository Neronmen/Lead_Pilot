import {
  type ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
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
});
