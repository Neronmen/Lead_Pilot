import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import {
  authSessionSchema,
  createInvitesRequestSchema,
  errorBodySchema,
  type CreateInvitesRequest,
  signupRequestSchema,
  type SignupRequest,
} from '@leadpilot/shared';
import request from 'supertest';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { ApiZodResponse, ZodBody } from '../src/common/validation/zod-swagger';

/** A stand-in controller: echoes what the pipe handed to the handler. */
@Controller('probe')
class ProbeController {
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiZodResponse(HttpStatus.OK, authSessionSchema, 'Signed in')
  echo(@ZodBody(signupRequestSchema) body: SignupRequest): SignupRequest {
    return body;
  }

  @Post('invites')
  @HttpCode(HttpStatus.OK)
  invites(@ZodBody(createInvitesRequestSchema) body: CreateInvitesRequest): CreateInvitesRequest {
    return body;
  }
}

describe('ZodBody (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const valid = {
    name: 'Chloe Martin',
    workspaceName: 'Harbour & Pine',
    email: ' Chloe@HarbourAndPine.com.au',
    password: 'harbour-pine-2026!',
    locale: 'en',
    currency: 'USD',
  };

  it('hands the handler the parsed, normalized body', async () => {
    const res = await request(app.getHttpServer()).post('/probe').send(valid).expect(200);
    expect(res.body).toEqual({ ...valid, email: 'chloe@harbourandpine.com.au' });
  });

  it('answers 400 VALIDATION_FAILED in the error envelope, with issue codes as details', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .send({ ...valid, password: 'short', role: 'OWNER' })
      .expect(400);

    expect(errorBodySchema.safeParse(res.body).success).toBe(true);
    expect(res.body.error).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: [
        { path: 'password', code: 'too_small', origin: 'string', minimum: 12 },
        { path: '', code: 'unrecognized_keys', values: ['role'] },
      ],
    });
  });

  it('documents the request and response bodies in Swagger from the same schemas', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const operation = document.paths['/probe']?.post;

    const requestSchema = (
      operation?.requestBody as { content: Record<string, { schema: unknown }> }
    ).content['application/json']?.schema;
    expect(requestSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['name', 'workspaceName', 'email', 'password']),
      additionalProperties: false,
      properties: { password: { type: 'string', minLength: 12, maxLength: 128 } },
    });

    const okSchema = (
      operation?.responses['200'] as { content: Record<string, { schema: unknown }> }
    ).content['application/json']?.schema;
    expect(okSchema).toMatchObject({
      type: 'object',
      properties: { accessToken: { type: 'string' }, expiresIn: { type: 'integer' } },
    });
  });

  it('reports an invalid array item by its dotted index, after normalizing the valid ones', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/invites')
      .send({ emails: [' A@B.co', 'b@c.co', 'c@d.co', 'not-an-email', 7], role: 'MEMBER' })
      .expect(400);
    expect(res.body.error.details).toEqual([
      { path: 'emails.3', code: 'invalid_format', format: 'email' },
      { path: 'emails.4', code: 'invalid_type', expected: 'string' },
    ]);
  });

  it('normalizes every invite address before the handler sees it', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe/invites')
      .send({ emails: [' Ethan@Northstar.com ', 'MAI@example.VN'], role: 'ADMIN' })
      .expect(200);
    expect(res.body).toEqual({
      emails: ['ethan@northstar.com', 'mai@example.vn'],
      role: 'ADMIN',
    });
  });

  it('answers a request with no body as invalid_type on the whole body', async () => {
    const res = await request(app.getHttpServer()).post('/probe').expect(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ path: '', code: 'invalid_type', expected: 'object' }],
    });
  });

  it('treats a non-JSON body like a missing one', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .set('Content-Type', 'text/plain')
      .send('email=a@b.co')
      .expect(400);
    expect(res.body.error.details).toEqual([
      { path: '', code: 'invalid_type', expected: 'object' },
    ]);
  });

  it('answers a JSON array body as invalid_type, not a 500', async () => {
    const res = await request(app.getHttpServer()).post('/probe').send([valid]).expect(400);
    expect(res.body.error.details).toEqual([
      { path: '', code: 'invalid_type', expected: 'object' },
    ]);
  });

  it('rejects a password over 128 characters before any hashing could run', async () => {
    const res = await request(app.getHttpServer())
      .post('/probe')
      .send({ ...valid, password: 'x'.repeat(10_000) })
      .expect(400);
    expect(res.body.error.details).toEqual([
      { path: 'password', code: 'too_big', origin: 'string', maximum: 128 },
    ]);
  });
});
