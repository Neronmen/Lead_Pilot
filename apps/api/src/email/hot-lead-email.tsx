import { Button, Heading, Link, render, Text } from '@react-email/components';
import type { EmailMessage } from './email.provider';
import { EmailLayout, emailStyles } from './templates/email-layout';
import {
  type HotLeadCopy,
  type HotLeadEmailInput,
  hotLeadCopy,
  hotLeadText,
} from './templates/hot-lead-copy';

export type { HotLeadEmailInput } from './templates/hot-lead-copy';

/** The "New Hot lead" alert: the same card as the invite, with the reasons from Lead detail. */
export function HotLeadEmail({ copy, input }: { copy: HotLeadCopy; input: HotLeadEmailInput }) {
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
      {copy.reasons.length > 0 && (
        <>
          <Text className="lp-text" style={{ ...emailStyles.body, fontWeight: 600 }}>
            {copy.reasonsTitle}
          </Text>
          {copy.reasons.map((reason, index) => (
            <Text key={index} className="lp-text" style={emailStyles.body}>
              {`• ${reason}`}
            </Text>
          ))}
        </>
      )}
      <Button href={input.link} className="lp-btn" style={emailStyles.button}>
        {copy.button}
      </Button>
      <Text className="lp-muted" style={{ ...emailStyles.small, marginTop: '20px' }}>
        {copy.linkIntro}
      </Text>
      <Link href={input.link} className="lp-link" style={emailStyles.link}>
        {input.link}
      </Link>
    </EmailLayout>
  );
}

/** The finished message: subject, HTML and a plain-text part with the same words and link. */
export async function buildHotLeadEmail(input: HotLeadEmailInput): Promise<EmailMessage> {
  const copy = hotLeadCopy(input);
  const html = await render(<HotLeadEmail copy={copy} input={input} />);
  return { to: input.to, subject: copy.subject, text: hotLeadText(copy, input.link), html };
}
