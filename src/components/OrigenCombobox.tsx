import { useState, useEffect } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
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
import { agroirisOrigenes, type Origen } from '@/services/agroirisOrigenes';

interface OrigenComboboxProps {
  value: number | null | undefined;
  onChange: (value: number) => void;
}

export function OrigenCombobox({ value, onChange }: OrigenComboboxProps) {
  const [open, setOpen] = useState(false);
  const [origenes, setOrigenes] = useState<Origen[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadOrigenes = async () => {
      try {
        setLoading(true);
        const data = await agroirisOrigenes.getAllOrigenes();
        // Ordenar por nombre para mejor UX
        const sorted = data.sort((a, b) => a.nombre_origen.localeCompare(b.nombre_origen));
        setOrigenes(sorted);
      } catch (error) {
        console.error('Error loading origenes:', error);
      } finally {
        setLoading(false);
      }
    };

    loadOrigenes();
  }, []);

  const selectedOrigen = origenes.find((o) => o.origenid === value);
  const formatLabel = (origen: Origen) => `${origen.nombre_origen} (ID: ${origen.origenid})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between overflow-hidden text-left"
          title={selectedOrigen ? formatLabel(selectedOrigen) : undefined}
        >
          <span className="truncate">
            {loading
              ? 'Cargando...'
              : selectedOrigen
              ? formatLabel(selectedOrigen)
              : 'Seleccionar origen...'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput placeholder="Buscar origen..." />
          <CommandList>
            <CommandEmpty>No se encontró ningún origen.</CommandEmpty>
            <CommandGroup>
              {origenes.map((origen) => (
                <CommandItem
                  key={origen.origenid}
                  value={`${origen.origenid}-${origen.nombre_origen}`}
                  onSelect={() => {
                    onChange(origen.origenid);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === origen.origenid ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {formatLabel(origen)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
