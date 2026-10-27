import type { AssignableRole, Role } from '@leadpilot/shared';

/**
 * Who may do what on the Team page. The API enforces all of this (and answers
 * 403 otherwise); these rules only decide which controls to show, so nobody
 * is offered a button that is certain to fail. The rule: the Owner manages
 * everyone except themselves; an Admin manages Members only; nobody touches
 * the Owner or themselves; a Member has no access (the page is not shown).
 */
export function canManageMember(viewer: Role, target: Role, isSelf: boolean): boolean {
  if (isSelf || target === 'OWNER') return false;
  if (viewer === 'OWNER') return true;
  if (viewer === 'ADMIN') return target === 'MEMBER';
  return false;
}

/** The roles the viewer may give (to someone invited, or in a role change). */
export function assignableRoles(viewer: Role): AssignableRole[] {
  if (viewer === 'OWNER') return ['MEMBER', 'ADMIN'];
  if (viewer === 'ADMIN') return ['MEMBER'];
  return [];
}

/** Resend and cancel: an admin invite is the Owner's to manage. */
export function canManageInvite(viewer: Role, inviteRole: AssignableRole): boolean {
  if (viewer === 'OWNER') return true;
  return viewer === 'ADMIN' && inviteRole === 'MEMBER';
}

/** The addresses typed in the invite box: split on commas, semicolons and spaces, lowercased, once each. */
export function parseEmails(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const address = part.trim().toLowerCase();
    if (address) seen.add(address);
  }
  return [...seen];
}

/** "Active now" when the last sign of life is this recent (the API bumps it about once a minute). */
export const ACTIVE_NOW_MS = 5 * 60 * 1000;
