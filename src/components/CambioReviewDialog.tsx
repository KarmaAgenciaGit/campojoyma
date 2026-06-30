import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AcreedorCombobox } from '@/components/AcreedorCombobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ArrowLeft, ArrowRight, Ban, CalendarDays, ExternalLink, Loader2, Pencil, Plus, Tag } from 'lucide-react';
import type { CambioLinea, CambioPedido } from '@/types/cambios';
import type { PedidoLinea } from '@/types/pedidos';
import { agroirisCatConfeckilos, type CatConfeckilosOption } from '@/services/agroirisCatConfeckilos';
import {
  agroirisCatalogoConfeccionPieza,
  type CatalogoConfeccionPiezaOption,
} from '@/services/agroirisCatalogoConfeccionPieza';
import { resolveOrizonId } from '@/utils/orizon';

type AcreedorInfo = {
  id: number | null;
  label?: string | null;
};

type CambioDialogMode = 'transportista' | 'lineas' | 'cabecera';
type LineaCambioAction = 'add' | 'update' | 'cancel';

type LineaCambioDraft = {
  action: LineaCambioAction;
  bultos: number | null;
  bultosxpalet: number | null;
  numero_palet: number | null;
  piezasxbulto: number | null;
  total_piezas: number | null;
  kilosxbulto: number | null;
  kilos_cliente: number | null;
  catconfeckilosbultoid: number | null;
  catconfecpiezaid: number | null;
  ean_pieza: string | null;
  ean_bulto: string | null;
  ean_caja: string | null;
  nlote_cliente: string | null;
  precio_venta: number | null;
};

interface CambioReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cambio: CambioPedido | null;
  mode?: CambioDialogMode;
  pedido: {
    id?: number;
    referencia_cliente?: string | null;
    referencia2_cliente?: string | null;
    archivo_pdf_id?: number | null;
    acreedorid_porte?: number | null;
    matricula_tractora?: string | null;
    matricula_remolque?: string | null;
    idpedido_orizon?: number | string | null;
    pedidoclienteid?: number | string | null;
  } | null;
  acreedorActual?: AcreedorInfo | null;
  acreedorNuevo?: AcreedorInfo | null;
  loading?: boolean;
  applying?: boolean;
  acceptDisabledReason?: string | null;
  acceptLabel?: string | null;
  hasTransportistaChange?: boolean;
  hasMatriculaChange?: boolean;
  onAccept?: () => void;
  lineasCambio?: CambioLinea[];
  lineasPedido?: PedidoLinea[];
  lineasMatch?: Record<number, number | null>;
  lineasDrafts?: Record<number, LineaCambioDraft>;
  onChangeLineaMatch?: (cambioLineaId: number, pedidoLineaId: number | null) => void;
  onChangeLineaDraft?: (
    cambioLineaId: number,
    field: keyof LineaCambioDraft,
    value: number | string | null,
  ) => void;
  onApplyLineas?: () => void;
  applyingLineas?: boolean;
  lineasApplyDisabledReason?: string | null;
  lineasApplyLabel?: string | null;
  lineasApplyHint?: string | null;
  canCancelPedido?: boolean;
  cancelPedidoLabel?: string | null;
  cancelPedidoDescription?: string | null;
  onCancelPedido?: () => void;
  cancelPedidoLoading?: boolean;
  onChangeMatriculaNueva?: (field: 'matricula_tractora' | 'matricula_remolque', value: string) => void;
  onSaveMatriculaNueva?: (field: 'matricula_tractora' | 'matricula_remolque', value: string) => void;
  onUpdateOrizon?: () => void;
  updatingOrizon?: boolean;
  canMarkReviewed?: boolean;
  markReviewedLabel?: string | null;
  markReviewedDescription?: string | null;
  onMarkReviewed?: () => void;
  markReviewedLoading?: boolean;
  canCreatePedidoFromCambio?: boolean;
  createPedidoLabel?: string | null;
  createPedidoDescription?: string | null;
  onCreatePedidoFromCambio?: () => void;
  createPedidoLoading?: boolean;
  backToPedidoLabel?: string | null;
  onBackToPedido?: () => void;
  pdfActualUrl?: string | null;
  pdfActualLoading?: boolean;
  pdfActualError?: string | null;
  pdfCambioUrl?: string | null;
  pdfCambioLoading?: boolean;
  pdfCambioError?: string | null;
  onChangeAcreedorNuevo?: (value: number | null) => void;
  summaryLabel?: string | null;
  contextTitle?: string | null;
  contextSubtitle?: string | null;
}

const formatAcreedorLabel = (info?: AcreedorInfo | null, fallback = 'Sin transportista') => {
  if (!info || info.id == null) return fallback;
  const label = info.label?.trim();
  return label ? `${label} (#${info.id})` : `#${info.id}`;
};

const normalizeEanText = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return !trimmed || trimmed === '0' ? null : trimmed;
};

const formatFechaClave = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
};

const normalizeLineaAction = (value: unknown): LineaCambioAction => {
  const normalized = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (normalized === 'add') return 'add';
  if (normalized === 'cancel') return 'cancel';
  if (normalized === 'edit' || normalized === 'update' || normalized === 'upsert') return 'update';
  return 'update';
};

