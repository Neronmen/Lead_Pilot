import type { Locale } from '@leadpilot/shared';

export interface HotLeadEmailInput {
  /** Who gets it. */
  to: string;
  locale: Locale;
  /** The lead's name, or its email or company when there is no name. */
  leadName: string;
  company: string | null;
  score: number | null;
  /** The plain-language reasons from "Why it's Hot" (the top three are used). */
  reasons: string[];
  /** The page of this lead in the web app. */
  link: string;
  workspaceName: string;
  webOrigin: string;
}

/** Every sentence of the Hot lead alert, in one place for the HTML and the plain text. */
export interface HotLeadCopy {
  subject: string;
  preheader: string;
  headline: string;
  /** The line that says how good the lead looks. */
  body: string;
  reasonsTitle: string;
  reasons: string[];
  button: string;
  linkIntro: string;
  why: string;
  brand: string;
  plainAction: string;
}

/** A header value must stay on one line, whatever the lead typed. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

// Words follow docs/design-notes.md (Emails: the Hot lead alert reuses "Why it's Hot") and the
// Vietnamese glossary. Written in the workspace's default language (SPEC §4.9).
export function hotLeadCopy(input: HotLeadEmailInput): HotLeadCopy {
  const name = oneLine(input.leadName);
  const company = input.company ? oneLine(input.company) : null;
  const who = company ? `${name} (${company})` : name;
  const workspace = oneLine(input.workspaceName);
  const reasons = input.reasons.map(oneLine).filter(Boolean).slice(0, 3);
  const score = input.score === null ? null : Math.round(input.score);

  if (input.locale === 'vi') {
    return {
      subject: `Khách tiềm năng Hot mới: ${who}`,
      preheader:
        'Hãy liên hệ sớm: khách Hot thường chốt nhanh nhất khi được trả lời trong giờ đầu.',
      headline: `Khách tiềm năng Hot mới: ${who}`,
      body:
        score === null
          ? 'AI đánh giá khách này là Hot.'
          : `AI đánh giá khách này là Hot với ${score} điểm trên 100.`,
      reasonsTitle: 'Vì sao khách này là Hot',
      reasons,
      button: 'Mở khách tiềm năng',
      linkIntro: 'Nút không bấm được? Hãy dán đường dẫn này vào trình duyệt:',
      why: `Bạn nhận email này vì quy tắc phân bổ của ${workspace} trên LeadPilot gửi cảnh báo khách Hot cho bạn. Quản trị viên có thể tắt quy tắc này trong Quy tắc phân bổ.`,
      brand: 'LeadPilot · Lọc và phân bổ khách tiềm năng bằng AI',
      plainAction: 'Mở khách tiềm năng:',
    };
  }

  return {
    subject: `New Hot lead: ${who}`,
    preheader: 'Reply soon: Hot leads close best when someone answers within the first hour.',
    headline: `New Hot lead: ${who}`,
    body:
      score === null
        ? 'The AI rated this lead Hot.'
        : `The AI rated this lead Hot, ${score} out of 100.`,
    reasonsTitle: 'Why it’s Hot',
    reasons,
    button: 'Open lead',
    linkIntro: 'Button not working? Paste this link into your browser:',
    why: `You’re receiving this because a routing rule in ${workspace} on LeadPilot sends Hot lead alerts to you. An admin can switch the rule off under Routing rules.`,
    brand: 'LeadPilot · AI lead qualification and routing',
    plainAction: 'Open the lead:',
  };
}

/** The plain-text part: the same words and the same link as the HTML. */
export function hotLeadText(copy: HotLeadCopy, link: string): string {
  return [
    `${copy.headline}.`,
    '',
    copy.body,
    '',
    ...(copy.reasons.length > 0
      ? [`${copy.reasonsTitle}:`, ...copy.reasons.map((r) => `- ${r}`), '']
      : []),
    copy.plainAction,
    link,
    '',
    '--',
    copy.why,
    copy.brand,
  ].join('\n');
}
