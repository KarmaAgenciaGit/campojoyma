import * as React from 'react';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { agroirisGastos, type AgroirisGasto } from '@/services/agroirisGastos';

interface GastoComboboxProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function GastoCombobox({
  value,
  onChange,
  placeholder = 'Seleccionar gasto...',
  disabled = false,
  className,
}: GastoComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [loadingSingle, setLoadingSingle] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<{ value: number; label: string; searchText: string }[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const loadGastos = React.useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const map = await agroirisGastos.listGastos();
      const list = Object.values(map).map((g) => ({
        value: g.gastoid,
        label: g.nombre_gasto || `Gasto ${g.gastoid}`,
        searchText: `${g.nombre_gasto || ''} ${g.gastoid} ${g.tags_gasto || ''}`.toLowerCase(),
      }));
      setOptions(list);
    } catch (error) {
      console.error('Error listando gastos', error);
      setOptions([]);
      setLoadError('No se pudieron cargar los gastos');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) loadGastos();
  }, [open, loadGastos]);

  // Pre-cargar opciones si ya hay un valor seleccionado, para que aparezca sin abrir el combo
  React.useEffect(() => {
    if (value == null) return;
    // Cargar lista si aún no hay opciones
    if (!options.length) {
      loadGastos();
    }
    // Si tras cargar no está la opción, traerla por ID
    const hasOption = options.some((o) => o.value === value);
    if (!hasOption) {
      (async () => {
        try {
          setLoadingSingle(true);
          const gasto = await agroirisGastos.getGasto(value);
          if (gasto) {
            const newOption = {
              value: gasto.gastoid,
              label: gasto.nombre_gasto || `Gasto ${gasto.gastoid}`,
              searchText: `${gasto.nombre_gasto || ''} ${gasto.gastoid}`.toLowerCase(),
            };
            setOptions((prev) => {
              if (prev.some((p) => p.value === newOption.value)) return prev;
              return [...prev, newOption];
            });
          }
        } finally {
          setLoadingSingle(false);
        }
      })();
    }
  }, [value, options.length, loadGastos]);

  const selectedOption = React.useMemo(() => options.find((o) => o.value === value) || null, [options, value]);
  const filtered = React.useMemo(() => {
    const base = options;
    if (!search) return base;
    const q = search.toLowerCase();
    return base.filter((o) => o.searchText.includes(q));
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className={cn('w-full justify-between h-8', className)}
        >
          {selectedOption ? <span className="truncate">{selectedOption.label}</span> : <span className="text-muted-foreground">{placeholder}</span>}
          {(loading || loadingSingle) && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Buscar gasto por nombre o ID..." value={search} onValueChange={setSearch} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Cargando...
              </div>
            ) : (
              <>
                {search && !Number.isNaN(Number(search)) && !filtered.some((o) => o.value === Number(search)) && (
                  <CommandGroup>
                    <CommandItem
                      value={`fetch-${search}`}
                      onSelect={async () => {
                        const id = Number(search);
                        if (Number.isNaN(id) || id <= 0) return;
                        try {
                          setLoadingSingle(true);
                          const gasto = await agroirisGastos.getGasto(id);
                          const newOption = {
                            value: id,
                            label: gasto?.nombre_gasto || `Gasto ${id}`,
                            searchText: `${gasto?.nombre_gasto || ''} ${id}`.toLowerCase(),
                          };
                          setOptions((prev) => {
                            if (prev.some((p) => p.value === id)) return prev;
                            return [...prev, newOption];
                          });
                          onChange(id);
                          setOpen(false);
                          setSearch('');
                        } finally {
                          setLoadingSingle(false);
                        }
                      }}
                    >
                      <Check className="mr-2 h-4 w-4 opacity-0" />
                      <div className="flex flex-col">
                        <span className="font-medium">Buscar ID {search}</span>
                        <span className="text-xs text-muted-foreground">Añadir gasto por ID</span>
                      </div>
                    </CommandItem>
                  </CommandGroup>
                )}
                {loadError ? (
                  <CommandEmpty>{loadError}</CommandEmpty>
                ) : filtered.length === 0 ? (
                  <CommandEmpty>No se encontraron gastos.</CommandEmpty>
                ) : (
                  <CommandGroup>
                    {filtered.map((option) => (
                      <CommandItem
                        key={option.value}
                        value={option.value.toString()}
                        onSelect={() => {
                          onChange(option.value === value ? null : option.value);
                          setOpen(false);
                          setSearch('');
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            value === option.value ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <div className="flex flex-col">
                          <span className="font-medium">{option.label}</span>
                          <span className="text-xs text-muted-foreground">ID: {option.value}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
