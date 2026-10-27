'use client';

import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface TextFieldProps extends Omit<ComponentProps<typeof Input>, 'id'> {
  label: string;
  /** Already translated. */
  error?: string;
  hint?: ReactNode;
  /** Something after the input, such as the show-password button. */
  end?: ReactNode;
}

/**
 * A labelled input with an optional hint and error. The error and hint are
 * tied to the input (`aria-describedby`), and the error is announced when it
 * appears (`role="alert"`), so a screen reader hears what to fix.
 */
export function TextField({ label, error, hint, end, className, ...input }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          {...input}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(end ? 'pr-11' : null, className)}
        />
        {end ? (
          <div className="absolute inset-y-0 right-0 flex items-center pr-1">{end}</div>
        ) : null}
      </div>
      {hint ? (
        <div id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </div>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A password input with a show/hide button. */
export function PasswordField(props: Omit<TextFieldProps, 'type' | 'end'>) {
  const t = useTranslations('auth');
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      type={shown ? 'text' : 'password'}
      end={
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-label={shown ? t('hidePassword') : t('showPassword')}
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
        >
          {shown ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      }
    />
  );
}

/** A problem with the whole form (a wrong password, a lost connection). */
export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      data-form-alert
      tabIndex={-1}
      className="flex items-start gap-2.5 rounded-xl border border-danger-line bg-danger-bg p-3 text-[13px] leading-[18px] text-danger-text"
    >
      <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
