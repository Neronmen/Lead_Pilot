'use client';

import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * A value in a monospace box with a Copy button. `label` names the value for
 * screen readers ("Copy Your API key"); the visible label is the caller's.
 */
export function CopyBox({ value, label, tag }: { value: string; label: string; tag?: string }) {
  const t = useTranslations('copy');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked: the value is selectable in the box, so nothing is lost.
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-strong bg-raised py-1.5 pr-1.5 pl-3">
      <code
        aria-label={label}
        className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap select-all"
      >
        {value}
      </code>
      {tag ? (
        <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent-text">
          {tag}
        </span>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => void copy()}
        aria-label={t('copyLabel', { what: label })}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span aria-live="polite">{copied ? t('copied') : t('copy')}</span>
      </Button>
    </div>
  );
}

/** A code example: monospace, scrolls sideways instead of wrapping. */
export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="overflow-x-auto rounded-lg border border-border bg-raised p-3 font-mono text-xs leading-5"
    >
      {code}
    </pre>
  );
}
