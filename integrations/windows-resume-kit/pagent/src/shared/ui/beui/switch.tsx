'use client';

import { useId, type ReactNode } from 'react';
import { motion, MotionConfig, useReducedMotion } from 'motion/react';
import { cn } from '@/shared/utils/utils';

const THUMB_SPRING = {
  type: 'spring',
  stiffness: 800,
  damping: 80,
  mass: 4,
} as const;

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  'aria-label'?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  'aria-label': ariaLabel,
  className,
}: SwitchProps) {
  const id = useId();
  const reduce = useReducedMotion();

  return (
    <MotionConfig transition={reduce ? { duration: 0 } : THUMB_SPRING}>
      <span className={cn('inline-flex items-center gap-3', className)}>
        <motion.button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => onCheckedChange(!checked)}
          initial={false}
          whileTap={reduce || disabled ? undefined : { scale: 0.94 }}
          className={cn(
            'inline-flex h-6 w-10 shrink-0 cursor-pointer items-center justify-start rounded-full px-1 outline-none transition-colors',
            'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'disabled:cursor-not-allowed disabled:opacity-60',
            checked ? 'bg-primary' : 'bg-muted-foreground/45',
          )}
        >
          <motion.span
            initial={false}
            animate={{ x: checked ? 17 : 0 }}
            className="block size-4 rounded-full bg-knob shadow-sm"
          />
        </motion.button>
        {label && (
          <label htmlFor={id} className="cursor-pointer text-sm text-foreground">
            {label}
          </label>
        )}
      </span>
    </MotionConfig>
  );
}
