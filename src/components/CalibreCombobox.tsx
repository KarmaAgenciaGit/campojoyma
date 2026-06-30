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
import { agroirisCalibre, type Calibre } from '@/services/agroirisCalibre';

interface CalibreComboboxProps {
  value: number | null | undefined;
  onChange: (value: number) => void;
  catalogoconfecid?: number | null;
}

export function CalibreCombobox({ value, onChange, catalogoconfecid }: CalibreComboboxProps) {
  const [open, setOpen] = useState(false);
  const [calibres, setCalibres] = useState<Calibre[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadCalibres = async () => {
      try {
        setLoading(true);
        const data = catalogoconfecid
          ? await agroirisCalibre.getCalibresByCatalogo(catalogoconfecid)
          : await agroirisCalibre.getAllCalibres();
        // Ordenar por nombre para mejor UX
        const sorted = data.sort((a, b) => a.nombre_calibre.localeCompare(b.nombre_calibre));
        setCalibres(sorted);
      } catch (error) {
        console.error('Error loading calibres:', error);
      } finally {
        setLoading(false);
      }
    };

    loadCalibres();
  }, [catalogoconfecid]);

  // Reset lista cuando cambia catálogo
  useEffect(() => {
    if (catalogoconfecid) {
      setCalibres([]);
    }
  }, [catalogoconfecid]);

  const selectedCalibre = calibres.find((c) => c.calibreid === value);
  const formatLabel = (calibre: Calibre) => `${calibre.nombre_calibre} (ID: ${calibre.calibreid})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between overflow-hidden text-left"
          title={selectedCalibre ? formatLabel(selectedCalibre) : undefined}
          disabled={!catalogoconfecid}
        >
          <span className="truncate">
            {loading
              ? 'Cargando...'
              : selectedCalibre
              ? formatLabel(selectedCalibre)
              : catalogoconfecid
              ? 'Seleccionar calibre...'
              : 'Selecciona catálogo primero'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-full p-0"
        onWheelCapture={(event) => event.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder="Buscar calibre..." />
          <CommandList onWheelCapture={(event) => event.stopPropagation()}>
            <CommandEmpty>No se encontró ningún calibre.</CommandEmpty>
            <CommandGroup>
              {calibres.map((calibre) => (
                <CommandItem
                  key={calibre.calibreid}
                  value={`${calibre.calibreid}-${calibre.nombre_calibre}`}
                  onSelect={() => {
                    onChange(calibre.calibreid);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === calibre.calibreid ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {formatLabel(calibre)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