const getLineaActionLabel = (action: LineaCambioAction) => {
  if (action === 'add') return 'Añadir';
  if (action === 'cancel') return 'Anular';
  return 'Editar';
};

const getLineaActionBadgeClass = (action: LineaCambioAction) => {
  if (action === 'add') {
    return 'border-emerald-300/80 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300';
  }
  if (action === 'cancel') {
    return 'border-rose-300/80 bg-rose-50 text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-300';
  }
  return 'border-blue-300/80 bg-blue-50 text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-300';
};

const getLineaActionDescription = (action: LineaCambioAction, targetLabel: string) => {
  const targetContainer = targetLabel === 'previsión' ? 'en la previsión' : 'en el pedido';
  const targetOwnership = targetLabel === 'previsión' ? 'de la previsión' : 'del pedido';
  if (action === 'add') return `Se añadirá como una nueva línea ${targetContainer}.`;
  if (action === 'cancel') return `Se anulará la línea emparejada ${targetOwnership}.`;
  return `Se editará la línea emparejada ${targetOwnership} con los valores nuevos.`;
};

const getLineaActionToggleClass = (action: LineaCambioAction) => {
  if (action === 'add') {
    return 'border-border/80 bg-background text-foreground hover:border-emerald-300/70 hover:bg-emerald-50/60 data-[state=on]:border-emerald-300 data-[state=on]:bg-emerald-50/90 data-[state=on]:text-emerald-900 dark:border-white/10 dark:bg-slate-950 dark:hover:border-emerald-700/70 dark:hover:bg-emerald-950/20 dark:data-[state=on]:border-emerald-700 dark:data-[state=on]:bg-emerald-950/30 dark:data-[state=on]:text-emerald-100';
  }
  if (action === 'cancel') {
    return 'border-border/80 bg-background text-foreground hover:border-rose-300/70 hover:bg-rose-50/60 data-[state=on]:border-rose-300 data-[state=on]:bg-rose-50/90 data-[state=on]:text-rose-900 dark:border-white/10 dark:bg-slate-950 dark:hover:border-rose-700/70 dark:hover:bg-rose-950/20 dark:data-[state=on]:border-rose-700 dark:data-[state=on]:bg-rose-950/30 dark:data-[state=on]:text-rose-100';
  }
  return 'border-border/80 bg-background text-foreground hover:border-blue-300/70 hover:bg-blue-50/60 data-[state=on]:border-blue-300 data-[state=on]:bg-blue-50/90 data-[state=on]:text-blue-900 dark:border-white/10 dark:bg-slate-950 dark:hover:border-blue-700/70 dark:hover:bg-blue-950/20 dark:data-[state=on]:border-blue-700 dark:data-[state=on]:bg-blue-950/30 dark:data-[state=on]:text-blue-100';
};

