import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AssignableRole } from '@leadpilot/shared';
import request from 'supertest';
import { EMAIL_PROVIDER, type EmailMessage } from '../../src/email/email.provider';
import type { MockEmailProvider } from '../../src/email/mock-email.provider';
import { refreshCookieOf, signUp, type SignedUpUser } from './auth';

/**
 * Every address a test file creates starts with this, and the file's cleanup
 * deletes by it. Jest gives each test file its own copy of this module, so
 * the random part is per file: files running in parallel never delete each
 * other's users.
 */
export const INVITES_EMAIL_PREFIX = `e2e-invites-${randomBytes(4).toString('hex')}-`;

let counter = 0;

/** A unique address, so parallel files and reruns never collide. */
export function inviteeAddress(label: string): string {
  counter += 1;
  return `${INVITES_EMAIL_PREFIX}${Date.now()}-${counter}-${label}@example.com`;
}

export function mailbox(app: NestExpressApplication): MockEmailProvider {
  return app.get<MockEmailProvider>(EMAIL_PROVIDER);
}

/** The invite token inside the link of an email (it sits in the URL fragment). */
export function tokenFromEmail(message: EmailMessage | undefined): string {
  const match = /#t=([A-Za-z0-9_-]+)/.exec(message?.text ?? '');
  if (!match?.[1]) throw new Error('no invite link in the email');
  return match[1];
}

export function ownerOf(app: NestExpressApplication, label = 'owner'): Promise<SignedUpUser> {
  return signUp(app, { email: inviteeAddress(label) });
}

/** Invites one address and returns the token from the email that was sent. */
export async function inviteAddress(
  app: NestExpressApplication,
  inviter: { accessToken: string },
  address: string,
  role: AssignableRole = 'MEMBER',
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/invites')
    .set('authorization', `Bearer ${inviter.accessToken}`)
    .send({ emails: [address], role })
    .expect(201);
  expect(res.body.results).toEqual([{ email: address, status: 'invited' }]);
  return tokenFromEmail(mailbox(app).lastTo(address));
}

export interface JoinedMember {
  email: string;
  password: string;
  accessToken: string;
  refreshCookie: string;
}

/** The real path: invite, then accept as a new account. */
export async function joinAs(
  app: NestExpressApplication,
  inviter: { accessToken: string },
  role: AssignableRole,
  label: string,
): Promise<JoinedMember> {
  const email = inviteeAddress(label);
  const token = await inviteAddress(app, inviter, email, role);
  const password = 'a-long-enough-password-1';
  const res = await request(app.getHttpServer())
    .post('/auth/invites/accept')
    .send({ token, name: `Member ${label}`, password })
    .expect(200);
  return {
    email,
    password,
    accessToken: res.body.accessToken as string,
    refreshCookie: refreshCookieOf(res),
  };
}
