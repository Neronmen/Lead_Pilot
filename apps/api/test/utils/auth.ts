import type { NestExpressApplication } from '@nestjs/platform-express';
import type { SignupRequest } from '@leadpilot/shared';
import request from 'supertest';

/** Every e2e user's email starts with this, so cleanup can find them. */
export const E2E_EMAIL_PREFIX = 'e2e-auth-';

let counter = 0;

/** A fresh, unique signup body. */
export function signupBody(overrides: Partial<SignupRequest> = {}): SignupRequest {
  counter += 1;
  return {
    name: 'Chloe Martin',
    workspaceName: 'Harbour & Pine',
    email: `${E2E_EMAIL_PREFIX}${Date.now()}-${counter}@example.test`,
    password: 'harbour-pine-2026!',
    locale: 'en',
    currency: 'USD',
    ...overrides,
  };
}

export interface SignedUpUser {
  body: SignupRequest;
  accessToken: string;
  /** The `lp_refresh=...` pair, ready for a Cookie header. */
  refreshCookie: string;
}

export async function signUp(
  app: NestExpressApplication,
  overrides: Partial<SignupRequest> = {},
): Promise<SignedUpUser> {
  const body = signupBody(overrides);
  const res = await request(app.getHttpServer()).post('/auth/signup').send(body).expect(201);
  return { body, accessToken: res.body.accessToken, refreshCookie: refreshCookieOf(res) };
}

/** The raw Set-Cookie line for the refresh cookie, or undefined. */
export function setCookieLine(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as string | string[] | undefined;
  const lines = Array.isArray(header) ? header : header ? [header] : [];
  return lines.find((line) => line.startsWith('lp_refresh='));
}

/** The `lp_refresh=<token>` pair from a response; throws if none was set. */
export function refreshCookieOf(res: request.Response): string {
  const line = setCookieLine(res);
  if (!line) throw new Error('response set no refresh cookie');
  return line.split(';')[0] ?? '';
}
