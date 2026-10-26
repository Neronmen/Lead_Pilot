import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Role } from '@leadpilot/shared';
import type { Request } from 'express';
import { DomainError } from '../common/errors/domain-error';
import { setAuthContext } from './auth-context';
import { workspaceSlug } from './auth.service';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { hashToken } from './session.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('hashes with argon2id and verifies only the right password', async () => {
    const hash = await passwords.hash('harbour-pine-2026!');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(passwords.verify(hash, 'harbour-pine-2026!')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'harbour-pine-2027!')).resolves.toBe(false);
  });

  it('returns false for an unknown account after doing the same work', async () => {
    const hash = await passwords.hash('known-user-password');
    const time = async (stored: string | undefined) => {
      const start = process.hrtime.bigint();
      await passwords.verify(stored, 'some-guess-1234');
      return Number(process.hrtime.bigint() - start) / 1e6;
    };
    await time(undefined); // first call also builds the dummy hash
    const unknown = await time(undefined);
    const known = await time(hash);
    await expect(passwords.verify(undefined, 'anything')).resolves.toBe(false);
    // Same order of magnitude: both ran one full argon2 verification.
    expect(unknown).toBeGreaterThan(known / 4);
  });

  it('treats a malformed stored hash as a failed login, not an error', async () => {
    await expect(passwords.verify('not-a-hash', 'x')).resolves.toBe(false);
  });
});

describe('workspaceSlug', () => {
  it('strips Vietnamese diacritics and adds a random suffix', () => {
    expect(workspaceSlug('Công ty Đông Á')).toMatch(/^cong-ty-dong-a-[0-9a-f]{8}$/);
    expect(workspaceSlug('Harbour & Pine')).toMatch(/^harbour-pine-[0-9a-f]{8}$/);
  });

  it('falls back to "workspace" and keeps the base short', () => {
    expect(workspaceSlug('日本')).toMatch(/^workspace-[0-9a-f]{8}$/);
    const long = workspaceSlug('a'.repeat(39) + ' b c d');
    expect(long.length).toBeLessThanOrEqual(40 + 9);
    expect(long).not.toMatch(/--/);
  });

  it('gives two workspaces with one name different slugs', () => {
    expect(workspaceSlug('Acme')).not.toBe(workspaceSlug('Acme'));
  });
});

describe('hashToken', () => {
  it('is a stable SHA-256 hex digest', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('RolesGuard', () => {
  const contextFor = (minRole: Role | undefined, role?: Role) => {
    const request = {} as Request;
    if (role) {
      setAuthContext(request, { userId: 'u', workspaceId: 'w', membershipId: 'm', role });
    }
    const reflector = { getAllAndOverride: () => minRole } as unknown as Reflector;
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { guard: new RolesGuard(reflector), context };
  };

  it.each<[Role, Role, boolean]>([
    ['ADMIN', 'OWNER', true],
    ['ADMIN', 'ADMIN', true],
    ['ADMIN', 'MEMBER', false],
    ['OWNER', 'ADMIN', false],
    ['MEMBER', 'MEMBER', true],
  ])('MinRole %s with role %s: allowed = %s', (minRole, role, allowed) => {
    const { guard, context } = contextFor(minRole, role);
    if (allowed) expect(guard.canActivate(context)).toBe(true);
    else expect(() => guard.canActivate(context)).toThrow(DomainError);
  });

  it('allows any signed-in role when the route sets no MinRole', () => {
    const { guard, context } = contextFor(undefined, 'MEMBER');
    expect(guard.canActivate(context)).toBe(true);
  });

  it('fails closed when a MinRole route has no auth context', () => {
    const { guard, context } = contextFor('MEMBER');
    expect(() => guard.canActivate(context)).toThrow(DomainError);
  });
});
