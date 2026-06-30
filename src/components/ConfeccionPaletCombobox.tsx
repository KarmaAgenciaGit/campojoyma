import { useState, useEffect } from 'react';
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
import { agroirisConfeccionPalet, type ConfeccionPaletSelectOption } from '@/services/agroirisConfeccionPalet';

interface ConfeccionPaletComboboxProps {
  value?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function ConfeccionPaletCombobox({ value, onChange, disabled }: ConfeccionPaletComboboxProps) {
  const [open, setOpen] = useState(false);
  const [confecciones, setConfecciones] = useState<ConfeccionPaletSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Cargar confecciones al montar si hay un value
  useEffect(() => {
    if (value && confecciones.length === 0) {
      loadConfecciones();
    }
  }, [value]);

  // Cargar confecciones cuando se abre el combobox
  useEffect(() => {
    if (open && confecciones.length === 0) {
      loadConfecciones();
    }
  }, [open]);

  const loadConfecciones = async () => {
    setLoading(true);
    try {
      const options = await agroirisConfeccionPalet.searchConfecciones('');
      setConfecciones(options);
    } catch (error) {
      console.error('Error cargando confecciones palet:', error);
    } finally {
      setLoading(false);
    }
  };

  const selectedConfeccion = confecciones.find((c) => c.value === value);

  const filteredConfecciones = searchQuery
    ? confecciones.filter((confeccion) =>
        confeccion.searchText.includes(searchQuery.toLowerCase())
      )
    : confecciones;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between overflow-hidden text-left"
          disabled={disabled}
          title={selectedConfeccion?.label || undefined}
        >
          <span className="truncate flex-1">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin inline-flex" />
                Cargando confecciones...
              </>
            ) : selectedConfeccion ? (
              selectedConfeccion.label
            ) : (
              'Seleccionar confección palet...'
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[400px] p-0"
        onWheelCapture={(event) => event.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar confección..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList onWheelCapture={(event) => event.stopPropagation()}>
            <CommandEmpty>
              {loading ? 'Cargando...' : 'No se encontraron confecciones.'}
            </CommandEmpty>
            <CommandGroup>
              {filteredConfecciones.map((confeccion) => (
                <CommandItem
                  key={confeccion.value}
                  value={confeccion.value.toString()}
                  onSelect={() => {
                    onChange(confeccion.value);
                    setOpen(false);
                    setSearchQuery('');
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === confeccion.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {confeccion.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
