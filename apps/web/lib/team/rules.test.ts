import type { Role } from '@leadpilot/shared';
import { describe, expect, it } from 'vitest';
import { assignableRoles, canManageInvite, canManageMember, parseEmails } from './rules';

const ROLES: Role[] = ['OWNER', 'ADMIN', 'MEMBER'];

describe('canManageMember', () => {
  // viewer x target (not yourself)
  const table: [Role, Role, boolean][] = [
    ['OWNER', 'OWNER', false],
    ['OWNER', 'ADMIN', true],
    ['OWNER', 'MEMBER', true],
    ['ADMIN', 'OWNER', false],
    ['ADMIN', 'ADMIN', false],
    ['ADMIN', 'MEMBER', true],
    ['MEMBER', 'OWNER', false],
    ['MEMBER', 'ADMIN', false],
    ['MEMBER', 'MEMBER', false],
  ];
  it.each(table)('%s acting on %s -> %s', (viewer, target, expected) => {
    expect(canManageMember(viewer, target, false)).toBe(expected);
  });

  it('nobody manages themselves, whatever their role', () => {
    for (const viewer of ROLES) expect(canManageMember(viewer, viewer, true)).toBe(false);
  });
});

describe('assignableRoles', () => {
  it('the owner can give Member or Admin, an admin only Member, a member nothing', () => {
    expect(assignableRoles('OWNER')).toEqual(['MEMBER', 'ADMIN']);
    expect(assignableRoles('ADMIN')).toEqual(['MEMBER']);
    expect(assignableRoles('MEMBER')).toEqual([]);
  });
  it('never offers the owner role', () => {
    for (const viewer of ROLES) expect(assignableRoles(viewer)).not.toContain('OWNER');
  });
});

describe('canManageInvite', () => {
  it('an admin invite is the owner’s; a member invite is an admin’s too', () => {
    expect(canManageInvite('OWNER', 'ADMIN')).toBe(true);
    expect(canManageInvite('OWNER', 'MEMBER')).toBe(true);
    expect(canManageInvite('ADMIN', 'MEMBER')).toBe(true);
    expect(canManageInvite('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageInvite('MEMBER', 'MEMBER')).toBe(false);
  });
});

describe('parseEmails', () => {
  it.each([
    ['a@x.com, b@y.com', ['a@x.com', 'b@y.com']],
    ['a@x.com;b@y.com  c@z.com', ['a@x.com', 'b@y.com', 'c@z.com']],
    ['A@X.com, a@x.com', ['a@x.com']],
    ['  ,  ; ', []],
    ['', []],
    ['one@x.com\ntwo@x.com', ['one@x.com', 'two@x.com']],
  ])('%j -> %j', (text, expected) => {
    expect(parseEmails(text)).toEqual(expected);
  });
});
