'use client';

import { useCallback, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/shared/utils/utils';
import { EASE_OUT, SPRING_LAYOUT } from './ease';

export interface BouncyAccordionItem {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface BouncyAccordionProps {
  items: BouncyAccordionItem[];
  value?: string | null;
  defaultValue?: string | null;
  onValueChange?: (value: string | null) => void;
  collapsible?: boolean;
  className?: string;
  classNames?: {
    item?: string;
    trigger?: string;
    title?: string;
    content?: string;
    description?: string;
  };
}

export function BouncyAccordion({
  items,
  value,
  defaultValue = null,
  onValueChange,
  collapsible = true,
  className,
  classNames,
}: BouncyAccordionProps) {
  const generatedId = useId();
  const reduce = useReducedMotion();
  const [internalValue, setInternalValue] = useState(defaultValue);
  const controlled = value !== undefined;
  const activeValue = controlled ? value : internalValue;

  const setValue = useCallback(
    (next: string | null) => {
      if (!controlled) setInternalValue(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );

  return (
    <div className={cn('w-full space-y-2', className)}>
      {items.map((item) => {
        const open = activeValue === item.id;
        const triggerId = `${generatedId}-${item.id}-trigger`;
        const contentId = `${generatedId}-${item.id}-content`;

        return (
          <motion.section
            key={item.id}
            layout="position"
            transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
            className={cn(
              'overflow-hidden rounded-card border border-border bg-card text-card-foreground',
              item.disabled && 'opacity-50',
              classNames?.item,
            )}
          >
            <button
              id={triggerId}
              type="button"
              disabled={item.disabled}
              aria-expanded={open}
              aria-controls={contentId}
              onClick={() => setValue(open && collapsible ? null : item.id)}
              className={cn(
                'flex min-h-10 w-full items-center gap-2.5 px-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
                classNames?.trigger,
              )}
            >
              {item.icon && (
                <span className="grid size-6 shrink-0 place-items-center text-muted-foreground">
                  {item.icon}
                </span>
              )}
              <span
                className={cn(
                  'min-w-0 flex-1 text-xs font-semibold tracking-wide text-foreground',
                  classNames?.title,
                )}
              >
                {item.title}
              </span>
              <motion.span
                aria-hidden
                animate={{ rotate: open ? 180 : 0 }}
                transition={reduce ? { duration: 0 } : { type: 'spring', duration: 0.42, bounce: 0.28 }}
                className="text-muted-foreground"
              >
                <ChevronDown className="size-3.5" />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  id={contentId}
                  role="region"
                  aria-labelledby={triggerId}
                  initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                  exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  transition={reduce ? { duration: 0 } : { duration: 0.35, ease: EASE_OUT }}
                  className={cn('overflow-hidden border-t border-border', classNames?.content)}
                >
                  <div className={cn('px-3 pt-2.5 pb-3', classNames?.description)}>
                    {item.description}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        );
      })}
    </div>
  );
}
