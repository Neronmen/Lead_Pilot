import * as React from 'react';
import { cn } from 'cn';

/**
 * The browser's own `<select>`, styled like `Input`. The canvas uses native
 * selects (they work with the keyboard and on phones without extra code).
 */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'h-11 w-full min-w-0 rounded-[9px] border border-border bg-card px-2.5 text-[15px] text-foreground transition-colors outline-none',
        'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]',
        'aria-invalid:border-danger aria-invalid:shadow-[0_0_0_3px_var(--danger-bg)]',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
