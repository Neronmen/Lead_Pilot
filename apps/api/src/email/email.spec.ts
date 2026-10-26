import type { Transporter } from 'nodemailer';
import { createTransport } from 'nodemailer';
import { MockEmailProvider } from './mock-email.provider';
import { SendTimeoutError, SmtpEmailProvider } from './smtp-email.provider';
import { MOCK_OUTBOX_LIMIT } from './mock-email.provider';

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
