'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * A list of short phrases typed one at a time: type, press Enter (or Add), and
 * it becomes a chip with a remove button. `normalize` may reject a value (it
 * returns null and the field says why).
 */
export function ListField({
  label,
  hint,
  values,
  onChange,
  normalize = (value) => value,
  error,
  max = 30,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
  normalize?: (value: string) => string | null;
  /** Shown when `normalize` refused the last value. */
  error: string;
  max?: number;
}) {
  const t = useTranslations('ideal');
  const id = useId();
  const [draft, setDraft] = useState('');
  const [bad, setBad] = useState(false);

  function add() {
    const text = draft.trim();
    if (!text) return;
    const value = normalize(text);
    if (value === null) return setBad(true);
    setBad(false);
    setDraft('');
    if (!values.includes(value) && values.length < max) onChange([...values, value]);
  }
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault(); // Enter adds the phrase; it must not submit the whole form
      add();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          maxLength={100}
          autoComplete="off"
          aria-invalid={bad ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            setDraft(event.target.value);
            setBad(false);
          }}
          onKeyDown={onKey}
        />
        <Button type="button" variant="outline" onClick={add}>
          {t('add')}
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {bad ? <span className="text-danger-text">{error}</span> : hint}
      </p>
      {values.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li
              key={value}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-raised py-0.5 pr-1 pl-2.5 text-[13px]"
            >
              {value}
              <button
                type="button"
                aria-label={t('remove', { name: value })}
                onClick={() => onChange(values.filter((other) => other !== value))}
                className="inline-flex size-5 items-center justify-center rounded-full hover:bg-hover focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
