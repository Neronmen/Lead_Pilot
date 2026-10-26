import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

// The LeadPilot cyan system (docs/design-notes.md). Inline styles are the light
// palette; the media query below swaps in the dark one for clients that
// support it (Apple Mail, Outlook.com, most mobile apps).
const LIGHT = {
  page: '#F6F6FA',
  card: '#FFFFFF',
  border: '#E2E3EC',
  text: '#0D0E1A',
  muted: '#565A73',
  accent: '#0A7D8C',
  onAccent: '#FFFFFF',
  accentText: '#076A77',
};

const DARK_CSS = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .lp-page { background-color: #0A0A12 !important; }
    .lp-card { background-color: #10111C !important; border-color: #24263A !important; }
    .lp-text { color: #ECEDF5 !important; }
    .lp-muted { color: #9A9DB8 !important; }
    .lp-link { color: #22E1F0 !important; }
    .lp-btn { background-color: #22E1F0 !important; color: #031417 !important; }
    .lp-hr { border-color: #24263A !important; }
  }
`;

/** System fonts only: Geist is not reliable in inboxes, and these cover Vietnamese. */
const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const emailStyles = {
  headline: {
    margin: '0 0 10px',
    fontSize: '22px',
    lineHeight: '29px',
    fontWeight: 700,
    color: LIGHT.text,
  },
  body: { margin: '0 0 20px', fontSize: '15px', lineHeight: '23px', color: LIGHT.text },
  small: { margin: '0 0 6px', fontSize: '13px', lineHeight: '19px', color: LIGHT.muted },
  link: {
    margin: '0 0 6px',
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
    fontSize: '12px',
    lineHeight: '18px',
    color: LIGHT.accentText,
    wordBreak: 'break-all' as const,
  },
  button: {
    display: 'inline-block',
    padding: '12px 24px',
    borderRadius: '8px',
    backgroundColor: LIGHT.accent,
    color: LIGHT.onAccent,
    fontSize: '15px',
    fontWeight: 600,
    lineHeight: '20px',
    textDecoration: 'none',
  },
};

export interface EmailLayoutProps {
  lang: string;
  /** The preview line inboxes show next to the subject. */
  preheader: string;
  /** The logo PNG lives in the web app: `${webOrigin}/email/logo.png`. */
  webOrigin: string;
  /** The footer: why the person got this email. */
  why: string;
  brand: string;
  children: ReactNode;
}

/**
 * The frame every LeadPilot email shares: logo and name, one white card on the
 * page colour, and a footer saying why the person got the email. Tables and
 * inline CSS come from React Email, so it holds up in Outlook and Gmail.
 */
export function EmailLayout({
  lang,
  preheader,
  webOrigin,
  why,
  brand,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang={lang}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style>{DARK_CSS}</style>
      </Head>
      <Preview>{preheader}</Preview>
      <Body
        className="lp-page"
        style={{ margin: 0, padding: 0, backgroundColor: LIGHT.page, fontFamily: FONT }}
      >
        {/* React Email moves Body's style into an inner cell and keeps the class on
            <body>, so the page colour needs its own element to switch in dark mode. */}
        <Section className="lp-page" style={{ backgroundColor: LIGHT.page, padding: '32px 12px' }}>
          <Container
            className="lp-card"
            style={{
              boxSizing: 'border-box',
              maxWidth: '560px',
              width: '100%',
              padding: '32px',
              backgroundColor: LIGHT.card,
              border: `1px solid ${LIGHT.border}`,
              borderRadius: '12px',
            }}
          >
            <Section style={{ marginBottom: '20px' }}>
              <Img
                src={`${webOrigin}/email/logo.png`}
                width="28"
                height="28"
                alt="LeadPilot"
                style={{ display: 'inline-block', verticalAlign: 'middle', borderRadius: '8px' }}
              />
              <Text
                className="lp-text"
                style={{
                  display: 'inline-block',
                  margin: '0 0 0 10px',
                  verticalAlign: 'middle',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: LIGHT.text,
                }}
              >
                LeadPilot
              </Text>
            </Section>

            {children}

            <Hr className="lp-hr" style={{ margin: '20px 0', borderColor: LIGHT.border }} />
            <Text
              className="lp-muted"
              style={{
                margin: '0 0 8px',
                fontSize: '12px',
                lineHeight: '18px',
                color: LIGHT.muted,
              }}
            >
              {why}
            </Text>
            <Text
              className="lp-muted"
              style={{ margin: 0, fontSize: '12px', lineHeight: '18px', color: LIGHT.muted }}
            >
              {brand}
            </Text>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}
