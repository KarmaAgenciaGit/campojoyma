import * as React from 'react';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  agroirisAcreedores,
  type AcreedorSelectOption,
  type AcreedorSource,
  type AgroIrisAcreedor,
} from '@/services/agroirisAcreedores';

interface AcreedorComboboxProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  onSelect?: (acreedor: AgroIrisAcreedor | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  source?: AcreedorSource;
  minSearchLength?: number;
  searchLimit?: number;
}

export function AcreedorCombobox({
  value,
  onChange,
  onSelect,
  placeholder = 'Seleccionar acreedor...',
  disabled = false,
  className,
  minSearchLength,
  searchLimit = 25,
}: AcreedorComboboxProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef(new Map<number, HTMLDivElement>());
  const selectedOptionRef = React.useRef<AcreedorSelectOption | undefined>(undefined);
  const searchRequestRef = React.useRef(0);
  const listboxId = `acreedor-options-${React.useId().replace(/:/g, '')}`;
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<AcreedorSelectOption[]>([]);
  const [activeValue, setActiveValue] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [editingSearch, setEditingSearch] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const effectiveMinSearchLength = minSearchLength ?? 2;
  const effectiveSearchLimit = Math.min(Math.max(1, Math.trunc(searchLimit)), 50);

  const selectedOption = React.useMemo(() => {
    return options.find((option) => option.value === value);
  }, [options, value]);
  const selectedSearchLabel = selectedOption?.label.trim() ?? '';

  React.useEffect(() => {
    if (selectedOption) selectedOptionRef.current = selectedOption;
  }, [selectedOption]);

  const keepOnlySelectedOption = React.useCallback(() => {
    setOptions((current) => {
      const selected =
        current.find((option) => option.value === value) ??
        (selectedOptionRef.current?.value === value ? selectedOptionRef.current : undefined);
      return selected ? [selected] : [];
    });
  }, [value]);

  React.useEffect(() => {
    if (!value || selectedOption) return;

    let active = true;
    agroirisAcreedores
      .getAcreedorById(value)
      .then((acreedor) => {
        if (!active) return;
        if (!acreedor) {
          setErrorMessage('El acreedor guardado ya no está disponible en el ERP. Busca y selecciona otro proveedor.');
          return;
        }
        const [option] = agroirisAcreedores.formatAcreedoresForSelect([acreedor]);
        if (!option) {
          setErrorMessage('El acreedor guardado no está operativo en el ERP. Busca y selecciona otro proveedor.');
          return;
        }
        setErrorMessage(null);
        setOptions((current) => (current.some((item) => item.value === option.value) ? current : [option, ...current]));
      })
      .catch((error) => {
        console.error(`Error obteniendo acreedor ${value}:`, error);
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : 'No se pudo consultar el acreedor en el ERP.');
        }
      });

    return () => {
      active = false;
    };
  }, [selectedOption, value]);

  React.useEffect(() => {
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;

    if (!open) {
      setLoading(false);
      return;
    }

    const cleaned = search.trim();
    if (selectedSearchLabel && cleaned === selectedSearchLabel) {
      setLoading(false);
      setErrorMessage(null);
      keepOnlySelectedOption();
      return;
    }

    if (cleaned.length < effectiveMinSearchLength) {
      setLoading(false);
      keepOnlySelectedOption();
      return;
    }

    let active = true;
    setLoading(true);
    setErrorMessage(null);
    keepOnlySelectedOption();
    const timeout = window.setTimeout(() => {
      agroirisAcreedores
        .searchAcreedores(cleaned, { limit: effectiveSearchLimit, offset: 0 })
        .then((acreedores) => {
          if (!active || requestId !== searchRequestRef.current) return;
          const found = agroirisAcreedores.formatAcreedoresForSelect(acreedores);
          setOptions((current) => {
            const selected = current.find((option) => option.value === value);
            return selected && !found.some((option) => option.value === selected.value) ? [selected, ...found] : found;
          });
        })
        .catch((error) => {
          console.error('Error buscando acreedores en ERP:', error);
          if (active && requestId === searchRequestRef.current) {
            setOptions([]);
            setErrorMessage(error instanceof Error ? error.message : 'No se pudo consultar el listado de acreedores.');
          }
        })
        .finally(() => {
          if (active && requestId === searchRequestRef.current) setLoading(false);
        });
    }, cleaned ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [effectiveMinSearchLength, effectiveSearchLimit, keepOnlySelectedOption, open, search, selectedSearchLabel, value]);

  const filteredOptions = React.useMemo(() => {
    if (!search) return options;
    const searchLower = search
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return options.filter((option) => option.searchText.includes(searchLower));
  }, [options, search]);

  React.useEffect(() => {
    if (!open || loading || filteredOptions.length === 0) {
      setActiveValue(null);
      return;
    }

    setActiveValue((current) => {
      if (current !== null && filteredOptions.some((option) => option.value === current)) return current;
      if (value && filteredOptions.some((option) => option.value === value)) return value;
      return filteredOptions[0].value;
    });
  }, [filteredOptions, loading, open, value]);

  React.useEffect(() => {
    if (activeValue === null) return;
    optionRefs.current.get(activeValue)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeValue]);

  const emptyText =
    errorMessage ??
    (search.trim().length < effectiveMinSearchLength
      ? `Escribe al menos ${effectiveMinSearchLength} caracteres.`
      : 'No se encontraron acreedores.');
  const displayValue = open ? (editingSearch ? search : selectedOption?.label ?? '') : selectedOption?.label ?? '';
  const showFieldLoader = loading && open && (editingSearch || !selectedOption);

  const openSearch = () => {
    if (disabled) return;
    if (!open) {
      setSearch(selectedSearchLabel);
      setEditingSearch(Boolean(selectedSearchLabel));
    }
    setOpen(true);
  };

  const closeSearch = () => {
    setOpen(false);
    setActiveValue(null);
    setSearch('');
    setEditingSearch(false);
  };

  const moveActiveOption = (direction: 1 | -1) => {
    if (filteredOptions.length === 0) return;

    setActiveValue((current) => {
      const currentIndex = filteredOptions.findIndex((option) => option.value === current);
      if (currentIndex === -1) {
        return direction === 1 ? filteredOptions[0].value : filteredOptions[filteredOptions.length - 1].value;
      }
      const nextIndex = (currentIndex + direction + filteredOptions.length) % filteredOptions.length;
      return filteredOptions[nextIndex].value;
    });
  };

  const selectAcreedor = async (option: AcreedorSelectOption) => {
    if (option.value === value) {
      onChange(null);
      onSelect?.(null);
      closeSearch();
      inputRef.current?.blur();
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const acreedor = await agroirisAcreedores.getAcreedorById(option.value);
      if (!acreedor) {
        throw new Error('El acreedor ya no está disponible en el ERP. Actualiza la búsqueda e inténtalo de nuevo.');
      }

      const [detailOption] = agroirisAcreedores.formatAcreedoresForSelect([acreedor]);
      if (!detailOption) {
        throw new Error('El acreedor no está operativo en el ERP. Selecciona otro proveedor.');
      }

      selectedOptionRef.current = detailOption;
      setOptions([detailOption]);
      onChange(detailOption.value);
      onSelect?.(acreedor);
      closeSearch();
      inputRef.current?.blur();
    } catch (error) {
      console.error(`Error validando acreedor ${option.value} en ERP:`, error);
      setOptions([]);
      setErrorMessage(error instanceof Error ? error.message : 'No se pudo consultar el acreedor en el ERP.');
      setOpen(true);
      setEditingSearch(true);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
      setSearch('');
      setEditingSearch(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

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
          openSearch();
          window.setTimeout(() => {
            inputRef.current?.focus();
            if (selectedOption) inputRef.current?.select();
          }, 0);
        }}
      >
        {showFieldLoader ? (
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
            open && activeValue !== null ? `${listboxId}-option-${activeValue}` : undefined
          }
          disabled={disabled}
          value={displayValue}
          placeholder={showFieldLoader && !search ? 'Cargando acreedores...' : placeholder}
          className="h-full min-w-0 flex-1 bg-transparent pl-7 pr-8 font-[inherit] text-inherit outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:placeholder:text-slate-500"
          onFocus={openSearch}
          onChange={(event) => {
            setEditingSearch(true);
            setActiveValue(null);
            setSearch(event.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              openSearch();
              moveActiveOption(event.key === 'ArrowDown' ? 1 : -1);
              return;
            }
            if (event.key === 'Enter' && open && activeValue !== null) {
              const activeOption = filteredOptions.find((option) => option.value === activeValue);
              if (activeOption) {
                event.preventDefault();
                void selectAcreedor(activeOption);
              }
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              closeSearch();
              inputRef.current?.blur();
              return;
            }
            if (event.key === 'Tab' && open) {
              closeSearch();
            }
          }}
        />
        <ChevronsUpDown className="pointer-events-none absolute right-3 h-4 w-4 shrink-0 opacity-50" />
      </div>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover p-0 text-popover-foreground shadow-md">
          <Command
            shouldFilter={false}
            value={activeValue?.toString() ?? ''}
            onValueChange={(nextValue) => {
              const parsedValue = Number(nextValue);
              if (filteredOptions.some((option) => option.value === parsedValue)) {
                setActiveValue(parsedValue);
              }
            }}
          >
            <CommandList id={listboxId}>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm text-muted-foreground">Cargando...</span>
                </div>
              ) : filteredOptions.length === 0 ? (
                <CommandEmpty>{emptyText}</CommandEmpty>
              ) : (
                <CommandGroup>
                  {filteredOptions.map((option) => (
                    <CommandItem
                      ref={(node) => {
                        if (node) optionRefs.current.set(option.value, node);
                        else optionRefs.current.delete(option.value);
                      }}
                      key={option.value}
                      id={`${listboxId}-option-${option.value}`}
                      value={option.value.toString()}
                      onSelect={() => void selectAcreedor(option)}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === option.value ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <div className="flex flex-col">
                        <span className="font-medium">{option.acreedor.nombre_comercial.trim()}</span>
                        {option.acreedor.identificador_fiscal ? (
                          <span className="text-xs text-muted-foreground">
                            NIF: {option.acreedor.identificador_fiscal} - ID: {option.acreedor.acreedorid}
                          </span>
                        ) : null}
                        {option.acreedor.cuenta_contable ? (
                          <span className="text-xs text-muted-foreground">
                            Cuenta: {option.acreedor.cuenta_contable}
                          </span>
                        ) : null}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </div>
      ) : null}
    </div>
  );
}
