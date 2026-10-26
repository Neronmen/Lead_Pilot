import { Body, type HttpStatus } from '@nestjs/common';
import { ApiBody, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

/** Swagger's schema type, taken from the decorator so no deep import is needed. */
type SwaggerSchema = Extract<Parameters<typeof ApiBody>[0], { schema: unknown }>['schema'];

/** The schema as OpenAPI 3.0 JSON Schema: what a client sends, or receives. */
export function toOpenApiSchema(schema: z.ZodType, io: 'input' | 'output'): SwaggerSchema {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io }) as SwaggerSchema;
}

/**
 * Request body validated by a shared zod schema and documented in Swagger
 * from the same schema, so the docs cannot drift from the validation:
 * `signup(@ZodBody(signupRequestSchema) body: SignupRequest)`.
 *
 * The Swagger metadata is stored on the method function. A method decorator
 * that replaces the function (a wrapping or caching decorator) would drop it.
 */
export function ZodBody(schema: z.ZodType): ParameterDecorator {
  const validate = Body(new ZodValidationPipe(schema));
  const document = ApiBody({ schema: toOpenApiSchema(schema, 'input') });
  return (target, propertyKey, parameterIndex) => {
    // Fail loudly: silently skipping the docs is the drift this helper prevents.
    const descriptor =
      propertyKey === undefined ? undefined : Object.getOwnPropertyDescriptor(target, propertyKey);
    if (propertyKey === undefined || descriptor === undefined) {
      throw new Error('@ZodBody must decorate a parameter of a controller method');
    }
    validate(target, propertyKey, parameterIndex);
    document(target, propertyKey, descriptor);
  };
}

/** Documents a response body with its shared zod schema. */
export function ApiZodResponse(
  status: HttpStatus,
  schema: z.ZodType,
  description: string,
): MethodDecorator {
  return ApiResponse({ status, description, schema: toOpenApiSchema(schema, 'output') });
}
