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
import { agroirisAcreedores, type AcreedorSelectOption } from '@/services/agroirisAcreedores';

interface AcreedorComboboxProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function AcreedorCombobox({
  value,
  onChange,
  placeholder = 'Seleccionar acreedor...',
  disabled = false,
  className,
}: AcreedorComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [options, setOptions] = React.useState<AcreedorSelectOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState('');

  // Cargar acreedores al montar el componente
  React.useEffect(() => {
    loadAcreedores();
  }, []);

  const loadAcreedores = async () => {
    try {
      setLoading(true);
      const acreedores = await agroirisAcreedores.getAcreedores();
      const formattedOptions = agroirisAcreedores.formatAcreedoresForSelect(acreedores);
      setOptions(formattedOptions);
    } catch (error) {
      console.error('Error cargando acreedores:', error);
      setOptions([]);
    } finally {
      setLoading(false);
    }
  };

  // Encontrar la opción seleccionada
  const selectedOption = React.useMemo(() => {
    return options.find((option) => option.value === value);
  }, [options, value]);

  // Filtrar opciones basado en la búsqueda
  const filteredOptions = React.useMemo(() => {
    if (!search) return options;
    const searchLower = search.toLowerCase();
    return options.filter((option) => option.searchText.includes(searchLower));
  }, [options, search]);

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
              Cargando acreedores...
            </>
          ) : selectedOption ? (
            <span className="truncate">{selectedOption.label}</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar por nombre o NIF..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Cargando...</span>
              </div>
            ) : filteredOptions.length === 0 ? (
              <CommandEmpty>No se encontraron acreedores.</CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredOptions.map((option) => (
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
                      <span className="font-medium">{option.acreedor.nombre_comercial.trim()}</span>
                      {option.acreedor.identificador_fiscal && (
                        <span className="text-xs text-muted-foreground">
                          NIF: {option.acreedor.identificador_fiscal} • ID: {option.acreedor.acreedorid}
                        </span>
                      )}
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
