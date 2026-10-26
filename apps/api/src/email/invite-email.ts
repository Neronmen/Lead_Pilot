import type { AssignableRole, Locale } from '@leadpilot/shared';
import type { EmailMessage } from './email.provider';

export interface InviteEmailInput {
  to: string;
  locale: Locale;
  inviterName: string;
  workspaceName: string;
  role: AssignableRole;
  /** The link that accepts the invite (the token is in the URL fragment). */
  link: string;
  expiresInDays: number;
}

// Outgoing email uses the workspace's default language (SPEC §4.9). The words
// for roles follow the Vietnamese glossary in docs/design-notes.md.
const COPY = {
  en: {
    role: { ADMIN: 'an admin', MEMBER: 'a member' },
    subject: (i: InviteEmailInput) =>
      `${i.inviterName} invited you to ${i.workspaceName} on LeadPilot`,
    intro: (i: InviteEmailInput, role: string) =>
      `${i.inviterName} invited you to join ${i.workspaceName} on LeadPilot as ${role}.`,
    action: 'Accept the invite:',
    expiry: (days: number) => `The link works for ${days} days and can be used once.`,
    ignore: "If you weren't expecting this, you can ignore this email.",
    button: 'Accept invite',
  },
  vi: {
    role: { ADMIN: 'quản trị viên', MEMBER: 'thành viên' },
    subject: (i: InviteEmailInput) =>
      `${i.inviterName} đã mời bạn tham gia ${i.workspaceName} trên LeadPilot`,
    intro: (i: InviteEmailInput, role: string) =>
      `${i.inviterName} đã mời bạn tham gia ${i.workspaceName} trên LeadPilot với vai trò ${role}.`,
    action: 'Chấp nhận lời mời:',
    expiry: (days: number) => `Đường dẫn có hiệu lực trong ${days} ngày và chỉ dùng được một lần.`,
    ignore: 'Nếu bạn không mong đợi email này, bạn có thể bỏ qua nó.',
    button: 'Chấp nhận lời mời',
  },
} as const;

/** A header value must stay on one line, whatever the names contain. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInviteEmail(input: InviteEmailInput): EmailMessage {
  const copy = COPY[input.locale];
  const safe = {
    ...input,
    inviterName: oneLine(input.inviterName),
    workspaceName: oneLine(input.workspaceName),
  };
  const intro = copy.intro(safe, copy.role[input.role]);
  const expiry = copy.expiry(input.expiresInDays);

  const text = [intro, '', copy.action, input.link, '', expiry, copy.ignore].join('\n');
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<p><a href="${escapeHtml(input.link)}">${copy.button}</a></p>`,
    `<p>${escapeHtml(expiry)}<br>${escapeHtml(copy.ignore)}</p>`,
  ].join('\n');

  return { to: input.to, subject: copy.subject(safe), text, html };
}
