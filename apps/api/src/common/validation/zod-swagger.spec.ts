import * as shared from '@leadpilot/shared';
import { z } from 'zod';
import { toOpenApiSchema, ZodBody } from './zod-swagger';

/**
 * Swagger UI and generated clients read OpenAPI 3.0, where JSON Schema is a
 * restricted dialect: no `const`, no `type: [..]` arrays, no `$schema`, no
 * `$defs` (refs must point into `components`), no numeric `exclusiveMinimum`.
 * Every shared schema must convert without them, in both directions.
 */
const sharedSchemas: Array<[string, z.ZodType]> = Object.entries(
  shared as Record<string, unknown>,
).flatMap(([name, value]) =>
  value instanceof z.ZodType ? [[name, value] as [string, z.ZodType]] : [],
);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Every OpenAPI-3.0-invalid keyword found in the tree, with its JSON path. */
function findOpenApi31Keywords(node: Json, path = '#'): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => findOpenApi31Keywords(child, `${path}/${i}`));
  }
  if (node === null || typeof node !== 'object') return [];
  const problems: string[] = [];
  for (const keyword of ['$schema', '$defs', 'const', 'prefixItems', '$id', 'definitions']) {
    if (keyword in node) problems.push(`${path}/${keyword}`);
  }
  if (Array.isArray(node.type)) problems.push(`${path}/type is an array`);
  for (const keyword of ['exclusiveMinimum', 'exclusiveMaximum']) {
    if (keyword in node && typeof node[keyword] !== 'boolean') {
      problems.push(`${path}/${keyword} is not a boolean`);
    }
  }
  if (typeof node.$ref === 'string' && !node.$ref.startsWith('#/components/')) {
    problems.push(`${path}/$ref points outside components: ${node.$ref}`);
  }
  for (const [key, child] of Object.entries(node)) {
    problems.push(...findOpenApi31Keywords(child, `${path}/${key}`));
  }
  return problems;
}

describe('toOpenApiSchema', () => {
  it('finds the shared schemas to check', () => {
    const names = sharedSchemas.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        'signupRequestSchema',
        'loginRequestSchema',
        'meResponseSchema',
        'createInvitesRequestSchema',
        'acceptInviteRequestSchema',
        'memberSchema',
        'errorBodySchema',
      ]),
    );
  });

  it.each(sharedSchemas)('converts %s to OpenAPI 3.0 for input and output', (_name, schema) => {
    for (const io of ['input', 'output'] as const) {
      const json = toOpenApiSchema(schema, io) as Json;
      expect(findOpenApi31Keywords(json)).toEqual([]);
    }
  });

  it('marks nullable fields the OpenAPI 3.0 way', () => {
    const json = toOpenApiSchema(shared.meResponseSchema, 'output') as {
      properties: { user: { properties: Record<string, unknown> } };
    };
    expect(json.properties.user.properties.name).toEqual({ type: 'string', nullable: true });
  });

  it('documents a request body as strict, with the limits the pipe enforces', () => {
    expect(toOpenApiSchema(shared.createInvitesRequestSchema, 'input')).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['emails', 'role'],
      properties: {
        emails: { type: 'array', minItems: 1, maxItems: 20, items: { maxLength: 254 } },
        role: { type: 'string', enum: ['ADMIN', 'MEMBER'] },
      },
    });
  });
});

describe('ZodBody', () => {
  it('refuses to decorate anything but a method parameter', () => {
    const decorate = ZodBody(shared.loginRequestSchema);
    class Probe {}
    // A constructor parameter: Nest passes no property key.
    expect(() => decorate(Probe, undefined, 0)).toThrow(/controller method/);
    // A method name that does not exist on the target.
    expect(() => decorate(Probe.prototype, 'missing', 0)).toThrow(/controller method/);
  });
});
