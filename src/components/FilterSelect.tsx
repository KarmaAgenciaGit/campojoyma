import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export type FilterSelectOption = {
  value: string;
  label: string;
  markerClassName?: string;
  labelClassName?: string;
};

interface FilterSelectProps {
  id?: string;
  value: string;
  options: FilterSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  triggerClassName?: string;
}

type MenuPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

export function FilterSelect({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  triggerClassName = '',
}: FilterSelectProps) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  const updateMenuPosition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 8;
    const width = Math.max(rect.width, 224);
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(120, openUp ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(288, availableHeight);
    const estimatedMenuHeight = Math.min(maxHeight, Math.max(44, options.length * 40 + 8));
    const top = openUp
      ? Math.max(viewportPadding, rect.top - gap - estimatedMenuHeight)
      : Math.min(rect.bottom + gap, window.innerHeight - viewportPadding - estimatedMenuHeight);

    setMenuPosition({ top, left, width, maxHeight });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    updateMenuPosition();
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const menu =
    open && menuPosition && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            className="origin-top overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xl animate-in fade-in-0 slide-in-from-top-1 zoom-in-95 duration-150 dark:border-border dark:bg-popover dark:shadow-black/40"
            style={{
              position: 'fixed',
              top: menuPosition.top,
              left: menuPosition.left,
              width: menuPosition.width,
              zIndex: 10000,
            }}
          >
            <div
              role="listbox"
              aria-label={ariaLabel}
              className="overflow-y-auto py-1"
              style={{ maxHeight: menuPosition.maxHeight }}
            >
              {options.map((option) => {
                const active = option.value === value;
                const hasCustomColor = Boolean(option.markerClassName || option.labelClassName);
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                      active && !hasCustomColor
                        ? 'bg-primary/10 font-semibold text-primary dark:bg-primary/15 dark:text-blue-200'
                        : active
                          ? 'bg-slate-50 font-semibold text-slate-800 dark:bg-muted dark:text-foreground'
                          : 'text-slate-800 hover:bg-slate-50 dark:text-foreground dark:hover:bg-muted/70'
                    }`}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      {option.markerClassName && (
                        <span className={`h-2 w-2 shrink-0 rounded-full ${option.markerClassName}`} />
                      )}
                      <span className={`truncate ${option.labelClassName ?? ''}`}>{option.label}</span>
                    </span>
                    {active && <Check className="h-4 w-4 shrink-0 text-primary dark:text-blue-300" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative min-w-0 w-full">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (!open) updateMenuPosition();
          setOpen((value) => !value);
        }}
        className={`flex h-10 w-full items-center justify-between gap-3 overflow-hidden rounded-md border bg-white px-3 text-left text-sm text-slate-950 outline-none transition-all dark:bg-background dark:text-foreground ${triggerClassName} ${
          open
            ? 'border-primary ring-2 ring-primary/15 dark:ring-primary/20'
            : 'border-slate-300 hover:border-slate-400 dark:border-border dark:hover:border-primary/60'
        } disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 disabled:hover:border-slate-300 dark:disabled:bg-muted dark:disabled:text-muted-foreground dark:disabled:hover:border-border`}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selected?.markerClassName && (
            <span className={`h-2 w-2 shrink-0 rounded-full ${selected.markerClassName}`} />
          )}
          <span className={`truncate ${selected?.labelClassName ?? ''}`}>{selected?.label ?? 'Seleccionar'}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform duration-150 dark:text-muted-foreground ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu}
    </div>
  );
}
