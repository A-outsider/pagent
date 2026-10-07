import type { InputHTMLAttributes } from 'react';
import { cn } from '@/shared/utils/utils';

export function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-8 w-full rounded-md border border-input bg-field px-2.5 text-sm text-ink shadow-xs transition-colors',
        'placeholder:text-ink-3 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'focus-visible:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
