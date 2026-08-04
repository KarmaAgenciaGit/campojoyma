import * as React from 'react';
import { Check, Loader2, Search } from 'lucide-react';

import {
  fetchFacturaCuentas,
  type FacturaCuentaGastoHistorica,
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
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';

type CuentaContableComboboxProps = {
  empresaId: number | null | undefined;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  searchLimit?: number;
  previouslyUsed?: readonly FacturaCuentaGastoHistorica[];
};

const EMPTY_PREVIOUSLY_USED: readonly FacturaCuentaGastoHistorica[] = [];

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

const isSelectableHistoricalAccount = (
  option: FacturaCuentaGastoHistorica,
) =>
  option.existeEnCatalogo &&
  option.bloqueoFacturas?.trim().toUpperCase() !== 'S';

export function CuentaContableCombobox({
  empresaId,
  value,
  onChange,
  placeholder = 'Buscar cuenta',
  disabled = false,
  className,
  searchLimit = 25,
  previouslyUsed = EMPTY_PREVIOUSLY_USED,
}: CuentaContableComboboxProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef(new Map<string, HTMLDivElement>());
  const searchRequestRef = React.useRef(0);
  const selectedOptionRef = React.useRef<FacturaCuentaOption | null>(null);
  const [renderedListboxId, setRenderedListboxId] = React.useState<string>();
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

  const visiblePreviouslyUsed = React.useMemo(() => {
    const query = editingSearch ? normalizeSearch(search) : '';
    const unique = new Map<string, FacturaCuentaGastoHistorica>();
    previouslyUsed.forEach((option) => {
      const account = option.cuenta.trim();
      if (!account || unique.has(account)) return;
      if (
        query &&
        (isAccountPrefixSearch(query)
          ? !normalizeSearch(account).startsWith(query)
          : !normalizeSearch(`${account} ${option.descripcion ?? ''}`).includes(
              query,
            ))
      ) {
        return;
      }
      unique.set(account, { ...option, cuenta: account });
    });
    return Array.from(unique.values());
  }, [editingSearch, previouslyUsed, search]);

  const visiblePreviouslyUsedValues = React.useMemo(
    () => new Set(visiblePreviouslyUsed.map((option) => option.cuenta)),
    [visiblePreviouslyUsed],
  );
  const visibleCatalogOptions = React.useMemo(
    () =>
      filteredOptions.filter(
        (option) => !visiblePreviouslyUsedValues.has(option.value),
      ),
    [filteredOptions, visiblePreviouslyUsedValues],
  );
  const selectableOptions = React.useMemo<FacturaCuentaOption[]>(() => {
    const historical = visiblePreviouslyUsed
      .filter(isSelectableHistoricalAccount)
      .map((option) => ({
        value: option.cuenta,
        label: option.descripcion
          ? `${option.cuenta} - ${option.descripcion}`
          : option.cuenta,
        description: option.descripcion,
        nif: null,
      }));
    return [...historical, ...visibleCatalogOptions];
  }, [visibleCatalogOptions, visiblePreviouslyUsed]);

  React.useEffect(() => {
    if (!open || loading || selectableOptions.length === 0) {
      setActiveValue(null);
      return;
    }
    setActiveValue((current) => {
      if (current && selectableOptions.some((option) => option.value === current)) {
        return current;
      }
      if (
        normalizedValue &&
        selectableOptions.some((option) => option.value === normalizedValue)
      ) {
        return normalizedValue;
      }
      return selectableOptions[0].value;
    });
  }, [loading, normalizedValue, open, selectableOptions]);

  React.useEffect(() => {
    if (activeValue) {
      optionRefs.current.get(activeValue)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeValue]);

  const close = () => {
    setOpen(false);
    setEditingSearch(false);
    setSearch('');
    setActiveValue(null);
  };

  const setListboxRef = React.useCallback((node: HTMLDivElement | null) => {
    setRenderedListboxId(node?.id);
  }, []);

  const selectOption = (option: FacturaCuentaOption) => {
    selectedOptionRef.current = option;
    setOptions([option]);
    onChange(option.value);
    close();
    inputRef.current?.blur();
  };

  const moveActiveOption = (direction: 1 | -1) => {
    if (selectableOptions.length === 0) return;
    setActiveValue((current) => {
      const currentIndex = selectableOptions.findIndex(
        (option) => option.value === current,
      );
      if (currentIndex < 0) {
        return direction > 0
          ? selectableOptions[0].value
          : selectableOptions[selectableOptions.length - 1].value;
      }
      const nextIndex =
        (currentIndex + direction + selectableOptions.length) %
        selectableOptions.length;
      return selectableOptions[nextIndex].value;
    });
  };

  const displayValue = open
    ? editingSearch
      ? search
      : selectedOption?.label ?? ''
    : selectedOption?.label ?? '';
  const emptyMessage = !normalizedEmpresaId
    ? 'Selecciona primero la empresa ERP.'
    : errorMessage ?? 'No se encontraron cuentas.';

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setEditingSearch(false);
          setSearch('');
          setActiveValue(null);
        }
      }}
    >
      <div ref={rootRef} className="relative w-full">
        <PopoverAnchor asChild>
          <div
            aria-disabled={disabled}
            className={cn(
              'relative flex w-full items-center',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-text',
              className,
            )}
            onClick={() => {
              if (disabled) return;
              if (previouslyUsed.length > 0) setOpen(true);
              window.setTimeout(() => {
                inputRef.current?.focus();
                if (!editingSearch) inputRef.current?.select();
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
              aria-controls={open ? renderedListboxId : undefined}
              aria-expanded={open}
              aria-activedescendant={
                open && activeValue
                  ? optionRefs.current.get(activeValue)?.id
                  : undefined
              }
              value={displayValue}
              disabled={disabled}
              placeholder={placeholder}
              className="h-full min-w-0 flex-1 bg-transparent pl-7 pr-3 font-[inherit] text-inherit outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:placeholder:text-slate-500"
              onFocus={() => {
                if (!disabled && previouslyUsed.length > 0) setOpen(true);
              }}
              onChange={(event) => {
                const nextSearch = event.target.value;
                setEditingSearch(true);
                setSearch(nextSearch);
                setActiveValue(null);
                setOpen(Boolean(nextSearch.trim()) || previouslyUsed.length > 0);
                if (!nextSearch && normalizedValue) onChange(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  if (selectableOptions.length === 0) return;
                  event.preventDefault();
                  setOpen(true);
                  moveActiveOption(event.key === 'ArrowDown' ? 1 : -1);
                  return;
                }
                if (event.key === 'Enter' && open && activeValue) {
                  const active = selectableOptions.find(
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
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="w-[min(26rem,calc(100vw-1rem))] p-0"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target;
            if (target instanceof Node && rootRef.current?.contains(target)) {
              event.preventDefault();
            }
          }}
        >
          <Command
            shouldFilter={false}
            value={activeValue ?? ''}
            onValueChange={(nextValue) => {
              if (
                selectableOptions.some((option) => option.value === nextValue)
              ) {
                setActiveValue(nextValue);
              }
            }}
          >
            <CommandList ref={setListboxRef}>
              {visiblePreviouslyUsed.length > 0 ? (
                <CommandGroup heading="Más usadas con este proveedor">
                  {visiblePreviouslyUsed.map((option) => {
                    const selectable = isSelectableHistoricalAccount(option);
                    const accountOption: FacturaCuentaOption = {
                      value: option.cuenta,
                      label: option.descripcion
                        ? `${option.cuenta} - ${option.descripcion}`
                        : option.cuenta,
                      description: option.descripcion,
                      nif: null,
                    };
                    return (
                      <CommandItem
                        ref={(node) => {
                          if (node && selectable) {
                            optionRefs.current.set(option.cuenta, node);
                          } else {
                            optionRefs.current.delete(option.cuenta);
                          }
                        }}
                        key={option.cuenta}
                        value={option.cuenta}
                        disabled={!selectable}
                        aria-disabled={!selectable}
                        onSelect={() => {
                          if (selectable) selectOption(accountOption);
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4 shrink-0',
                            normalizedValue === option.cuenta
                              ? 'opacity-100'
                              : 'opacity-0',
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{option.cuenta}</p>
                          {option.descripcion ? (
                            <p className="truncate text-xs text-muted-foreground">
                              {option.descripcion}
                            </p>
                          ) : null}
                          <p className="truncate text-xs text-muted-foreground">
                            {option.usosFacturas === 1
                              ? 'Usada en 1 factura'
                              : `Usada en ${option.usosFacturas.toLocaleString('es-ES')} facturas`}
                            {!selectable ? ' · Ya no disponible' : ''}
                          </p>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
              {loading ? (
                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Consultando cuentas…
                </div>
              ) : visibleCatalogOptions.length === 0 &&
                visiblePreviouslyUsed.length === 0 ? (
                <CommandEmpty>{emptyMessage}</CommandEmpty>
              ) : visibleCatalogOptions.length > 0 ? (
                <CommandGroup
                  heading={
                    visiblePreviouslyUsed.length > 0 ? 'Resultados' : undefined
                  }
                >
                  {visibleCatalogOptions.map((option) => (
                    <CommandItem
                      ref={(node) => {
                        if (node) optionRefs.current.set(option.value, node);
                        else optionRefs.current.delete(option.value);
                      }}
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
              ) : null}
              {!loading && visibleCatalogOptions.length > 0 && hasMore ? (
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
              {errorMessage &&
              (visibleCatalogOptions.length > 0 ||
                visiblePreviouslyUsed.length > 0) ? (
                <p
                  role="status"
                  className="border-t px-3 py-2 text-xs text-destructive"
                >
                  {errorMessage}
                </p>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </div>
    </Popover>
  );
}
