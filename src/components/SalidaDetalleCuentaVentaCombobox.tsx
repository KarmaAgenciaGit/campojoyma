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
import { agroirisSalidas, type AgroirisSalidaDetalleResumen } from '@/services/agroirisSalidas';

interface SalidaDetalleCuentaVentaComboboxProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  clienteid?: number | null;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface SalidaDetalleOption {
  value: number;
  label: string;
  referencia: string;
  descripcion: string;
  searchText: string;
}

const toOption = (item: AgroirisSalidaDetalleResumen): SalidaDetalleOption | null => {
  const id = Number(item.salidadetalleid);
  if (!id || Number.isNaN(id)) return null;
  const referencia = (item.referencia_cliente ?? '').trim() || 'Sin referencia';
  const descripcion =
    (item.descripcion_salida ?? item.descripcion_genero ?? item.nombre_catalogoconfeccion ?? '').trim() ||
    'Sin descripcion';
  const label = `${referencia} - ${descripcion}`;
  return {
    value: id,
    label,
    referencia,
    descripcion,
    searchText: `${referencia} ${descripcion} ${id}`.toLowerCase(),
  };
};

export function SalidaDetalleCuentaVentaCombobox({
  value,
  onChange,
  clienteid,
  placeholder = 'Buscar salida por referencia...',
  disabled = false,
  className,
}: SalidaDetalleCuentaVentaComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<SalidaDetalleOption[]>([]);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const loadOptions = React.useCallback(async () => {
    if (!clienteid) return;
    try {
      setLoading(true);
      setLoadError(null);
      const data = await agroirisSalidas.getSalidasDetalleCuentaVenta(clienteid);
      const formatted = data.map(toOption).filter(Boolean) as SalidaDetalleOption[];
      setOptions(formatted);
    } catch (error) {
      console.error('Error cargando salidasdetalle por cliente', clienteid, error);
      setOptions([]);
      setLoadError('No se pudieron cargar las salidas del cliente');
    } finally {
      setLoading(false);
    }
  }, [clienteid]);

  React.useEffect(() => {
    setOptions([]);
    setSearch('');
    setLoadError(null);
  }, [clienteid]);

  React.useEffect(() => {
    if (!open) return;
    if (!clienteid) return;
    if (options.length === 0) {
      loadOptions();
    }
  }, [open, clienteid, options.length, loadOptions]);

  React.useEffect(() => {
    if (!clienteid) return;
    if (value == null || value === 0) return;
    if (options.length === 0) {
      loadOptions();
    }
  }, [value, clienteid, options.length, loadOptions]);

  const selectedOption = React.useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  const filtered = React.useMemo(() => {
    if (!search) return options;
    const query = search.toLowerCase();
    return options.filter((option) => option.searchText.includes(query));
  }, [options, search]);

  const buttonLabel = selectedOption
    ? selectedOption.label
    : value
    ? `SalidaDetalle #${value}`
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || !clienteid}
          className={cn('w-full justify-between h-8 text-left', className)}
        >
          <span className={cn('truncate', !selectedOption && !value ? 'text-muted-foreground' : undefined)}>
            {buttonLabel}
          </span>
          {loading && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar por referencia o descripcion..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Cargando...
              </div>
            ) : loadError ? (
              <CommandEmpty>{loadError}</CommandEmpty>
            ) : filtered.length === 0 ? (
              <CommandEmpty>No se encontraron salidas.</CommandEmpty>
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
                      className={cn('mr-2 h-4 w-4', value === option.value ? 'opacity-100' : 'opacity-0')}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-xs text-muted-foreground">SalidaDetalle #{option.value}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
