import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailProvider } from './email.provider';

export class SendTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';
  constructor() {
    super('Sending the email took too long');
    this.name = 'SendTimeoutError';
  }
}

export interface SmtpOptions {
  host: string;
  port: number;
  /** `Name <address>` shown as the sender. */
  from: string;
}

/** The whole send, from connecting to the server's answer, must finish within this. */
export const SEND_DEADLINE_MS = 15_000;

/**
 * SMTP through nodemailer. In development the server is Mailpit (UI on
 * :8025), so no real email ever leaves the machine. No authentication or TLS
 * is configured, so this provider is for Mailpit only: a real server needs
 * SMTP_USER/SMTP_PASS and required TLS added here (docs/backlog.md).
 */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: Transporter;

  /** `transport` and the deadline are injectable so tests need no network or waiting. */
  constructor(
    private readonly options: SmtpOptions,
    transport?: Transporter,
    private readonly deadlineMs: number = SEND_DEADLINE_MS,
  ) {
    this.transport =
      transport ??
      createTransport({
        host: options.host,
        port: options.port,
        secure: false,
        // Fail in seconds, not minutes, when the mail server is down.
        connectionTimeout: 5_000,
        greetingTimeout: 5_000,
        socketTimeout: 10_000,
      });
  }

  async send(message: EmailMessage): Promise<void> {
    // nodemailer's timeouts are idle timeouts: a server that drips bytes could
    // keep one open, so the whole send also gets a hard deadline.
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new SendTimeoutError()), this.deadlineMs);
    });
    try {
      await Promise.race([
        this.transport.sendMail({
          from: this.options.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        deadline,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
