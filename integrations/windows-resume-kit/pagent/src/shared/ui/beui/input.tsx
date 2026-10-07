'use client';

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/shared/utils/utils';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange'> {
  label?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  error?: string | boolean;
  success?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    id: idProp,
    label,
    value: valueProp,
    defaultValue,
    onValueChange,
    onFocus,
    onBlur,
    error,
    success,
    leftIcon,
    rightIcon,
    className,
    disabled,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const reduce = useReducedMotion();
  const fieldRef = useRef<HTMLDivElement>(null);
  const [internalValue, setInternalValue] = useState(defaultValue ?? '');
  const [focused, setFocused] = useState(false);
  const controlled = valueProp !== undefined;
  const value = controlled ? valueProp : internalValue;
  const hasError = Boolean(error);
  const errorMessage = typeof error === 'string' ? error : undefined;

  useEffect(() => {
    if (!fieldRef.current || reduce || !hasError) return;
    animate(fieldRef.current, { x: [0, -5, 5, -3, 3, 0] }, { duration: 0.4 });
  }, [hasError, reduce]);

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
        </label>
      )}
      <div
        ref={fieldRef}
        data-state={hasError ? 'error' : success ? 'success' : focused ? 'focused' : 'idle'}
        className={cn(
          'relative h-9 overflow-hidden rounded-control border border-input bg-card transition-colors',
          focused && !hasError && 'border-ring ring-2 ring-ring/20',
          hasError && 'border-destructive ring-2 ring-destructive/20',
          disabled && 'opacity-60',
          className,
        )}
      >
        {leftIcon && (
          <span className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
            {leftIcon}
          </span>
        )}
        <input
          {...props}
          ref={ref}
          id={id}
          data-slot="input"
          value={value}
          disabled={disabled}
          aria-invalid={hasError || undefined}
          aria-describedby={errorMessage ? `${id}-error` : undefined}
          onChange={(event) => {
            if (!controlled) setInternalValue(event.target.value);
            onValueChange?.(event.target.value);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          className={cn(
            'h-full w-full bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed',
            leftIcon && 'pl-9',
            (rightIcon || success) && 'pr-9',
          )}
        />
        {success ? (
          <motion.svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-green"
          >
            <motion.path
              d="M5 12.5l4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
            />
          </motion.svg>
        ) : rightIcon ? (
          <span className="absolute top-0 right-0 flex h-full items-center text-muted-foreground">
            {rightIcon}
          </span>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {errorMessage && (
          <motion.p
            id={`${id}-error`}
            role="alert"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
            className="text-xs text-destructive"
          >
            {errorMessage}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
});
