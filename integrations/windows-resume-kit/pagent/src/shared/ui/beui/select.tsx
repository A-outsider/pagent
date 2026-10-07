'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { cn } from '@/shared/utils/utils';
import { EASE_OUT } from './ease';

type SelectOption = { value: string; label: string; id: string; disabled: boolean };

interface SelectContextValue {
  value?: string;
  open: boolean;
  disabled: boolean;
  reduce: boolean;
  activeValue?: string;
  triggerId: string;
  listId: string;
  options: SelectOption[];
  setOpen: (open: boolean) => void;
  setActiveValue: (value?: string) => void;
  select: (value: string) => void;
  register: (option: SelectOption) => void;
  unregister: (value: string) => void;
  labelFor: (value?: string) => string | undefined;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelect(component: string) {
  const context = useContext(SelectContext);
  if (!context) throw new Error(`${component} must be used inside Select`);
  return context;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  className,
  children,
}: SelectProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [activeValue, setActiveValue] = useState<string>();
  const controlled = value !== undefined;
  const openControlled = openProp !== undefined;
  const currentValue = controlled ? value : internalValue;
  const open = openControlled ? openProp : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!openControlled) setInternalOpen(next);
      onOpenChange?.(next);
      if (next) setActiveValue(currentValue);
    },
    [currentValue, onOpenChange, openControlled],
  );

  const select = useCallback(
    (next: string) => {
      if (!controlled) setInternalValue(next);
      onValueChange?.(next);
      setOpen(false);
    },
    [controlled, onValueChange, setOpen],
  );

  const register = useCallback((option: SelectOption) => {
    setOptions((current) => {
      const index = current.findIndex((item) => item.value === option.value);
      if (index === -1) return [...current, option];
      const existing = current[index];
      if (!existing) return [...current, option];
      if (
        existing.label === option.label &&
        existing.disabled === option.disabled &&
        existing.id === option.id
      ) {
        return current;
      }
      return current.map((item, itemIndex) => (itemIndex === index ? option : item));
    });
  }, []);

  const unregister = useCallback((optionValue: string) => {
    setOptions((current) => current.filter((item) => item.value !== optionValue));
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('pointerdown', closeOnPointer);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('pointerdown', closeOnPointer);
    };
  }, [open, setOpen]);

  const context = useMemo<SelectContextValue>(
    () => ({
      value: currentValue,
      open,
      disabled,
      reduce,
      activeValue,
      triggerId: `${baseId}-trigger`,
      listId: `${baseId}-list`,
      options,
      setOpen,
      setActiveValue,
      select,
      register,
      unregister,
      labelFor: (optionValue) => options.find((item) => item.value === optionValue)?.label,
    }),
    [
      activeValue,
      baseId,
      currentValue,
      disabled,
      open,
      options,
      reduce,
      register,
      select,
      setOpen,
      unregister,
    ],
  );

  return (
    <SelectContext.Provider value={context}>
      <div ref={rootRef} className={cn('relative', open && 'z-30', className)}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

export interface SelectTriggerProps extends Omit<HTMLMotionProps<'button'>, 'value' | 'children'> {
  children: ReactNode;
}

export function SelectTrigger({ className, children, onKeyDown, ...props }: SelectTriggerProps) {
  const context = useSelect('SelectTrigger');
  const enabledOptions = context.options.filter((option) => !option.disabled);
  const activeIndex = enabledOptions.findIndex((option) => option.value === context.activeValue);

  const move = (direction: 1 | -1) => {
    if (!enabledOptions.length) return;
    const nextIndex =
      activeIndex < 0
        ? direction === 1
          ? 0
          : enabledOptions.length - 1
        : (activeIndex + direction + enabledOptions.length) % enabledOptions.length;
    context.setActiveValue(enabledOptions[nextIndex]?.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!context.open) context.setOpen(true);
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' && context.open) {
      event.preventDefault();
      context.setActiveValue(enabledOptions[0]?.value);
    } else if (event.key === 'End' && context.open) {
      event.preventDefault();
      context.setActiveValue(enabledOptions.at(-1)?.value);
    } else if ((event.key === 'Enter' || event.key === ' ') && context.open) {
      event.preventDefault();
      if (context.activeValue) context.select(context.activeValue);
    } else if (event.key === 'Escape' && context.open) {
      event.preventDefault();
      context.setOpen(false);
    }
  };

  const activeOption = context.options.find((option) => option.value === context.activeValue);

  return (
    <motion.button
      {...props}
      type="button"
      id={context.triggerId}
      data-field-id={props.id}
      disabled={context.disabled || props.disabled}
      aria-haspopup="listbox"
      aria-expanded={context.open}
      aria-controls={context.listId}
      aria-activedescendant={context.open ? activeOption?.id : undefined}
      onClick={() => context.setOpen(!context.open)}
      onKeyDown={handleKeyDown}
      initial={false}
      whileTap={context.reduce ? undefined : { scale: 0.99 }}
      className={cn(
        'relative flex h-9 w-full items-center justify-between gap-2 rounded-control border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors',
        'hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      {children}
      <motion.span
        aria-hidden
        animate={{ rotate: context.open ? 180 : 0 }}
        transition={context.reduce ? { duration: 0 } : { type: 'spring', duration: 0.4, bounce: 0.3 }}
        className="text-muted-foreground"
      >
        <ChevronDown className="size-4" />
      </motion.span>
    </motion.button>
  );
}

export function SelectValue({
  placeholder,
  className,
}: {
  placeholder?: string;
  className?: string;
}) {
  const context = useSelect('SelectValue');
  const label = context.labelFor(context.value);
  return (
    <span className={cn('truncate', label ? 'text-foreground' : 'text-muted-foreground', className)}>
      {label ?? placeholder ?? '请选择'}
    </span>
  );
}

export function SelectContent({ className, children }: { className?: string; children: ReactNode }) {
  const context = useSelect('SelectContent');
  const contentRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');

  useLayoutEffect(() => {
    if (!context.open) return;
    const trigger = document.getElementById(context.triggerId);
    if (!trigger || !contentRef.current) return;
    const rect = trigger.getBoundingClientRect();
    const height = contentRef.current.scrollHeight;
    const below = window.innerHeight - rect.bottom;
    setPlacement(below < height + 12 && rect.top > below ? 'top' : 'bottom');
  }, [context.open, context.triggerId]);

  return (
    <motion.div
      id={context.listId}
      ref={contentRef}
      role="listbox"
      aria-labelledby={context.triggerId}
      aria-hidden={!context.open}
      inert={!context.open}
      initial={false}
      animate={{
        opacity: context.open ? 1 : 0,
        height: context.open ? 'auto' : 0,
        y: context.open || context.reduce ? 0 : placement === 'top' ? 4 : -4,
      }}
      transition={context.reduce ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
      className={cn(
        'absolute right-0 left-0 z-40 overflow-hidden rounded-control border border-border bg-popover shadow-overlay',
        placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        className,
      )}
      style={{ pointerEvents: context.open ? 'auto' : 'none' }}
    >
      <div className="max-h-60 overflow-y-auto p-1">{children}</div>
    </motion.div>
  );
}

export function SelectItem({
  value,
  disabled = false,
  className,
  children,
}: {
  value: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const context = useSelect('SelectItem');
  const id = useId();
  const selected = context.value === value;
  const active = context.activeValue === value;
  const label = typeof children === 'string' ? children : value;

  useLayoutEffect(() => {
    context.register({ value, label, id, disabled });
    return () => context.unregister(value);
  }, [context.register, context.unregister, disabled, id, label, value]);

  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      tabIndex={-1}
      onPointerMove={() => context.setActiveValue(value)}
      onClick={() => context.select(value)}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-sm outline-none transition-colors',
        selected || active
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
    >
      {children}
      {selected && <Check aria-hidden className="size-3.5 shrink-0" />}
    </button>
  );
}
