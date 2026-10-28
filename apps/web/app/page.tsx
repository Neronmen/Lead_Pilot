import { Bell, Filter, Inbox } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { ThemeToggle } from '@/components/theme-toggle';
import { buttonVariants } from '@/components/ui/button';
import { DEMO_LOGIN } from '@/lib/demo';
import { cn } from '@/lib/utils';

/**
 * The public front page: what LeadPilot does in a few plain sentences, a sample of one rated lead,
 * and the two ways in. Static and light on purpose: no scripts beyond the theme and language buttons.
 */
export default async function HomePage() {
  const t = await getTranslations('landing');
  const steps = [
    { icon: Inbox, title: t('how.arrive.title'), body: t('how.arrive.body') },
    { icon: Filter, title: t('how.rate.title'), body: t('how.rate.body') },
    { icon: Bell, title: t('how.handover.title'), body: t('how.handover.body') },
  ];
  const reasons = [t('sample.r1'), t('sample.r2'), t('sample.r3')];
  const trust = [t('trust.t1'), t('trust.t2'), t('trust.t3'), t('trust.t4')];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo />
          {t('brand')}
        </Link>
        <span className="flex-1" />
        <LocaleSwitcher />
        <ThemeToggle />
        <Link href="/login" className={buttonVariants({ variant: 'ghost' })}>
          {t('signIn')}
        </Link>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 pt-10 pb-20">
        <section className="flex flex-col gap-5">
          <h1 className="max-w-3xl text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl">
            {t('hero.title')}
          </h1>
          <p className="max-w-2xl text-lg text-muted-foreground">{t('hero.sub')}</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
              {t('hero.create')}
            </Link>
            <Link href="/login" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
              {DEMO_LOGIN ? t('hero.demo') : t('signIn')}
            </Link>
          </div>
        </section>

        <section aria-labelledby="how" className="flex flex-col gap-5">
          <h2 id="how" className="text-2xl font-semibold tracking-tight">
            {t('how.title')}
          </h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card px-[18px] py-4"
              >
                <span className="inline-flex size-10 items-center justify-center rounded-lg border border-accent-line bg-accent-soft text-accent-text">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="text-[15px] leading-[22px] font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="sample"
          className="grid items-start gap-6 md:grid-cols-[1fr_1.1fr]"
        >
          <div className="flex flex-col gap-3">
            <h2 id="sample" className="text-2xl font-semibold tracking-tight">
              {t('sample.title')}
            </h2>
            <p className="text-muted-foreground">{t('sample.body')}</p>
          </div>
          <article
            aria-label={t('sample.cardLabel')}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card px-[18px] py-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold">{t('sample.name')}</span>
              <span className="rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-text">
                {t('sample.tier')}
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {t('sample.score')}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{t('sample.company')}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="text-[13px] text-muted-foreground">{t('sample.sentTo')}</p>
          </article>
        </section>

        <section aria-labelledby="trust" className="flex flex-col gap-4">
          <h2 id="trust" className="text-2xl font-semibold tracking-tight">
            {t('trust.title')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {trust.map((item) => (
              <li
                key={item}
                className="rounded-xl border border-border bg-card px-[18px] py-3 text-sm"
              >
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col items-start gap-3 rounded-2xl border border-accent-line bg-card px-6 py-8">
          <h2 className="text-2xl font-semibold tracking-tight">{t('cta.title')}</h2>
          <p className="text-muted-foreground">{t('cta.body')}</p>
          <Link href="/signup" className={cn(buttonVariants({ size: 'lg' }))}>
            {t('hero.create')}
          </Link>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-5xl px-4 pb-10 text-xs text-muted-foreground">
        {t('footer')}
      </footer>
    </div>
  );
}
