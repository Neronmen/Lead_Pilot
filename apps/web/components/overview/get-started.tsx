'use client';

import { CircleCheck, Circle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { useRubric } from '@/lib/icp/use-rubric';
import { useIntegrations, useRules } from '@/lib/routing/use-routing';
import { useSources } from '@/lib/sources/use-sources';
import { cn } from '@/lib/utils';

/**
 * The three things that make LeadPilot useful, as a short checklist for the Owner or an Admin: connect
 * a source, say who the ideal customer is, choose where good leads go. It disappears once all three
 * are done, and shows nothing while it is still loading (a flash of "not done" would be wrong).
 */
export function GetStarted() {
  const t = useTranslations('getStarted');
  const sources = useSources();
  const rubric = useRubric();
  const integrations = useIntegrations();
  const rules = useRules();

  if (!sources.data || !rubric.data || !integrations.data || !rules.data) return null;
  const steps = [
    { id: 'source', done: sources.data.length > 0, href: '/settings/sources' },
    { id: 'ideal', done: rubric.data.updatedAt !== null, href: '/settings/ideal-customer' },
    {
      id: 'handover',
      done: integrations.data.length > 0 && rules.data.length > 0,
      href: integrations.data.length > 0 ? '/settings/routing' : '/settings/integrations',
    },
  ] as const;
  if (steps.every((step) => step.done)) return null;
  const finished = steps.filter((step) => step.done).length;

  return (
    <section
      aria-labelledby="get-started"
      className="flex flex-col gap-3 rounded-xl border border-accent-line bg-card px-[18px] py-4"
    >
      <div>
        <h2 id="get-started" className="text-[15px] leading-[22px] font-semibold">
          {t('title')}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          {t('progress', { done: finished, total: steps.length })}
        </p>
      </div>
      <ol className="flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {step.done ? (
              <CircleCheck
                className="size-5 shrink-0 text-accent-text"
                aria-label={t('done')}
                role="img"
              />
            ) : (
              <Circle
                className="size-5 shrink-0 text-muted-foreground"
                aria-label={t('todo')}
                role="img"
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t(`steps.${step.id}.title`)}</span>
              <span className="block text-[13px] text-muted-foreground">
                {t(`steps.${step.id}.body`)}
              </span>
            </span>
            <Link
              href={step.href}
              className={cn(
                buttonVariants({ variant: step.done ? 'ghost' : 'outline', size: 'sm' }),
              )}
            >
              {step.done ? t('change') : t('go')}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
