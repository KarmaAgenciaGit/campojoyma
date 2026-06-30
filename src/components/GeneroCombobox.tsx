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
import { agroirisGeneros, type Genero } from '@/services/agroirisGeneros';

interface GeneroComboboxProps {
  value: number | null | undefined;
  onChange: (value: number) => void;
}

export function GeneroCombobox({ value, onChange }: GeneroComboboxProps) {
  const [open, setOpen] = useState(false);
  const [generos, setGeneros] = useState<Genero[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadGeneros = async () => {
      try {
        setLoading(true);
        const data = await agroirisGeneros.getGeneros();
        setGeneros(data);
      } catch (error) {
        console.error('Error loading generos:', error);
      } finally {
        setLoading(false);
      }
    };

    loadGeneros();
  }, []);

  const selectedGenero = generos.find((g) => g.generoid === value);
  const formatLabel = (genero: Genero) => `${genero.nombre_genero} (ID: ${genero.generoid})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between overflow-hidden text-left"
          title={selectedGenero ? formatLabel(selectedGenero) : undefined}
        >
          <span className="truncate">
            {loading
              ? 'Cargando...'
              : selectedGenero
              ? formatLabel(selectedGenero)
              : 'Seleccionar género...'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput placeholder="Buscar género..." />
          <CommandList>
            <CommandEmpty>No se encontró ningún género.</CommandEmpty>
            <CommandGroup>
              {generos.map((genero) => (
                <CommandItem
                  key={genero.generoid}
                  value={`${genero.generoid}-${genero.nombre_genero}`}
                  onSelect={() => {
                    onChange(genero.generoid);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === genero.generoid ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {formatLabel(genero)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
