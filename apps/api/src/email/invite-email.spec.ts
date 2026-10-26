import { buildInviteEmail, type InviteEmailInput } from './invite-email';
import { inviteCopy, inviteText } from './templates/invite-copy';

const LINK = 'https://app.example.com/invite#t=Zk3q8VhT_AbC-0123456789xyzABCDEFGHIJKLMNO';

const input: InviteEmailInput = {
  to: 'ethan.brooks@northstargrowth.com',
  locale: 'en',
  inviterName: 'Mia Johnson',
  workspaceName: 'Northstar Growth',
  role: 'MEMBER',
  link: LINK,
  expiresInDays: 7,
  webOrigin: 'https://app.example.com',
};

describe('buildInviteEmail (HTML and plain text)', () => {
  it('has a subject, an HTML part and a plain-text part', async () => {
    const mail = await buildInviteEmail(input);
    expect(mail.to).toBe(input.to);
    expect(mail.subject).toBe('Mia Johnson invited you to Northstar Growth on LeadPilot');
    expect(mail.html).toContain('<!DOCTYPE html');
    expect(mail.text.length).toBeGreaterThan(50);
  });

  it('puts the link on the button and repeats it as text, in the HTML', async () => {
    const { html } = await buildInviteEmail(input);
    expect(html).toBeDefined();
    // The fragment carries the token: it must survive rendering untouched.
    expect(html).toContain(`href="${LINK}"`);
    expect(html?.split(LINK).length).toBeGreaterThanOrEqual(3); // button, link, link text
    expect(html).toContain('Accept invite');
  });

  it('writes the English email in English', async () => {
    const { html, text } = await buildInviteEmail(input);
    expect(html).toContain('lang="en"');
    expect(html).toContain('Mia Johnson invited you to join Northstar Growth');
    expect(html).toContain('You’ll join as a Member.');
    expect(html).toContain('The link works for 7 days and can be used once.');
    expect(text).toContain('You’ll join as a Member.');
    expect(html).not.toContain('Chấp nhận');
  });

  it('writes the Vietnamese email in Vietnamese, with the glossary role words', async () => {
    const member = await buildInviteEmail({ ...input, locale: 'vi' });
    expect(member.subject).toBe('Mia Johnson đã mời bạn tham gia Northstar Growth trên LeadPilot');
    expect(member.html).toContain('lang="vi"');
    expect(member.html).toContain('Chấp nhận lời mời');
    expect(member.html).toContain('Bạn tham gia với vai trò thành viên.');
    expect(member.html).toContain('có hiệu lực trong 7 ngày');
    expect(member.html).not.toContain('Accept invite');
    expect(member.text).toContain('Chấp nhận lời mời:');
    expect(member.text).toContain(LINK);

    const admin = await buildInviteEmail({ ...input, locale: 'vi', role: 'ADMIN' });
    expect(admin.html).toContain('vai trò quản trị viên');
  });

  it('describes the role being granted', async () => {
    const admin = await buildInviteEmail({ ...input, role: 'ADMIN' });
    expect(admin.html).toContain('You’ll join as an Admin.');
    expect(admin.html).not.toContain('You’ll join as a Member.');
    expect(admin.text).toContain('Admins change settings, lead sources and routing rules');
  });

  it('shows the preview line, the logo from the web app, and says why they got it', async () => {
    const { html } = await buildInviteEmail(input);
    expect(html).toContain('Join as a member and start working the leads assigned to you.');
    expect(html).toContain('src="https://app.example.com/email/logo.png"');
    expect(html).toContain('alt="LeadPilot"');
    expect(html).toContain(
      'Mia Johnson invited ethan.brooks@northstargrowth.com to Northstar Growth',
    );
    expect(html).toContain('nothing happens unless you accept');
  });

  it('ships both palettes: light inline, dark under prefers-color-scheme', async () => {
    const { html } = await buildInviteEmail(input);
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    // Light button inline; the dark one only inside the media query.
    expect(html).toMatch(/background-color:\s*#0A7D8C/i);
    expect(html).toContain(
      '.lp-btn { background-color: #22E1F0 !important; color: #031417 !important; }',
    );
    // No pure white or black, which forced inversion handles badly.
    expect(html).not.toMatch(/#000000|#000(?![0-9a-f])|#FFFFFF[^;]*;\s*color:\s*#FFFFFF/i);
  });

  it('puts the dark page colour on an element that has the lp-page class', async () => {
    // React Email moves Body's style into an inner cell and keeps the class on
    // <body>, so the layout wraps the card in a Section carrying the class too.
    // If a React Email upgrade changes that, dark mode loses its page colour.
    const { html } = await buildInviteEmail(input);
    expect(html).toContain('.lp-page { background-color: #0A0A12 !important; }');
    const withClass = [...(html ?? '').matchAll(/<(\w+)[^>]*class="lp-page"[^>]*>/g)];
    expect(withClass.length).toBeGreaterThanOrEqual(2);
    // The inner one is a real element (a table) holding the light background inline.
    expect(
      withClass.some(([tag]) => tag.startsWith('<table') && /background-color:#F6F6FA/i.test(tag)),
    ).toBe(true);
  });

  it('escapes names and the link in the HTML', async () => {
    const { html } = await buildInviteEmail({
      ...input,
      inviterName: '<script>alert(1)</script>',
      workspaceName: 'Fish & "Chips"',
      link: 'https://app.example.com/invite#t="x"&y=<b>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Fish &amp; &quot;Chips&quot;');
    expect(html).not.toContain('#t="x"&y=<b>');
  });

  it('keeps the subject on one line whatever the names contain', async () => {
    const mail = await buildInviteEmail({
      ...input,
      inviterName: 'Eve\r\nBcc: victim@example.com',
      workspaceName: 'Acme\nCorp',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toBe('Eve Bcc: victim@example.com invited you to Acme Corp on LeadPilot');
  });
});

describe('inviteText (the plain-text part)', () => {
  it('carries the same words and the same link as the HTML, with no markup', () => {
    for (const locale of ['en', 'vi'] as const) {
      const copy = inviteCopy({ ...input, locale });
      const text = inviteText(copy, LINK);
      for (const sentence of [copy.headline, copy.body, copy.expiry, copy.why, copy.brand]) {
        expect(text).toContain(sentence);
      }
      expect(text).toContain(LINK);
      expect(text).not.toMatch(/<[a-z/][^>]*>/i);
      // A signature separator before the footer, as plain-text mail has it.
      expect(text).toContain('\n--\n');
    }
  });
});

describe('buildInviteEmail (edge cases)', () => {
  const decode = (value: string) =>
    value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');
  const ENTITY = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i;

  it('renders every language and role, each with its own words and no leftovers', async () => {
    for (const locale of ['en', 'vi'] as const) {
      for (const role of ['MEMBER', 'ADMIN'] as const) {
        const copy = inviteCopy({ ...input, locale, role });
        const mail = await buildInviteEmail({ ...input, locale, role });
        expect(mail.html).toContain(`lang="${locale}"`);
        expect(mail.html).toContain(copy.button);
        expect(mail.html).toContain(copy.expiry);
        expect(mail.text).toContain(copy.body);
        // No template placeholder or JS leftovers in either part.
        for (const part of [mail.html ?? '', mail.text]) {
          expect(part).not.toMatch(/undefined|\[object Object\]|\{\{|\$\{|NaN/);
        }
      }
    }
  });

  it('gives MEMBER and ADMIN different bodies in both languages', () => {
    for (const locale of ['en', 'vi'] as const) {
      const member = inviteCopy({ ...input, locale, role: 'MEMBER' });
      const admin = inviteCopy({ ...input, locale, role: 'ADMIN' });
      expect(member.body).not.toBe(admin.body);
      expect(member.preheader).not.toBe(admin.preheader);
    }
  });

  it('keeps tokens with "_" and "-" intact, and escapes "&" only once', async () => {
    const link = 'https://app.example.com/invite?a=1&b=2#t=_-_-AbC_-0123456789_-xyz_-ABCDEFGHIJK&c';
    const { html, text } = await buildInviteEmail({ ...input, link });
    expect(html).not.toContain('&amp;amp;');
    const hrefs = [...(html ?? '').matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1] ?? ''));
    expect(hrefs.filter((href) => href === link)).toHaveLength(2); // button and text link
    expect(text).toContain(`\n${link}\n`);
  });

  it('shows names with markup characters, quotes and diacritics safely in HTML and as typed in text', async () => {
    const inviterName = 'Nguyễn Văn <A> & "B" \'C\'';
    const workspaceName = 'Cửa hàng Ánh & Co <3';
    for (const locale of ['en', 'vi'] as const) {
      const { html, text, subject } = await buildInviteEmail({
        ...input,
        locale,
        inviterName,
        workspaceName,
      });
      // HTML: escaped once, diacritics untouched.
      expect(html).toContain('Nguyễn Văn &lt;A&gt; &amp; &quot;B&quot;');
      expect(html).toContain('Cửa hàng Ánh &amp; Co &lt;3');
      expect(html).not.toContain('&amp;amp;');
      expect(html).not.toContain('&amp;lt;');
      expect(html).not.toContain('<A>');
      // Plain text and subject: the characters exactly as typed, no entities.
      for (const part of [text, subject]) {
        expect(part).toContain(inviterName);
        expect(part).toContain(workspaceName);
        expect(part).not.toMatch(ENTITY);
      }
    }
  });

  it('survives 100-character names without breaking either part', async () => {
    const long = 'Đ'.repeat(100);
    const mail = await buildInviteEmail({ ...input, inviterName: long, workspaceName: long });
    expect(mail.html).toContain(`${long} invited you to join ${long}`);
    expect(mail.text).toContain(long);
    expect(mail.subject).toContain(long);
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('keeps CR and LF out of the subject but never drops the words', async () => {
    const mail = await buildInviteEmail({
      ...input,
      inviterName: 'Eve\r\n\r\nBcc: x@example.com',
      workspaceName: 'A\nB\rC',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toContain('A B C');
  });

  it('loads nothing remote but the logo, and has no tracking pixel or script', async () => {
    const { html } = await buildInviteEmail(input);
    const markup = html ?? '';
    const images = [...markup.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(images).toHaveLength(1);
    expect(images[0]).toContain('src="https://app.example.com/email/logo.png"');
    expect(markup).not.toMatch(/<script|<iframe|<video|<audio|<object|<embed|<form|@import/i);
    expect(markup).not.toMatch(/url\(\s*['"]?https?:/i);
    // Every absolute URL is the logo, the invite link, or the XHTML doctype.
    const urls = new Set(markup.match(/https?:\/\/[^"'\s<)]+/g));
    for (const url of urls) {
      expect([
        'https://app.example.com/email/logo.png',
        'http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd',
        LINK,
      ]).toContain(url);
    }
  });

  it('has no HTML entities or markup in the plain-text part, even for odd names', async () => {
    const { text } = await buildInviteEmail({
      ...input,
      inviterName: "O'Brien & <Sons>",
      workspaceName: 'Fish "n" Chips',
    });
    expect(text.replace("O'Brien & <Sons>", '')).not.toMatch(ENTITY);
    expect(text).not.toContain('&amp;');
    expect(text).toContain("O'Brien & <Sons>");
  });
});
