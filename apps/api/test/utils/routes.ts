import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

/** Every handler name on a class and on the classes it extends. */
function handlerNames(controller: { prototype: object }): string[] {
  const names = new Set<string>();
  for (
    let proto = controller.prototype as object | null;
    proto && proto !== Object.prototype;
    proto = Object.getPrototypeOf(proto) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  return [...names];
}

/**
 * Every route of every controller of the app, as "METHOD /path/:param".
 * Handlers inherited from a base controller count too (Nest registers them).
 * A path given as an array becomes "a,b", which no allowlist names: it fails
 * the classification test, which is the safe direction.
 */
export function registeredRoutes(app: INestApplication): string[] {
  const routes: string[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      const base = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
      for (const name of handlerNames(controller)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (path === undefined || method === undefined) continue;
        const full = `/${[base, path].filter((part) => part && part !== '/').join('/')}`;
        routes.push(`${RequestMethod[method]} ${full}`);
      }
    }
  }
  return routes.sort();
}

export const PUBLIC = new Set([
  'GET /health/live',
  'GET /health/ready',
  'POST /auth/signup',
  'POST /auth/login',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/invites/preview',
  'POST /auth/invites/accept',
  // Signed in with a source's API key, not a user: its tests are in ingest.e2e-spec.ts.
  'POST /v1/ingest/:sourceId',
]);
// Own account or own workspace, readable by every member (so no admin-only 403 check);
// 'GET /leads' has its cross-workspace test in isolation.e2e-spec.ts.
export const OWN = new Set(['GET /auth/me', 'PATCH /auth/me', 'GET /leads', 'GET /overview']);
export const WORKSPACE_COLLECTION = new Set([
  'GET /invites',
  'POST /invites',
  'GET /members',
  'GET /sources',
  'POST /sources',
  'GET /icp-rubric',
  'PUT /icp-rubric',
  'POST /leads/rescore',
  'GET /routing/rules',
  'POST /routing/rules',
  'PUT /routing/rules/order',
  'POST /routing/test',
  'GET /integrations',
  'POST /integrations',
  'GET /actions',
]);
// Readable and usable by every member, by an id from the URL: a lead of another workspace
// is a 404. Their cross-workspace tests are in leads.e2e-spec.ts.
export const MEMBER_BY_ID = new Set([
  'GET /leads/:id',
  'POST /leads/:id/review',
  'POST /leads/:id/outcome',
]);
export const WORKSPACE_BY_ID = new Set([
  'POST /invites/:id/resend',
  'DELETE /invites/:id',
  'PATCH /members/:id',
  'DELETE /members/:id',
  'PATCH /sources/:id',
  'DELETE /sources/:id',
  'POST /sources/:id/api-key',
  'POST /sources/:id/hmac-secret',
  'DELETE /sources/:id/hmac-secret',
  'PATCH /routing/rules/:id',
  'DELETE /routing/rules/:id',
  'PATCH /integrations/:id',
  'DELETE /integrations/:id',
  'POST /integrations/:id/test',
  'POST /actions/:id/retry',
]);
