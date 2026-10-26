import { hashToken } from '../auth/session.service';
import { INVITE_TTL_DAYS, inviteLink, newInviteToken } from './invite-token';

describe('newInviteToken', () => {
  it('is 256 random bits in base64url, stored only as its SHA-256', () => {
    const { token, tokenHash } = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toContain(token);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newInviteToken().token));
    expect(tokens.size).toBe(200);
  });

  it('expires after the TTL', () => {
    const now = new Date('2026-10-27T10:00:00.000Z');
    expect(newInviteToken(now).expiresAt.toISOString()).toBe('2026-11-03T10:00:00.000Z');
    expect(INVITE_TTL_DAYS).toBe(7);
  });
});

describe('inviteLink', () => {
  it('puts the token in the URL fragment, which browsers never send to a server', () => {
    const link = inviteLink('https://app.example.com', 'tok');
    expect(link).toBe('https://app.example.com/invite#t=tok');
    expect(new URL(link).search).toBe('');
    expect(new URL(link).hash).toBe('#t=tok');
  });
});
