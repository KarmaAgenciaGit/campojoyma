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
import { agroirisClients, type AgroIrisClient, type ClientSelectOption } from '@/services/agroirisClients';

interface ClientComboboxProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  allowedClientIds?: Iterable<number> | null;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function ClientCombobox({
  value,
  onChange,
  allowedClientIds,
  placeholder = 'Seleccionar cliente...',
  disabled = false,
  className,
}: ClientComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [clients, setClients] = React.useState<AgroIrisClient[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const loadClients = React.useCallback(async () => {
    try {
      setLoading(true);
      const clients = await agroirisClients.getClients();
      setClients(clients);
    } catch (error) {
      console.error('Error cargando clientes:', error);
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Cargar clientes al montar el componente
  React.useEffect(() => {
    loadClients();
  }, [loadClients]);

  const allowedSet = React.useMemo(() => {
    if (!allowedClientIds) return null;
    if (allowedClientIds instanceof Set) return allowedClientIds;
    return new Set(allowedClientIds);
  }, [allowedClientIds]);

  const options = React.useMemo(() => {
    const formatted = agroirisClients.formatClientsForSelect(clients, { includeInactive: Boolean(allowedSet) });
    if (!allowedSet) return formatted;

    const filtered = formatted.filter((option) => allowedSet.has(option.value));

    // Mantener el seleccionado visible aunque no esté en el set (p.ej. URL param)
    if (value != null && !allowedSet.has(value)) {
      const selected = formatted.find((option) => option.value === value);
      if (selected) {
        return [selected, ...filtered.filter((option) => option.value !== value)];
      }
    }

    return filtered;
  }, [clients, allowedSet, value]);

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
          className={cn('w-full justify-between h-8', className)}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Cargando clientes...
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
              <CommandEmpty>No se encontraron clientes.</CommandEmpty>
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
                      <span className="font-medium">{option.client.nombre_sujeto}</span>
                      {option.client.identificador_fiscal && (
                        <span className="text-xs text-muted-foreground">
                          {option.client.identificador_fiscal}
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
