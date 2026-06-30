import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowRight,
  ExternalLink,
  FileText,
  Loader2,
  MapPin,
  Plus,
  Trash2,
} from 'lucide-react';
import { GeneroCombobox } from '@/components/GeneroCombobox';
import { CatalogoConfecCombobox } from '@/components/CatalogoConfecCombobox';
import { GrupoConfeccionCombobox } from '@/components/GrupoConfeccionCombobox';
import { ConfeccionPaletCombobox } from '@/components/ConfeccionPaletCombobox';
import { ConfeccionSalidaCombobox } from '@/components/ConfeccionSalidaCombobox';
import { CalibreCombobox } from '@/components/CalibreCombobox';
import { OrigenCombobox } from '@/components/OrigenCombobox';
import { TipoCultivoCombobox } from '@/components/TipoCultivoCombobox';
import { SubcentroCombobox } from '@/components/SubcentroCombobox';
import { cn } from '@/lib/utils';
import type { CambioPedido } from '@/types/cambios';
import type { NewPedidoLineaDraft } from '@/types/pedidos';
import { useToast } from '@/hooks/use-toast';
import { agroirisCatConfeckilos, type CatConfeckilosOption } from '@/services/agroirisCatConfeckilos';
import {
  agroirisCatalogoConfeccionPieza,
  type CatalogoConfeccionPiezaOption,
} from '@/services/agroirisCatalogoConfeccionPieza';

type NewCentroDraft = {
  tempId: string;
  asignacion: string;
  numero_palets: number | null;
  subprov: number | null;
};

interface CambioCreatePedidoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cambio: CambioPedido | null;
  contextTitle?: string | null;
  contextSubtitle?: string | null;
  pdfCambioUrl?: string | null;
  pdfCambioLoading?: boolean;
  pdfCambioError?: string | null;
  pdfActualUrl?: string | null;
  pdfActualLoading?: boolean;
  pdfActualError?: string | null;
  clienteNombre?: string | null;
  lineas: NewPedidoLineaDraft[];
  setLineas: Dispatch<SetStateAction<NewPedidoLineaDraft[]>>;
  centros: Record<string, NewCentroDraft[]>;
  setCentros: Dispatch<SetStateAction<Record<string, NewCentroDraft[]>>>;
  onCreate?: () => void;
  creating?: boolean;
  createDisabledReason?: string | null;
}