export const CambioReviewDialog = ({
  open,
  onOpenChange,
  cambio,
  mode = 'transportista',
  pedido,
  acreedorActual,
  acreedorNuevo,
  loading = false,
  applying = false,
  acceptDisabledReason,
  acceptLabel,
  hasTransportistaChange = false,
  hasMatriculaChange = false,
  onAccept,
  lineasCambio = [],
  lineasPedido = [],
  lineasMatch = {},
  lineasDrafts = {},
  onChangeLineaMatch,
  onChangeLineaDraft,
  onApplyLineas,
  applyingLineas = false,
  lineasApplyDisabledReason,
  lineasApplyLabel,
  lineasApplyHint,
  canCancelPedido = false,
  cancelPedidoLabel,
  cancelPedidoDescription,
  onCancelPedido,
  cancelPedidoLoading = false,
  onChangeMatriculaNueva,
  onSaveMatriculaNueva,
  pdfActualUrl,
  pdfActualLoading = false,
  pdfActualError,
  pdfCambioUrl,
  pdfCambioLoading = false,
  pdfCambioError,
  onChangeAcreedorNuevo,
  summaryLabel,
  contextTitle,
  contextSubtitle,
  onUpdateOrizon,
  updatingOrizon = false,
  canMarkReviewed = false,
  markReviewedLabel,
  markReviewedDescription,
  onMarkReviewed,
  markReviewedLoading = false,
  canCreatePedidoFromCambio = false,
  createPedidoLabel,
  createPedidoDescription,
  onCreatePedidoFromCambio,
  createPedidoLoading = false,
  backToPedidoLabel,
  onBackToPedido,
}: CambioReviewDialogProps) => {
  const headerLabel = cambio?.id ? `Cambio ${cambio.id}` : 'Cambio';
  const referenciaPrimaria = cambio?.referencia_cliente?.trim() || pedido?.referencia_cliente?.trim() || null;
  const referenciaSecundaria = cambio?.referencia2_cliente?.trim() || pedido?.referencia2_cliente?.trim() || null;
  const referenciaLabel = referenciaPrimaria
    ? referenciaSecundaria
      ? `Refs. ${referenciaPrimaria} · ${referenciaSecundaria}`
      : `Ref. ${referenciaPrimaria}`
    : referenciaSecundaria
      ? `Ref. 2 ${referenciaSecundaria}`
      : null;
  const estadoLabel = cambio?.revisado ? 'Revisado' : 'Pendiente';
  const acceptDisabled = !onAccept || !cambio || Boolean(acceptDisabledReason) || loading || applying;
  const lineasDisabled =
    !onApplyLineas || !cambio || Boolean(lineasApplyDisabledReason) || loading || applying || applyingLineas;
  const showHeader = hasTransportistaChange || hasMatriculaChange;
  const pdfFrameClass = 'h-[36vh] min-h-[260px] max-h-[440px]';
  const titleLabel = contextTitle?.trim() || headerLabel;
  const descriptionLabel =
    contextSubtitle?.trim() ||
    referenciaLabel ||
    (showHeader
      ? 'Comparativa rápida para aplicar el cambio de cabecera.'
      : 'Comparativa rápida del cambio recibido.');
  const hasOrizonId = Boolean(resolveOrizonId(pedido?.idpedido_orizon, pedido?.pedidoclienteid));
  const hasPedido = Boolean(pedido?.id);
  const canUpdateOrizon = Boolean(onUpdateOrizon && hasOrizonId && cambio?.revisado);
  const showOrizonMissing = Boolean(onUpdateOrizon && cambio?.revisado && hasPedido && !hasOrizonId);
  const canEditAcreedorNuevo = Boolean(hasTransportistaChange && onChangeAcreedorNuevo && !cambio?.revisado);
  const helperText = showHeader
    ? acceptDisabledReason ??
      (hasTransportistaChange && hasMatriculaChange
        ? 'Actualiza transportista y matrícula con los valores nuevos.'
        : hasTransportistaChange
          ? 'Actualiza el transportista con el valor nuevo.'
          : 'Actualiza la matrícula con el valor nuevo.')
    : acceptDisabledReason ?? 'Revisa los cambios en el PDF antes de continuar.';
  const summaryText = summaryLabel?.trim() || (!showHeader ? 'Cambio de líneas' : null);
  const headerActionLabel = acceptLabel?.trim() || 'Aceptar cambio';
  const showCancelPedido = Boolean(canCancelPedido && onCancelPedido);
  const cancelLabel = cancelPedidoLabel?.trim() || 'Eliminar pedido';
  const cancelDescription =
    cancelPedidoDescription?.trim() ||
    'Todas las líneas del cambio están anuladas. Puedes eliminar el pedido completo.';
  const cancelDisabled = !onCancelPedido || cancelPedidoLoading || loading || applying;
  const lineasSectionVisible = !showCancelPedido && lineasCambio.length > 0;
  const isPrevision = (cambio?.tipo_pedido ?? 'P220') === 'P22E';
  const canEditMatricula = Boolean(hasMatriculaChange && onChangeMatriculaNueva && !cambio?.revisado);
  const showMarkReviewed = Boolean(canMarkReviewed && !cambio?.revisado);
  const markReviewedDisabled = !onMarkReviewed || markReviewedLoading || loading || applying;
  const markReviewedText = markReviewedLabel?.trim() || 'Marcar como revisado';
  const markReviewedHint =
    markReviewedDescription?.trim() || 'Marca el cambio como revisado sin aplicar acciones.';
  const showCreatePedidoFromCambio = Boolean(canCreatePedidoFromCambio && !cambio?.revisado);
  const createPedidoDisabled =
    !onCreatePedidoFromCambio || createPedidoLoading || loading || applying;
  const createPedidoText =
    createPedidoLabel?.trim() || (isPrevision ? 'Crear nueva previsión' : 'Crear nuevo pedido');
  const showResolutionPanel = !showHeader && (showCreatePedidoFromCambio || showMarkReviewed);
  const resolutionPanelDescription = showCreatePedidoFromCambio
    ? isPrevision
      ? 'No se ha encontrado una previsión asociada. Elige si quieres crear una nueva o cerrar este cambio sin aplicarlo.'
      : 'No se ha encontrado un pedido asociado. Elige si quieres crear uno nuevo o cerrar este cambio sin aplicarlo.'
    : markReviewedHint;
  const lineasActionLabel = lineasApplyLabel?.trim() || 'Aplicar cambios de líneas';
  const lineasHintText =
    lineasApplyDisabledReason ?? lineasApplyHint?.trim() ?? 'Revisa los valores antes de aplicar.';
  const matchOptions = lineasPedido.map((linea) => ({
    id: linea.pedidodetid,
    label: `${linea.descripcion_salida || 'Línea sin descripción'} (#${linea.pedidodetid})`,
  }));
  const formatNumeric = (value: number | null | undefined) =>
    value == null ? '-' : String(value);
  const formatText = (value: string | null | undefined) =>
    value && value.trim() ? value.trim() : '-';
  const formatMatricula = (value: string | null | undefined) =>
    value && value.trim() ? value.trim() : 'Sin matrícula';
  const fechaCargaClave = formatFechaClave(cambio?.fecha_carga ?? cambio?.fecha_pedido ?? null);
  const fechaCargaDisplay = fechaCargaClave || 'Sin fecha de carga';
  const referenciaDisplay = referenciaPrimaria || 'Sin referencia';
  const referencia2Display = referenciaSecundaria || 'Sin referencia 2';
  const showHeaderHighlights = Boolean(cambio);
  const openPdfInNewTab = useCallback((url?: string | null) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const [catalogoKilosOptions, setCatalogoKilosOptions] = useState<Record<number, CatConfeckilosOption[]>>({});
  const [catalogoPiezasOptions, setCatalogoPiezasOptions] = useState<Record<number, CatalogoConfeccionPiezaOption[]>>(
    {},
  );
  const [catalogoOptionsLoading, setCatalogoOptionsLoading] = useState<Record<number, boolean>>({});

  const ensureCatalogoOptions = useCallback(
    async (catalogoconfecid: number | null | undefined) => {
      if (!catalogoconfecid) return;
      if (catalogoKilosOptions[catalogoconfecid] && catalogoPiezasOptions[catalogoconfecid]) return;
      if (catalogoOptionsLoading[catalogoconfecid]) return;
      setCatalogoOptionsLoading((prev) => ({ ...prev, [catalogoconfecid]: true }));
      try {
        const [kilos, piezas] = await Promise.all([
          catalogoKilosOptions[catalogoconfecid]
            ? Promise.resolve(catalogoKilosOptions[catalogoconfecid])
            : agroirisCatConfeckilos.getByCatalogo(catalogoconfecid),
          catalogoPiezasOptions[catalogoconfecid]
            ? Promise.resolve(catalogoPiezasOptions[catalogoconfecid])
            : agroirisCatalogoConfeccionPieza.getByCatalogo(catalogoconfecid),
        ]);
        setCatalogoKilosOptions((prev) => ({ ...prev, [catalogoconfecid]: kilos }));
        setCatalogoPiezasOptions((prev) => ({ ...prev, [catalogoconfecid]: piezas }));
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
    lineasCambio.forEach((linea) => {
      if (linea.catalogoconfecid) catalogoIds.add(linea.catalogoconfecid);
    });
    lineasPedido.forEach((linea) => {
      if (linea.catalogoconfecid) catalogoIds.add(linea.catalogoconfecid);
    });
    catalogoIds.forEach((id) => {
      ensureCatalogoOptions(id);
    });
  }, [lineasCambio, lineasPedido, ensureCatalogoOptions]);

  const getKilosOptions = useCallback(
    (catalogoconfecid?: number | null) =>
      catalogoconfecid ? catalogoKilosOptions[catalogoconfecid] ?? [] : [],
    [catalogoKilosOptions],
  );
  const getPiezasOptions = useCallback(
    (catalogoconfecid?: number | null) =>
      catalogoconfecid ? catalogoPiezasOptions[catalogoconfecid] ?? [] : [],
    [catalogoPiezasOptions],
  );
  const isCatalogoLoading = useCallback(
    (catalogoconfecid?: number | null) =>
      catalogoconfecid ? Boolean(catalogoOptionsLoading[catalogoconfecid]) : false,
    [catalogoOptionsLoading],
  );

  const formatCatKilosLabel = useCallback(
    (catalogoId: number | null | undefined, selectedId: number | null | undefined) => {
      if (!selectedId) return 'Sin asignar';
      const option =
        catalogoId && selectedId
          ? getKilosOptions(catalogoId).find((opt) => opt.catconfeckilosbultoid === selectedId)
          : null;
      return option
        ? `${option.kilosxbulto ?? '-'} kg · ID ${option.catconfeckilosbultoid}`
        : `ID: ${selectedId}`;
    },
    [getKilosOptions],
  );

  const formatCatPiezaLabel = useCallback(
    (catalogoId: number | null | undefined, selectedId: number | null | undefined) => {
      if (!selectedId) return 'Sin asignar';
      const option =
        catalogoId && selectedId
          ? getPiezasOptions(catalogoId).find((opt) => opt.catalogoconfeccionpiezaid === selectedId)
          : null;
      return option
        ? `${option.nro_piezas ?? '-'} piezas · ID ${option.catalogoconfeccionpiezaid}`
        : `ID: ${selectedId}`;
    },
    [getPiezasOptions],
  );

  const renderPdfPanel = ({
    title,
    description,
    hasFile,
    url,
    loading: isLoading,
    error,
  }: {
    title: string;
    description: string;
    hasFile: boolean;
    url?: string | null;
    loading: boolean;
    error?: string | null;
  }) => (
    <section className="min-w-0 rounded-md border border-border/70 bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{hasFile ? description : 'Sin PDF asociado.'}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => openPdfInNewTab(url)}
          disabled={!url}
          className="h-8"
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Abrir en pestaña
        </Button>
      </div>
      <div className="p-3">
        {isLoading ? (
          <Skeleton className={`${pdfFrameClass} w-full`} />
        ) : url ? (
          <object
            data={url}
            type="application/pdf"
            className={`${pdfFrameClass} w-full rounded-sm border border-border/60 bg-background`}
          >
            <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
              <p>No se pudo incrustar el PDF.</p>
              <Button variant="outline" size="sm" onClick={() => openPdfInNewTab(url)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir en nueva pestaña
              </Button>
            </div>
          </object>
        ) : (
          <div className={`flex ${pdfFrameClass} items-center justify-center rounded-sm bg-muted/20 text-xs text-muted-foreground`}>
            {error || 'No hay PDF asociado.'}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[min(1680px,96vw)] h-[94vh] max-h-[94vh] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-3xl border border-border/60 p-0 gap-0 shadow-2xl">
        <DialogHeader className="border-b border-border/60 bg-background/80 px-5 pb-4 pt-5 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-7 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle className="text-xl font-semibold">{titleLabel}</DialogTitle>
              <DialogDescription>{descriptionLabel}</DialogDescription>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {onBackToPedido && (
                <Button variant="outline" size="sm" onClick={onBackToPedido}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {backToPedidoLabel?.trim() || 'Volver al pedido'}
                </Button>
              )}
              {cambio && (
                <Badge
                  variant={cambio.revisado ? 'secondary' : 'outline'}
                  className={cambio.revisado ? 'bg-emerald-600/10 text-emerald-700' : ''}
                >
                  {estadoLabel}
                </Badge>
              )}
            </div>
          </div>
          {showHeaderHighlights && (
            <div
              className={`mt-3 grid gap-2 ${isPrevision ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-[minmax(180px,0.75fr)_minmax(0,1.25fr)]'}`}
            >
              <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {isPrevision ? 'Fecha de carga de la previsión' : 'Fecha de carga'}
                </p>
                <p className="mt-1 text-sm font-semibold leading-tight text-foreground">{fechaCargaDisplay}</p>
              </div>
              {!isPrevision && (
                <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                  <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Tag className="h-3.5 w-3.5" />
                    Referencias cliente
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Referencia 1</p>
                      <p className="text-sm font-semibold text-foreground break-all">{referenciaDisplay}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Referencia 2</p>
                      <p className="text-sm font-semibold text-foreground break-all">{referencia2Display}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7 lg:px-8">
        {loading ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <Skeleton className={`${pdfFrameClass} w-full`} />
            <Skeleton className={`${pdfFrameClass} w-full`} />
          </div>
        ) : (
          <>
            {showHeader || canUpdateOrizon || showOrizonMissing || showResolutionPanel ? (
              <section className="mb-4 rounded-md border border-border/70 bg-muted/20 px-4 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {summaryText || (showHeader ? 'Cambio de cabecera' : 'Resolución del cambio')}
                    </p>
                    {!showResolutionPanel && (
                      <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {showHeader && (
                      <Button onClick={onAccept} disabled={acceptDisabled} size="sm">
                        {applying ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Aplicando
                          </>
                        ) : (
                          <>
                            <ArrowRight className="mr-2 h-4 w-4" />
                            {headerActionLabel}
                          </>
                        )}
                      </Button>
                    )}
                    {canUpdateOrizon && (
                      <Button variant="outline" size="sm" onClick={onUpdateOrizon} disabled={updatingOrizon}>
                        {updatingOrizon ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Actualizando
                          </>
                        ) : (
                          'Actualizar en Orizon'
                        )}
                      </Button>
                    )}
                    {showOrizonMissing && (
                      <p className="text-xs text-muted-foreground">Pedido no está en Orizon.</p>
                    )}
                  </div>
                </div>

                {showResolutionPanel ? (
                  <div className="mt-3 border-t border-border/70 pt-3">
                    <p className="text-xs leading-5 text-muted-foreground">{resolutionPanelDescription}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {showCreatePedidoFromCambio && (
                        <Button size="sm" onClick={onCreatePedidoFromCambio} disabled={createPedidoDisabled}>
                          {createPedidoLoading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Preparando
                            </>
                          ) : (
                            <>
                              <Plus className="mr-2 h-4 w-4" />
                              {createPedidoText}
                            </>
                          )}
                        </Button>
                      )}
                      {showMarkReviewed && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onMarkReviewed}
                          disabled={markReviewedDisabled}
                        >
                          {markReviewedLoading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Marcando
                            </>
                          ) : (
                            markReviewedText
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {showHeader && (
              <section className="mb-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-border/70 bg-background px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Estado actual</p>
                  <div className="mt-3 space-y-3">
                    {hasTransportistaChange && (
                      <div>
                        <p className="text-xs text-muted-foreground">Transportista actual</p>
                        <p className="text-sm font-semibold">
                          {formatAcreedorLabel(acreedorActual, pedido ? 'Sin transportista' : 'Sin pedido asociado')}
                        </p>
                      </div>
                    )}
                    {hasMatriculaChange && (
                      <div className="grid gap-2 text-sm sm:grid-cols-2">
                        <div>
                          <p className="text-xs text-muted-foreground">Tractora</p>
                          <p className="font-semibold">{formatMatricula(pedido?.matricula_tractora)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Remolque</p>
                          <p className="font-semibold">{formatMatricula(pedido?.matricula_remolque)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-border/70 bg-background px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Valor recibido</p>
                  <div className="mt-3 space-y-3">
                    {hasTransportistaChange && (
                      <div>
                        <p className="text-xs text-muted-foreground">Transportista nuevo</p>
                        {onChangeAcreedorNuevo ? (
                          <AcreedorCombobox
                            value={acreedorNuevo?.id ?? null}
                            onChange={onChangeAcreedorNuevo}
                            disabled={!canEditAcreedorNuevo}
                          />
                        ) : (
                          <p className="text-sm font-semibold">
                            {formatAcreedorLabel(acreedorNuevo, 'Sin nuevo transportista')}
                          </p>
                        )}
                      </div>
                    )}
                    {hasMatriculaChange && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {canEditMatricula ? (
                          <>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Tractora</Label>
                              <Input
                                value={cambio?.matricula_tractora ?? ''}
                                onChange={(event) => {
                                  if (!onChangeMatriculaNueva) return;
                                  onChangeMatriculaNueva('matricula_tractora', event.target.value);
                                }}
                                onBlur={(event) => {
                                  if (!onSaveMatriculaNueva) return;
                                  onSaveMatriculaNueva('matricula_tractora', event.target.value);
                                }}
                                placeholder="Sin matrícula"
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Remolque</Label>
                              <Input
                                value={cambio?.matricula_remolque ?? ''}
                                onChange={(event) => {
                                  if (!onChangeMatriculaNueva) return;
                                  onChangeMatriculaNueva('matricula_remolque', event.target.value);
                                }}
                                onBlur={(event) => {
                                  if (!onSaveMatriculaNueva) return;
                                  onSaveMatriculaNueva('matricula_remolque', event.target.value);
                                }}
                                placeholder="Sin matrícula"
                                className="h-8 text-sm"
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <div>
                              <p className="text-xs text-muted-foreground">Tractora</p>
                              <p className="text-sm font-semibold">{formatMatricula(cambio?.matricula_tractora)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-muted-foreground">Remolque</p>
                              <p className="text-sm font-semibold">{formatMatricula(cambio?.matricula_remolque)}</p>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              {renderPdfPanel({
                title: 'PDF actual',
                description: 'Documento del pedido/previsión actual.',
                hasFile: Boolean(pedido?.archivo_pdf_id),
                url: pdfActualUrl,
                loading: pdfActualLoading,
                error: pdfActualError,
              })}
              {renderPdfPanel({
                title: 'PDF del cambio',
                description: 'Documento recibido con los cambios.',
                hasFile: Boolean(cambio?.archivo_pdf_id),
                url: pdfCambioUrl,
                loading: pdfCambioLoading,
                error: pdfCambioError,
              })}
            </div>

            {showCancelPedido && (
              <section className="mt-6 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">{cancelLabel}</h3>
                    <p className="text-xs text-muted-foreground">{cancelDescription}</p>
                  </div>
                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    <Button variant="destructive" onClick={onCancelPedido} disabled={cancelDisabled}>
                      {cancelPedidoLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Eliminando
                        </>
                      ) : (
                        cancelLabel
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      Se eliminará el pedido/previsión y se marcará el cambio como revisado.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {lineasSectionVisible && (
              <section className="mt-5 space-y-4 border-t border-border/70 pt-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold">Cambios de líneas</h3>
                    <p className="text-xs text-muted-foreground">
                      Empareja cada línea con la original y ajusta los valores nuevos antes de aplicar.
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-1 sm:items-end">
                    <Button size="sm" onClick={onApplyLineas} disabled={lineasDisabled}>
                      {applyingLineas ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Aplicando
                        </>
                      ) : (
                        lineasActionLabel
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {lineasHintText}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  {lineasCambio.map((linea, index) => {
                    const matchedId = lineasMatch[linea.pedidodetid] ?? null;
                    const matchedLinea =
                      lineasPedido.find((item) => item.pedidodetid === matchedId) ?? null;
                    const catalogoId = linea.catalogoconfecid ?? matchedLinea?.catalogoconfecid ?? null;
                    const draft = lineasDrafts[linea.pedidodetid];
                    const originalAction = normalizeLineaAction(
                      (linea.change_meta as { _change?: { action?: string } } | null)?._change?.action ??
                        linea.accion ??
                        'update',
                    );
                    const action = normalizeLineaAction(draft?.action ?? originalAction);
                    const actionLabel = getLineaActionLabel(action);
                    const originalActionLabel = getLineaActionLabel(originalAction);
                    const actionTargetLabel = isPrevision ? 'previsión' : 'pedido';
                    const actionTargetOwnershipLabel = isPrevision ? 'la previsión' : 'el pedido';
                    const actionDescription = getLineaActionDescription(action, actionTargetLabel);
                    const actionToneClass = getLineaActionBadgeClass(action);
                    const isAddAction = action === 'add';
                    const isCancelAction = action === 'cancel';
                    const isActionOverridden = action !== originalAction;
                    const readonly =
                      !onChangeLineaDraft ||
                      !onChangeLineaMatch ||
                      Boolean(
                        cambio?.revisado ||
                          lineasApplyDisabledReason?.includes('Lineas ya aplicadas') ||
                          lineasApplyDisabledReason?.includes('Líneas ya aplicadas'),
                      );

                    return (
                      <div key={linea.pedidodetid} className="rounded-md border border-border/70 bg-background">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                          <div className="min-w-0 space-y-1">
                            <p className="text-sm font-semibold">
                              Línea #{index + 1} {linea.descripcion_salida ? `- ${linea.descripcion_salida}` : ''}
                            </p>
                            {matchedLinea ? (
                              <p className="text-xs text-muted-foreground">
                                Actual: {matchedLinea.descripcion_salida || 'Sin descripción'}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">Sin línea emparejada.</p>
                            )}
                          </div>
                          <Badge variant="outline" className={`text-xs ${actionToneClass}`}>
                            {actionLabel}
                          </Badge>
                        </div>

                        <div className="space-y-4 p-4">
                          <div className="border-b border-border/70 pb-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Tratamiento de la línea
                              </Label>
                              <span className="text-xs text-muted-foreground">
                                Propuesta automática: <span className="font-medium text-foreground">{originalActionLabel}</span>
                                {isActionOverridden ? ` · selección actual: ${actionLabel}` : ''}
                              </span>
                            </div>

                            <ToggleGroup
                              type="single"
                              value={action}
                              onValueChange={(value) => {
                                if (!value || !onChangeLineaDraft) return;
                                onChangeLineaDraft(
                                  linea.pedidodetid,
                                  'action',
                                  normalizeLineaAction(value),
                                );
                              }}
                              className="mt-3 grid w-full grid-cols-1 gap-2 sm:grid-cols-3"
                              disabled={readonly}
                            >
                              <ToggleGroupItem
                                value="add"
                                variant="outline"
                                size="sm"
                                className={`h-10 w-full justify-start rounded-md px-3 text-left ${getLineaActionToggleClass('add')} ${originalAction === 'add' ? 'ring-1 ring-primary/20 ring-offset-0' : ''}`}
                                disabled={readonly}
                              >
                                <Plus className="mr-2 h-4 w-4" />
                                <span className="font-semibold">Añadir</span>
                              </ToggleGroupItem>
                              <ToggleGroupItem
                                value="update"
                                variant="outline"
                                size="sm"
                                className={`h-10 w-full justify-start rounded-md px-3 text-left ${getLineaActionToggleClass('update')} ${originalAction === 'update' ? 'ring-1 ring-primary/20 ring-offset-0' : ''}`}
                                disabled={readonly}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                <span className="font-semibold">Editar</span>
                              </ToggleGroupItem>
                              <ToggleGroupItem
                                value="cancel"
                                variant="outline"
                                size="sm"
                                className={`h-10 w-full justify-start rounded-md px-3 text-left ${getLineaActionToggleClass('cancel')} ${originalAction === 'cancel' ? 'ring-1 ring-primary/20 ring-offset-0' : ''}`}
                                disabled={readonly}
                              >
                                <Ban className="mr-2 h-4 w-4" />
                                <span className="font-semibold">Anular</span>
                              </ToggleGroupItem>
                            </ToggleGroup>

                            <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${actionToneClass}`}>
                              {actionDescription}
                            </div>
                          </div>

                          {!isAddAction && (
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                                {isCancelAction ? 'Línea a anular' : 'Línea a editar'}
                              </Label>
                              <Select
                                value={matchedId ? String(matchedId) : 'none'}
                                onValueChange={(value) => {
                                  if (!onChangeLineaMatch) return;
                                  onChangeLineaMatch(
                                    linea.pedidodetid,
                                    value === 'none' ? null : Number(value),
                                  );
                                }}
                                disabled={readonly}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder="Selecciona una línea" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Sin emparejar</SelectItem>
                                  {matchOptions.map((option) => (
                                    <SelectItem key={option.id} value={String(option.id)}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}

                          <div className="overflow-x-auto">
                            <div className="grid min-w-[720px] grid-cols-[minmax(130px,0.75fr)_minmax(130px,1fr)_minmax(220px,1fr)] items-center gap-x-4 gap-y-1 text-sm">
                              <div className="border-b border-border/70 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campo</div>
                              <div className="border-b border-border/70 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actual</div>
                              <div className="border-b border-border/70 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nuevo</div>
                              {([
                                { key: 'bultos', label: 'Bultos' },
                                { key: 'bultosxpalet', label: 'Bultos x palet' },
                                { key: 'numero_palet', label: 'Número palet' },
                                { key: 'piezasxbulto', label: 'Piezas x bulto' },
                                { key: 'total_piezas', label: 'Total piezas' },
                                { key: 'kilosxbulto', label: 'Kilos x bulto' },
                                { key: 'kilos_cliente', label: 'Kilos cliente' },
                                { key: 'ean_pieza', label: 'EAN pieza' },
                                { key: 'ean_caja', label: 'EAN caja' },
                                { key: 'nlote_cliente', label: 'Número de lote' },
                                { key: 'precio_venta', label: 'Precio venta' },
                                { key: 'catconfeckilosbultoid', label: 'Cat. conf. kilos' },
                                { key: 'catconfecpiezaid', label: 'Cat. conf. pieza' },
                              ] as { key: Exclude<keyof LineaCambioDraft, 'action'>; label: string }[]).map((field) => (
                                <div key={field.key} className="contents">
                                  <div className="border-b border-border/40 py-2 text-muted-foreground">{field.label}</div>
                                  <div className="border-b border-border/40 py-2 font-medium">
                                    {field.key === 'catconfeckilosbultoid'
                                      ? formatCatKilosLabel(
                                          catalogoId,
                                          matchedLinea ? (matchedLinea as any)[field.key] : null,
                                        )
                                      : field.key === 'catconfecpiezaid'
                                        ? formatCatPiezaLabel(
                                            catalogoId,
                                            matchedLinea ? (matchedLinea as any)[field.key] : null,
                                          )
                                        : field.key === 'ean_pieza'
                                          ? formatText(
                                              normalizeEanText(
                                                matchedLinea
                                                  ? (matchedLinea as any).ean_pieza ??
                                                    (matchedLinea as any).ean_bulto ??
                                                    (matchedLinea as any).ean ??
                                                    null
                                                  : null,
                                              ),
                                            )
                                        : field.key === 'ean_caja'
                                          ? formatText(
                                              normalizeEanText(matchedLinea ? (matchedLinea as any)[field.key] : null),
                                            )
                                        : field.key === 'nlote_cliente'
                                          ? formatText(matchedLinea ? (matchedLinea as any)[field.key] : null)
                                        : formatNumeric(matchedLinea ? (matchedLinea as any)[field.key] : null)}
                                  </div>
                                  <div className="border-b border-border/40 py-1">
                                    {field.key === 'catconfeckilosbultoid' || field.key === 'catconfecpiezaid' ? (
                                      <Select
                                        value={draft?.[field.key] ? String(draft?.[field.key]) : 'unset'}
                                        onValueChange={(value) => {
                                          if (!onChangeLineaDraft) return;
                                          const selectedId = value === 'unset' ? null : Number(value);
                                          onChangeLineaDraft(linea.pedidodetid, field.key, selectedId);
                                          if (field.key === 'catconfeckilosbultoid') {
                                            const option =
                                              catalogoId && selectedId
                                                ? getKilosOptions(catalogoId).find(
                                                    (opt) => opt.catconfeckilosbultoid === selectedId,
                                                  )
                                                : null;
                                            onChangeLineaDraft(
                                              linea.pedidodetid,
                                              'kilosxbulto',
                                              option?.kilosxbulto ?? null,
                                            );
                                          } else if (field.key === 'catconfecpiezaid') {
                                            const option =
                                              catalogoId && selectedId
                                                ? getPiezasOptions(catalogoId).find(
                                                    (opt) => opt.catalogoconfeccionpiezaid === selectedId,
                                                  )
                                                : null;
                                            onChangeLineaDraft(
                                              linea.pedidodetid,
                                              'piezasxbulto',
                                              option?.nro_piezas ?? null,
                                            );
                                          }
                                        }}
                                        disabled={readonly || isCancelAction || !catalogoId || isCatalogoLoading(catalogoId)}
                                      >
                                        <SelectTrigger className="h-8 text-xs">
                                          <SelectValue
                                            placeholder={
                                              catalogoId
                                                ? isCatalogoLoading(catalogoId)
                                                  ? 'Cargando...'
                                                  : 'Selecciona'
                                                : 'Sin catálogo'
                                            }
                                          />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="unset">Sin asignar</SelectItem>
                                          {(field.key === 'catconfeckilosbultoid'
                                            ? getKilosOptions(catalogoId)
                                            : getPiezasOptions(catalogoId)
                                          ).map((option) => {
                                            const optionId =
                                              field.key === 'catconfeckilosbultoid'
                                                ? (option as CatConfeckilosOption).catconfeckilosbultoid
                                                : (option as CatalogoConfeccionPiezaOption)
                                                    .catalogoconfeccionpiezaid;
                                            return (
                                              <SelectItem key={optionId} value={String(optionId)}>
                                                {field.key === 'catconfeckilosbultoid'
                                                  ? `${(option as CatConfeckilosOption).kilosxbulto ?? '-'} kg · ID ${optionId}`
                                                  : `${(option as CatalogoConfeccionPiezaOption).nro_piezas ?? '-'} piezas · ID ${optionId}`}
                                              </SelectItem>
                                            );
                                          })}
                                        </SelectContent>
                                      </Select>
                                    ) : field.key === 'ean_pieza' || field.key === 'ean_caja' || field.key === 'nlote_cliente' ? (
                                      <Input
                                        type="text"
                                        value={typeof draft?.[field.key] === 'string' ? draft?.[field.key] : ''}
                                        onChange={(event) => {
                                          if (!onChangeLineaDraft) return;
                                          const raw = event.target.value.trim();
                                          onChangeLineaDraft(
                                            linea.pedidodetid,
                                            field.key,
                                            raw === '' ? null : raw,
                                          );
                                        }}
                                        disabled={readonly || isCancelAction}
                                        className="h-8"
                                        placeholder={
                                          field.key === 'ean_pieza'
                                            ? 'Sin EAN pieza'
                                            : field.key === 'ean_caja'
                                              ? 'Sin EAN caja'
                                              : 'Sin lote'
                                        }
                                      />
                                    ) : (
                                      <Input
                                        type="number"
                                        step="any"
                                        value={typeof draft?.[field.key] === 'number' ? draft?.[field.key] : ''}
                                        onChange={(event) => {
                                          if (!onChangeLineaDraft) return;
                                          const raw = event.target.value;
                                          const parsed = raw === '' ? null : Number(raw);
                                          const nextValue = parsed === null || Number.isFinite(parsed) ? parsed : null;
                                          onChangeLineaDraft(linea.pedidodetid, field.key, nextValue);
                                        }}
                                        disabled={readonly || isCancelAction}
                                        className="h-8"
                                      />
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default CambioReviewDialog;
