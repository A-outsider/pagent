import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/utils/utils';

const badgeVariants = cva(
  'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[10.5px] font-medium',
  {
    variants: {
      variant: {
        default: 'bg-primary/12 text-accent-ink',
        secondary: 'bg-field text-ink-2',
        outline: 'border border-line bg-surface text-ink-2',
        success: 'bg-green-tint text-green',
      },
    },
    defaultVariants: { variant: 'secondary' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
