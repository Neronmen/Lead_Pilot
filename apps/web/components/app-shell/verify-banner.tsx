'use client';

import { MailWarning } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuthClient } from '@/lib/auth/auth-provider';
import { useCurrentMe } from './me-context';

/** Until the person follows the link in the verification email, a one-line reminder with "Send again". */
export function VerifyBanner() {
  const t = useTranslations('auth.account.banner');
  const me = useCurrentMe();
  const client = useAuthClient();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  if (me.user.emailVerified) return null;

  async function resend() {
    setState('sending');
    try {
      await client.request('/auth/resend-verification', { method: 'POST' });
      setState('sent');
    } catch {
      setState('failed');
    }
  }

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warm/30 bg-warm-bg px-4 py-2.5 text-[13px]"
    >
      <MailWarning className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {state === 'sent'
          ? t('sent', { email: me.user.email })
          : state === 'failed'
            ? t('failed')
            : t('text', { email: me.user.email })}
      </span>
      {state === 'sent' ? null : (
        <Button
          size="sm"
          variant="outline"
          disabled={state === 'sending'}
          onClick={() => void resend()}
        >
          {t('resend')}
        </Button>
      )}
    </div>
  );
}
