import { Button, Heading, Link, render, Text } from '@react-email/components';
import type { EmailMessage } from './email.provider';
import { EmailLayout, emailStyles } from './templates/email-layout';
import {
  type InviteCopy,
  type InviteEmailInput,
  inviteCopy,
  inviteText,
} from './templates/invite-copy';

export type { InviteEmailInput } from './templates/invite-copy';

/** The invite email, as the approved design shows it (docs/design-notes.md, Emails). */
export function InviteEmail({ copy, input }: { copy: InviteCopy; input: InviteEmailInput }) {
  return (
    <EmailLayout
      lang={input.locale}
      preheader={copy.preheader}
      webOrigin={input.webOrigin}
      why={copy.why}
      brand={copy.brand}
    >
      <Heading as="h1" className="lp-text" style={emailStyles.headline}>
        {copy.headline}
      </Heading>
      <Text className="lp-text" style={emailStyles.body}>
        {copy.body}
      </Text>
      <Button href={input.link} className="lp-btn" style={emailStyles.button}>
        {copy.button}
      </Button>
      <Text className="lp-muted" style={{ ...emailStyles.small, marginTop: '20px' }}>
        {copy.linkIntro}
      </Text>
      <Link href={input.link} className="lp-link" style={emailStyles.link}>
        {input.link}
      </Link>
      <Text className="lp-muted" style={emailStyles.small}>
        {copy.expiry}
      </Text>
    </EmailLayout>
  );
}

/**
 * The finished message: subject, HTML and a plain-text part with the same
 * words and link (SPEC §4.9: the workspace's language).
 */
export async function buildInviteEmail(input: InviteEmailInput): Promise<EmailMessage> {
  const copy = inviteCopy(input);
  const html = await render(<InviteEmail copy={copy} input={input} />);
  return { to: input.to, subject: copy.subject, text: inviteText(copy, input.link), html };
}
