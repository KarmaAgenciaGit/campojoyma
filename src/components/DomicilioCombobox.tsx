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
import { agroirisDomicilios, SujetoDomicilio } from '@/services/agroirisDomicilios';
import { agroirisClients } from '@/services/agroirisClients';

interface DomicilioComboboxProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  clienteId: number | null | undefined;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function DomicilioCombobox({
  value,
  onChange,
  clienteId,
  placeholder = 'Seleccionar domicilio...',
  disabled = false,
  className,
}: DomicilioComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [domicilios, setDomicilios] = React.useState<SujetoDomicilio[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState('');

  // Cargar domicilios cuando se proporciona un clienteId
  React.useEffect(() => {
    if (clienteId) {
      loadDomicilios(clienteId);
    } else {
      setDomicilios([]);
    }
  }, [clienteId]);

  const loadDomicilios = async (clientId: number) => {
    try {
      setLoading(true);
      // Primero obtener el sujeto del cliente
      const cliente = await agroirisClients.getClientById(clientId);
      if (cliente && cliente.sujetoid) {
        // Luego obtener los domicilios del sujeto
        const data = await agroirisDomicilios.getDomiciliosBySujetoId(cliente.sujetoid);
        setDomicilios(data);
      } else {
        setDomicilios([]);
      }
    } catch (error) {
      console.error('Error cargando domicilios:', error);
      setDomicilios([]);
    } finally {
      setLoading(false);
    }
  };

  // Encontrar el domicilio seleccionado
  const selectedDomicilio = React.useMemo(() => {
    return domicilios.find((dom) => dom.sujetodomicilioid === value);
  }, [domicilios, value]);

  // Filtrar domicilios basado en la búsqueda
  const filteredDomicilios = React.useMemo(() => {
    if (!search) return domicilios;
    const searchLower = search.toLowerCase();
    return domicilios.filter(
      (dom) =>
        dom.nombre_identificador_domicilio_sujeto?.toLowerCase().includes(searchLower) ||
        dom.poblacion_domicilio_sujeto?.toLowerCase().includes(searchLower) ||
        dom.provincia_domicilio_sujeto?.toLowerCase().includes(searchLower) ||
        dom.domicilio_sujeto?.toLowerCase().includes(searchLower) ||
        dom.sujetodomicilioid.toString().includes(searchLower)
    );
  }, [domicilios, search]);

  // Si no hay clienteId, deshabilitar
  const isDisabled = disabled || !clienteId;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={isDisabled || loading}
          className={cn('w-full justify-between h-9', className)}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Cargando domicilios...
            </>
          ) : selectedDomicilio ? (
            <span className="truncate">
              {agroirisDomicilios.getDomicilioDisplayName(selectedDomicilio)}
            </span>
          ) : !clienteId ? (
            <span className="text-muted-foreground">Selecciona un cliente primero</span>
          ) : domicilios.length === 0 ? (
            <span className="text-muted-foreground">Sin domicilios</span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar por nombre, población, provincia..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Cargando...</span>
              </div>
            ) : filteredDomicilios.length === 0 ? (
              <CommandEmpty>
                {!clienteId 
                  ? 'Selecciona un cliente para ver sus domicilios' 
                  : 'No se encontraron domicilios'}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredDomicilios.map((domicilio) => (
                  <CommandItem
                    key={domicilio.sujetodomicilioid}
                    value={domicilio.sujetodomicilioid.toString()}
                    onSelect={() => {
                      onChange(domicilio.sujetodomicilioid === value ? null : domicilio.sujetodomicilioid);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === domicilio.sujetodomicilioid ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {agroirisDomicilios.getDomicilioDisplayName(domicilio)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {domicilio.domicilio_sujeto && `${domicilio.domicilio_sujeto} • `}
                        ID: {domicilio.sujetodomicilioid}
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
