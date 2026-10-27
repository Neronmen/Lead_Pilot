import { Check } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

const STEPS = ['s1', 's2', 's3', 's4'] as const;
const REASONS = ['r1', 'r2', 'r3'] as const;

/**
 * Sign up's right column: what happens after sign-up (four steps, in order,
 * so they are numbered) and a sample of what the team will see. The design's
 * "starts with sample leads" line is left out: sample leads arrive with the
 * seed data in M6, so it would promise something that is not there yet.
 */
export async function SignupAside() {
  const t = await getTranslations('auth.signup.aside');
  const sample = await getTranslations('auth.aside');
  return (
    <div className="flex max-w-[560px] flex-col gap-7">
      <div className="flex max-w-[520px] flex-col gap-2.5">
        <h2 className="text-[26px] leading-[33px] font-semibold tracking-tight text-balance">
          {t('title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('sub')}</p>
      </div>

      <ol className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li
            key={step}
            className="flex flex-col gap-2 rounded-xl border border-border bg-raised px-4 py-3.5"
          >
            <span
              aria-hidden
              className="inline-flex size-[26px] items-center justify-center rounded-full border border-accent-line font-mono text-xs font-semibold text-accent-text"
            >
              {index + 1}
            </span>
            <span className="text-sm font-semibold">{t(`steps.${step}.title`)}</span>
            <span className="text-[13px] leading-[18px] text-muted-foreground">
              {t(`steps.${step}.body`)}
            </span>
          </li>
        ))}
      </ol>

      <div aria-hidden className="flex flex-col gap-2.5">
        <span className="text-[13px] text-muted-foreground">{t('youGet')}</span>
        <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-background px-[18px] py-4">
          <div className="flex items-start justify-between gap-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{sample('sample.name')}</span>
              <span className="text-[13px] text-muted-foreground">{sample('sample.role')}</span>
            </span>
            <span className="flex items-center gap-2.5">
              <span className="font-mono text-2xl font-medium tabular-nums">
                {sample('sample.score')}
              </span>
              <span className="rounded-full border border-accent-line bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-text">
                {sample('hot')}
              </span>
            </span>
          </div>
          <ul className="flex flex-col gap-1.5 text-[13px] leading-[18px]">
            {REASONS.map((reason) => (
              <li key={reason} className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-accent-text" strokeWidth={2.5} />
                {t(`reasons.${reason}`)}
              </li>
            ))}
          </ul>
          <span className="border-t border-border pt-2.5 text-[13px] text-muted-foreground">
            {t('routed')}
          </span>
        </div>
      </div>
    </div>
  );
}
