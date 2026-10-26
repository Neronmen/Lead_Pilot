import type { LucideIcon } from 'lucide-react';
import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'accent' | 'neutral' | 'danger';

const TONES: Record<Tone, string> = {
  accent: 'border-accent-line bg-accent-soft text-accent-text',
  neutral: 'border-border-strong bg-raised text-muted-foreground',
  danger: 'border-danger-line bg-danger-bg text-danger',
};

/** The empty / error / no-access look from the design: an icon tile, a title, a short line, an action. */
export function StateView({
  icon: Icon,
  tone = 'neutral',
  title,
  body,
  children,
  alert,
  heading: Heading = 'h2',
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  body?: string;
  children?: ReactNode;
  /** Announce to screen readers at once (errors). */
  alert?: boolean;
  /** `h1` when the state is the whole page. */
  heading?: 'h1' | 'h2';
  className?: string;
}) {
  return (
    <div
      role={alert ? 'alert' : undefined}
      className={cn(
        'flex flex-col items-center justify-center gap-3.5 px-6 py-12 text-center',
        className,
      )}
    >
      <span
        className={cn(
          'inline-flex size-12 items-center justify-center rounded-xl border',
          TONES[tone],
        )}
      >
        <Icon className="size-[22px]" strokeWidth={1.75} aria-hidden />
      </span>
      <Heading className="text-lg font-semibold">{title}</Heading>
      {body ? <p className="max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {children}
    </div>
  );
}

/** A request failed: say so, keep the page, offer a retry. */
export function ErrorState({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <StateView icon={AlertTriangle} tone="danger" title={title} body={body} alert>
      {children}
    </StateView>
  );
}
