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
  source = 'cache',
  minSearchLength,
  searchLimit = 25,
}: AcreedorComboboxProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const selectedOptionRef = React.useRef<AcreedorSelectOption | undefined>(undefined);
  const searchRequestRef = React.useRef(0);
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<AcreedorSelectOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [editingSearch, setEditingSearch] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const effectiveMinSearchLength = minSearchLength ?? (source === 'erp' ? 2 : 0);

  React.useEffect(() => {
    if (source !== 'erp') return;
    agroirisAcreedores.prefetchAcreedores({ source: 'erp', limit: searchLimit });
  }, [searchLimit, source]);

  React.useEffect(() => {
    if (source !== 'cache') return;

    let active = true;
    setLoading(true);
    setErrorMessage(null);
    agroirisAcreedores
      .getAcreedores()
      .then((acreedores) => {
        if (!active) return;
        setOptions(agroirisAcreedores.formatAcreedoresForSelect(acreedores));
      })
      .catch((error) => {
        console.error('Error cargando acreedores:', error);
        if (active) {
          setOptions([]);
          setErrorMessage(error instanceof Error ? error.message : 'No se pudieron cargar los acreedores.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [source]);

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
      .getAcreedorById(value, source)
      .then((acreedor) => {
        if (!active || !acreedor) return;
        const [option] = agroirisAcreedores.formatAcreedoresForSelect([acreedor]);
        if (!option) return;
        setOptions((current) => (current.some((item) => item.value === option.value) ? current : [option, ...current]));
      })
      .catch((error) => {
        console.error(`Error obteniendo acreedor ${value}:`, error);
      });

    return () => {
      active = false;
    };
  }, [selectedOption, source, value]);

  React.useEffect(() => {
    if (source !== 'erp') return;

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
      setErrorMessage(null);
      return;
    }

    let active = true;
    setLoading(true);
    setErrorMessage(null);
    keepOnlySelectedOption();
    const timeout = window.setTimeout(() => {
      agroirisAcreedores
        .searchAcreedores(cleaned, { source: 'erp', limit: searchLimit })
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
  }, [effectiveMinSearchLength, keepOnlySelectedOption, open, search, searchLimit, selectedSearchLabel, source, value]);

  const filteredOptions = React.useMemo(() => {
    if (!search) return options;
    const searchLower = search
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return options.filter((option) => option.searchText.includes(searchLower));
  }, [options, search]);

  const emptyText =
    errorMessage ??
    (source === 'erp' && search.trim().length < effectiveMinSearchLength
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
    setSearch('');
    setEditingSearch(false);
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
        role="combobox"
        aria-expanded={open}
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
          disabled={disabled}
          value={displayValue}
          placeholder={showFieldLoader && !search ? 'Cargando acreedores...' : placeholder}
          className="h-full min-w-0 flex-1 bg-transparent pl-7 pr-8 font-[inherit] text-inherit outline-none placeholder:text-slate-400 disabled:cursor-not-allowed dark:placeholder:text-slate-500"
          onFocus={openSearch}
          onChange={(event) => {
            setEditingSearch(true);
            setSearch(event.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeSearch();
              inputRef.current?.blur();
            }
          }}
        />
        <ChevronsUpDown className="pointer-events-none absolute right-3 h-4 w-4 shrink-0 opacity-50" />
      </div>
      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border bg-popover p-0 text-popover-foreground shadow-md">
        <Command shouldFilter={false}>
          <CommandList>
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
                    key={option.value}
                    value={option.value.toString()}
                    onSelect={() => {
                      const nextValue = option.value === value ? null : option.value;
                      onChange(nextValue);
                      onSelect?.(nextValue === null ? null : option.acreedor);
                      closeSearch();
                      inputRef.current?.blur();
                    }}
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
