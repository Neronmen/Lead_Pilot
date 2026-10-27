import type { AssignableRole, Role } from '@leadpilot/shared';
import { describe, expect, it } from 'vitest';
import { assignableRoles, canManageInvite, canManageMember } from './rules';

const ROLES: Role[] = ['OWNER', 'ADMIN', 'MEMBER'];
const ASSIGNABLE: AssignableRole[] = ['ADMIN', 'MEMBER'];

/**
 * The API gives members and invites the same rule (the owner manages admins,
 * an admin manages members only). The three helpers must never disagree, or
 * the page would offer a control the API refuses.
 */
describe('team rules are consistent with each other', () => {
  it('managing an invite of a role equals managing a member of that role', () => {
    for (const viewer of ROLES) {
      for (const role of ASSIGNABLE) {
        expect(canManageInvite(viewer, role)).toBe(canManageMember(viewer, role, false));
      }
    }
  });

  it('you may manage a role exactly when you may also hand it out', () => {
    for (const viewer of ROLES) {
      for (const role of ASSIGNABLE) {
        expect(canManageInvite(viewer, role)).toBe(assignableRoles(viewer).includes(role));
      }
    }
  });

  it('whoever can manage someone has at least one role to offer', () => {
    for (const viewer of ROLES) {
      for (const target of ROLES) {
        if (canManageMember(viewer, target, false)) {
          expect(assignableRoles(viewer).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('only the owner is ever offered the admin role, and an admin never sees an admin row as manageable', () => {
    for (const viewer of ROLES) {
      expect(assignableRoles(viewer).includes('ADMIN')).toBe(viewer === 'OWNER');
    }
    expect(canManageMember('ADMIN', 'ADMIN', false)).toBe(false);
    expect(canManageInvite('ADMIN', 'ADMIN')).toBe(false);
  });
});
