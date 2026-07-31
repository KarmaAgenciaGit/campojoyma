import * as React from 'react';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';

import {
  fetchFacturaCuentas,
  type FacturaCuentaOption,
} from '@/services/facturas';
import { cn } from '@/lib/utils';
import { sanitizeUserFacingErrorMessage } from '@/lib/userFacingErrors';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

type CuentaContableComboboxProps = {
  empresaId: number | null | undefined;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  searchLimit?: number;
};

const normalizeSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-ES')
    .trim();

const isAccountPrefixSearch = (value: string) => /^\d+$/.test(value);

const remoteSearchParams = (value: string) =>
  isAccountPrefixSearch(value) ? { cuenta: value } : { search: value };

const historicalOption = (value: string): FacturaCuentaOption => ({
  value,
  label: value,
  description: null,
  nif: null,
});

export function CuentaContableCombobox({
  empresaId,
  value,
  onChange,
  placeholder = 'Buscar cuenta o descripción',
  disabled = false,
  className,
  searchLimit = 25,
}: CuentaContableComboboxProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef(new Map<string, HTMLDivElement>());
  const searchRequestRef = React.useRef(0);
  const selectedOptionRef = React.useRef<FacturaCuentaOption | null>(null);
  const listboxId = `cuenta-contable-options-${React.useId().replace(/:/g, '')}`;
  const normalizedValue = value?.trim() || null;
  const normalizedEmpresaId =
    Number.isInteger(Number(empresaId)) && Number(empresaId) > 0
      ? Number(empresaId)
      : null;
  const effectiveLimit = Math.min(Math.max(1, Math.trunc(searchLimit)), 50);

  const [open, setOpen] = React.useState(false);
  const [editingSearch, setEditingSearch] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<FacturaCuentaOption[]>([]);
  const [activeValue, setActiveValue] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [nextOffset, setNextOffset] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const selectedOption = React.useMemo(
    () =>
      options.find((option) => option.value === normalizedValue) ??
      (selectedOptionRef.current?.value === normalizedValue
        ? selectedOptionRef.current
        : normalizedValue
          ? historicalOption(normalizedValue)
          : null),
    [normalizedValue, options],
  );

  React.useEffect(() => {
    if (selectedOption) selectedOptionRef.current = selectedOption;
  }, [selectedOption]);

  React.useEffect(() => {
    searchRequestRef.current += 1;
    selectedOptionRef.current = normalizedValue
      ? historicalOption(normalizedValue)
      : null;
    setOptions(normalizedValue ? [historicalOption(normalizedValue)] : []);
    setSearch('');
    setEditingSearch(false);
    setActiveValue(null);
    setNextOffset(0);
    setHasMore(false);
    setLoadingMore(false);
    setErrorMessage(null);
  }, [normalizedEmpresaId, normalizedValue]);

  React.useEffect(() => {
    if (!normalizedEmpresaId || !normalizedValue) return;

    let active = true;
    fetchFacturaCuentas({
      empresaId: normalizedEmpresaId,
      cuenta: normalizedValue,
      limit: 10,
    })
      .then((found) => {
        if (!active) return;
        const exact = found.find((option) => option.value === normalizedValue);
        if (!exact) return;
        selectedOptionRef.current = exact;
        setOptions((current) => [
          exact,
          ...current.filter((option) => option.value !== exact.value),
        ]);
      })
      .catch(() => {
        // El valor histórico se mantiene visible aunque el catálogo no responda.
      });

    return () => {
      active = false;
    };
  }, [normalizedEmpresaId, normalizedValue]);

  React.useEffect(() => {
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;

    if (!open || !editingSearch || !normalizedEmpresaId) {
      setLoading(false);
      setLoadingMore(false);
      setHasMore(false);
      return;
    }

    const cleaned = search.trim();
    if (!cleaned) {
      setLoading(false);
      setNextOffset(0);
      setHasMore(false);
      setOptions(selectedOptionRef.current ? [selectedOptionRef.current] : []);
      return;
    }

    let active = true;
    setLoading(true);
    setLoadingMore(false);
    setNextOffset(0);
    setHasMore(false);
    setErrorMessage(null);
    const timeoutId = window.setTimeout(() => {
      fetchFacturaCuentas({
        empresaId: normalizedEmpresaId,
        ...remoteSearchParams(cleaned),
        limit: effectiveLimit,
      })
        .then((found) => {
          if (!active || requestId !== searchRequestRef.current) return;
          setNextOffset(found.length);
          setHasMore(found.length === effectiveLimit);
          setOptions(found);
        })
        .catch((error) => {
          if (!active || requestId !== searchRequestRef.current) return;
          setErrorMessage(
            sanitizeUserFacingErrorMessage(
              error instanceof Error
                ? error.message
                : 'No se pudo consultar el catálogo de cuentas.',
            ),
          );
        })
        .finally(() => {
          if (active && requestId === searchRequestRef.current) setLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [
    editingSearch,
    effectiveLimit,
    normalizedEmpresaId,
    open,
    search,
  ]);

  const loadMore = () => {
    const cleaned = search.trim();
    if (
      !normalizedEmpresaId ||
      !cleaned ||
      loading ||
      loadingMore ||
      !hasMore
    ) {
      return;
    }

    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setLoadingMore(true);
    setErrorMessage(null);
    void fetchFacturaCuentas({
      empresaId: normalizedEmpresaId,
      ...remoteSearchParams(cleaned),
      limit: effectiveLimit,
      offset: nextOffset,
    })
      .then((found) => {
        if (requestId !== searchRequestRef.current) return;
        setOptions((current) => {
          const byValue = new Map(
            current.map((option) => [option.value, option] as const),
          );
          found.forEach((option) => byValue.set(option.value, option));
          return Array.from(byValue.values());
        });
        setNextOffset((current) => current + found.length);
        setHasMore(found.length === effectiveLimit);
      })
      .catch((error) => {
        if (requestId !== searchRequestRef.current) return;
        setErrorMessage(
          sanitizeUserFacingErrorMessage(
            error instanceof Error
              ? error.message
              : 'No se pudo consultar el catálogo de cuentas.',
          ),
        );
      })
      .finally(() => {
        if (requestId === searchRequestRef.current) setLoadingMore(false);
      });
  };

  const filteredOptions = React.useMemo(() => {
    const query = normalizeSearch(search);
    if (!query || !editingSearch) return options;
    if (isAccountPrefixSearch(query)) {
      return options.filter((option) =>
        normalizeSearch(option.value).startsWith(query),
      );
    }
    return options.filter((option) =>
      normalizeSearch(`${option.value} ${option.description ?? ''}`).includes(
        query,
      ),
    );
  }, [editingSearch, options, search]);

  React.useEffect(() => {
    if (!open || loading || filteredOptions.length === 0) {
      setActiveValue(null);
      return;
    }
    setActiveValue((current) => {
      if (current && filteredOptions.some((option) => option.value === current)) {
        return current;
      }
      if (
        normalizedValue &&
        filteredOptions.some((option) => option.value === normalizedValue)
      ) {
        return normalizedValue;
      }
      return filteredOptions[0].value;
    });
  }, [filteredOptions, loading, normalizedValue, open]);

  React.useEffect(() => {
    if (activeValue) {
      optionRefs.current.get(activeValue)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeValue]);

  React.useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
      setEditingSearch(false);
      setSearch('');
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () =>
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  const close = () => {
    setOpen(false);
    setEditingSearch(false);
    setSearch('');
    setActiveValue(null);
  };

  const selectOption = (option: FacturaCuentaOption) => {
    selectedOptionRef.current = option;
    setOptions([option]);
    onChange(option.value);
    close();
    inputRef.current?.blur();
  };

  const moveActiveOption = (direction: 1 | -1) => {
    if (filteredOptions.length === 0) return;
    setActiveValue((current) => {
      const currentIndex = filteredOptions.findIndex(
        (option) => option.value === current,
      );
      if (currentIndex < 0) {
        return direction > 0
          ? filteredOptions[0].value
          : filteredOptions[filteredOptions.length - 1].value;
      }
      const nextIndex =
        (currentIndex + direction + filteredOptions.length) %
        filteredOptions.length;
      return filteredOptions[nextIndex].value;
    });
  };

  const displayValue = open
    ? editingSearch
      ? search
      : selectedOption?.label ?? ''
    : selectedOption?.label ?? '';
  const emptyMessage = !normalizedEmpresaId
    ? 'Selecciona primero la empresa ERP.'
    : errorMessage ??
      (search.trim()
        ? 'No se encontraron cuentas.'
        : 'Escribe una cuenta o descripción.');

  return (
    <div ref={rootRef} className="relative w-full">
      <div
        aria-disabled={disabled}
        className={cn(
          'relative flex w-full items-center',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-text',
          className,
        )}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
          window.setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
          }, 0);
        }}
      >
        {loading && open ? (
          <Loader2 className="pointer-events-none absolute left-3 h-4 w-4 animate-spin text-slate-400" />
        ) : (
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-slate-400" />
        )}
        <input
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={
            open && activeValue
              ? `${listboxId}-option-${activeValue}`
              : undefined
          }
          value={displayValue}
          disabled={disabled}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent pl-7 pr-8 font-[inherit] text-inherit outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:placeholder:text-slate-500"
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onChange={(event) => {
            setEditingSearch(true);
            setSearch(event.target.value);
            setActiveValue(null);
            if (!open) setOpen(true);
            if (!event.target.value && normalizedValue) onChange(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              moveActiveOption(event.key === 'ArrowDown' ? 1 : -1);
              return;
            }
            if (event.key === 'Enter' && open && activeValue) {
              const active = filteredOptions.find(
                (option) => option.value === activeValue,
              );
              if (active) {
                event.preventDefault();
                selectOption(active);
              }
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
              inputRef.current?.blur();
              return;
            }
            if (event.key === 'Tab' && open) close();
          }}
        />
        <ChevronsUpDown className="pointer-events-none absolute right-3 h-4 w-4 opacity-50" />
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md">
          <Command
            shouldFilter={false}
            value={activeValue ?? ''}
            onValueChange={(nextValue) => {
              if (
                filteredOptions.some((option) => option.value === nextValue)
              ) {
                setActiveValue(nextValue);
              }
            }}
          >
            <CommandList id={listboxId}>
              {loading ? (
                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Consultando cuentas…
                </div>
              ) : filteredOptions.length === 0 ? (
                <CommandEmpty>{emptyMessage}</CommandEmpty>
              ) : (
                <CommandGroup>
                  {filteredOptions.map((option) => (
                    <CommandItem
                      ref={(node) => {
                        if (node) optionRefs.current.set(option.value, node);
                        else optionRefs.current.delete(option.value);
                      }}
                      id={`${listboxId}-option-${option.value}`}
                      key={option.value}
                      value={option.value}
                      onSelect={() => selectOption(option)}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          normalizedValue === option.value
                            ? 'opacity-100'
                            : 'opacity-0',
                        )}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{option.value}</p>
                        {option.description ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {option.description}
                          </p>
                        ) : null}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {!loading && filteredOptions.length > 0 && hasMore ? (
                <div className="border-t p-2">
                  <button
                    type="button"
                    className="flex h-8 w-full items-center justify-center rounded-sm px-2 text-sm font-medium text-primary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={loadingMore}
                    onClick={loadMore}
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Cargando…
                      </>
                    ) : (
                      'Cargar más cuentas'
                    )}
                  </button>
                </div>
              ) : null}
              {errorMessage && filteredOptions.length > 0 ? (
                <p
                  role="status"
                  className="border-t px-3 py-2 text-xs text-destructive"
                >
                  {errorMessage}
                </p>
              ) : null}
            </CommandList>
          </Command>
        </div>
      ) : null}
    </div>
  );
}
