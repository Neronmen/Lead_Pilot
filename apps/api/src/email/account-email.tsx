import { Button, Heading, Link, render, Text } from '@react-email/components';
import type { EmailMessage } from './email.provider';
import {
  type AccountCopy,
  type AccountEmailInput,
  accountCopy,
  accountText,
} from './templates/account-copy';
import { EmailLayout, emailStyles } from './templates/email-layout';

export type { AccountEmailInput } from './templates/account-copy';

/** Password reset and verify-address emails: the same card as the invite, one button. */
export function AccountEmail({ copy, input }: { copy: AccountCopy; input: AccountEmailInput }) {
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

export async function buildAccountEmail(input: AccountEmailInput): Promise<EmailMessage> {
  const copy = accountCopy(input);
  const html = await render(<AccountEmail copy={copy} input={input} />);
  return { to: input.to, subject: copy.subject, text: accountText(copy, input.link), html };
}
