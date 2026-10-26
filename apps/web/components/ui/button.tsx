import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from 'cn';
import { Slot } from 'radix-ui';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The one neon accent: primary actions only, with the canvas glow.
        default: 'bg-primary text-primary-foreground shadow-glow hover:brightness-110',
        outline: 'border-border-strong bg-transparent text-foreground hover:bg-hover',
        secondary: 'border-border bg-raised text-foreground hover:bg-hover',
        ghost: 'text-foreground hover:bg-hover aria-expanded:bg-hover',
        destructive:
          'border-danger-line bg-danger-bg text-danger-text hover:brightness-110 focus-visible:ring-danger/30',
        link: 'text-accent-text underline-offset-4 hover:underline',
      },
      size: {
        // 40 px is the canvas's usual button, 44 px the auth forms', 32 px a table row's.
        default:
          'h-10 gap-2 rounded-[9px] px-4 text-sm font-semibold has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-lg px-3 text-[13px] font-medium [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-11 gap-2 rounded-[9px] px-5 text-[15px] font-semibold',
        icon: 'size-10 rounded-[9px]',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8 rounded-lg',
        'icon-lg': 'size-11 rounded-[9px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
