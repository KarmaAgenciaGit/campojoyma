import * as React from 'react';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';
import { agroirisCatalogoConfec, type CatalogoConfecSelectOption } from '@/services/agroirisCatalogoConfec';

interface CatalogoConfecComboboxProps {
  value?: number;
  onChange: (value: number, option?: CatalogoConfecSelectOption) => void;
  disabled?: boolean;
  generoid?: number | null;
}

const EMPTY_OBSERVACION_LABEL = 'Sin observación';

const normalizeSearchQuery = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const getObservacionLabel = (catalogo: CatalogoConfecSelectOption): string =>
  catalogo.observacion?.trim() || EMPTY_OBSERVACION_LABEL;

const getCatalogoTitle = (catalogo: CatalogoConfecSelectOption): string =>
  [
    `Catálogo: ${catalogo.nombreCatalogo}`,
    `Cod. catálogo: ${catalogo.catalogoId}`,
    `Confección salida: ${catalogo.nombreConfeccionSalida}`,
    `Cod. salida: ${catalogo.confeccionSalidaId ?? 'Sin ID'}`,
    `Observación: ${getObservacionLabel(catalogo)}`,
  ].join('\n');

export function CatalogoConfecCombobox({ value, onChange, disabled, generoid }: CatalogoConfecComboboxProps) {
  const isMobile = useIsMobile();
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [catalogos, setCatalogos] = React.useState<CatalogoConfecSelectOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);

  const loadCatalogos = React.useCallback(async () => {
    if (!generoid || loading) {
      if (!generoid) setCatalogos([]);
      return;
    }

    setLoading(true);
    try {
      const options = await agroirisCatalogoConfec.searchCatalogosByGenero(generoid, '');
      setCatalogos(options);
    } catch (error) {
      console.error('Error cargando catálogos:', error);
      setCatalogos([]);
    } finally {
      setLoading(false);
    }
  }, [generoid, loading]);

  React.useEffect(() => {
    if (value && catalogos.length === 0 && generoid) {
      void loadCatalogos();
    }
  }, [value, catalogos.length, generoid, loadCatalogos]);

  React.useEffect(() => {
    setCatalogos([]);
    setSearchQuery('');
    setOpen(false);
  }, [generoid]);

  React.useEffect(() => {
    if (open && catalogos.length === 0 && generoid) {
      void loadCatalogos();
    }
  }, [open, catalogos.length, generoid, loadCatalogos]);

  React.useEffect(() => {
    if (!open && searchQuery) {
      setSearchQuery('');
    }
  }, [open, searchQuery]);

  React.useEffect(() => {
    if (!open) return;
    const dialogContainer = triggerRef.current?.closest('[role="dialog"]');
    setPortalContainer(dialogContainer instanceof HTMLElement ? dialogContainer : null);
  }, [open]);

  const selectedCatalogo = React.useMemo(
    () => catalogos.find((catalogo) => catalogo.value === value) ?? null,
    [catalogos, value]
  );

  const filteredCatalogos = React.useMemo(() => {
    const normalizedSearch = normalizeSearchQuery(searchQuery);
    if (!normalizedSearch) return catalogos;
    return catalogos.filter((catalogo) => catalogo.searchText.includes(normalizedSearch));
  }, [catalogos, searchQuery]);

  const handleSelectCatalogo = React.useCallback(
    (catalogo: CatalogoConfecSelectOption) => {
      onChange(catalogo.value, catalogo);
      setOpen(false);
      setSearchQuery('');
    },
    [onChange]
  );

  const triggerText = React.useMemo(() => {
    if (loading) return 'Cargando catálogos...';
    if (selectedCatalogo) return selectedCatalogo.label;
    if (!generoid) return 'Selecciona género para ver catálogos';
    return 'Seleccionar catálogo de confección...';
  }, [generoid, loading, selectedCatalogo]);

  const triggerTitle = !generoid
    ? 'Selecciona un género primero'
    : selectedCatalogo
      ? getCatalogoTitle(selectedCatalogo)
      : undefined;

  const renderTriggerButton = (mobileTrigger: boolean = false) => (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className="w-full justify-between overflow-hidden text-left"
      disabled={disabled || !generoid}
      title={triggerTitle}
      onClick={mobileTrigger ? () => setOpen(true) : undefined}
      ref={triggerRef}
    >
      <span
        className={cn(
          'flex min-w-0 flex-1 items-center truncate',
          !selectedCatalogo && !loading && 'text-muted-foreground'
        )}
      >
        {loading ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : null}
        <span className="truncate">{triggerText}</span>
      </span>
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  const renderSearchBox = (
    <div className="border-b px-4 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Buscar por catálogo, confección, ID u observación..."
          className="pl-9"
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {filteredCatalogos.length} resultado{filteredCatalogos.length === 1 ? '' : 's'}
      </p>
    </div>
  );

  const renderEmptyState = (
    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
      {loading
        ? 'Cargando catálogos...'
        : generoid
          ? 'No se encontraron catálogos.'
          : 'Selecciona un género para ver catálogos.'}
    </div>
  );

  const renderDesktopResults = (
    <div
      className="max-h-[420px] overflow-auto overscroll-contain"
      onWheelCapture={(event) => event.stopPropagation()}
    >
      {filteredCatalogos.length === 0 ? (
        renderEmptyState
      ) : (
        <table className="w-full min-w-[920px] caption-bottom text-sm">
          <thead className="[&_tr]:border-b">
            <tr className="border-b">
              <th className="sticky top-0 z-10 h-10 bg-background px-4 text-left align-middle font-medium text-muted-foreground">
                Catálogo
              </th>
              <th className="sticky top-0 z-10 h-10 w-[120px] bg-background px-4 text-left align-middle font-medium text-muted-foreground">
                Cod. catálogo
              </th>
              <th className="sticky top-0 z-10 h-10 bg-background px-4 text-left align-middle font-medium text-muted-foreground">
                Confección salida
              </th>
              <th className="sticky top-0 z-10 h-10 w-[120px] bg-background px-4 text-left align-middle font-medium text-muted-foreground">
                Cod. salida
              </th>
              <th className="sticky top-0 z-10 h-10 bg-background px-4 text-left align-middle font-medium text-muted-foreground">
                Observación
              </th>
            </tr>
          </thead>
          <tbody className="[&_tr:last-child]:border-0">
            {filteredCatalogos.map((catalogo) => {
              const selected = catalogo.value === value;
              const observacion = getObservacionLabel(catalogo);

              return (
                <tr
                  key={catalogo.value}
                  tabIndex={0}
                  className={cn(
                    'cursor-pointer border-b align-top transition-colors hover:bg-muted/50',
                    selected && 'bg-muted/70'
                  )}
                  onClick={() => handleSelectCatalogo(catalogo)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleSelectCatalogo(catalogo);
                    }
                  }}
                >
                  <td className="p-4 align-middle">
                    <div className="flex items-start gap-2">
                      <Check
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          selected ? 'opacity-100 text-primary' : 'opacity-0'
                        )}
                      />
                      <span className="font-medium">{catalogo.nombreCatalogo}</span>
                    </div>
                  </td>
                  <td className="p-4 align-middle font-mono text-xs">{catalogo.catalogoId}</td>
                  <td className="p-4 align-middle">{catalogo.nombreConfeccionSalida}</td>
                  <td className="p-4 align-middle font-mono text-xs">
                    {catalogo.confeccionSalidaId ?? 'Sin ID'}
                  </td>
                  <td
                    className={cn(
                      'p-4 align-middle text-sm',
                      catalogo.observacion ? 'text-muted-foreground' : 'italic text-muted-foreground'
                    )}
                  >
                    {observacion}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderMobileResults = (
    <div className="flex-1 overflow-y-auto px-4 pb-4">
      {filteredCatalogos.length === 0 ? (
        renderEmptyState
      ) : (
        <div className="space-y-2">
          {filteredCatalogos.map((catalogo) => {
            const selected = catalogo.value === value;
            const observacion = getObservacionLabel(catalogo);

            return (
              <button
                key={catalogo.value}
                type="button"
                className={cn(
                  'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                  selected ? 'border-primary bg-muted/70' : 'hover:bg-muted/40'
                )}
                onClick={() => handleSelectCatalogo(catalogo)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{catalogo.nombreCatalogo}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Cat. {catalogo.catalogoId} · Salida {catalogo.confeccionSalidaId ?? 'Sin ID'}
                    </p>
                  </div>
                  <Check
                    className={cn(
                      'mt-0.5 h-4 w-4 shrink-0',
                      selected ? 'opacity-100 text-primary' : 'opacity-0'
                    )}
                  />
                </div>
                <p className="mt-2 text-sm">{catalogo.nombreConfeccionSalida}</p>
                <p
                  className={cn(
                    'mt-1 text-xs',
                    catalogo.observacion ? 'text-muted-foreground' : 'italic text-muted-foreground'
                  )}
                >
                  Observación: {observacion}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <>
        {renderTriggerButton(true)}
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader className="pb-2">
              <DrawerTitle>Catálogo de confección</DrawerTitle>
              <DrawerDescription>
                Busca por catálogo, confección de salida, código u observación.
              </DrawerDescription>
            </DrawerHeader>
            {renderSearchBox}
            {renderMobileResults}
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{renderTriggerButton()}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(980px,calc(100vw-2rem))] p-0"
        container={portalContainer}
        onWheelCapture={(event) => event.stopPropagation()}
      >
        {renderSearchBox}
        {renderDesktopResults}
      </PopoverContent>
    </Popover>
  );
}
