import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { agroirisSubcentro, Subcentro } from '@/services/agroirisSubcentro';

interface SubcentroComboboxProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  excludeIds?: number[];
}

export function SubcentroCombobox({ value, onChange, excludeIds = [] }: SubcentroComboboxProps) {
  const [open, setOpen] = useState(false);
  const [subcentros, setSubcentros] = useState<Subcentro[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await agroirisSubcentro.getAll();
        setSubcentros(data);
      } catch (error) {
        console.error('Error cargando subcentros:', error);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const selected = useMemo(
    () => subcentros.find((s) => s.subcentroid === value),
    [subcentros, value]
  );

  const filtered = useMemo(() => {
    if (!search) return subcentros;
    const q = search.toLowerCase();
    return subcentros.filter(
      (s) =>
        s.nombre_subcentro.toLowerCase().includes(q) ||
        s.subcentroid.toString().includes(q) ||
        s.poblacion_subcentro.toLowerCase().includes(q) ||
        s.provincia_subcentro.toLowerCase().includes(q)
    );
  }, [search, subcentros]);

  const formatLabel = (s: Subcentro) =>
    `${s.nombre_subcentro} (ID: ${s.subcentroid})${s.poblacion_subcentro ? ` · ${s.poblacion_subcentro}` : ''}`;

  const options = selected
    ? [selected, ...filtered.filter((s) => s.subcentroid !== selected.subcentroid)]
    : filtered;

  const filteredOptions = options.filter((s) => {
    if (value && s.subcentroid === value) return true;
    return !excludeIds.includes(s.subcentroid);
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-7 text-sm overflow-hidden text-left"
          title={selected ? formatLabel(selected) : undefined}
        >
          <span className="truncate">
            {loading
              ? 'Cargando...'
              : selected
              ? formatLabel(selected)
              : 'Seleccionar subcentro...'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0">
        <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar subcentro..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>{loading ? 'Cargando...' : 'No se encontraron subcentros.'}</CommandEmpty>
              <CommandGroup>
              {filteredOptions.map((s) => (
                <CommandItem
                  key={s.subcentroid}
                  value={s.subcentroid.toString()}
                  onSelect={() => {
                    onChange(s.subcentroid === value ? null : s.subcentroid);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === s.subcentroid ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {formatLabel(s)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
