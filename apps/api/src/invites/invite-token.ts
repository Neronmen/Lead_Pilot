import { randomBytes } from 'node:crypto';
import { hashToken } from '../auth/session.service';

/** An invite link works for 7 days (the Accept invite design: "Expires in 6 days"). */
export const INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface NewInviteToken {
  /** Goes into the link, once; never stored. */
  token: string;
  /** What the database keeps. */
  tokenHash: string;
  expiresAt: Date;
}

/**
 * 32 random bytes (256 bits), base64url. Only the SHA-256 is stored, like a
 * refresh token: the token has full entropy, so a fast hash is enough, and a
 * database leak does not hand out working invite links.
 */
export function newInviteToken(now: Date = new Date()): NewInviteToken {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS),
  };
}

/**
 * The link in the email. The token sits in the URL fragment (`#t=`): browsers
 * never send the fragment to a server, so it stays out of access logs, proxy
 * logs and the Referer header. The Accept page reads it and POSTs it in a body.
 */
export function inviteLink(webOrigin: string, token: string): string {
  return `${webOrigin}/invite#t=${token}`;
}