const generateTempId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `temp-linea-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createEmptyLinea = (): NewPedidoLineaDraft => ({
  tempId: generateTempId(),
  generoid: null,
  tipocultivoid: null,
  catalogoconfecid: null,
  grupoconfeccionid: null,
  confeccionpaletid: null,
  confeccionsalidaid: null,
  origenid: null,
  calibreid: null,
  bultos: null,
  bultosxpalet: null,
  numero_palet: null,
  piezasxbulto: null,
  total_piezas: null,
  kilosxbulto: null,
  kilos_cliente: null,
  descripcion_salida: '',
  catconfecpiezaid: null,
  catconfeckilosbultoid: null,
  ean: null,
  ean_pieza: null,
  ean_bulto: null,
  ean_caja: null,
  nlote_cliente: null,
  precio_venta: null,
});

const getLineaKey = (lineaId: number | string) => String(lineaId);

const parseNumberInput = (value: string) => (value === '' ? null : Number(value));
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isFractionalPalet = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value);

const validateLinea = (linea: NewPedidoLineaDraft) => {
  const missing: string[] = [];

  if (!linea.generoid) missing.push('Genero');
  if (!linea.tipocultivoid) missing.push('Tipo cultivo');
  if (!linea.catalogoconfecid) missing.push('Catalogo confeccion');
  if (!linea.grupoconfeccionid) missing.push('Grupo confeccion');
  if (!linea.confeccionsalidaid) missing.push('Confeccion salida');
  if (!linea.origenid) missing.push('Origen');
  if (!linea.calibreid) missing.push('Calibre');
  if (linea.bultos == null) missing.push('Bultos');
  if (linea.bultosxpalet == null) missing.push('Bultos x palet');
  if (linea.numero_palet == null) missing.push('Numero de palet');
  if (!linea.descripcion_salida || !linea.descripcion_salida.trim()) missing.push('Descripcion');

  return missing.length ? missing.join(', ') : null;
};

export const CambioCreatePedidoDialog = ({
  open,
  onOpenChange,
  cambio,
  contextTitle,
  contextSubtitle,
  pdfCambioUrl,
  pdfCambioLoading = false,
  pdfCambioError,
  pdfActualUrl,
  pdfActualLoading = false,
  pdfActualError,
  clienteNombre,
  lineas,
  setLineas,
  centros,
  setCentros,
  onCreate,
  creating = false,
  createDisabledReason,
}: CambioCreatePedidoDialogProps) => {
  const { toast } = useToast();
  const [catalogoKilosOptions, setCatalogoKilosOptions] = useState<Record<number, CatConfeckilosOption[]>>({});
  const [catalogoPiezasOptions, setCatalogoPiezasOptions] = useState<Record<number, CatalogoConfeccionPiezaOption[]>>({});
  const [catalogoOptionsLoading, setCatalogoOptionsLoading] = useState<Record<number, boolean>>({});

  const ensureCatalogoOptions = useCallback(
    async (catalogoconfecid: number | null | undefined) => {
      if (!catalogoconfecid) return;
      const hasKilos = Boolean(catalogoKilosOptions[catalogoconfecid]);
      const hasPiezas = Boolean(catalogoPiezasOptions[catalogoconfecid]);
      if (hasKilos && hasPiezas) return;
      if (catalogoOptionsLoading[catalogoconfecid]) return;
      setCatalogoOptionsLoading((prev) => ({ ...prev, [catalogoconfecid]: true }));
      try {
        const [kilos, piezas] = await Promise.all([
          hasKilos
            ? Promise.resolve(catalogoKilosOptions[catalogoconfecid])
            : agroirisCatConfeckilos.getByCatalogo(catalogoconfecid),
          hasPiezas
            ? Promise.resolve(catalogoPiezasOptions[catalogoconfecid])
            : agroirisCatalogoConfeccionPieza.getByCatalogo(catalogoconfecid),
        ]);
        if (!hasKilos) {
          setCatalogoKilosOptions((prev) => ({ ...prev, [catalogoconfecid]: kilos }));
        }
        if (!hasPiezas) {
          setCatalogoPiezasOptions((prev) => ({ ...prev, [catalogoconfecid]: piezas }));
        }
      } catch (error) {
        console.error('Error cargando opciones de catalogo:', error);
        setCatalogoKilosOptions((prev) => ({ ...prev, [catalogoconfecid]: prev[catalogoconfecid] ?? [] }));
        setCatalogoPiezasOptions((prev) => ({ ...prev, [catalogoconfecid]: prev[catalogoconfecid] ?? [] }));
      } finally {
        setCatalogoOptionsLoading((prev) => {
          const next = { ...prev };
          delete next[catalogoconfecid];
          return next;
        });
      }
    },
    [catalogoKilosOptions, catalogoPiezasOptions, catalogoOptionsLoading],
  );

  useEffect(() => {
    const catalogoIds = new Set<number>();
    lineas.forEach((linea) => {
      if (linea.catalogoconfecid) {
        catalogoIds.add(linea.catalogoconfecid);
      }
    });
    catalogoIds.forEach((id) => {
      ensureCatalogoOptions(id);
    });
  }, [lineas, ensureCatalogoOptions]);

  const updateLineaFields = useCallback(
    (tempId: string, changes: Partial<NewPedidoLineaDraft>) => {
      setLineas((prev) => prev.map((linea) => (linea.tempId === tempId ? { ...linea, ...changes } : linea)));
    },
    [setLineas],
  );

  const handleLineaChange = useCallback(
    <K extends keyof NewPedidoLineaDraft>(tempId: string, field: K, value: NewPedidoLineaDraft[K]) => {
      updateLineaFields(tempId, { [field]: value } as Partial<NewPedidoLineaDraft>);
    },
    [updateLineaFields],
  );

  const handleAddLinea = useCallback(() => {
    setLineas((prev) => [...prev, createEmptyLinea()]);
  }, [setLineas]);

  const handleRemoveLinea = useCallback(
    (tempId: string) => {
      setLineas((prev) => prev.filter((linea) => linea.tempId !== tempId));
      setCentros((prev) => {
        const next = { ...prev };
        delete next[getLineaKey(tempId)];
        return next;
      });
    },
    [setLineas, setCentros],
  );

  const handleCatalogoChangeForLinea = useCallback(
    (
      tempId: string,
      catalogoId: number,
      catalogoNombre?: string,
      confeccionSalidaId?: number | null,
      grupoConfeccionId?: number | null,
    ) => {
      const descripcion = catalogoNombre?.trim();
      updateLineaFields(tempId, {
        catalogoconfecid: catalogoId,
        catconfeckilosbultoid: null,
        catconfecpiezaid: null,
        kilosxbulto: null,
        piezasxbulto: null,
        confeccionsalidaid: confeccionSalidaId ?? null,
        grupoconfeccionid: grupoConfeccionId ?? null,
        calibreid: null,
        ...(descripcion ? { descripcion_salida: descripcion } : {}),
      });
      ensureCatalogoOptions(catalogoId);
    },
    [ensureCatalogoOptions, updateLineaFields],
  );
  const handleConfeccionSalidaChangeForLinea = useCallback(
    (tempId: string, confeccionSalidaId: number | null, grupoConfeccionId?: number | null) => {
      updateLineaFields(tempId, {
        confeccionsalidaid: confeccionSalidaId,
        grupoconfeccionid: grupoConfeccionId ?? null,
      });
    },
    [updateLineaFields],
  );

  const getKilosOptions = (catalogoconfecid?: number | null) =>
    catalogoconfecid ? catalogoKilosOptions[catalogoconfecid] ?? [] : [];
  const getPiezasOptions = (catalogoconfecid?: number | null) =>
    catalogoconfecid ? catalogoPiezasOptions[catalogoconfecid] ?? [] : [];
  const isCatalogoLoading = (catalogoconfecid?: number | null) =>
    catalogoconfecid ? Boolean(catalogoOptionsLoading[catalogoconfecid]) : false;

  const handleCatConfeckilosChangeForLinea = useCallback(
    (tempId: string, catalogoId: number | null | undefined, selectedId: number | null) => {
      const option =
        catalogoId && selectedId
          ? getKilosOptions(catalogoId).find((opt) => opt.catconfeckilosbultoid === selectedId)
          : null;
      updateLineaFields(tempId, {
        catconfeckilosbultoid: selectedId,
        kilosxbulto: option?.kilosxbulto ?? null,
      });
    },
    [updateLineaFields, catalogoKilosOptions],
  );

  const handleCatConfecPiezaChangeForLinea = useCallback(
    (tempId: string, catalogoId: number | null | undefined, selectedId: number | null) => {
      const option =
        catalogoId && selectedId
          ? getPiezasOptions(catalogoId).find((opt) => opt.catalogoconfeccionpiezaid === selectedId)
          : null;
      updateLineaFields(tempId, {
        catconfecpiezaid: selectedId,
        piezasxbulto: option?.nro_piezas ?? null,
      });
    },
    [updateLineaFields, catalogoPiezasOptions],
  );

  const calculateKilosCliente = (kilosxbulto: number | null | undefined, bultos: number | null | undefined) =>
    isFiniteNumber(kilosxbulto) && isFiniteNumber(bultos) ? kilosxbulto * bultos : null;
  const calculateBultos = (
    numeroPalet: number | null | undefined,
    bultosxpalet: number | null | undefined,
  ) =>
    isFiniteNumber(numeroPalet) && isFiniteNumber(bultosxpalet)
      ? numeroPalet * bultosxpalet
      : null;
  const calculateTotalPiezas = (
    piezasxbulto: number | null | undefined,
    bultos: number | null | undefined,
  ) =>
    isFiniteNumber(piezasxbulto) && isFiniteNumber(bultos)
      ? piezasxbulto * bultos
      : null;
  const handleCalculateKilosClienteForNew = (
    tempId: string,
    kilosxbulto?: number | null,
    bultos?: number | null,
  ) => {
    const calculated = calculateKilosCliente(kilosxbulto, bultos);
    if (calculated == null) {
      toast({
        title: 'No se pudo calcular kilos cliente',
        description: 'Completa kilos x bulto y bultos antes de calcular.',
      });
      return;
    }
    updateLineaFields(tempId, { kilos_cliente: calculated });
  };
  const handleCalculateTotalPiezasForNew = (
    tempId: string,
    piezasxbulto?: number | null,
    bultos?: number | null,
  ) => {
    const calculated = calculateTotalPiezas(piezasxbulto, bultos);
    if (calculated == null) {
      toast({
        title: 'No se pudo calcular total piezas',
        description: 'Completa piezas x bulto y bultos antes de calcular.',
      });
      return;
    }
    updateLineaFields(tempId, { total_piezas: calculated });
  };
  const handleCalculateBultosForNew = (
    tempId: string,
    numeroPalet?: number | null,
    bultosxpalet?: number | null,
  ) => {
    const calculated = calculateBultos(numeroPalet, bultosxpalet);
    if (calculated == null) {
      toast({
        title: 'No se pudo calcular bultos',
        description: 'Completa numero de palet y bultos x palet antes de calcular.',
      });
      return;
    }
    updateLineaFields(tempId, { bultos: calculated });
  };

  const getCentrosList = useCallback(
    (lineaKey: string, state?: Record<string, NewCentroDraft[]>) => {
      const source = state ?? centros;
      return source[lineaKey] ?? [];
    },
    [centros],
  );

  const getUsedSubprovIds = useCallback(
    (lineaKey: string, ignoreTempId?: string) => {
      const used = new Set<number>();
      getCentrosList(lineaKey).forEach((centro) => {
        if (ignoreTempId && centro.tempId === ignoreTempId) return;
        if (centro.subprov) used.add(centro.subprov);
      });
      return used;
    },
    [getCentrosList],
  );

  const getUsedAsignaciones = useCallback(
    (lineaKey: string) => {
      const used = new Set<string>();
      getCentrosList(lineaKey).forEach((centro) => {
        if (centro.asignacion) used.add(centro.asignacion);
      });
      return used;
    },
    [getCentrosList],
  );

  const getNextAsignacionLibre = useCallback(
    (lineaKey: string) => {
      const used = getUsedAsignaciones(lineaKey);
      const candidates = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
      const free = candidates.find((c) => !used.has(c));
      if (free) return free;
      let idx = 1;
      while (used.has(`N${idx}`)) idx += 1;
      return `N${idx}`;
    },
    [getUsedAsignaciones],
  );

  const addCentro = useCallback(
    (lineaKey: string) => {
      const tempId = `temp-centro-${lineaKey}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setCentros((prev) => {
        const list = getCentrosList(lineaKey, prev);
        return {
          ...prev,
          [lineaKey]: [
            ...list,
            { tempId, asignacion: getNextAsignacionLibre(lineaKey), numero_palets: 0, subprov: null },
          ],
        };
      });
    },
    [getCentrosList, getNextAsignacionLibre, setCentros],
  );

  const updateCentro = useCallback(
    (lineaKey: string, tempId: string, field: keyof Omit<NewCentroDraft, 'tempId'>, value: string | number | null) => {
      setCentros((prev) => {
        const list = getCentrosList(lineaKey, prev);
        return {
          ...prev,
          [lineaKey]: list.map((centro) =>
            centro.tempId === tempId ? { ...centro, [field]: value } : centro,
          ),
        };
      });
    },
    [getCentrosList, setCentros],
  );

  const removeCentro = useCallback(
    (lineaKey: string, tempId: string) => {
      setCentros((prev) => {
        const list = getCentrosList(lineaKey, prev);
        return {
          ...prev,
          [lineaKey]: list.filter((centro) => centro.tempId !== tempId),
        };
      });
    },
    [getCentrosList, setCentros],
  );

  const validationMessage = useMemo(() => {
    if (lineas.length === 0) return 'Anade al menos una linea.';
    const invalid = lineas.find((linea) => validateLinea(linea));
    if (!invalid) return null;
    const detail = validateLinea(invalid);
    return detail ? `Faltan campos: ${detail}` : 'Revisa los campos de las lineas.';
  }, [lineas]);

  const effectiveDisabledReason = createDisabledReason ?? validationMessage;
  const disableCreate = !onCreate || Boolean(effectiveDisabledReason) || creating;

  const titleLabel = contextTitle?.trim() || 'Nuevo pedido';
  const descriptionLabel = contextSubtitle?.trim() || 'Revisa el PDF y ajusta las lineas antes de crear.';
  const isPrevision = cambio?.tipo_pedido === 'P22E';
  const createLabel = isPrevision ? 'Crear prevision' : 'Crear pedido';
  const helperText =
    effectiveDisabledReason ?? 'El pedido se creara con el PDF del cambio.';
  const pdfFrameClass = 'h-[52vh] min-h-[320px] max-h-[680px]';

  const renderCatOptionField = (
    catalogoId: number | null | undefined,
    label: string,
    value: number | null | undefined,
    options: CatConfeckilosOption[] | CatalogoConfeccionPiezaOption[],
    onChange: (value: number | null) => void,
    formatValue: (catalogoId: number | null | undefined, selectedId: number | null | undefined) => string,
    helperNoCatalog?: string,
  ) => {
    const loading = isCatalogoLoading(catalogoId);
    return (
      <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Select
          value={value ? String(value) : 'none'}
          onValueChange={(val) => {
            onChange(val === 'none' ? null : Number(val));
          }}
          disabled={!catalogoId}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={catalogoId ? (loading ? 'Cargando...' : formatValue(catalogoId, value ?? null)) : 'Sin catalogo'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin asignar</SelectItem>
            {options.map((option) => {
              const optionId =
                'kilosxbulto' in option ? option.catconfeckilosbultoid : option.catalogoconfeccionpiezaid;
              return (
                <SelectItem key={optionId} value={String(optionId)}>
                  {'kilosxbulto' in option
                    ? `${option.kilosxbulto ?? '-'} kg - ID ${option.catconfeckilosbultoid}`
                    : `${option.nro_piezas ?? '-'} piezas - ID ${option.catalogoconfeccionpiezaid}`}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {helperNoCatalog && (
          <p className="text-xs text-muted-foreground">{helperNoCatalog}</p>
        )}
        {catalogoId && !loading && options.length === 0 && (
          <p className="text-xs text-muted-foreground">Sin valores activos para este catalogo.</p>
        )}
      </div>
    );
  };

  const formatCatKilosLabel = (catalogoId: number | null | undefined, selectedId: number | null | undefined) => {
    if (!selectedId) return 'Sin asignar';
    const option =
      catalogoId && selectedId
        ? getKilosOptions(catalogoId).find((opt) => opt.catconfeckilosbultoid === selectedId)
        : null;
    return option
      ? `${option.kilosxbulto ?? '-'} kg - ID ${option.catconfeckilosbultoid}`
      : `ID: ${selectedId}`;
  };

  const formatCatPiezaLabel = (catalogoId: number | null | undefined, selectedId: number | null | undefined) => {
    if (!selectedId) return 'Sin asignar';
    const option =
      catalogoId && selectedId
        ? getPiezasOptions(catalogoId).find((opt) => opt.catalogoconfeccionpiezaid === selectedId)
        : null;
    return option
      ? `${option.nro_piezas ?? '-'} piezas - ID ${option.catalogoconfeccionpiezaid}`
      : `ID: ${selectedId}`;
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-[98vw] max-h-[96vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <DialogTitle className="text-xl font-semibold">{titleLabel}</DialogTitle>
              <DialogDescription>{descriptionLabel}</DialogDescription>
            </div>
            {cambio && (
              <Badge variant="outline" className="text-xs">
                {isPrevision ? 'Prevision' : 'Pedido'}
              </Badge>
            )}
          </div>
        </DialogHeader>

        <div className="grid gap-6 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Card className="min-w-0">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <FileText className="h-4 w-4" />
                Pedido nuevo
              </div>
              <div className="rounded-lg border border-dashed border-muted-foreground/30 p-4">
                <p className="text-sm font-medium">PDF actual</p>
                <p className="text-xs text-muted-foreground">
                  Documento asociado a los pedidos del grupo.
                </p>
                <div className="mt-3 rounded-md border border-border/60 bg-muted/10 p-2">
                  {pdfActualLoading ? (
                    <div className={`${pdfFrameClass} w-full animate-pulse rounded-md bg-muted`} />
                  ) : pdfActualUrl ? (
                    <object
                      data={pdfActualUrl}
                      type="application/pdf"
                      className={`${pdfFrameClass} w-full rounded-md border border-border/60 bg-background`}
                    >
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        No se pudo incrustar el PDF.
                      </div>
                    </object>
                  ) : (
                    <div className={`flex ${pdfFrameClass} items-center justify-center text-xs text-muted-foreground`}>
                      {pdfActualError || 'No hay PDF asociado.'}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col items-center justify-center gap-3 text-center">
            <div className="text-sm font-semibold text-muted-foreground">
              {isPrevision ? 'Nueva prevision' : 'Nuevo pedido'}
            </div>
            <Button onClick={onCreate} disabled={disableCreate}>
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creando
                </>
              ) : (
                <>
                  <ArrowRight className="mr-2 h-4 w-4" />
                  {createLabel}
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">{helperText}</p>
          </div>

          <Card className="min-w-0">
            <CardContent className="space-y-4 p-5">
              <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">PDF del cambio</p>
              <div className="rounded-lg border border-dashed border-muted-foreground/30 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Documento recibido</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      if (pdfCambioUrl) window.open(pdfCambioUrl, '_blank');
                    }}
                    disabled={!pdfCambioUrl}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir aparte
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  PDF que se asociara al nuevo pedido/prevision.
                </p>
                <div className="mt-3 rounded-md border border-border/60 bg-muted/10 p-2">
                  {pdfCambioLoading ? (
                    <div className={`${pdfFrameClass} w-full animate-pulse rounded-md bg-muted`} />
                  ) : pdfCambioUrl ? (
                    <object
                      data={pdfCambioUrl}
                      type="application/pdf"
                      className={`${pdfFrameClass} w-full rounded-md border border-border/60 bg-background`}
                    >
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        No se pudo incrustar el PDF.
                      </div>
                    </object>
                  ) : (
                    <div className={`flex ${pdfFrameClass} items-center justify-center text-xs text-muted-foreground`}>
                      {pdfCambioError || 'No hay PDF asociado.'}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {cambio && (
          <Card className="mt-6">
            <CardContent className="space-y-2 p-5 text-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {isPrevision ? 'Prevision' : 'Pedido'}
                  </Badge>
                  <span className="text-sm font-semibold text-muted-foreground">Detalle del pedido</span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <span className="text-muted-foreground">Referencia</span>
                  <p className="font-medium">{cambio.referencia_cliente?.trim() || 'Sin referencia'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Referencia 2</span>
                  <p className="font-medium">{cambio.referencia2_cliente?.trim() || 'Sin referencia 2'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Cliente</span>
                  <p className="font-medium">
                    {clienteNombre?.trim() || (cambio.clienteid ? `Cliente #${cambio.clienteid}` : 'Sin cliente')}
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">Fecha pedido</span>
                  <p className="font-medium">{cambio.fecha_pedido ?? 'Sin fecha'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <section className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              Lineas del pedido
              <Badge variant="secondary" className="text-xs">
                {lineas.length} lineas
              </Badge>
            </h3>
            <Button variant="secondary" size="sm" onClick={handleAddLinea}>
              <Plus className="mr-2 h-4 w-4" />
              Anadir linea
            </Button>
          </div>

          {lineas.length === 0 ? (
            <div className="rounded-lg border border-dashed border-muted-foreground/30 p-6 text-sm text-muted-foreground">
              No hay lineas cargadas. Anade una linea para continuar.
            </div>
          ) : (
            <div className="space-y-4">
              {lineas.map((linea, index) => {
                const lineKey = getLineaKey(linea.tempId);
                const centrosLinea = getCentrosList(lineKey);
                return (
                  <div key={linea.tempId} className="border rounded-lg overflow-hidden bg-card shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 bg-muted/40 border-b">
                      <h4 className="font-semibold flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                          {index + 1}
                        </span>
                        Linea #{index + 1}
                      </h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-destructive"
                        onClick={() => handleRemoveLinea(linea.tempId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="p-4 space-y-4">
                      <div className="space-y-1 border-b border-border/60 pb-4">
                        <Label className="text-sm font-semibold text-muted-foreground">Descripcion</Label>
                        <Input
                          value={linea.descripcion_salida}
                          placeholder="Detalle de la linea"
                          onChange={(e) => handleLineaChange(linea.tempId, 'descripcion_salida', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1 border-b border-border/60 pb-4">
                        <Label className="text-sm font-semibold text-muted-foreground">EAN pieza</Label>
                        <Input
                          value={linea.ean_pieza ?? linea.ean_bulto ?? linea.ean ?? ''}
                          placeholder="EAN de la pieza"
                          onChange={(e) => {
                            const value = e.target.value.trim() || null;
                            handleLineaChange(linea.tempId, 'ean', value);
                            handleLineaChange(linea.tempId, 'ean_pieza', value);
                          }}
                        />
                      </div>
                      <div className="space-y-1 border-b border-border/60 pb-4">
                        <Label className="text-sm font-semibold text-muted-foreground">EAN caja</Label>
                        <Input
                          value={linea.ean_caja ?? ''}
                          placeholder="EAN de la caja"
                          onChange={(e) =>
                            handleLineaChange(linea.tempId, 'ean_caja', e.target.value.trim() || null)
                          }
                        />
                      </div>
                      <div className="space-y-1 border-b border-border/60 pb-4">
                        <Label className="text-sm font-semibold text-muted-foreground">Precio venta</Label>
                        <Input
                          type="number"
                          step="any"
                          value={linea.precio_venta ?? ''}
                          placeholder="Precio venta"
                          onChange={(e) =>
                            handleLineaChange(
                              linea.tempId,
                              'precio_venta',
                              e.target.value === '' ? null : Number(e.target.value),
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1 border-b border-border/60 pb-4">
                        <Label className="text-sm font-semibold text-muted-foreground">Número de lote</Label>
                        <Input
                          value={linea.nlote_cliente ?? ''}
                          placeholder="Lote del cliente para esta línea"
                          onChange={(e) =>
                            handleLineaChange(
                              linea.tempId,
                              'nlote_cliente',
                              e.target.value.trim() || null,
                            )
                          }
                        />
                      </div>
                      <div>
                        <h5 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                          Cantidades
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                          {[
                            { label: 'Bultos', field: 'bultos' },
                            { label: 'Bultos x Palet', field: 'bultosxpalet' },
                            { label: 'Numero Palet', field: 'numero_palet' },
                            { label: 'Piezas x Bulto', field: 'piezasxbulto' },
                            { label: 'Total Piezas', field: 'total_piezas' },
                            { label: 'Kilos x Bulto', field: 'kilosxbulto' },
                            { label: 'Kilos Cliente', field: 'kilos_cliente' },
                          ].map(({ label, field }) => (
                            <div
                              key={field}
                              className={cn(
                                'space-y-1 p-3 rounded-lg bg-muted/30 border',
                                field === 'numero_palet' &&
                                  isFractionalPalet(linea.numero_palet) &&
                                  'bg-rose-50/70 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900'
                              )}
                            >
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide">{label}</Label>
                              {field === 'bultos' ? (
                                <div className="space-y-2">
                                  <Input
                                    type="number"
                                    value={linea[field as keyof NewPedidoLineaDraft] ?? ''}
                                    onChange={(e) =>
                                      handleLineaChange(
                                        linea.tempId,
                                        field as keyof NewPedidoLineaDraft,
                                        parseNumberInput(e.target.value) as NewPedidoLineaDraft[keyof NewPedidoLineaDraft],
                                      )
                                    }
                                    className="h-8"
                                  />
                                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                    <span>Calculo: numero de palets x bultos x palet</span>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() =>
                                        handleCalculateBultosForNew(
                                          linea.tempId,
                                          linea.numero_palet,
                                          linea.bultosxpalet,
                                        )
                                      }
                                      title="Calcula bultos = numero de palets x bultos x palet"
                                    >
                                      Calcular
                                    </Button>
                                  </div>
                                </div>
                              ) : field === 'total_piezas' ? (
                                <div className="space-y-2">
                                  <Input
                                    type="number"
                                    value={linea[field as keyof NewPedidoLineaDraft] ?? ''}
                                    onChange={(e) =>
                                      handleLineaChange(
                                        linea.tempId,
                                        field as keyof NewPedidoLineaDraft,
                                        parseNumberInput(e.target.value) as NewPedidoLineaDraft[keyof NewPedidoLineaDraft],
                                      )
                                    }
                                    className="h-8"
                                  />
                                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                    <span>Calculo: piezas x bulto x bultos</span>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() =>
                                        handleCalculateTotalPiezasForNew(
                                          linea.tempId,
                                          linea.piezasxbulto,
                                          linea.bultos,
                                        )
                                      }
                                      title="Calcula total piezas = piezas x bulto x bultos"
                                    >
                                      Calcular
                                    </Button>
                                  </div>
                                </div>
                              ) : field === 'kilos_cliente' ? (
                                <div className="space-y-2">
                                  <Input
                                    type="number"
                                    value={linea[field as keyof NewPedidoLineaDraft] ?? ''}
                                    onChange={(e) =>
                                      handleLineaChange(
                                        linea.tempId,
                                        field as keyof NewPedidoLineaDraft,
                                        parseNumberInput(e.target.value) as NewPedidoLineaDraft[keyof NewPedidoLineaDraft],
                                      )
                                    }
                                    className="h-8"
                                  />
                                  <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                                    <span>Calculo: kilos x bulto x bultos</span>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() =>
                                        handleCalculateKilosClienteForNew(
                                          linea.tempId,
                                          linea.kilosxbulto,
                                          linea.bultos,
                                        )
                                      }
                                      title="Calcula kilos cliente = kilos x bulto x bultos"
                                    >
                                      Calcular
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <Input
                                  type="number"
                                  value={linea[field as keyof NewPedidoLineaDraft] ?? ''}
                                  onChange={(e) =>
                                    handleLineaChange(
                                      linea.tempId,
                                      field as keyof NewPedidoLineaDraft,
                                      parseNumberInput(e.target.value) as NewPedidoLineaDraft[keyof NewPedidoLineaDraft],
                                    )
                                  }
                                  className="h-8"
                                  step={field === 'numero_palet' ? '0.001' : undefined}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h5 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                          Identificadores de Configuracion
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Genero</Label>
                            <GeneroCombobox
                              value={linea.generoid}
                              onChange={(value) => handleLineaChange(linea.tempId, 'generoid', value)}
                            />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Catalogo Confeccion</Label>
                            <CatalogoConfecCombobox
                              value={linea.catalogoconfecid ?? undefined}
                              generoid={linea.generoid ?? null}
                              onChange={(value, catalogo) =>
                                handleCatalogoChangeForLinea(
                                  linea.tempId,
                                  value,
                                  catalogo?.nombreCatalogo,
                                  catalogo?.confeccionSalidaId,
                                  catalogo?.grupoConfeccionId
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Confeccion Salida</Label>
                            <ConfeccionSalidaCombobox
                              value={linea.confeccionsalidaid}
                              catalogoconfecid={linea.catalogoconfecid ?? null}
                              onChange={(value, confeccion) =>
                                handleConfeccionSalidaChangeForLinea(
                                  linea.tempId,
                                  value,
                                  confeccion?.grupoconfeccionid
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Grupo Confeccion</Label>
                            <GrupoConfeccionCombobox
                              value={linea.grupoconfeccionid}
                              catalogoconfecid={linea.catalogoconfecid ?? null}
                              onChange={(value) => handleLineaChange(linea.tempId, 'grupoconfeccionid', value)}
                            />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Confeccion Palet</Label>
                            <ConfeccionPaletCombobox
                              value={linea.confeccionpaletid}
                              onChange={(value) => handleLineaChange(linea.tempId, 'confeccionpaletid', value)}
                            />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Calibre</Label>
                            <CalibreCombobox
                              value={linea.calibreid}
                              catalogoconfecid={linea.catalogoconfecid ?? null}
                              onChange={(value) => handleLineaChange(linea.tempId, 'calibreid', value)}
                            />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Origen</Label>
                            <OrigenCombobox
                              value={linea.origenid}
                              onChange={(value) => handleLineaChange(linea.tempId, 'origenid', value)}
                            />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Tipo Cultivo</Label>
                            <TipoCultivoCombobox
                              value={linea.tipocultivoid}
                              onChange={(value) => handleLineaChange(linea.tempId, 'tipocultivoid', value)}
                            />
                          </div>
                          {renderCatOptionField(
                            linea.catalogoconfecid ?? null,
                            'Cat. Confec Kilos/Bulto',
                            linea.catconfeckilosbultoid,
                            getKilosOptions(linea.catalogoconfecid ?? null),
                            (selectedId) =>
                              handleCatConfeckilosChangeForLinea(linea.tempId, linea.catalogoconfecid ?? null, selectedId),
                            formatCatKilosLabel,
                            'Selecciona un catalogo para ver opciones.',
                          )}
                          {renderCatOptionField(
                            linea.catalogoconfecid ?? null,
                            'Cat. Confec Pieza',
                            linea.catconfecpiezaid,
                            getPiezasOptions(linea.catalogoconfecid ?? null),
                            (selectedId) =>
                              handleCatConfecPiezaChangeForLinea(linea.tempId, linea.catalogoconfecid ?? null, selectedId),
                            formatCatPiezaLabel,
                            'Selecciona un catalogo para ver opciones.',
                          )}
                        </div>
                      </div>
                      <div className="mt-4 pt-3 border-t space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h5 className="text-sm font-semibold flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-primary" />
                            Centros de Distribucion
                            <span className="text-muted-foreground font-normal">({centrosLinea.length})</span>
                          </h5>
                          <Button variant="secondary" size="sm" className="h-8" onClick={() => addCentro(lineKey)}>
                            Anadir centro
                          </Button>
                        </div>
                        {centrosLinea.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Aun no hay centros. Anade al menos uno si aplica.</p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {centrosLinea.map((centro) => (
                              <div
                                key={centro.tempId}
                                className="bg-muted/30 rounded-lg p-3 border border-dashed hover:border-primary/50 transition-colors"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                  <Badge variant="secondary" className="text-xs">Centro</Badge>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-destructive"
                                    onClick={() => removeCentro(lineKey, centro.tempId)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-3 text-sm">
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Asignacion</Label>
                                    <Input
                                      value={centro.asignacion}
                                      onChange={(e) =>
                                        updateCentro(lineKey, centro.tempId, 'asignacion', e.target.value)
                                      }
                                      className="h-7"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Palets</Label>
                                    <Input
                                      type="number"
                                      value={centro.numero_palets ?? ''}
                                      onChange={(e) => {
                                        const val = parseNumberInput(e.target.value);
                                        updateCentro(lineKey, centro.tempId, 'numero_palets', val);
                                      }}
                                      className="h-7"
                                      step="0.001"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs text-muted-foreground">Subprov</Label>
                                    <SubcentroCombobox
                                      value={centro.subprov}
                                      excludeIds={[...getUsedSubprovIds(lineKey, centro.tempId)]}
                                      onChange={(val) => updateCentro(lineKey, centro.tempId, 'subprov', val)}
                                    />
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
    </>
  );
};
