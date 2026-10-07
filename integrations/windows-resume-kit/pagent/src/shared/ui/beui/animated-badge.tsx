'use client';

import { type ReactNode } from 'react';
import { AlertTriangle, Check, Circle, Info, LoaderCircle, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/shared/utils/utils';
import { EASE_OUT, SPRING_LAYOUT } from './ease';

export type AnimatedBadgeStatus =
  | 'neutral'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'loading';

const statusClasses: Record<AnimatedBadgeStatus, string> = {
  neutral: 'border-border bg-card text-muted-foreground',
  info: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-green/30 bg-green-tint text-green',
  warning: 'border-orange/30 bg-orange-tint text-orange',
  danger: 'border-destructive/30 bg-red-tint text-destructive',
  loading: 'border-primary/30 bg-primary/10 text-primary',
};

const statusIcons = {
  neutral: Circle,
  info: Info,
  success: Check,
  warning: AlertTriangle,
  danger: X,
  loading: LoaderCircle,
};

export interface AnimatedBadgeProps {
  status?: AnimatedBadgeStatus;
  size?: 'sm' | 'md';
  children?: ReactNode;
  icon?: ReactNode;
  showIcon?: boolean;
  pulse?: boolean;
  contentKey?: string | number;
  className?: string;
}

export function AnimatedBadge({
  status = 'neutral',
  size = 'sm',
  children,
  icon,
  showIcon = true,
  pulse = status === 'loading',
  contentKey,
  className,
}: AnimatedBadgeProps) {
  const reduce = useReducedMotion();
  const Icon = statusIcons[status];
  const key = contentKey ?? (typeof children === 'string' ? children : status);

  return (
    <motion.span
      layout
      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
      className={cn(
        'relative inline-flex shrink-0 items-center overflow-hidden whitespace-nowrap rounded-full border font-medium tabular-nums',
        size === 'sm' ? 'h-6 gap-1.5 px-2 text-[11px]' : 'h-8 gap-2 px-3 text-xs',
        statusClasses[status],
        className,
      )}
    >
      {pulse && !reduce && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-current"
          animate={{ scale: [0.94, 1.08, 0.94], opacity: [0.04, 0.12, 0.04] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {showIcon && (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={status}
            aria-hidden
            initial={reduce ? false : { opacity: 0, y: 6, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? undefined : { opacity: 0, y: -6, filter: 'blur(4px)' }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
            className="relative z-10 inline-flex [&_svg]:size-3"
          >
            {status === 'loading' && !reduce && !icon ? (
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Icon className="size-3" />
              </motion.span>
            ) : (
              icon ?? <Icon className="size-3" />
            )}
          </motion.span>
        </AnimatePresence>
      )}
      {children != null && (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={key}
            initial={reduce ? false : { opacity: 0, y: 6, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? undefined : { opacity: 0, y: -6, filter: 'blur(4px)' }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
            className="relative z-10"
          >
            {children}
          </motion.span>
        </AnimatePresence>
      )}
    </motion.span>
  );
}
