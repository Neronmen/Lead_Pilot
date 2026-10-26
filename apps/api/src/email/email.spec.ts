import type { Transporter } from 'nodemailer';
import { createTransport } from 'nodemailer';
import { buildInviteEmail, type InviteEmailInput } from './invite-email';
import { MockEmailProvider } from './mock-email.provider';
import { SendTimeoutError, SmtpEmailProvider } from './smtp-email.provider';
import { MOCK_OUTBOX_LIMIT } from './mock-email.provider';

const input: InviteEmailInput = {
  to: 'ethan.brooks@northstargrowth.com',
  locale: 'en',
  inviterName: 'Mia Johnson',
  workspaceName: 'Northstar Growth',
  role: 'MEMBER',
  link: 'https://app.example.com/invite#t=abc',
  expiresInDays: 7,
};

describe('buildInviteEmail', () => {
  it('writes the English email with the link, the role and the expiry', () => {
    const mail = buildInviteEmail(input);
    expect(mail.to).toBe(input.to);
    expect(mail.subject).toBe('Mia Johnson invited you to Northstar Growth on LeadPilot');
    expect(mail.text).toContain('as a member');
    expect(mail.text).toContain(input.link);
    expect(mail.text).toContain('7 days');
    expect(mail.html).toContain(`href="${input.link}"`);
  });

  it('writes the Vietnamese email with the glossary role words', () => {
    const member = buildInviteEmail({ ...input, locale: 'vi' });
    expect(member.subject).toBe('Mia Johnson đã mời bạn tham gia Northstar Growth trên LeadPilot');
    expect(member.text).toContain('với vai trò thành viên');
    const admin = buildInviteEmail({ ...input, locale: 'vi', role: 'ADMIN' });
    expect(admin.text).toContain('với vai trò quản trị viên');
    expect(admin.text).toContain('7 ngày');
  });

  it('keeps the subject on one line whatever the names contain', () => {
    const mail = buildInviteEmail({
      ...input,
      inviterName: 'Eve\r\nBcc: victim@example.com',
      workspaceName: 'Acme\nCorp',
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toBe('Eve Bcc: victim@example.com invited you to Acme Corp on LeadPilot');
  });

  it('escapes HTML in names and the link', () => {
    const mail = buildInviteEmail({
      ...input,
      inviterName: '<script>alert(1)</script>',
      link: 'https://app.example.com/invite#t="x"',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('#t=&quot;x&quot;');
  });
});

describe('MockEmailProvider', () => {
  it('keeps what is sent and finds the newest message to an address', async () => {
    const mock = new MockEmailProvider();
    await mock.send({ to: 'a@b.co', subject: 'one', text: '1' });
    await mock.send({ to: 'a@b.co', subject: 'two', text: '2' });
    expect(mock.outbox).toHaveLength(2);
    expect(mock.lastTo('a@b.co')?.subject).toBe('two');
    expect(mock.lastTo('nobody@b.co')).toBeUndefined();
  });

  it('keeps only the newest messages, so live invite links do not pile up', async () => {
    const mock = new MockEmailProvider();
    for (let i = 0; i < MOCK_OUTBOX_LIMIT + 5; i += 1) {
      await mock.send({ to: `p${i}@b.co`, subject: `s${i}`, text: 't' });
    }
    expect(mock.outbox).toHaveLength(MOCK_OUTBOX_LIMIT);
    expect(mock.outbox[0]?.to).toBe('p5@b.co');
    expect(mock.lastTo('p0@b.co')).toBeUndefined();
  });

  it('fails on demand', async () => {
    const mock = new MockEmailProvider();
    mock.failWith = new Error('smtp down');
    await expect(mock.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toThrow('smtp down');
    expect(mock.outbox).toHaveLength(0);
  });
});

describe('SmtpEmailProvider', () => {
  const options = { host: 'localhost', port: 1025, from: 'LeadPilot <no-reply@leadpilot.local>' };

  it('hands the message to the transport with the configured sender', async () => {
    // jsonTransport builds the message without opening a connection.
    const transport = createTransport({ jsonTransport: true });
    const provider = new SmtpEmailProvider(options, transport);
    const spy = jest.spyOn(transport, 'sendMail');
    await provider.send({ to: 'a@b.co', subject: 'Hi', text: 'Body', html: '<p>Body</p>' });
    expect(spy).toHaveBeenCalledWith({
      from: options.from,
      to: 'a@b.co',
      subject: 'Hi',
      text: 'Body',
      html: '<p>Body</p>',
    });
  });

  it('rejects when the mail server cannot be reached', async () => {
    // Port 1 on localhost refuses connections at once.
    const provider = new SmtpEmailProvider({ ...options, port: 1 });
    await expect(provider.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toThrow();
  });

  it('gives up after the total deadline even when the server keeps the connection busy', async () => {
    const slow = {
      sendMail: () => new Promise(() => undefined), // never answers
    } as unknown as Transporter;
    const provider = new SmtpEmailProvider(options, slow, 50);
    await expect(provider.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toBeInstanceOf(
      SendTimeoutError,
    );
  });

  it('is a Transporter-compatible seam (type check only)', () => {
    const transport: Transporter = createTransport({ jsonTransport: true });
    expect(new SmtpEmailProvider(options, transport)).toBeDefined();
  });
});
