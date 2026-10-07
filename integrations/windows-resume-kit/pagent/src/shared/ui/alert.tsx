import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/utils/utils';

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      data-slot="alert"
      className={cn(
        'relative flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-ink shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-[11.5px] font-semibold leading-4', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-[10.5px] leading-4 text-ink-3', className)} {...props} />;
}
