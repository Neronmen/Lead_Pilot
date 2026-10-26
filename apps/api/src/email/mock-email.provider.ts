import { Logger } from '@nestjs/common';
import type { EmailMessage, EmailProvider } from './email.provider';

/** Only the newest messages are kept: each holds a live invite link. */
export const MOCK_OUTBOX_LIMIT = 100;

/**
 * Keeps sent messages in memory instead of sending them: used by tests and by
 * demo mode (no SMTP_HOST). It logs only that a message was skipped, never
 * its content, because invite emails carry a sign-in link. In demo mode set
 * SMTP_HOST=localhost to read invites in Mailpit (docker compose runs it).
 */
export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);
  /** Everything "sent" so far, oldest first. */
  readonly outbox: EmailMessage[] = [];
  /** Set to make the next `send` calls fail, to test the failure paths. */
  failWith?: Error;

  send(message: EmailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.outbox.push(message);
    if (this.outbox.length > MOCK_OUTBOX_LIMIT) this.outbox.shift();
    this.logger.log('Email not sent (no SMTP_HOST): stored in the in-memory outbox');
    return Promise.resolve();
  }

  /** The newest message to an address, or undefined. */
  lastTo(address: string): EmailMessage | undefined {
    return [...this.outbox].reverse().find((message) => message.to === address);
  }
}
