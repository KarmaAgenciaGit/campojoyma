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
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { agroirisTipoCultivo, TipoCultivo } from '@/services/agroirisTipoCultivo';

interface TipoCultivoComboboxProps {
  value: number | null | undefined;
  onChange: (value: number) => void;
  placeholder?: string;
}

export function TipoCultivoCombobox({ value, onChange, placeholder = "Seleccionar tipo cultivo..." }: TipoCultivoComboboxProps) {
  const [open, setOpen] = useState(false);
  const [tipoCultivos, setTipoCultivos] = useState<TipoCultivo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTipoCultivos = async () => {
      try {
        const data = await agroirisTipoCultivo.getAllTipoCultivos();
        // Ordenar alfabéticamente por nombre
        const sorted = data.sort((a, b) => 
          a.nombre_tipocultivo.localeCompare(b.nombre_tipocultivo)
        );
        setTipoCultivos(sorted);
      } catch (error) {
        console.error('Error cargando tipos de cultivo:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTipoCultivos();
  }, []);

  const selectedTipoCultivo = tipoCultivos.find(tc => tc.tipocultivoid === value);
  const formatLabel = (tipoCultivo: TipoCultivo) => `${tipoCultivo.nombre_tipocultivo} (ID: ${tipoCultivo.tipocultivoid})`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-7 text-sm overflow-hidden text-left"
          title={selectedTipoCultivo ? formatLabel(selectedTipoCultivo) : undefined}
        >
          <span className="truncate">
            {loading
              ? "Cargando..."
              : selectedTipoCultivo
              ? formatLabel(selectedTipoCultivo)
              : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Buscar tipo cultivo..." />
          <CommandEmpty>No se encontró el tipo cultivo.</CommandEmpty>
          <CommandGroup className="max-h-64 overflow-auto">
            {tipoCultivos.map((tipoCultivo) => (
              <CommandItem
                key={tipoCultivo.tipocultivoid}
                value={`${tipoCultivo.tipocultivoid}-${tipoCultivo.nombre_tipocultivo}`}
                onSelect={() => {
                  onChange(tipoCultivo.tipocultivoid);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value === tipoCultivo.tipocultivoid ? "opacity-100" : "opacity-0"
                  )}
                />
                {formatLabel(tipoCultivo)}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
