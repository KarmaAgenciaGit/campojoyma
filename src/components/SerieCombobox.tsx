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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { agroirisSeries } from '@/services/agroirisSeries';

interface Serie {
  serieid: number;
  tipo: string;
  por_defecto: boolean;
  serie: string;
  empresaid: number;
  ejercicioid: number;
  subcentroid: number;
  descripcion: string;
  entradagenero: boolean;
  entradaconfecc: boolean;
}

interface SerieComboboxProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function SerieCombobox({
  value,
  onChange,
  placeholder = 'Seleccionar serie...',
  disabled = false,
  className,
}: SerieComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [series, setSeries] = React.useState<Serie[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState('');

  // Cargar series al montar el componente
  React.useEffect(() => {
    loadSeries();
  }, []);

  const loadSeries = async () => {
    try {
      setLoading(true);
      const data = await agroirisSeries.getAllSeries();
      setSeries(data);
    } catch (error) {
      console.error('Error cargando series:', error);
      setSeries([]);
    } finally {
      setLoading(false);
    }
  };

  // Encontrar la serie seleccionada
  const selectedSerie = React.useMemo(() => {
    return series.find((serie) => serie.serieid === value);
  }, [series, value]);

  // Filtrar series basado en la búsqueda
  const filteredSeries = React.useMemo(() => {
    if (!search) return series;
    const searchLower = search.toLowerCase();
    return series.filter(
      (serie) =>
        serie.descripcion.toLowerCase().includes(searchLower) ||
        serie.serie.toLowerCase().includes(searchLower) ||
        serie.serieid.toString().includes(searchLower)
    );
  }, [series, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className={cn('w-full justify-between h-9', className)}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Cargando series...
            </>
          ) : selectedSerie ? (
            <span className="truncate">{selectedSerie.descripcion}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar por descripción o serie..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Cargando...</span>
              </div>
            ) : filteredSeries.length === 0 ? (
              <CommandEmpty>No se encontraron series.</CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredSeries.map((serie) => (
                  <CommandItem
                    key={serie.serieid}
                    value={serie.serieid.toString()}
                    onSelect={() => {
                      onChange(serie.serieid === value ? null : serie.serieid);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === serie.serieid ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">{serie.descripcion}</span>
                      <span className="text-xs text-muted-foreground">
                        Serie: {serie.serie} • ID: {serie.serieid}
                      </span>
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
