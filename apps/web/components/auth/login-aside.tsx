import { getTranslations } from 'next-intl/server';

const CHIPS = ['web', 'zapier', 'csv', 'linkedin'] as const;

/**
 * Login's right column, as a still frame of the design's "live pipeline"
 * picture: sources on the left, the AI score gate in the middle, the three
 * lanes on the right, and a sample lead. The animated version (WebGL) is part
 * of the marketing work in M5; this frame has no moving parts.
 */
export async function LoginAside() {
  const t = await getTranslations('auth.aside');
  return (
    <>
      <div
        aria-hidden
        className="relative h-[440px] overflow-hidden rounded-2xl border border-border bg-background"
      >
        <span className="absolute top-[14%] bottom-[14%] left-1/2 w-px bg-accent-line shadow-[0_0_14px_var(--primary)]" />
        <span className="absolute top-[5%] left-1/2 -translate-x-1/2 rounded-md border border-accent-line bg-background px-2 py-[3px] font-mono text-[11px] tracking-[0.14em] whitespace-nowrap text-accent-text">
          {t('gate')}
        </span>
        <span className="absolute top-[5%] left-[4%] font-mono text-[11px] tracking-[0.14em] text-muted-foreground">
          {t('sources')}
        </span>
        <div className="absolute bottom-[5%] left-[4%] flex max-w-[42%] flex-wrap gap-1.5">
          {CHIPS.map((chip) => (
            <span
              key={chip}
              className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
            >
              {t(`chips.${chip}`)}
            </span>
          ))}
        </div>
        <span className="absolute top-[24%] right-[4%] rounded-full border border-accent-line bg-background px-2.5 py-0.5 text-xs font-semibold text-accent-text">
          {t('hot')}
        </span>
        <span className="absolute top-[47%] right-[4%] rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-semibold text-warm">
          {t('warm')}
        </span>
        <span className="absolute top-[70%] right-[4%] rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-semibold text-cold">
          {t('cold')}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] tracking-[0.14em] text-accent-text">
          {t('eyebrow')}
        </span>
        <p className="text-2xl leading-[31px] font-semibold tracking-tight">{t('pitch')}</p>
      </div>

      <div
        aria-hidden
        className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-raised p-[18px]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold">{t('sample.name')}</span>
            <span className="text-[13px] text-muted-foreground">{t('sample.role')}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[26px] font-medium tabular-nums">
              {t('sample.score')}
            </span>
            <span className="rounded-full border border-accent-line bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-text">
              {t('hot')}
            </span>
          </div>
        </div>
        <dl className="flex flex-col gap-2 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('sample.assigned')}</dt>
            <dd className="font-medium">{t('sample.assignedValue')}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('sample.actions')}</dt>
            <dd>{t('sample.actionsValue')}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t('sample.scored')}</dt>
            <dd className="font-mono text-xs">{t('sample.scoredValue')}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
