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
import { agroirisGrupoConfeccion, type GrupoConfeccionSelectOption } from '@/services/agroirisGrupoConfeccion';

interface GrupoConfeccionComboboxProps {
  value?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  catalogoconfecid?: number | null;
}

export function GrupoConfeccionCombobox({ value, onChange, disabled, catalogoconfecid }: GrupoConfeccionComboboxProps) {
  const [open, setOpen] = useState(false);
  const [grupos, setGrupos] = useState<GrupoConfeccionSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const loadGrupos = useCallback(async () => {
    setLoading(true);
    try {
      const options = catalogoconfecid
        ? await agroirisGrupoConfeccion.searchGruposByCatalogo(catalogoconfecid, '')
        : await agroirisGrupoConfeccion.searchGrupos('');
      setGrupos(options);
    } catch (error) {
      console.error('Error cargando grupos confección:', error);
    } finally {
      setLoading(false);
    }
  }, [catalogoconfecid]);

  useEffect(() => {
    setSearchQuery('');

    if (!catalogoconfecid) {
      setGrupos([]);
      return;
    }

    if (open || value) {
      void loadGrupos();
      return;
    }

    setGrupos([]);
  }, [catalogoconfecid, open, value, loadGrupos]);

  useEffect(() => {
    if (!value) {
      setLoadingSelected(false);
      return;
    }
    if (grupos.some((grupo) => grupo.value === value)) {
      setLoadingSelected(false);
      return;
    }

    let cancelled = false;

    const loadSelectedGrupo = async () => {
      try {
        setLoadingSelected(true);
        const grupo = await agroirisGrupoConfeccion.getGrupoById(value);
        if (!cancelled && grupo) {
          const option = agroirisGrupoConfeccion.formatGruposForSelect([grupo])[0];
          if (!option) return;
          setGrupos((prev) => {
            if (prev.some((item) => item.value === option.value)) {
              return prev;
            }
            return [...prev, option];
          });
        }
      } catch (error) {
        console.error(`Error cargando grupo confección ${value}:`, error);
      } finally {
        if (!cancelled) {
          setLoadingSelected(false);
        }
      }
    };

    void loadSelectedGrupo();

    return () => {
      cancelled = true;
    };
  }, [value, grupos]);

  const selectedGrupo = grupos.find((g) => g.value === value);

  const filteredGrupos = searchQuery
    ? grupos.filter((grupo) =>
        grupo.searchText.includes(searchQuery.toLowerCase())
      )
    : grupos;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between overflow-hidden text-left"
          disabled={disabled || !catalogoconfecid}
          title={selectedGrupo?.label || undefined}
        >
          <span className="truncate flex-1">
            {selectedGrupo ? (
              selectedGrupo.label
            ) : loading || loadingSelected ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin inline-flex" />
                Cargando grupos...
              </>
            ) : (
              catalogoconfecid ? 'Seleccionar grupo de confección...' : 'Selecciona catálogo primero'
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[350px] p-0"
        onWheelCapture={(event) => event.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar grupo..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList onWheelCapture={(event) => event.stopPropagation()}>
            <CommandEmpty>
              {loading ? 'Cargando...' : 'No se encontraron grupos.'}
            </CommandEmpty>
            <CommandGroup>
              {filteredGrupos.map((grupo) => (
                <CommandItem
                  key={grupo.value}
                  value={grupo.value.toString()}
                  onSelect={() => {
                    onChange(grupo.value);
                    setOpen(false);
                    setSearchQuery('');
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === grupo.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {grupo.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
