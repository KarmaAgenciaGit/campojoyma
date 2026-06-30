import { useState, useEffect, useCallback } from 'react';
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
import { agroirisConfeccionSalida, AgroIrisConfeccionSalida } from '@/services/agroirisConfeccionSalida';

interface ConfeccionSalidaComboboxProps {
  value: number | null;
  onChange: (value: number | null, option?: AgroIrisConfeccionSalida | null) => void;
  catalogoconfecid?: number | null;
}

export function ConfeccionSalidaCombobox({ value, onChange, catalogoconfecid }: ConfeccionSalidaComboboxProps) {
  const [open, setOpen] = useState(false);
  const [confecciones, setConfecciones] = useState<AgroIrisConfeccionSalida[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const loadConfecciones = useCallback(async () => {
    setLoading(true);
    try {
      const data = catalogoconfecid
        ? await agroirisConfeccionSalida.getConfeccionesByCatalogo(catalogoconfecid)
        : await agroirisConfeccionSalida.getConfecciones();
      setConfecciones(data.filter(c => c.activo));
    } catch (error) {
      console.error('Error al cargar confecciones salida:', error);
    } finally {
      setLoading(false);
    }
  }, [catalogoconfecid]);

  useEffect(() => {
    setSearchValue('');

    if (!catalogoconfecid) {
      setConfecciones([]);
      return;
    }

    if (open || value) {
      void loadConfecciones();
      return;
    }

    setConfecciones([]);
  }, [catalogoconfecid, open, value, loadConfecciones]);

  useEffect(() => {
    if (!value) {
      setLoadingSelected(false);
      return;
    }
    if (confecciones.some((confeccion) => confeccion.confeccionsalidaid === value)) {
      setLoadingSelected(false);
      return;
    }

    let cancelled = false;

    const loadSelectedConfeccion = async () => {
      try {
        setLoadingSelected(true);
        const confeccion = await agroirisConfeccionSalida.getConfeccionById(value);
        if (!cancelled && confeccion) {
          setConfecciones((prev) => {
            if (prev.some((item) => item.confeccionsalidaid === confeccion.confeccionsalidaid)) {
              return prev;
            }
            return [...prev, confeccion];
          });
        }
      } catch (error) {
        console.error(`Error al cargar confección salida ${value}:`, error);
      } finally {
        if (!cancelled) {
          setLoadingSelected(false);
        }
      }
    };

    void loadSelectedConfeccion();

    return () => {
      cancelled = true;
    };
  }, [value, confecciones]);

  // Filtrar confecciones según el texto de búsqueda
  const filteredConfecciones = confecciones.filter((confeccion) => {
    if (!searchValue) return true;
    const searchLower = searchValue.toLowerCase();
    return (
      confeccion.nombre_confeccionsalida.toLowerCase().includes(searchLower) ||
      confeccion.abreviatura_confeccionsalida.toLowerCase().includes(searchLower) ||
      confeccion.confeccionsalidaid.toString().includes(searchLower)
    );
  });

  // Ordenar alfabéticamente
  const sortedConfecciones = [...filteredConfecciones].sort((a, b) =>
    a.nombre_confeccionsalida.localeCompare(b.nombre_confeccionsalida)
  );

  const selectedConfeccion = confecciones.find(c => c.confeccionsalidaid === value);
  const formatLabel = (confeccion: AgroIrisConfeccionSalida) =>
    `${confeccion.nombre_confeccionsalida} (${confeccion.abreviatura_confeccionsalida}) · ID: ${confeccion.confeccionsalidaid}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-9 text-sm items-center overflow-hidden text-left"
          title={selectedConfeccion ? formatLabel(selectedConfeccion) : undefined}
          disabled={!catalogoconfecid}
        >
          <span className="flex-1 min-w-0 truncate">
            {selectedConfeccion
              ? formatLabel(selectedConfeccion)
              : loading || loadingSelected
              ? 'Cargando confección salida...'
              : catalogoconfecid
              ? 'Seleccionar confección salida...'
              : 'Selecciona un catálogo de confección primero'}
          </span>
          {(loading || loadingSelected) ? (
            <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-70" />
          ) : null}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[400px] p-0"
        onWheelCapture={(event) => event.stopPropagation()}
      >
        <Command>
          <CommandInput 
            placeholder="Buscar confección salida..." 
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList onWheelCapture={(event) => event.stopPropagation()}>
            {loading ? (
              <CommandEmpty>Cargando confecciones salida...</CommandEmpty>
            ) : sortedConfecciones.length === 0 ? (
              <CommandEmpty>No se encontraron confecciones salida.</CommandEmpty>
            ) : (
              <CommandGroup>
                {sortedConfecciones.map((confeccion) => (
                  <CommandItem
                    key={confeccion.confeccionsalidaid}
                    value={`${confeccion.confeccionsalidaid}-${confeccion.nombre_confeccionsalida} ${confeccion.abreviatura_confeccionsalida}`}
                    onSelect={() => {
                      const isSameValue = confeccion.confeccionsalidaid === value;
                      onChange(
                        isSameValue ? null : confeccion.confeccionsalidaid,
                        isSameValue ? null : confeccion,
                      );
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === confeccion.confeccionsalidaid ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {formatLabel(confeccion)}
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
