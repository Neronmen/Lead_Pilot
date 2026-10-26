/** One outgoing email. Plain text is required; HTML is optional. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends email (CLAUDE.md: external systems sit behind an interface). SMTP is
 * the real implementation (Mailpit in development), the mock keeps messages in
 * memory for tests and demo mode. Resend or similar can be added later behind
 * the same interface.
 */
export interface EmailProvider {
  /** Rejects when the message could not be handed to the mail server. */
  send(message: EmailMessage): Promise<void>;
}

/** Injection token for the active `EmailProvider`. */
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
