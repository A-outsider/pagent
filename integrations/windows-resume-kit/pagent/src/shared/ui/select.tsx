import * as SelectPrimitive from '@radix-ui/react-select';
import { IconCheck, IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
} from 'react';
import { resolveShadowPortal } from '@/shared/extension/shadow-portal';
import { cn } from '@/shared/utils/utils';

interface SelectContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function composeRefs<T>(...refs: (Ref<T> | undefined)[]) {
  return (node: T) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as React.MutableRefObject<T | null>).current = node;
      }
    }
  };
}

export function Select({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDownCapture = (event: PointerEvent) => {
      const target = event.target as Node | null;
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];

      const isInsideTrigger =
        triggerRef.current &&
        (triggerRef.current === target ||
          triggerRef.current.contains(target) ||
          path.includes(triggerRef.current));

      const isInsideContent =
        contentRef.current &&
        (contentRef.current === target ||
          contentRef.current.contains(target) ||
          path.includes(contentRef.current));

      if (!isInsideTrigger && !isInsideContent) {
        handleOpenChange(false);
      }
    };

    const root = triggerRef.current?.getRootNode() ?? document;
    root.addEventListener('pointerdown', handlePointerDownCapture as EventListener, true);
    if (root !== document) {
      document.addEventListener('pointerdown', handlePointerDownCapture, true);
    }

    return () => {
      root.removeEventListener('pointerdown', handlePointerDownCapture as EventListener, true);
      if (root !== document) {
        document.removeEventListener('pointerdown', handlePointerDownCapture, true);
      }
    };
  }, [open, handleOpenChange]);

  return (
    <SelectContext.Provider value={{ open, setOpen: handleOpenChange, triggerRef, contentRef }}>
      <SelectPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props}>
        {children}
      </SelectPrimitive.Root>
    </SelectContext.Provider>
  );
}

export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ref,
  onPointerDown,
  onClick,
  onKeyDown,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  const ctx = useContext(SelectContext);
  const composedRef = composeRefs(ref, ctx?.triggerRef);
  const openedOnPointerDownRef = useRef(false);
  const closedOnPointerDownRef = useRef(false);

  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      ref={composedRef}
      className={cn(
        'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-field px-2.5 text-sm text-ink shadow-xs transition-colors',
        'data-[placeholder]:text-ink-3 focus:outline-none focus-visible:border-line-strong focus-visible:ring-2 focus-visible:ring-ring/40',
        'disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1',
        className,
      )}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (event.defaultPrevented) return;
        if (ctx?.open) {
          event.preventDefault();
          closedOnPointerDownRef.current = true;
          openedOnPointerDownRef.current = false;
          ctx.setOpen(false);
        } else {
          closedOnPointerDownRef.current = false;
          openedOnPointerDownRef.current = true;
        }
      }}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (closedOnPointerDownRef.current) {
          event.preventDefault();
          closedOnPointerDownRef.current = false;
          return;
        }
        if (openedOnPointerDownRef.current) {
          openedOnPointerDownRef.current = false;
          return;
        }
        if (ctx?.open) {
          event.preventDefault();
          ctx.setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (ctx?.open && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          closedOnPointerDownRef.current = true;
          openedOnPointerDownRef.current = false;
          ctx.setOpen(false);
        }
      }}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <IconChevronDown className="size-4 shrink-0 text-ink-3" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ref,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  const probeRef = useRef<HTMLSpanElement>(null);
  const ctx = useContext(SelectContext);
  const [container, setContainer] = useState<HTMLElement | undefined>(() =>
    resolveShadowPortal(ctx?.triggerRef.current),
  );
  const composedRef = composeRefs(ref, ctx?.contentRef);

  useLayoutEffect(() => {
    if (!container) {
      setContainer(resolveShadowPortal(probeRef.current ?? ctx?.triggerRef.current));
    }
  }, [container, ctx]);

  return (
    <>
      <span ref={probeRef} className="hidden" aria-hidden />
      <SelectPrimitive.Portal container={container}>
        <SelectPrimitive.Content
          ref={composedRef}
          data-slot="select-content"
          position={position}
          className={cn(
            'relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-md border border-line bg-popover text-popover-foreground shadow-raised',
            'pointer-events-auto',
            position === 'popper' &&
              'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport
            className={cn(
              'p-1',
              position === 'popper' &&
                'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
            )}
          >
            {children}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </>
  );
}

export function SelectLabel({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('px-2 py-1.5 text-xs font-medium text-ink-2', className)}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pr-8 pl-2 text-sm text-ink outline-none',
        'focus:bg-hover focus:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <IconCheck className="size-3.5 text-ink" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn('flex cursor-default items-center justify-center py-1 text-ink-2', className)}
      {...props}
    >
      <IconChevronUp className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn('flex cursor-default items-center justify-center py-1 text-ink-2', className)}
      {...props}
    >
      <IconChevronDown className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}
