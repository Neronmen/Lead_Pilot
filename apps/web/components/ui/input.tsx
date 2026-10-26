import * as React from 'react';
import { cn } from 'cn';

/**
 * A text field as the canvas draws it: 44 px tall, card background, a cyan
 * border and soft ring on focus, and a red border when `aria-invalid`.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-11 w-full min-w-0 rounded-[9px] border border-border bg-card px-3 text-[15px] text-foreground transition-colors outline-none',
        'placeholder:text-muted-foreground',
        'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none',
        'aria-invalid:border-danger aria-invalid:shadow-[0_0_0_3px_var(--danger-bg)]',
        'read-only:bg-raised read-only:text-muted-foreground',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
