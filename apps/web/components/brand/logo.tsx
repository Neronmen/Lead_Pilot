import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The LeadPilot mark (design/brand/leadpilot.svg), used as it is: never
 * recoloured or redrawn. It is a dark rounded square, so it reads on both
 * themes. Decorative when the name is written next to it.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/leadpilot.svg"
      alt=""
      width={size}
      height={size}
      // An SVG needs no resizing; skip the image optimizer.
      unoptimized
      className={cn('shrink-0 rounded-lg', className)}
    />
  );
}
