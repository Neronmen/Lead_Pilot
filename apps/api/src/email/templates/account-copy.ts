import type { Locale } from '@leadpilot/shared';

export type AccountEmailKind = 'reset' | 'verify';

export interface AccountEmailInput {
  kind: AccountEmailKind;
  to: string;
  locale: Locale;
  /** The link in the email (the token sits in the address fragment, so it stays out of server logs). */
  link: string;
  /** How long the link works, in hours. */
  expiresInHours: number;
  webOrigin: string;
}

/** Every sentence of the account emails (password reset, verify address), for the HTML and the plain text. */
export interface AccountCopy {
  subject: string;
  preheader: string;
  headline: string;
  body: string;
  button: string;
  linkIntro: string;
  expiry: string;
  why: string;
  brand: string;
  plainAction: string;
}

export function accountCopy(input: AccountEmailInput): AccountCopy {
  const reset = input.kind === 'reset';
  const hours = input.expiresInHours;
  if (input.locale === 'vi') {
    return reset
      ? {
          subject: 'Đặt lại mật khẩu LeadPilot của bạn',
          preheader: 'Dùng đường dẫn này để chọn mật khẩu mới.',
          headline: 'Đặt lại mật khẩu',
          body: 'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản này. Bấm nút bên dưới để chọn mật khẩu mới.',
          button: 'Chọn mật khẩu mới',
          linkIntro: 'Nút không bấm được? Hãy dán đường dẫn này vào trình duyệt:',
          expiry: `Đường dẫn có hiệu lực trong ${hours} giờ và chỉ dùng được một lần.`,
          why: `Bạn nhận email này vì ai đó đã yêu cầu đặt lại mật khẩu cho ${input.to}. Nếu không phải bạn, hãy bỏ qua email này: mật khẩu hiện tại vẫn giữ nguyên.`,
          brand: 'LeadPilot · Lọc và phân bổ khách tiềm năng bằng AI',
          plainAction: 'Chọn mật khẩu mới:',
        }
      : {
          subject: 'Xác minh địa chỉ email của bạn trên LeadPilot',
          preheader: 'Một bước nữa để hoàn tất tài khoản.',
          headline: 'Xác minh địa chỉ email',
          body: 'Hãy xác nhận đây là địa chỉ email của bạn. Việc này giúp bạn khôi phục tài khoản nếu quên mật khẩu.',
          button: 'Xác minh email',
          linkIntro: 'Nút không bấm được? Hãy dán đường dẫn này vào trình duyệt:',
          expiry: `Đường dẫn có hiệu lực trong ${Math.round(hours / 24)} ngày.`,
          why: `Bạn nhận email này vì ${input.to} vừa được dùng để tạo tài khoản LeadPilot. Nếu không phải bạn, hãy bỏ qua email này.`,
          brand: 'LeadPilot · Lọc và phân bổ khách tiềm năng bằng AI',
          plainAction: 'Xác minh email:',
        };
  }
  return reset
    ? {
        subject: 'Reset your LeadPilot password',
        preheader: 'Use this link to choose a new password.',
        headline: 'Reset your password',
        body: 'We got a request to reset the password for this account. Press the button below to choose a new one.',
        button: 'Choose a new password',
        linkIntro: 'Button not working? Paste this link into your browser:',
        expiry: `The link works for ${hours} hour${hours === 1 ? '' : 's'} and can be used once.`,
        why: `You’re receiving this because someone asked to reset the password for ${input.to}. If that wasn’t you, ignore this email: your password stays as it is.`,
        brand: 'LeadPilot · AI lead qualification and routing',
        plainAction: 'Choose a new password:',
      }
    : {
        subject: 'Verify your email address on LeadPilot',
        preheader: 'One more step to finish your account.',
        headline: 'Verify your email address',
        body: 'Please confirm this is your email address. It lets you recover your account if you forget your password.',
        button: 'Verify email',
        linkIntro: 'Button not working? Paste this link into your browser:',
        expiry: `The link works for ${Math.round(hours / 24)} days.`,
        why: `You’re receiving this because ${input.to} was just used to create a LeadPilot account. If that wasn’t you, ignore this email.`,
        brand: 'LeadPilot · AI lead qualification and routing',
        plainAction: 'Verify your email:',
      };
}

/** The plain-text part: the same words and the same link as the HTML. */
export function accountText(copy: AccountCopy, link: string): string {
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
