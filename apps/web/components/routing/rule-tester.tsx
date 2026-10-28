'use client';

import type { ConditionCheck, TestRoutingResponse } from '@leadpilot/shared';
import { Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { TextField } from '@/components/auth/form-parts';
import { SourcesNotice, useFailureNotice, type Notice } from '@/components/sources/sources-notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { useTestRouting } from '@/lib/routing/use-routing';
import { useSources } from '@/lib/sources/use-sources';
import { useDescribe } from './sentence';

/**
 * "Test with a sample lead": describe a lead, and the page says which rule decides and why. It is a
 * dry run: nothing is assigned, sent or saved.
 */
export function RuleTester({ onClose }: { onClose: () => void }) {
  const t = useTranslations('routing');
  const tiers = useTranslations('tiers');
  const failure = useFailureNotice();
  const sources = useSources();
  const test = useTestRouting();
  const describe = useDescribe();
  const [score, setScore] = useState('90');
  const [tier, setTier] = useState('HOT');
  const [country, setCountry] = useState('US');
  const [sourceId, setSourceId] = useState('');
  const [freeMail, setFreeMail] = useState('false');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [result, setResult] = useState<TestRoutingResponse | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (test.isPending) return;
    setNotice(null);
    const number = Number(score);
    try {
      setResult(
        await test.mutateAsync({
          lead: {
            score: score.trim() === '' || Number.isNaN(number) ? null : Math.round(number),
            tier: tier === '' ? null : (tier as 'HOT'),
            country: /^[A-Za-z]{2}$/.test(country.trim()) ? country.trim().toUpperCase() : null,
            sourceId: sourceId || null,
            industry: null,
            isFreeMail: freeMail === 'true',
            customFields: {},
          },
        }),
      );
    } catch (error) {
      setNotice(failure(error));
    }
  }

  const checkLine = (check: ConditionCheck) =>
    describe.condition({
      field: check.field,
      ...(check.key === undefined ? {} : { key: check.key }),
      op: check.op,
      value: check.expected,
    });

  return (
    <section
      aria-labelledby="tester-title"
      className="flex flex-col gap-3 rounded-xl border border-accent-line bg-card px-[18px] py-4"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="tester-title" className="text-[15px] leading-[22px] font-semibold">
            {t('test.title')}
          </h2>
          <p className="text-[13px] text-muted-foreground">{t('test.sub')}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('test.close')}
        </Button>
      </div>
      {notice ? (
        <SourcesNotice
          notice={notice}
          onReload={() => setNotice(null)}
          onDismiss={() => setNotice(null)}
        />
      ) : null}
      <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
        <div className="w-24">
          <TextField
            label={t('test.score')}
            type="number"
            inputMode="numeric"
            value={score}
            onChange={(event) => setScore(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-tier">{t('test.tier')}</Label>
          <NativeSelect
            id="test-tier"
            className="w-auto"
            value={tier}
            onChange={(e) => setTier(e.target.value)}
          >
            {(['HOT', 'WARM', 'COLD', 'JUNK'] as const).map((value) => (
              <option key={value} value={value}>
                {tiers(value)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-24">
          <TextField
            label={t('test.country')}
            maxLength={2}
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-source">{t('test.source')}</Label>
          <NativeSelect
            id="test-source"
            className="w-auto"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">{t('test.anySource')}</option>
            {(sources.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-free">{t('test.freeMail')}</Label>
          <NativeSelect
            id="test-free"
            className="w-auto"
            value={freeMail}
            onChange={(e) => setFreeMail(e.target.value)}
          >
            <option value="false">{t('no')}</option>
            <option value="true">{t('yes')}</option>
          </NativeSelect>
        </div>
        <Button type="submit" disabled={test.isPending}>
          {t('test.run')}
        </Button>
      </form>

      {result ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {result.decidingRuleId
              ? t('test.decides', {
                  name: result.verdicts.find((v) => v.ruleId === result.decidingRuleId)?.name ?? '',
                })
              : t('test.noRule')}
          </p>
          <ul className="flex flex-col gap-2">
            {result.verdicts.map((verdict) => {
              const label = verdict.skipped
                ? t(`test.skipped.${verdict.skipped}`)
                : verdict.ruleId === result.decidingRuleId
                  ? t('test.verdictDecides')
                  : verdict.matched
                    ? t('test.verdictAlso')
                    : t('test.verdictNo');
              return (
                <li
                  key={verdict.ruleId}
                  className="rounded-lg border border-border bg-raised px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{verdict.name}</span>
                    <Badge
                      variant={verdict.ruleId === result.decidingRuleId ? 'default' : 'outline'}
                    >
                      {label}
                    </Badge>
                  </div>
                  {verdict.checks.length > 0 ? (
                    <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-muted-foreground">
                      {verdict.checks.map((check, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          {check.passed ? (
                            <Check
                              role="img"
                              className="mt-0.5 size-3.5 shrink-0 text-accent-text"
                              aria-label={t('test.passed')}
                            />
                          ) : (
                            <X
                              role="img"
                              className="mt-0.5 size-3.5 shrink-0 text-danger-text"
                              aria-label={t('test.failed')}
                            />
                          )}
                          <span>
                            {checkLine(check)}
                            {' · '}
                            {t('test.lead', {
                              value:
                                check.actual === null ? t('test.unknown') : String(check.actual),
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
