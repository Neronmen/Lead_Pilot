import type { AssignableRole, Locale } from '@leadpilot/shared';

export interface InviteEmailInput {
  /** The invited address. */
  to: string;
  locale: Locale;
  inviterName: string;
  workspaceName: string;
  role: AssignableRole;
  /** The link that accepts the invite (the token is in the URL fragment). */
  link: string;
  expiresInDays: number;
  /** Where the web app lives: the logo is served from `${webOrigin}/email/logo.png`. */
  webOrigin: string;
}

/** Every sentence of the invite email, in one place for the HTML and the plain text. */
export interface InviteCopy {
  subject: string;
  /** The preview line inboxes show next to the subject. */
  preheader: string;
  headline: string;
  body: string;
  button: string;
  /** The line above the link repeated as text, for clients that break buttons. */
  linkIntro: string;
  expiry: string;
  /** Why the person got the email, and what to do if they did not expect it. */
  why: string;
  brand: string;
  /** The plain-text line that introduces the link. */
  plainAction: string;
}

/** A header value must stay on one line, whatever the names contain. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

// Words follow docs/design-notes.md (the approved Emails design, and the Team
// page for what each role does) and the Vietnamese glossary. The email is
// written in the workspace's default language (SPEC §4.9).
export function inviteCopy(input: InviteEmailInput): InviteCopy {
  const inviter = oneLine(input.inviterName);
  const workspace = oneLine(input.workspaceName);
  const admin = input.role === 'ADMIN';

  if (input.locale === 'vi') {
    return {
      subject: `${inviter} đã mời bạn tham gia ${workspace} trên LeadPilot`,
      preheader: admin
        ? 'Tham gia với vai trò quản trị viên và giúp cả đội bắt đầu.'
        : 'Tham gia với vai trò thành viên và bắt đầu xử lý lead được giao cho bạn.',
      headline: `${inviter} đã mời bạn tham gia ${workspace}`,
      body: admin
        ? 'Bạn tham gia với vai trò quản trị viên. Quản trị viên thay đổi cài đặt, nguồn lead và quy tắc phân bổ, và mời thêm người.'
        : 'Bạn tham gia với vai trò thành viên. Thành viên xử lý lead được giao, kiểm tra lead trong hàng chờ duyệt và ghi kết quả.',
      button: 'Chấp nhận lời mời',
      linkIntro: 'Nút không bấm được? Hãy dán đường dẫn này vào trình duyệt:',
      expiry: `Đường dẫn có hiệu lực trong ${input.expiresInDays} ngày và chỉ dùng được một lần.`,
      why: `Bạn nhận email này vì ${inviter} đã mời ${input.to} tham gia ${workspace} trên LeadPilot. Nếu bạn không mong đợi email này, hãy bỏ qua: sẽ không có gì xảy ra nếu bạn không chấp nhận.`,
      brand: 'LeadPilot · Lọc và phân bổ lead bằng AI',
      plainAction: 'Chấp nhận lời mời:',
    };
  }

  return {
    subject: `${inviter} invited you to ${workspace} on LeadPilot`,
    preheader: admin
      ? 'Join as an admin and help get the team set up.'
      : 'Join as a member and start working the leads assigned to you.',
    headline: `${inviter} invited you to join ${workspace}`,
    body: admin
      ? 'You’ll join as an Admin. Admins change settings, lead sources and routing rules, and invite people.'
      : 'You’ll join as a Member. Members work the leads assigned to them, check leads in the review queue and record outcomes.',
    button: 'Accept invite',
    linkIntro: 'Button not working? Paste this link into your browser:',
    expiry: `The link works for ${input.expiresInDays} days and can be used once.`,
    why: `You’re receiving this because ${inviter} invited ${input.to} to ${workspace} on LeadPilot. If you weren’t expecting it, ignore this email: nothing happens unless you accept.`,
    brand: 'LeadPilot · AI lead qualification and routing',
    plainAction: 'Accept the invite:',
  };
}

/** The plain-text part: the same words and the same link as the HTML. */
export function inviteText(copy: InviteCopy, link: string): string {
  return [
    `${copy.headline}.`,
    '',
    copy.body,
    '',
    copy.plainAction,
    link,
    '',
    copy.expiry,
    '',
    '--',
    copy.why,
    copy.brand,
  ].join('\n');
}
