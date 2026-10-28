'use client';

import type { Source } from '@leadpilot/shared';
import { Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useSourceActions } from '@/lib/sources/use-sources';
import { CopyBox } from './copy-box';
import { type Notice, useFailureNotice } from './sources-notice';

/**
 * The source's public web form: switch it on and the page `/f/<id>` takes leads from anyone with the
 * link, so the customer can put it on their website (an iframe) or share the link, with no key to hide.
 */
export function WebFormCard({
  source,
  onNotice,
}: {
  source: Source;
  onNotice: (notice: Notice | null) => void;
}) {
  const t = useTranslations('sources.webForm');
  const failure = useFailureNotice();
  const { update } = useSourceActions();
  const link = `${window.location.origin}/f/${source.id}`;
  const snippet = `<iframe src="${link}" title="${t('frameTitle')}" width="100%" height="640" style="border:0"></iframe>`;

  async function toggle() {
    onNotice(null);
    try {
      await update.mutateAsync({ id: source.id, formEnabled: !source.formEnabled });
    } catch (error) {
      onNotice(failure(error));
    }
  }

  return (
    <section
      aria-label={t('title')}
      className="flex flex-col gap-2 rounded-lg border border-border bg-raised p-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Globe className="size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{t('title')}</h3>
          <p className="text-[13px] text-muted-foreground">
            {source.formEnabled ? t('on') : t('off')}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={update.isPending || !source.enabled}
          onClick={() => void toggle()}
        >
          {source.formEnabled ? t('turnOff') : t('turnOn')}
        </Button>
      </div>
      {source.formEnabled ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px]">{t('link')}</p>
          <CopyBox value={link} label={t('linkLabel')} />
          <p className="text-[13px]">{t('embed')}</p>
          <CopyBox value={snippet} label={t('embedLabel')} />
          <p className="text-xs text-muted-foreground">{t('safe')}</p>
        </div>
      ) : null}
    </section>
  );
}
