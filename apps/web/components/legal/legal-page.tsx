import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';

/** Both pages have six numbered sections in the message files (`legal.<page>.s1` ... `s6`). */
const IDS = ['s1', 's2', 's3', 's4', 's5', 's6'] as const;
export type LegalKind = 'privacy' | 'terms';

/** The address people write to, set by the operator (NEXT_PUBLIC_CONTACT_EMAIL). Empty: the line is left out. */
const CONTACT = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ?? '';

/** Privacy Policy and Terms: plain headings and paragraphs from the message files, both languages. */
export async function LegalPage({ kind }: { kind: LegalKind }) {
  const t = await getTranslations('legal');
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo />
          {t('brand')}
        </Link>
        <span className="flex-1" />
        <LocaleSwitcher />
        <ThemeToggle />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-8 pb-16">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">{t(`${kind}.title`)}</h1>
          <p className="text-sm text-muted-foreground">{t('updated')}</p>
        </div>
        <p className="text-[15px] leading-6">{t(`${kind}.intro`)}</p>
        {IDS.map((id) => (
          <section key={id} className="flex flex-col gap-1.5">
            <h2 className="text-lg font-semibold">{t(`${kind}.${id}.title`)}</h2>
            <p className="text-[15px] leading-6 text-muted-foreground">{t(`${kind}.${id}.body`)}</p>
          </section>
        ))}
        {CONTACT ? (
          <p className="text-[15px] leading-6">
            {t('contact')}{' '}
            <a href={`mailto:${CONTACT}`} className="text-accent-text underline underline-offset-4">
              {CONTACT}
            </a>
          </p>
        ) : null}
        <nav aria-label={t('navLabel')} className="flex gap-4 text-sm">
          <Link href="/privacy" className="text-accent-text underline underline-offset-4">
            {t('privacy.title')}
          </Link>
          <Link href="/terms" className="text-accent-text underline underline-offset-4">
            {t('terms.title')}
          </Link>
          <Link href="/" className="text-accent-text underline underline-offset-4">
            {t('home')}
          </Link>
        </nav>
      </main>
    </div>
  );
}
