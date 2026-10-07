'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, Bell, Check, Info, LoaderCircle, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createPortal } from 'react-dom';
import { resolveShadowPortal } from '@/shared/extension/shadow-portal';
import { cn } from '@/shared/utils/utils';
import { SPRING_LAYOUT } from './ease';

export type ToastStatus = 'neutral' | 'info' | 'loading' | 'success' | 'error';

export interface AnimatedToast {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  status?: ToastStatus;
  icon?: ReactNode;
  dismissible?: boolean;
}

export interface AnimatedToastStackProps {
  toasts: AnimatedToast[];
  onDismiss?: (id: string) => void;
  placement?: 'static' | 'fixed' | 'absolute';
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  portal?: boolean;
  portalRoot?: Element | null;
  portalAnchor?: Element | null;
  className?: string;
}

const icons = {
  neutral: Bell,
  info: Info,
  loading: LoaderCircle,
  success: Check,
  error: AlertCircle,
};

const statusClasses: Record<ToastStatus, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-primary/10 text-primary',
  loading: 'bg-primary/10 text-primary',
  success: 'bg-green-tint text-green',
  error: 'bg-red-tint text-destructive',
};

const positionClasses = {
  'top-left': 'top-4 left-4',
  'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-right': 'right-4 bottom-4',
};

export function AnimatedToastStack({
  toasts,
  onDismiss,
  placement = 'static',
  position = 'bottom-right',
  portal = placement === 'fixed',
  portalRoot,
  portalAnchor,
  className,
}: AnimatedToastStackProps) {
  const reduce = useReducedMotion();
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    if (!portal) {
      setTarget(null);
      return;
    }
    setTarget(portalRoot ?? resolveShadowPortal(portalAnchor) ?? document.body);
  }, [portal, portalAnchor, portalRoot]);

  const content = (
    <ol
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'pointer-events-none flex w-full max-w-sm flex-col gap-2',
        placement === 'fixed' && 'fixed z-[90]',
        placement === 'absolute' && 'absolute z-20',
        placement !== 'static' && positionClasses[position],
        className,
      )}
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const status = toast.status ?? 'neutral';
          const Icon = icons[status];
          const dismissible = toast.dismissible !== false && Boolean(onDismiss);
          return (
            <motion.li
              key={toast.id}
              layout
              initial={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: 14, scale: 0.97, filter: 'blur(8px)' }
              }
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: 8, scale: 0.97, filter: 'blur(6px)' }
              }
              transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
              className="pointer-events-auto"
            >
              <div className="flex items-start gap-3 rounded-card border border-border bg-card/95 p-3 shadow-raised backdrop-blur-xl">
                <span
                  className={cn(
                    'mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full',
                    statusClasses[status],
                  )}
                >
                  {status === 'loading' && !reduce && !toast.icon ? (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    >
                      <Icon className="size-3.5" />
                    </motion.span>
                  ) : (
                    toast.icon ?? <Icon className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{toast.title}</p>
                  {toast.description && (
                    <p className="mt-0.5 text-xs leading-4 text-muted-foreground">
                      {toast.description}
                    </p>
                  )}
                </div>
                {dismissible && (
                  <button
                    type="button"
                    aria-label="关闭提示"
                    onClick={() => onDismiss?.(toast.id)}
                    className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );

  if (!portal) return content;
  if (!target) return null;
  return createPortal(content, target);
}
