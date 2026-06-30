import { useState, useMemo, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Trash2, Send, Filter, X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, AlertTriangle, Package, FileText, Calendar as CalendarIcon, Truck, RefreshCw, Clock } from 'lucide-react';
import { usePersistedState, usePageUnload } from '@/hooks/usePersistedState';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ClientCombobox } from '@/components/ClientCombobox';
import { DomicilioCombobox } from '@/components/DomicilioCombobox';
import { PedidoDetailsDialog } from '@/components/PedidoDetailsDialog';
import { PdfGroup } from '@/components/PdfGroup';
import CambioReviewDialog from '@/components/CambioReviewDialog';
import { ManualPedidoDialog } from '@/components/ManualPedidoDialog';
import { usePedidosData } from '@/hooks/usePedidosData';
import { usePedidoDetails } from '@/hooks/usePedidoDetails';
import { usePedidoFilters } from '@/hooks/usePedidoFilters';
import { useGroupedPedidos } from '@/hooks/useGroupedPedidos';
import { useAuth } from '@/hooks/useAuth';
import { useUserLabels } from '@/hooks/useUserLabels';
import type {
  TipoPedido,
  Pedido,
  PedidoWithMatch,
  NewPedidoLineaDraft,
  PedidoLineaClipboard,
  CeoxStatusFilter,
} from '@/types/pedidos';
import type { CambioPedido } from '@/types/cambios';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { agroirisAuth } from '@/services/agroirisAuth';
import { agroirisAcreedores } from '@/services/agroirisAcreedores';
import { agroirisPicking, type PickingRequest } from '@/services/agroirisPicking';
import { sendPedidoToOrizon } from '@/services/agroirisPedidos';
import { formatDateSafe } from '@/utils/dateSafe';
import { hasNonEmptyMeta, resolveAcreedorId, updateCambioMetaAcreedor } from '@/utils/cambioMeta';
import { parseOrizonId, resolveOrizonId } from '@/utils/orizon';
import { normalizeApiNumber } from '@/utils/number';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as DateRangeCalendar } from '@/components/ui/calendar';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { buildCambioDetailPath, buildPedidoDetailPath, getPedidoBasePath } from '@/utils/entityRoutes';


interface UnifiedPedidosViewProps {
  tipoPedido: TipoPedido;
  title: string;
  emptyMessage: string;
}

export const UnifiedPedidosView = ({ tipoPedido, title, emptyMessage }: UnifiedPedidosViewProps) => {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { pedidoId: routePedidoIdParam } = useParams<{ pedidoId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const pedidosBasePath = getPedidoBasePath(tipoPedido);
  const [showFilters, setShowFilters] = usePersistedState(`agroiris_${tipoPedido}_showFilters`, true, localStorage);
  const [dialogOpen, setDialogOpen] = usePersistedState(`agroiris_${tipoPedido}_dialogOpen`, false, localStorage);
  const [selectedPedidoId, setSelectedPedidoId] = usePersistedState<number | null>(`agroiris_${tipoPedido}_selectedPedidoId`, null, localStorage);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pedidoToDelete, setPedidoToDelete] = useState<Pedido | null>(null);
  const [deletingPedido, setDeletingPedido] = useState(false);
  const [deleteGroupDialogOpen, setDeleteGroupDialogOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<{ archivoPdfId: number | null; pedidos: PedidoWithMatch[] } | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [deletingGroupProgress, setDeletingGroupProgress] = useState<{ done: number; total: number } | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedPedido, setEditedPedido] = useState<any>({});
  const [editedLineas, setEditedLineas] = useState<any>({});
  const [editedCentros, setEditedCentros] = useState<any>({});
  const [newCentros, setNewCentros] = useState<Record<string, Array<{ tempId: string; asignacion: string; numero_palets: number | null; subprov: number | null; accepted?: boolean }>>>({});
  const [deletedCentros, setDeletedCentros] = useState<number[]>([]);
  const [editingLineaId, setEditingLineaId] = useState<number | null>(null);
  const [sendingPedidoId, setSendingPedidoId] = useState<number | null>(null);
  const [cambioDialogOpen, setCambioDialogOpen] = useState(false);
  const [cambioDialogLoading, setCambioDialogLoading] = useState(false);
  const [cambioDialogCambio, setCambioDialogCambio] = useState<CambioPedido | null>(null);
  const buildReviewUpdate = useCallback(
    () => ({
      revisado: true,
      revisado_por: user?.id ?? null,
      revisado_en: new Date().toISOString(),
    }),
    [user?.id],
  );
  const [cambioDialogPedido, setCambioDialogPedido] = useState<Pedido | null>(null);
  const [cambioDialogApplying, setCambioDialogApplying] = useState(false);
  const [cambioDialogMode, setCambioDialogMode] = useState<'transportista' | 'lineas' | 'cabecera'>('transportista');
  const [cambioDialogAcreedorActual, setCambioDialogAcreedorActual] = useState<{
    id: number | null;
    label: string | null;
  } | null>(null);
  const [cambioDialogAcreedorNuevo, setCambioDialogAcreedorNuevo] = useState<{
    id: number | null;
    label: string | null;
  } | null>(null);
  const [cambioDialogDisabledReason, setCambioDialogDisabledReason] = useState<string | null>(null);
  const [cambioDialogPdfActualUrl, setCambioDialogPdfActualUrl] = useState<string | null>(null);
  const [cambioDialogPdfActualLoading, setCambioDialogPdfActualLoading] = useState(false);
  const [cambioDialogPdfActualError, setCambioDialogPdfActualError] = useState<string | null>(null);
  const [cambioDialogPdfCambioUrl, setCambioDialogPdfCambioUrl] = useState<string | null>(null);
  const [cambioDialogPdfCambioLoading, setCambioDialogPdfCambioLoading] = useState(false);
  const [cambioDialogPdfCambioError, setCambioDialogPdfCambioError] = useState<string | null>(null);
  const [selectedCambioHasMeta, setSelectedCambioHasMeta] = useState<boolean | null>(null);
  const [newLineas, setNewLineas] = useState<NewPedidoLineaDraft[]>([]);
  const [lineaToRemove, setLineaToRemove] = useState<number | null>(null);
  const [lineaToRemoveDescripcion, setLineaToRemoveDescripcion] = useState<string | null>(null);
  const [lineaToRemoveOrizonId, setLineaToRemoveOrizonId] = useState<number | null>(null);
  const [showDeleteLineaDialog, setShowDeleteLineaDialog] = useState(false);
  const [previousPedidoId, setPreviousPedidoId] = useState<number | null>(null);
  const [navigatingToRelated, setNavigatingToRelated] = useState(false);
  const [loadingPrevisionPedidoId, setLoadingPrevisionPedidoId] = useState<number | null>(null);
  const [pickingBlockedIds, setPickingBlockedIds] = useState<Set<number>>(new Set());
  const [lineClipboard, setLineClipboard] = useState<PedidoLineaClipboard | null>(null);
  const [clientesConPedidos, setClientesConPedidos] = useState<Set<number> | null>(null);
  const [autoOpenPickingPedidoId, setAutoOpenPickingPedidoId] = useState<number | null>(null);
  const [pickingConfirmOpen, setPickingConfirmOpen] = useState(false);
  const [pickingPayload, setPickingPayload] = useState<PickingRequest[] | null>(null);
  const [pickingPedidoId, setPickingPedidoId] = useState<number | null>(null);
  const [pickingSending, setPickingSending] = useState(false);
  const [manualPedidoDialogOpen, setManualPedidoDialogOpen] = useState(false);
  const [manualAllowedClientIds, setManualAllowedClientIds] = useState<Set<number> | null>(null);
  const handleCopyLineaToClipboard = (clip: PedidoLineaClipboard) => {
    setLineClipboard(clip);
    toast({
      title: 'Línea copiada',
      description: clip.label,
    });
  };

  const buildAcreedorInfo = useCallback(async (id: number | null) => {
    if (!id) return { id: null, label: null };
    const acreedor = await agroirisAcreedores.getAcreedorById(id);
    const label =
      acreedor?.nombre_comercial?.trim() ||
      acreedor?.nombre_sujeto?.trim() ||
      acreedor?.identificador_fiscal?.trim() ||
      null;
    return { id, label };
  }, []);

  const loadPdfPreview = useCallback(
    async (
      archivoPdfId: number | null,
      setUrl: Dispatch<SetStateAction<string | null>>,
      setLoading: Dispatch<SetStateAction<boolean>>,
      setError: Dispatch<SetStateAction<string | null>>,
    ) => {
      if (!archivoPdfId) {
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        setError('No hay PDF asociado.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from('archivos_pdf')
          .select('b64_contenido')
          .eq('id', archivoPdfId)
          .single();
        if (error) throw error;
        if (!data?.b64_contenido) {
          setUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
          setError('No se encontró el PDF.');
          return;
        }
        const byteCharacters = atob(data.b64_contenido);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch (err) {
        console.error('Error cargando PDF', err);
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        setError('No se pudo cargar el PDF.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const checkCambioHasMeta = useCallback(
    async (cambioId: number): Promise<boolean> => {
      const { data: header, error: headerError } = await supabase
        .from('cambios_pedidos')
        .select('change_meta')
        .eq('id', cambioId)
        .single();
      if (headerError) throw headerError;
      if (hasNonEmptyMeta(header?.change_meta)) return true;

      const { data: lineasMeta, error: lineasError } = await supabase
        .from('cambios_pedido_linea')
        .select('change_meta')
        .eq('pedidoid', cambioId)
        .not('change_meta', 'is', null);
      if (lineasError) throw lineasError;
      return (lineasMeta ?? []).some((linea) => hasNonEmptyMeta(linea.change_meta));
    },
    [],
  );

  const handleCloseCambioDialog = useCallback((open: boolean) => {
    setCambioDialogOpen(open);
    if (!open) {
      setCambioDialogCambio(null);
      setCambioDialogPedido(null);
      setCambioDialogAcreedorActual(null);
      setCambioDialogAcreedorNuevo(null);
      setCambioDialogDisabledReason(null);
      setCambioDialogMode('transportista');
      setCambioDialogLoading(false);
      setCambioDialogApplying(false);
      setCambioDialogPdfActualUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setCambioDialogPdfActualLoading(false);
      setCambioDialogPdfActualError(null);
      setCambioDialogPdfCambioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setCambioDialogPdfCambioLoading(false);
      setCambioDialogPdfCambioError(null);
    }
  }, []);

  const updatePedidoLineaDescripcion = async (pedidodetid: number, nuevaDescripcion: string) => {
    try {
      const { error } = await supabase
        .from('pedido_linea')
        .update({ descripcion_salida: nuevaDescripcion })
        .eq('pedidodetid', pedidodetid);
      if (error) throw error;

      // Refrescar estado local si corresponde
      setSelectedPedido((prev) => {
        if (!prev?.lineas) return prev;
        const updated = prev.lineas.map((l) =>
          l.pedidodetid === pedidodetid ? { ...l, descripcion_salida: nuevaDescripcion } : l,
        );
        return { ...prev, lineas: updated };
      });
    } catch (error) {
      console.error('No se pudo actualizar la descripción localmente', error);
    }
  };
  const [pendingPedidoId, setPendingPedidoId] = useState<number | null>(null);
  const [pendingCambioId, setPendingCambioId] = useState<number | null>(null);
  const [pendingAutoUpdateId, setPendingAutoUpdateId] = useState<number | null>(null);

  const navigateToPedidoDetail = useCallback(
    (pedidoId: number, options?: { replace?: boolean; nextSearchParams?: URLSearchParams }) => {
      const resolvedSearchParams = options?.nextSearchParams ?? new URLSearchParams(searchParams);
      const nextSearch = resolvedSearchParams.toString();
      navigate(
        {
          pathname: buildPedidoDetailPath(pedidoId, tipoPedido),
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: options?.replace ?? false },
      );
    },
    [navigate, searchParams, tipoPedido],
  );

  const navigateToPedidosList = useCallback(
    (options?: { replace?: boolean; nextSearchParams?: URLSearchParams }) => {
      const resolvedSearchParams = options?.nextSearchParams ?? new URLSearchParams(searchParams);
      const nextSearch = resolvedSearchParams.toString();
      navigate(
        {
          pathname: pedidosBasePath,
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: options?.replace ?? false },
      );
    },
    [navigate, pedidosBasePath, searchParams],
  );
  type PedidoMatchInfo = {
    matching_cambio_id?: number | null;
    matching_cambio_revisado?: boolean | null;
    matching_prevision_id?: number | null;
    matching_prevision_uploaded?: boolean | null;
  };
  const [selectedPedidoMatchInfo, setSelectedPedidoMatchInfo] = useState<PedidoMatchInfo | null>(null);

  const markPedidoNeedsSync = useCallback(async (pedidoId: number) => {
    const { error } = await supabase
      .from('pedidos')
      .update({ needs_sync: true })
      .eq('id', pedidoId);

    if (error) {
      console.error('Error marcando pedido como desactualizado:', error);
    }
  }, []);

  const extractMatchInfo = useCallback(
    (pedido?: PedidoWithMatch | null): PedidoMatchInfo | null => {
      if (!pedido) return null;
      return {
        matching_cambio_id: pedido.matching_cambio_id ?? null,
        matching_cambio_revisado: pedido.matching_cambio_revisado ?? null,
        matching_prevision_id: pedido.matching_prevision_id ?? null,
        matching_prevision_uploaded: pedido.matching_prevision_uploaded ?? null,
      };
    },
    [],
  );

  const {
    selectedPedido,
    setSelectedPedido,
    loadingDetails,
    loadingPedidoId,
    fetchPedidoDetails,
    clearDetails,
    clienteNombre,
    clienteEnvioNombre,
    divisaNombre,
    clienteDivisaId,
    clienteDivisaNombre,
    serieDescripcion,
    comercialNombre,
    acreedorNombre,
    domicilioDestinoNombre,
    domicilioEnvioNombre,
    generoNombres,
    calibreNombres,
    origenNombres,
    tipoCultivoNombres,
    catalogoConfecNombres,
    grupoConfeccionNombres,
    confeccionPaletNombres,
    confeccionSalidaNombres,
    pdfBase64,
    pdfCompartidoCount,
  } = usePedidoDetails();

  const {
    filters,
    updateFilter,
    clearFilters,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    setItemsPerPage,
  } = usePedidoFilters(10);

  // Custom hooks
  const {
    pedidos,
    totalGroups,
    totalPedidos,
    totalPages: totalGroupPages,
    loading,
    refreshing,
    error: pedidosError,
    incompleteDataPedidos,
    domicilioNombres,
    domicilioPlataformas,
    clienteNombres,
    fetchPedidos,
    deletePedido: deleteFromDb,
  } = usePedidosData({
    tipoPedido,
    filters,
    page: currentPage,
    pageSize: itemsPerPage,
  });

  const sentByUserIds = useMemo(
    () =>
      pedidos
        .map((pedido) => pedido.enviado_por)
        .filter((userId): userId is string => typeof userId === 'string' && userId.trim().length > 0),
    [pedidos],
  );

  const { labelsById: sentByUserLabels } = useUserLabels(sentByUserIds, isAdmin);

  useEffect(() => {
    if (tipoPedido !== 'P220') {
      setManualAllowedClientIds(null);
      return;
    }

    let active = true;
    const fetchManualAllowedClientIds = async () => {
      try {
        const { data, error } = await supabase.rpc('list_clientes_visibles');
        if (error) throw error;

        const ids = new Set<number>();
        (data ?? []).forEach((row: { clienteid: number | null }) => {
          if (typeof row.clienteid === 'number' && row.clienteid > 0) {
            ids.add(row.clienteid);
          }
        });

        if (active) setManualAllowedClientIds(ids);
      } catch (error) {
        console.error('Error cargando clientes permitidos para insercion manual:', error);
        if (active) setManualAllowedClientIds(null);
      }
    };

    void fetchManualAllowedClientIds();
    return () => {
      active = false;
    };
  }, [tipoPedido]);

  useEffect(() => {
    const cambioId =
      selectedPedidoMatchInfo?.matching_cambio_id ?? (selectedPedido as any)?.matching_cambio_id ?? null;
    if (!dialogOpen || !cambioId) {
      setSelectedCambioHasMeta(null);
      return;
    }
    let active = true;
    setSelectedCambioHasMeta(null);
    checkCambioHasMeta(cambioId)
      .then((hasMeta) => {
        if (active) setSelectedCambioHasMeta(hasMeta);
      })
      .catch((error) => {
        console.error('Error verificando metadatos del cambio', error);
        if (active) setSelectedCambioHasMeta(null);
      });
    return () => {
      active = false;
    };
  }, [checkCambioHasMeta, dialogOpen, selectedPedido, selectedPedidoMatchInfo]);

  const openCambioDialogFromPedido = useCallback(async () => {
    const cambioId =
      selectedPedidoMatchInfo?.matching_cambio_id ?? (selectedPedido as any)?.matching_cambio_id ?? null;
    if (!cambioId || !selectedPedido) return;

    setDialogOpen(false);
    setSelectedPedidoId(null);
    setSelectedPedido(null);
    setSelectedPedidoMatchInfo(null);
    setSelectedCambioHasMeta(null);
    clearDetails();
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('volver_pedido', String(selectedPedido.id));
    nextSearchParams.set('volver_tipo', selectedPedido.tipo_pedido === 'P22E' ? 'P22E' : 'P220');
    const nextSearch = nextSearchParams.toString();
    navigate({
      pathname: buildCambioDetailPath(cambioId),
      search: nextSearch ? `?${nextSearch}` : '',
    });
  }, [
    clearDetails,
    navigate,
    searchParams,
    selectedPedido,
    selectedPedidoMatchInfo,
    setDialogOpen,
    setSelectedPedido,
    setSelectedPedidoId,
  ]);

  const cambioDialogContext = useMemo(() => {
    const cambioTipo = cambioDialogCambio?.tipo_pedido ?? selectedPedido?.tipo_pedido ?? null;
    const isPrevision = cambioTipo === 'P22E';
    const base = isPrevision ? 'Cambio en la Previsión' : 'Cambio en el Pedido';

    const domicilioId =
      selectedPedido?.sujetodomicilioid_destino ?? cambioDialogCambio?.sujetodomicilioid_destino ?? null;
    const domicilioNombre =
      domicilioDestinoNombre ||
      (domicilioId ? domicilioNombres[domicilioId] ?? `Domicilio #${domicilioId}` : null);
    const title = domicilioNombre ? `${base} de ${domicilioNombre}` : base;

    if (isPrevision) {
      const fecha = formatDateSafe(
        cambioDialogCambio?.fecha_carga ?? selectedPedido?.fecha_carga ?? null,
        'dd/MM/yyyy',
        '',
      );
      return { title, subtitle: fecha ? `Del día ${fecha}` : null };
    }

    const referencia =
      (cambioDialogCambio?.referencia_cliente ?? selectedPedido?.referencia_cliente)?.trim() ?? null;
    return { title, subtitle: referencia ? `Con la referencia ${referencia}` : null };
  }, [
    cambioDialogCambio,
    domicilioDestinoNombre,
    domicilioNombres,
    selectedPedido,
  ]);

  const applyTransportistaCambio = useCallback(async () => {
    if (!selectedPedido || !cambioDialogCambio) return;
    const nuevoAcreedorId = cambioDialogAcreedorNuevo?.id ?? null;
    if (!nuevoAcreedorId) {
      toast({
        title: 'Cambio incompleto',
        description: 'No se encontró el nuevo acreedor en el cambio.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setCambioDialogApplying(true);
      const shouldMarkSync = Boolean(
        resolveOrizonId((selectedPedido as any)?.idpedido_orizon, (selectedPedido as any)?.pedidoclienteid),
      );
      const updatePayload: Record<string, unknown> = { acreedorid_porte: nuevoAcreedorId };
      if (shouldMarkSync) {
        updatePayload.needs_sync = true;
      }
      const { error: pedidoError } = await supabase
        .from('pedidos')
        .update(updatePayload)
        .eq('id', selectedPedido.id);
      if (pedidoError) throw pedidoError;

      const reviewUpdate = buildReviewUpdate();
      const { error: cambioError } = await supabase
        .from('cambios_pedidos')
        .update(reviewUpdate)
        .eq('id', cambioDialogCambio.id);
      if (cambioError) throw cambioError;

      setSelectedPedido((prev: any) =>
        prev
          ? {
              ...prev,
              acreedorid_porte: nuevoAcreedorId,
              matching_cambio_revisado: true,
              ...(shouldMarkSync ? { needs_sync: true } : {}),
            }
          : prev,
      );
      setCambioDialogPedido((prev) =>
        prev
          ? {
              ...prev,
              acreedorid_porte: nuevoAcreedorId,
              ...(shouldMarkSync ? { needs_sync: true } : {}),
            }
          : prev,
      );
      setCambioDialogAcreedorActual(cambioDialogAcreedorNuevo ?? null);
      setSelectedPedidoMatchInfo((prev) =>
        prev ? { ...prev, matching_cambio_revisado: true } : prev,
      );
      setCambioDialogCambio((prev) => (prev ? { ...prev, ...reviewUpdate } : prev));
      setCambioDialogDisabledReason('Cambio ya revisado');
      await fetchPedidos();

      toast({
        title: 'Cambio aplicado',
        description: `Se actualizó el acreedor de porte en el pedido #${selectedPedido.id}.`,
      });
    } catch (error: any) {
      console.error('Error aplicando cambio de transportista', error);
      toast({
        title: 'No se pudo aplicar el cambio',
        description: error?.message ?? 'Inténtalo nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setCambioDialogApplying(false);
    }
  }, [
    buildReviewUpdate,
    cambioDialogAcreedorNuevo,
    cambioDialogCambio,
    fetchPedidos,
    selectedPedido,
    setSelectedPedido,
    setSelectedPedidoMatchInfo,
    supabase,
    toast,
  ]);

  const handleCambioAcreedorNuevoChange = useCallback(
    async (acreedorId: number | null) => {
      if (!cambioDialogCambio) return;
      if (cambioDialogMode !== 'transportista') return;
      const updatedMeta = updateCambioMetaAcreedor(cambioDialogCambio.change_meta, acreedorId);
      try {
        const { error } = await supabase
          .from('cambios_pedidos')
          .update({ acreedorid_porte: acreedorId, change_meta: updatedMeta })
          .eq('id', cambioDialogCambio.id);
        if (error) throw error;

        const acreedorInfo = await buildAcreedorInfo(acreedorId);
        setCambioDialogAcreedorNuevo(acreedorInfo);
        setCambioDialogCambio((prev) =>
          prev
            ? { ...prev, acreedorid_porte: acreedorId ?? null, change_meta: updatedMeta }
            : prev,
        );

        if (cambioDialogCambio.revisado) {
          setCambioDialogDisabledReason('Cambio ya revisado');
        } else {
          setCambioDialogDisabledReason(acreedorId == null ? 'Sin nuevo acreedor' : null);
        }
      } catch (error: any) {
        console.error('Error actualizando transportista del cambio', error);
        toast({
          title: 'No se pudo actualizar el transportista',
          description: error?.message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
      }
    },
    [
      buildAcreedorInfo,
      cambioDialogCambio,
      cambioDialogMode,
      supabase,
      toast,
    ],
  );

  useEffect(() => {
    const clienteParam = searchParams.get('cliente');
    const domicilioParam = searchParams.get('domicilio');
    const fechaCargaParam = searchParams.get('fecha_carga');
    const legacyPedidoParam = searchParams.get('pedido');
    const cambioParam = searchParams.get('cambio');
    const autoUpdateParam = searchParams.get('auto_update');
    const clienteId = clienteParam ? Number(clienteParam) : undefined;
    const domicilioId = domicilioParam ? Number(domicilioParam) : undefined;
    const routePedidoId = routePedidoIdParam ? Number(routePedidoIdParam) : undefined;
    const legacyPedidoId = legacyPedidoParam ? Number(legacyPedidoParam) : undefined;
    const pedidoId =
      routePedidoId && !Number.isNaN(routePedidoId)
        ? routePedidoId
        : legacyPedidoId && !Number.isNaN(legacyPedidoId)
          ? legacyPedidoId
          : undefined;
    const cambioId = cambioParam ? Number(cambioParam) : undefined;

    if (!routePedidoIdParam && pedidoId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('pedido');
      navigateToPedidoDetail(pedidoId, { replace: true, nextSearchParams: nextParams });
      return;
    }

    if (clienteId && !Number.isNaN(clienteId) && clienteId !== filters.clienteId) {
      updateFilter('clienteId', clienteId);
    }
    if (domicilioId && !Number.isNaN(domicilioId) && domicilioId !== filters.domicilioDestinoId) {
      updateFilter('domicilioDestinoId', domicilioId);
    }
    if (fechaCargaParam && fechaCargaParam !== filters.fechaCargaDesde) {
      updateFilter('fechaCargaDesde', fechaCargaParam);
      updateFilter('fechaCargaHasta', fechaCargaParam);
    }
    if ((pedidoId && !Number.isNaN(pedidoId)) || (cambioId && !Number.isNaN(cambioId))) {
      const nextParams = new URLSearchParams(searchParams);
      if (pedidoId && !Number.isNaN(pedidoId)) {
        const isSamePedidoOpen = dialogOpen && selectedPedidoId === pedidoId;
        if (!isSamePedidoOpen && pendingPedidoId !== pedidoId) {
          setPendingPedidoId(pedidoId);
        }
      }
      if (cambioId && !Number.isNaN(cambioId)) {
        setPendingCambioId(cambioId);
        nextParams.delete('cambio');
      }
      if (autoUpdateParam && pedidoId && !Number.isNaN(pedidoId)) {
        setPendingAutoUpdateId(pedidoId);
        nextParams.delete('auto_update');
      }
      // Evitar bucles de navegación: solo actualizar si cambió algo
      if (nextParams.toString() !== searchParams.toString()) {
        setSearchParams(nextParams, { replace: true });
      }
    }
  }, [
    searchParams,
    filters.clienteId,
    filters.domicilioDestinoId,
    filters.fechaCargaDesde,
    filters.fechaCargaHasta,
    updateFilter,
    routePedidoIdParam,
    dialogOpen,
    selectedPedidoId,
    pendingPedidoId,
    navigateToPedidoDetail,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!pendingPedidoId) return;
    if (loading) return;
    if (dialogOpen && selectedPedidoId === pendingPedidoId) return;
    const exists = pedidos.find((pedido) => pedido.id === pendingPedidoId);

    if (exists) {
      setSelectedPedidoMatchInfo(extractMatchInfo(exists));
    } else {
      // Si no está en la lista (p. ej. filtros o datos cacheados), intentar abrir igualmente
      setSelectedPedidoMatchInfo(null);
    }

    setSelectedPedidoId(pendingPedidoId);
    fetchPedidoDetails(pendingPedidoId);
    setDialogOpen(true);
    setPendingPedidoId(null);
  }, [pendingPedidoId, pedidos, loading, fetchPedidoDetails, setDialogOpen, setSelectedPedidoId, extractMatchInfo]);

  useEffect(() => {
    if (!pendingCambioId) return;
    let cancelled = false;
    const loadCambioInfo = async () => {
      try {
        const { data, error } = await supabase
          .from('cambios_pedidos')
          .select('id, revisado')
          .eq('id', pendingCambioId)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        const revisado = data?.revisado ?? null;
        setSelectedPedidoMatchInfo((prev) => {
          if (prev?.matching_cambio_id && prev.matching_cambio_id !== pendingCambioId) {
            return prev;
          }
          return {
            ...(prev ?? {}),
            matching_cambio_id: pendingCambioId,
            matching_cambio_revisado: revisado,
          };
        });
      } catch (error) {
        console.error('Error cargando estado del cambio solicitado', error);
        setSelectedPedidoMatchInfo((prev) => {
          if (prev?.matching_cambio_id && prev.matching_cambio_id !== pendingCambioId) {
            return prev;
          }
          return {
            ...(prev ?? {}),
            matching_cambio_id: pendingCambioId,
          };
        });
      } finally {
        if (!cancelled) {
          setPendingCambioId(null);
        }
      }
    };

    loadCambioInfo();

    return () => {
      cancelled = true;
    };
  }, [pendingCambioId, supabase]);

  // Agrupar la página actual (ya paginada por grupos desde backend)
  const { groupedPedidos } = useGroupedPedidos(pedidos, filters.order, filters.sortBy);

  // Si el pedido seleccionado no pertenece a la lista actual ni está cargado por detalle, limpiar selección/dialog.
  // Esto evita dejar una ruta de detalle inválida cuando el pedido ya no puede abrirse.
  useEffect(() => {
    if (!selectedPedidoId) return;
    const existsInCurrentList = pedidos.some((p) => p.id === selectedPedidoId);
    const hasLoadedDetails = selectedPedido?.id === selectedPedidoId;
    const loadingSelected = loadingDetails && loadingPedidoId === selectedPedidoId;
    const openingFromPending = pendingPedidoId === selectedPedidoId;

    if (existsInCurrentList || hasLoadedDetails || loadingSelected || openingFromPending) {
      return;
    }

    setSelectedPedidoId(null);
    setSelectedPedidoMatchInfo(null);
    clearDetails();
    setDialogOpen(false);
    navigateToPedidosList({ replace: true });
  }, [
    pedidos,
    selectedPedidoId,
    selectedPedido,
    loadingDetails,
    loadingPedidoId,
    pendingPedidoId,
    setSelectedPedidoId,
    clearDetails,
    setDialogOpen,
    navigateToPedidosList,
  ]);

  const paginatedGroups = groupedPedidos;
  const pageTransitionLoading = refreshing && !loading;

  useEffect(() => {
    if (loading) return;
    if (currentPage <= totalGroupPages) return;
    setCurrentPage(totalGroupPages);
  }, [loading, currentPage, totalGroupPages, setCurrentPage]);

  const pedidoDateRange = useMemo(() => {
    const from = filters.fechaPedidoRango.from ? parseISO(filters.fechaPedidoRango.from) : undefined;
    const to = filters.fechaPedidoRango.to ? parseISO(filters.fechaPedidoRango.to) : undefined;
    return { from, to };
  }, [filters.fechaPedidoRango]);

  const dateRangeLabel = useMemo(() => {
    if (pedidoDateRange.from && pedidoDateRange.to) {
      return `${format(pedidoDateRange.from, 'dd/MM/yyyy')} - ${format(pedidoDateRange.to, 'dd/MM/yyyy')}`;
    }
    if (pedidoDateRange.from) {
      return `Desde ${format(pedidoDateRange.from, 'dd/MM/yyyy')}`;
    }
    if (pedidoDateRange.to) {
      return `Hasta ${format(pedidoDateRange.to, 'dd/MM/yyyy')}`;
    }
    return 'Selecciona un rango';
  }, [pedidoDateRange]);

  const cargaDateRange = useMemo(() => {
    const from = filters.fechaCargaRango.from ? parseISO(filters.fechaCargaRango.from) : undefined;
    const to = filters.fechaCargaRango.to ? parseISO(filters.fechaCargaRango.to) : undefined;
    return { from, to };
  }, [filters.fechaCargaRango]);

  const cargaDateRangeLabel = useMemo(() => {
    if (cargaDateRange.from && cargaDateRange.to) {
      return `${format(cargaDateRange.from, 'dd/MM/yyyy')} - ${format(cargaDateRange.to, 'dd/MM/yyyy')}`;
    }
    if (cargaDateRange.from) {
      return `Desde ${format(cargaDateRange.from, 'dd/MM/yyyy')}`;
    }
    if (cargaDateRange.to) {
      return `Hasta ${format(cargaDateRange.to, 'dd/MM/yyyy')}`;
    }
    return 'Selecciona un rango';
  }, [cargaDateRange]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.referencia.trim()) count++;
    if (filters.clienteId) count++;
    if (filters.domicilioDestinoId) count++;
    if (filters.fechaPedidoRango.from || filters.fechaPedidoRango.to) count++;
    if (filters.fechaCargaDesde) count++;
    if (filters.fechaCargaHasta) count++;
    if (filters.ceoxStatus !== 'all') count++;
    if (filters.tieneMatricula) count++;
    if (filters.tieneCambio) count++;
    if (filters.tienePrevision) count++;
    return count;
  }, [filters]);

  useEffect(() => {
    let active = true;
    const fetchClientesConPedidos = async () => {
      try {
        const ids = new Set<number>();
        const pageSize = 1000;
        let from = 0;

        while (true) {
          const to = from + pageSize - 1;
          const { data, error } = await supabase
            .from('pedidos')
            .select('clienteid')
            .eq('tipo_pedido', tipoPedido)
            .not('clienteid', 'is', null)
            .order('clienteid', { ascending: true })
            .range(from, to);

          if (error) throw error;

          const rows = (data ?? []) as Array<{ clienteid: number | null }>;
          rows.forEach((row) => {
            if (typeof row.clienteid === 'number' && row.clienteid > 0) {
              ids.add(row.clienteid);
            }
          });

          if (rows.length < pageSize) break;
          from += pageSize;
        }

        if (active) setClientesConPedidos(ids);
      } catch (error) {
        console.error('Error cargando clientes con pedidos/previsiones', error);
        if (active) setClientesConPedidos(null);
      }
    };

    fetchClientesConPedidos();
    return () => {
      active = false;
    };
  }, [tipoPedido]);

  const handlePedidoDateRangeChange = useCallback(
    (range: DateRange | undefined) => {
      updateFilter('fechaPedidoRango', {
        from: range?.from ? format(range.from, 'yyyy-MM-dd') : '',
        to: range?.to ? format(range.to, 'yyyy-MM-dd') : '',
      });
    },
    [updateFilter],
  );

  const handleCargaDateRangeChange = useCallback(
    (range: DateRange | undefined) => {
      updateFilter('fechaCargaRango', {
        from: range?.from ? format(range.from, 'yyyy-MM-dd') : '',
        to: range?.to ? format(range.to, 'yyyy-MM-dd') : '',
      });
    },
    [updateFilter],
  );

  const booleanFilterOptions: Array<{
    key: 'tieneMatricula' | 'tieneCambio' | 'tienePrevision';
    label: string;
    description: string;
  }> = [
    {
      key: 'tieneMatricula',
      label: 'Tiene matrícula',
      description: 'Solo muestra pedidos con matrícula de transporte.',
    },
    {
      key: 'tieneCambio',
      label: 'Tiene cambio',
      description: 'Pedidos con cambio disponible para revisar.',
    },
    ...(tipoPedido === 'P220'
          ? [
              {
                key: 'tienePrevision' as const,
                label: 'Tiene previsión',
                description: 'Pedidos con previsión asociada (subida o pendiente).',
              },
            ]
          : []),
  ];

  const ceoxStatusOptions: Array<{ value: CeoxStatusFilter; label: string }> = [
    { value: 'all', label: 'Todos' },
    { value: 'in_ceox', label: 'Está en Ceox' },
    { value: 'not_in_ceox', label: 'No está en Ceox' },
    ...(tipoPedido === 'P220'
      ? [{ value: 'in_ceox_outdated' as const, label: 'En Ceox desactualizado' }]
      : []),
  ];

  const viewPedidoDetails = async (pedido: Pedido) => {
    setNewLineas([]);
    setSelectedPedidoMatchInfo(extractMatchInfo(pedido as PedidoWithMatch));
    setPendingPedidoId(pedido.id);
    navigateToPedidoDetail(pedido.id);
  };

  const handleClearFilters = useCallback(() => {
    clearFilters();
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('cliente');
    nextParams.delete('domicilio');
    nextParams.delete('fecha_carga');
    setSearchParams(nextParams);
  }, [clearFilters, searchParams, setSearchParams]);

  // Restaurar detalles del pedido si hay uno seleccionado al cargar
  useEffect(() => {
    if (dialogOpen && selectedPedidoId && !selectedPedido) {
      fetchPedidoDetails(selectedPedidoId);
    }
  }, [dialogOpen, selectedPedidoId, selectedPedido]);

  const openDeleteDialog = (pedido: Pedido) => {
    setPedidoToDelete(pedido);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!pedidoToDelete || deletingPedido) return;
    setDeletingPedido(true);
    try {
      await deleteFromDb(pedidoToDelete, { throwOnError: true });
      setDeleteDialogOpen(false);
      setPedidoToDelete(null);
    } catch (error) {
      // El toast de error se maneja en deletePedido; mantenemos el dialog abierto.
    } finally {
      setDeletingPedido(false);
    }
  };

  const cancelDelete = () => {
    if (deletingPedido) return;
    setDeleteDialogOpen(false);
    setPedidoToDelete(null);
  };

  const openDeleteGroupDialog = (groupPedidos: PedidoWithMatch[], archivoPdfId: number | null) => {
    if (!groupPedidos.length) return;
    setGroupToDelete({ archivoPdfId, pedidos: groupPedidos });
    setDeleteGroupDialogOpen(true);
  };

  const cancelDeleteGroup = () => {
    if (deletingGroup) return;
    setDeleteGroupDialogOpen(false);
    setGroupToDelete(null);
  };

  const confirmDeleteGroup = async () => {
    if (!groupToDelete || deletingGroup) return;

    setDeletingGroup(true);
    setDeletingGroupProgress({ done: 0, total: groupToDelete.pedidos.length });
    try {
      const failed: Array<{ id: number; message: string }> = [];
      let deletedCount = 0;
      let processedCount = 0;

      for (const pedido of groupToDelete.pedidos) {
        try {
          await deleteFromDb(pedido, { silent: true, skipInvalidate: true, throwOnError: true });
          deletedCount += 1;
        } catch (error) {
          failed.push({
            id: pedido.id,
            message: error instanceof Error ? error.message : 'Error desconocido',
          });
        }
        processedCount += 1;
        setDeletingGroupProgress({ done: processedCount, total: groupToDelete.pedidos.length });
      }

      await fetchPedidos();

      if (deletedCount > 0) {
        toast({
          title: 'Bloque eliminado',
          description: `Se eliminaron ${deletedCount} ${tipoPedido === 'P220' ? 'pedidos' : 'previsiones'} del bloque.`,
        });
      }

      if (failed.length > 0) {
        const firstError = failed[0];
        toast({
          title: 'Eliminación parcial',
          description:
            failed.length === 1
              ? `No se pudo eliminar #${String(firstError.id).slice(0, 8)}: ${firstError.message}`
              : `No se pudieron eliminar ${failed.length} elementos del bloque.`,
          variant: 'destructive',
        });
      }
    } finally {
      setDeletingGroup(false);
      setDeletingGroupProgress(null);
      setDeleteGroupDialogOpen(false);
      setGroupToDelete(null);
    }
  };

  const handlePickingFlow = async (
    pedido: Pedido,
    matchingPrevisionId: number,
    matchingPrevisionUploaded?: boolean | null,
  ): Promise<PickingRequest[] | null> => {
    if (!matchingPrevisionUploaded) {
      toast({
        title: 'Previsión no subida',
        description: `Sube la previsión #${matchingPrevisionId} a Orizon antes de hacer picking.`,
        variant: 'destructive',
      });
      return null;
    }

    const normalizeDescription = (value: string | null | undefined) =>
      value
        ? value
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
        : '';

    const ceilPickingPalets = (value: unknown) => {
      const normalized = normalizeApiNumber(value);
      return normalized === null ? 0 : Math.ceil(normalized);
    };

    const mapLinea = (linea: any): LineaSummary => ({
      pedidodetid: linea.pedidodetid,
      idpedidodet_orizon: (linea as any)?.idpedidodet_orizon ?? null,
      descripcion_salida: linea.descripcion_salida ?? '',
      numero_palet: linea.numero_palet ?? 0,
    });

    const fetchLineas = async (pedidoId: number, fallback?: any[]): Promise<LineaSummary[]> => {
      if (Array.isArray(fallback) && fallback.length > 0) {
        return fallback.map(mapLinea);
      }
      const { data, error } = await supabase
        .from('pedido_linea')
        .select('pedidodetid, idpedidodet_orizon, descripcion_salida, numero_palet')
        .eq('pedidoid', pedidoId);
      if (error) throw error;
      return (data as any[] | null | undefined)?.map(mapLinea) ?? [];
    };

    const warnings: string[] = [];
    const safeIso = (value: string | null | undefined, label: string) => {
      if (!value) {
        warnings.push(`Falta ${label} en el pedido.`);
        return null;
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        warnings.push(`Formato de fecha inválido para ${label}.`);
        return null;
      }
      return date.toISOString();
    };

    try {
      const { data: previsionHeader, error: previsionHeaderError } = await supabase
        .from('pedidos')
        .select('id, idpedido_orizon, pedidoclienteid, fecha_pedido, fecha_carga, clienteid, clienteid_envio, sujetodomicilioid_destino, referencia_cliente')
        .eq('id', matchingPrevisionId)
        .maybeSingle();

      if (previsionHeaderError) throw previsionHeaderError;
      if (!previsionHeader) throw new Error(`No se encontró la previsión #${matchingPrevisionId}`);

      const previsionOrizonId = resolveOrizonId(
        (previsionHeader as any)?.idpedido_orizon,
        (previsionHeader as any)?.pedidoclienteid,
      );

      if (!previsionOrizonId) {
        toast({
          title: 'Previsión sin Orizon',
          description: `Sube la previsión #${matchingPrevisionId} a Orizon antes de preparar el picking.`,
          variant: 'destructive',
        });
        return null;
      }

      const [pedidoLineas, previsionLineas] = await Promise.all([
        fetchLineas(pedido.id, (pedido as any)?.lineas),
        fetchLineas(matchingPrevisionId),
      ]);

      if (!pedidoLineas.length) {
        toast({
          title: 'Picking no disponible',
          description: 'El pedido no tiene líneas para preparar.',
          variant: 'destructive',
        });
        return null;
      }

      if (!previsionLineas.length) {
        toast({
          title: 'Picking no disponible',
          description: 'La previsión no tiene líneas registradas.',
          variant: 'destructive',
        });
        return null;
      }

      const previsionMap = new Map<string, LineaSummary[]>();
      const usedPrevisionIds = new Set<number>();
      previsionLineas.forEach((linea) => {
        const key = normalizeDescription(linea.descripcion_salida);
        if (!key) return;
        const list = previsionMap.get(key) ?? [];
        list.push(linea);
        previsionMap.set(key, list);
      });

      const detalles: {
        pedidodetid_origen: number;
        palets_origen: number;
        palets_seleccionados: number;
      }[] = [];

      for (const linea of pedidoLineas) {
        const normalized = normalizeDescription(linea.descripcion_salida);
        if (!normalized) {
          warnings.push(`La línea ${linea.pedidodetid} no tiene descripción para comparar.`);
          continue;
        }
        const candidates = previsionMap.get(normalized);
        const matchedLinea = candidates?.find((pl) => !usedPrevisionIds.has(pl.pedidodetid));
        if (!matchedLinea) {
          warnings.push(
            `No se ha encontrado en la previsión el artículo con descripción "${linea.descripcion_salida || 'sin descripción'}".`,
          );
          continue;
        }
        const origenLineaId = matchedLinea.idpedidodet_orizon ?? matchedLinea.pedidodetid;
        if (!origenLineaId) {
          warnings.push(
            `La línea "${matchedLinea.descripcion_salida || 'sin descripción'}" de la previsión no tiene identificador en Orizon.`,
          );
          continue;
        }
        usedPrevisionIds.add(matchedLinea.pedidodetid);

        const matchedWithOverride: LineaSummary = {
          ...matchedLinea,
          descripcion_salida: matchedLinea.descripcion_salida || linea.descripcion_salida,
        };

        detalles.push({
          pedidodetid_origen: origenLineaId,
          palets_origen: ceilPickingPalets(matchedWithOverride.numero_palet),
          palets_seleccionados: ceilPickingPalets(linea.numero_palet),
        });
      }

      const fechaPedidoDestino = safeIso(
        (pedido as any)?.fecha_pedido ?? (pedido as any)?.fecha ?? null,
        'la fecha de pedido',
      );
      const fechaCargaDestino = safeIso((pedido as any)?.fecha_carga ?? null, 'la fecha de carga');
      const clienteDestino = pedido.clienteid ?? (pedido as any)?.clienteid_envio ?? null;
      const domicilioDestino = pedido.sujetodomicilioid_destino ?? null;

      if (!clienteDestino) {
        warnings.push('El pedido no tiene cliente asignado.');
      }
      if (!domicilioDestino) {
        warnings.push('El pedido no tiene domicilio de destino.');
      }

      if (warnings.length) {
        toast({
          title: 'Picking no listo',
          description:
            warnings.length === 1
              ? warnings[0]
              : `${warnings[0]} (${warnings.length - 1} aviso${
                warnings.length - 1 === 1 ? '' : 's'
              } más)`,
          variant: 'destructive',
        });
        return null;
      }

      const pickingPayload: PickingRequest[] = [
        {
          pedidoclienteid_origen: previsionOrizonId,
          fecha_pedido_destino: fechaPedidoDestino!,
          fecha_carga_destino: fechaCargaDestino!,
          clienteid_destino: clienteDestino,
          sujetodomicilioid_destino: domicilioDestino,
          referencia_cliente_destino: pedido.referencia_cliente ?? '',
          referencia2_cliente_destino: pedido.referencia2_cliente ?? '',
          detalles,
        },
      ];

      console.log('📦 JSON picking generado', pickingPayload);

      toast({
        title: 'Picking listo',
        description: `${detalles.length} línea${
          detalles.length === 1 ? '' : 's'
        } enlazada${
          detalles.length === 1 ? '' : 's'
        } con la previsión #${matchingPrevisionId}. Ejecuta el picking cuando quieras.`,
      });
      return pickingPayload;
    } catch (error: any) {
      console.error('Error generando picking:', error);
      toast({
        title: 'Error al generar picking',
        description: error?.message ?? 'No se pudo preparar el picking.',
        variant: 'destructive',
      });
      return null;
    }
  };

  const sendPickingToAgroiris = async () => {
    if (!pickingPayload) return;
    setPickingSending(true);
    try {
      try {
        console.log('📦 Payload picking -> AgroIris', JSON.stringify(pickingPayload, null, 2));
      } catch {
        console.log('📦 Payload picking -> AgroIris', pickingPayload);
      }

      const response = await agroirisPicking.generarPedidos(pickingPayload);

      try {
        console.log('📦 Respuesta picking <- AgroIris', JSON.stringify(response, null, 2));
      } catch {
        console.log('📦 Respuesta picking <- AgroIris', response);
      }

      const rawResponseId = Array.isArray(response)
        ? response[0]
        : typeof response === 'object' && response !== null
        ? (response as any).pedidoclienteid ??
          (response as any).pedidoClienteId ??
          (response as any).id ??
          null
        : response;

      const responseId =
        typeof rawResponseId === 'number'
          ? rawResponseId
          : typeof rawResponseId === 'string' && rawResponseId.trim() !== ''
          ? Number(rawResponseId)
          : null;

      toast({
        title: 'Picking enviado',
        description: responseId ? `ID Orizon: ${responseId}` : 'Se envió correctamente.',
      });
      setPickingConfirmOpen(false);
      setPickingPayload(null);
      setPickingPedidoId(null);

      if (pickingPedidoId && responseId) {
        try {
          const { error } = await supabase
            .from('pedidos')
            .update({
              idpedido_orizon: responseId,
              pedidoclienteid: String(responseId),
              enviado: true,
              needs_sync: false,
            })
            .eq('id', pickingPedidoId);
          if (error) {
            console.error('No se pudo actualizar el pedido con el ID de Orizon', error);
          } else {
            setSelectedPedido((prev) =>
              prev && prev.id === pickingPedidoId
                ? {
                    ...prev,
                    idpedido_orizon: responseId,
                    pedidoclienteid: String(responseId),
                    enviado: true,
                    needs_sync: false,
                  }
                : prev,
            );
            await fetchPedidos();
          }
        } catch (updateError) {
          console.error('Error actualizando pedido tras picking', updateError);
        }
      }
    } catch (error: any) {
      console.error('Error enviando picking:', error);
      toast({
        title: 'Error al enviar picking',
        description: error?.message ?? 'No se pudo enviar el picking.',
        variant: 'destructive',
      });
    } finally {
      setPickingSending(false);
    }
  };

  const enviarPedido = async (pedido: Pedido, options?: { ignorePrevision?: boolean }) => {
    setSendingPedidoId(pedido.id);
    const ignorePrevision = options?.ignorePrevision ?? false;
    const hasOrizonId = Boolean(
      resolveOrizonId((pedido as any)?.idpedido_orizon, (pedido as any)?.pedidoclienteid),
    );
    const effectiveMatchingPrevisionId =
      (pedido as any)?.matching_prevision_id ??
      (selectedPedidoId === pedido.id ? selectedPedidoMatchInfo?.matching_prevision_id ?? null : null);
    const effectiveMatchingPrevisionUploaded =
      (pedido as any)?.matching_prevision_uploaded ??
      (selectedPedidoId === pedido.id ? selectedPedidoMatchInfo?.matching_prevision_uploaded ?? null : null);

    if (effectiveMatchingPrevisionId && !ignorePrevision && !hasOrizonId) {
      if (!effectiveMatchingPrevisionUploaded) {
        toast({
          title: 'Previsión no subida',
          description: 'Sube la previsión vinculada a Orizon antes de comprobar el picking.',
          variant: 'destructive',
        });
        setPickingBlockedIds((prev) => {
          const next = new Set(prev);
          next.add(pedido.id);
          return next;
        });
        setSendingPedidoId(null);
        return;
      }

      try {
        const payload = await handlePickingFlow(pedido, effectiveMatchingPrevisionId, effectiveMatchingPrevisionUploaded);
        if (payload) {
          setPickingPayload(payload);
          setPickingPedidoId(pedido.id);
          setPickingConfirmOpen(true);
        }
      } finally {
        setSendingPedidoId(null);
      }
      return;
    }

    try {
      const result = await sendPedidoToOrizon({ pedido, tipoPedido, sentBy: user?.id ?? null });

      if (result.updateError) {
        console.error('Error actualizando campos Orizon en Supabase:', result.updateError);
        toast({
          title: 'Pedido enviado, pero no se pudo actualizar Supabase',
          description: result.updateError.message,
          variant: 'destructive',
        });
        return;
      }

      if (result.detalleUpdateError) {
        console.error('Error guardando IDs de detalle en Supabase:', result.detalleUpdateError);
      }
      if (result.centroUpdateError) {
        console.error('Error guardando IDs de centros en Supabase:', result.centroUpdateError);
      }

      setSelectedPedido((prev) => {
        if (!prev || prev.id !== pedido.id) return prev;
        let updatedLineas = prev.lineas;

        if (updatedLineas?.length && result.detalleLineaMap.size && !result.detalleUpdateError) {
          updatedLineas = updatedLineas.map((linea) => {
            const newRemoteId = result.detalleLineaMap.get(linea.pedidodetid);
            return newRemoteId ? { ...linea, idpedidodet_orizon: newRemoteId } : linea;
          });
        }

        if (updatedLineas?.length && result.centroLineaMap.size && !result.centroUpdateError) {
          updatedLineas = updatedLineas.map((linea) => {
            if (!linea.centros?.length) return linea;
            const updatedCentros = linea.centros.map((centro) => {
              const newCentroId = result.centroLineaMap.get(centro.pedcentroid);
              return newCentroId ? { ...centro, pedidocentroid_orizon: newCentroId } : centro;
            });
            return { ...linea, centros: updatedCentros };
          });
        }

        return {
          ...prev,
          idpedido_orizon: result.newOrizonId ?? prev.idpedido_orizon,
          needs_sync: false,
          enviado: true,
          lineas: updatedLineas,
        };
      });

      await fetchPedidos();

      toast({
        title: result.isUpdate ? 'Pedido actualizado' : 'Pedido enviado',
      });
    } catch (error: any) {
      console.error('Error enviando pedido a AgroIris:', error);
      let errorDescription = error?.message || 'Error desconocido';

      if (error?.details?.errors) {
        const flatErrors = Object.values(error.details.errors)
          .flat()
          .join(' | ');
        if (flatErrors) {
          errorDescription = flatErrors;
        }
      } else if (typeof error?.details === 'string') {
        errorDescription = error.details;
      } else if (error?.details?.title) {
        errorDescription = error.details.title;
      }

      toast({
        title: 'Error al enviar pedido',
        description: errorDescription,
        variant: 'destructive',
      });
    } finally {
      setSendingPedidoId(null);
    }
  };

  const handleUpdateOrizonFromCambio = useCallback(() => {
    if (!selectedPedido) return;
    handleCloseCambioDialog(false);
    enviarPedido(selectedPedido);
  }, [enviarPedido, handleCloseCambioDialog, selectedPedido]);

  useEffect(() => {
    if (!pendingAutoUpdateId) return;
    if (!selectedPedido || selectedPedido.id !== pendingAutoUpdateId) return;
    const hasOrizonId = Boolean(
      resolveOrizonId((selectedPedido as any)?.idpedido_orizon, (selectedPedido as any)?.pedidoclienteid),
    );
    if (!hasOrizonId) {
      toast({
        title: 'Pedido sin Orizon',
        description: 'El pedido no tiene ID en Orizon para actualizar.',
        variant: 'destructive',
      });
      setPendingAutoUpdateId(null);
      return;
    }
    enviarPedido(selectedPedido);
    setPendingAutoUpdateId(null);
  }, [pendingAutoUpdateId, selectedPedido, enviarPedido, toast]);

  const resetPedidoDialogState = useCallback(
    (options?: { keepPrevious?: boolean }) => {
      setDialogOpen(false);
      setSelectedPedidoId(null); // Limpiar el ID persistido
      setSelectedPedido(null);
      setIsEditing(false);
      setEditedPedido({});
      setEditedLineas({});
      setEditedCentros({});
      setNewCentros({});
      setDeletedCentros([]);
      setEditingLineaId(null);
      setNewLineas([]);
      if (!options?.keepPrevious) {
        setPreviousPedidoId(null);
      }
      setSelectedPedidoMatchInfo(null);
      setCambioDialogOpen(false);
      setCambioDialogCambio(null);
      setCambioDialogPedido(null);
      setCambioDialogAcreedorActual(null);
      setCambioDialogAcreedorNuevo(null);
      setCambioDialogDisabledReason(null);
      setCambioDialogLoading(false);
      setCambioDialogApplying(false);
      setCambioDialogPdfActualUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setCambioDialogPdfActualLoading(false);
      setCambioDialogPdfActualError(null);
      setCambioDialogPdfCambioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setCambioDialogPdfCambioLoading(false);
      setCambioDialogPdfCambioError(null);
      setSelectedCambioHasMeta(null);
      clearDetails();
    },
    [clearDetails, setSelectedPedido],
  );

  const handleCloseDialog = () => {
    navigateToPedidosList({ replace: true });
    resetPedidoDialogState();
  };

  useEffect(() => {
    if (routePedidoIdParam) return;
    if (!dialogOpen && selectedPedidoId === null) return;
    resetPedidoDialogState();
  }, [routePedidoIdParam, dialogOpen, selectedPedidoId, resetPedidoDialogState]);

  const handlePedidoRelacionadoClick = async (pedidoId: number) => {
    // Primero intentar buscar en la lista actual
    let pedido = pedidos.find(p => p.id === pedidoId);

    // Guardar el pedido previo para poder volver si navegamos a una previsión
    if (selectedPedido && selectedPedido.id !== pedidoId) {
      setPreviousPedidoId(selectedPedido.id);
    }
    resetPedidoDialogState({ keepPrevious: true });
    
    // Si no está en la lista actual (podría estar filtrado), cargar desde DB
    if (!pedido) {
      setNavigatingToRelated(true);
      try {
        const { data, error } = await supabase
          .from('pedidos')
          .select(`
            *,
            lineas:pedido_linea(
              *,
              centros:pedido_linea_centro(*)
            )
          `)
          .eq('id', pedidoId)
          .single();

        if (error) throw error;
        pedido = data;
      } catch (error) {
        console.error('Error loading related pedido:', error);
        toast({
          title: "Error",
          description: "No se pudo cargar el pedido relacionado",
          variant: "destructive",
        });
        return;
      } finally {
        setNavigatingToRelated(false);
      }
    }
    
    if (pedido) {
      await viewPedidoDetails(pedido);
    }
  };

  const handleOpenPrevisionFromBadge = async (previsionId: number, sourcePedido: PedidoWithMatch) => {
    const sourcePedidoId = sourcePedido.id;
    setLoadingPrevisionPedidoId(sourcePedidoId);
    try {
      await handlePedidoRelacionadoClick(previsionId);
    } finally {
      setLoadingPrevisionPedidoId(null);
    }
  };

  const validateNewLinea = (linea: NewPedidoLineaDraft) => {
    const missing: string[] = [];

    if (!linea.generoid) missing.push('Género');
    if (!linea.tipocultivoid) missing.push('Tipo cultivo');
    if (!linea.catalogoconfecid) missing.push('Catálogo confección');
    if (!linea.grupoconfeccionid) missing.push('Grupo confección');
    if (!linea.confeccionsalidaid) missing.push('Confección salida');
    if (!linea.origenid) missing.push('Origen');
    if (!linea.calibreid) missing.push('Calibre');
    if (linea.bultos == null) missing.push('Bultos');
    if (linea.bultosxpalet == null) missing.push('Bultos x palet');
    if (linea.numero_palet == null) missing.push('Número de palet');
    if (!linea.descripcion_salida || !linea.descripcion_salida.trim()) missing.push('Descripción');

    return missing.length ? missing.join(', ') : null;
  };

  const savePedidoChanges = async () => {
    if (!selectedPedido) return;

    try {
      let hasChanges = false;
      // Guardar cambios del pedido principal
      if (Object.keys(editedPedido).length > 0) {
        const { error: pedidoError } = await supabase
          .from('pedidos')
          .update(editedPedido)
          .eq('id', selectedPedido.id);

        if (pedidoError) throw pedidoError;
        hasChanges = true;
      }

      // Guardar cambios en las líneas
      for (const [pedidodetid, changes] of Object.entries(editedLineas)) {
        if (Object.keys(changes).length > 0) {
          const normalizedChanges = { ...(changes as Record<string, unknown>) };
          const hasEanPieza = Object.prototype.hasOwnProperty.call(normalizedChanges, 'ean_pieza');
          const hasEanBulto = Object.prototype.hasOwnProperty.call(normalizedChanges, 'ean_bulto');
          if (Object.prototype.hasOwnProperty.call(normalizedChanges, 'confeccionpaletid')) {
            normalizedChanges.confeccionpaletid = normalizedChanges.confeccionpaletid ?? 0;
          }
          if (hasEanPieza || hasEanBulto) {
            normalizedChanges.ean = hasEanPieza
              ? normalizedChanges.ean_pieza ?? null
              : normalizedChanges.ean_bulto ?? null;
            delete normalizedChanges.ean_pieza;
            delete normalizedChanges.ean_bulto;
          }
          const { error: lineaError } = await supabase
            .from('pedido_linea')
            .update(normalizedChanges)
            .eq('pedidodetid', parseInt(pedidodetid));

          if (lineaError) throw lineaError;
          hasChanges = true;
        }
      }

      // Guardar cambios en los centros
      for (const [pedcentroid, changes] of Object.entries(editedCentros)) {
        if (Object.keys(changes).length > 0) {
          const { error: centroError } = await supabase
            .from('pedido_linea_centro')
            .update(changes)
            .eq('pedcentroid', parseInt(pedcentroid));

          if (centroError) throw centroError;
          hasChanges = true;
        }
      }

      // Validar asignaciones únicas en centros (existentes activos + nuevos aceptados)
      const deletedSet = new Set(deletedCentros);
      for (const linea of selectedPedido.lineas || []) {
        const used = new Set<string>();
        linea.centros
          ?.filter((c: any) => !deletedSet.has(c.pedcentroid))
          .forEach((c: any) => {
            const editedCentro = editedCentros[c.pedcentroid] || {};
            const asign = editedCentro.asignacion ?? c.asignacion;
            if (asign && used.has(asign)) {
              throw new Error(`Asignación duplicada (${asign}) en centros de la línea ${linea.pedidodetid}. Usa valores distintos.`);
            }
            if (asign) used.add(asign);
          });
        (newCentros[String(linea.pedidodetid)] || (newCentros as any)[linea.pedidodetid] || [])
          .filter((c) => c.accepted)
          .forEach((c) => {
            if (c.asignacion && used.has(c.asignacion)) {
              throw new Error(`Asignación duplicada (${c.asignacion}) en centros de la línea ${linea.pedidodetid}. Usa valores distintos.`);
            }
            if (c.asignacion) used.add(c.asignacion);
          });
      }

      // Eliminar centros marcados
      if (deletedCentros.length > 0) {
        const { error: deleteError } = await supabase
          .from('pedido_linea_centro')
          .delete()
          .in('pedcentroid', deletedCentros);
        if (deleteError) throw deleteError;
        hasChanges = true;
      }

      // Insertar centros nuevos (solo los aceptados)
      for (const [lineaId, centros] of Object.entries(newCentros)) {
        const pedidodetid = Number(lineaId);
        if (!Number.isFinite(pedidodetid)) continue;
        for (const centro of centros) {
          if (!centro.accepted) continue;
          const payload = {
            pedidodetid,
            asignacion: centro.asignacion || 'S',
            numero_palets: centro.numero_palets ?? 0,
            subprov: centro.subprov ?? 0,
          };
          const { error: insertCentroError } = await supabase
            .from('pedido_linea_centro')
            .insert(payload);
          if (insertCentroError) throw insertCentroError;
          hasChanges = true;
        }
      }

      for (const [index, linea] of newLineas.entries()) {
        const missing = validateNewLinea(linea);
        if (missing) {
          throw new Error(`Línea nueva #${index + 1}: completa ${missing}.`);
        }

        const hasPiezasData = linea.piezasxbulto != null && linea.piezasxbulto !== 0;
        const hasKilosData = linea.kilosxbulto != null && linea.kilosxbulto !== 0;
        const usarPiezas = !hasKilosData || hasPiezasData;

        const payload = {
          pedidoid: selectedPedido.id,
          generoid: linea.generoid!,
          tipocultivoid: linea.tipocultivoid!,
          catalogoconfecid: linea.catalogoconfecid!,
          grupoconfeccionid: linea.grupoconfeccionid!,
          confeccionpaletid: linea.confeccionpaletid ?? 0,
          confeccionsalidaid: linea.confeccionsalidaid!,
          origenid: linea.origenid!,
          calibreid: linea.calibreid!,
          bultos: linea.bultos!,
          bultosxpalet: linea.bultosxpalet!,
          numero_palet: linea.numero_palet!,
          descripcion_salida: linea.descripcion_salida.trim(),
          ean: linea.ean_pieza ?? linea.ean_bulto ?? linea.ean ?? null,
          ean_caja: linea.ean_caja ?? null,
          nlote_cliente:
            typeof linea.nlote_cliente === 'string' && linea.nlote_cliente.trim()
              ? linea.nlote_cliente.trim()
              : null,
          precio_venta: linea.precio_venta ?? null,
          piezasxbulto: usarPiezas ? linea.piezasxbulto ?? 0 : null,
          total_piezas: usarPiezas ? linea.total_piezas ?? 0 : null,
          catconfecpiezaid: usarPiezas ? linea.catconfecpiezaid ?? 0 : null,
          kilosxbulto: usarPiezas ? null : linea.kilosxbulto ?? 0,
          kilos_cliente: usarPiezas ? null : linea.kilos_cliente ?? 0,
          catconfeckilosbultoid: usarPiezas ? null : linea.catconfeckilosbultoid ?? 0,
        };

        const { data: insertedLinea, error: insertError } = await supabase
          .from('pedido_linea')
          .insert(payload)
          .select('pedidodetid')
          .single();

        if (insertError) throw insertError;
        const newPedidodetid = (insertedLinea as any)?.pedidodetid ?? null;

        const centrosForNewLinea = newCentros[String(linea.tempId)] || (newCentros as any)[linea.tempId] || [];
        if (newPedidodetid && centrosForNewLinea.length) {
          for (const centro of centrosForNewLinea) {
            if (!centro.accepted) continue;
            const centroPayload = {
              pedidodetid: newPedidodetid,
              asignacion: centro.asignacion || 'S',
              numero_palets: centro.numero_palets ?? 0,
              subprov: centro.subprov ?? 0,
            };
            const { error: insertCentroError } = await supabase
              .from('pedido_linea_centro')
              .insert(centroPayload);
            if (insertCentroError) throw insertCentroError;
          }
        }
        hasChanges = true;
      }

      if (hasChanges) {
        await markPedidoNeedsSync(selectedPedido.id);
      }

      toast({
        title: 'Cambios guardados',
        description: `El ${tipoPedido === 'P220' ? 'pedido' : 'previsión'} se ha actualizado correctamente`,
      });

      setIsEditing(false);
      setEditedPedido({});
      setEditedLineas({});
      setEditedCentros({});
      setNewCentros({});
      setDeletedCentros([]);
      setEditingLineaId(null);
      setNewLineas([]);

      // Recargar datos
      await fetchPedidoDetails(selectedPedido.id);
      await fetchPedidos();

    } catch (error: any) {
      toast({
        title: 'Error al guardar',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleRequestDeleteLinea = (lineaId: number) => {
    setLineaToRemove(lineaId);
    const lineaInfo = selectedPedido?.lineas?.find((l) => l.pedidodetid === lineaId);
    setLineaToRemoveDescripcion(lineaInfo?.descripcion_salida ?? null);
    // @ts-expect-error - algunos tipos no incluyen idpedidodet_orizon
    setLineaToRemoveOrizonId((lineaInfo as any)?.idpedidodet_orizon ?? null);
    setShowDeleteLineaDialog(true);
  };

  const deletePedidoLinea = async () => {
    if (!lineaToRemove) return;
    try {
      // Obtener id de Orizon de la línea antes de eliminar localmente
      let idPedidodetOrizon = lineaToRemoveOrizonId;

      if (!idPedidodetOrizon) {
        const { data: lineaOrigen, error: fetchLineaError } = await supabase
          .from('pedido_linea')
          .select('idpedidodet_orizon')
          .eq('pedidodetid', lineaToRemove)
          .single();

        if (fetchLineaError && fetchLineaError.code !== 'PGRST116') {
          throw fetchLineaError;
        }

        idPedidodetOrizon = (lineaOrigen as any)?.idpedidodet_orizon ?? null;
      }

      if (idPedidodetOrizon) {
        toast({
          title: 'Eliminando línea en Orizon',
          description: `Se enviará la eliminación de la línea #${idPedidodetOrizon} en Orizon.`,
        });

        await agroirisAuth.authenticatedFetch(`/pedidodet/${idPedidodetOrizon}`, {
          method: 'DELETE',
        });
      }

      const { error } = await supabase
        .from('pedido_linea')
        .delete()
        .eq('pedidodetid', lineaToRemove);
      if (error) throw error;

      toast({
        title: 'Línea eliminada',
        description: 'La línea se eliminó correctamente.',
      });
      if (selectedPedido) {
        await markPedidoNeedsSync(selectedPedido.id);
      }
      await fetchPedidoDetails(selectedPedido!.id);
    } catch (error: any) {
      toast({
        title: 'Error al eliminar la línea',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setShowDeleteLineaDialog(false);
      setLineaToRemove(null);
      setLineaToRemoveDescripcion(null);
      setLineaToRemoveOrizonId(null);
    }
  };

  const currentMatchingCambioId =
    selectedPedidoMatchInfo?.matching_cambio_id ?? selectedPedido?.matching_cambio_id ?? null;
  const currentMatchingCambioRevisado =
    selectedPedidoMatchInfo?.matching_cambio_revisado ?? selectedPedido?.matching_cambio_revisado ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="container mx-auto p-6 space-y-6">
        {/* Hero */}
        <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent_55%)]" />
          <CardHeader className="relative space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold uppercase tracking-wide text-white/70">{tipoPedido === 'P220' ? 'Pedidos' : 'Previsiones'}</p>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">{title}</h1>
                <p className="text-sm text-white/80">
                  {totalGroups} {totalGroups === 1 ? 'archivo agrupado' : 'archivos agrupados'} · {totalPedidos} {totalPedidos === 1 ? 'pedido' : 'pedidos'}{activeFiltersCount > 0 ? ` · ${activeFiltersCount} filtros activos` : ''}
                </p>
              </div>
              <Badge className="bg-white/15 border-white/20 text-white flex items-center gap-2 self-start">
                <Clock className="h-3.5 w-3.5" />
                {totalPedidos} totales
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Controles */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchPedidos()}
              className="h-9 w-[144px] justify-center gap-2"
              title="Refrescar datos"
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {refreshing ? 'Actualizando...' : 'Refrescar'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={`h-9 w-[144px] justify-center gap-2 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary dark:border-blue-400/70 dark:text-blue-200 dark:hover:bg-blue-400/10 ${showFilters ? 'bg-primary text-primary-foreground dark:bg-blue-500 dark:text-slate-50 border-transparent' : 'bg-background'}`}
            >
              <Filter className="h-4 w-4" />
              Filtros
              {activeFiltersCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center rounded-full">
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>
          </div>
          {tipoPedido === 'P220' && (
            <div className="flex items-center justify-end">
              <Button onClick={() => setManualPedidoDialogOpen(true)} className="gap-2">
                <Send className="h-4 w-4" />
                Enviar pedido
              </Button>
            </div>
          )}
        </div>

        {/* Filtros */}
        {showFilters && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-base">Filtros de búsqueda</CardTitle>
              {activeFiltersCount > 0 && (
                <Button variant="ghost" size="sm" onClick={handleClearFilters} className="gap-2">
                  <X className="h-4 w-4" />
                  Limpiar filtros
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="filter-referencia">Referencia</Label>
                  <Input
                    id="filter-referencia"
                    placeholder="Buscar por referencia..."
                    value={filters.referencia}
                    onChange={(e) => updateFilter('referencia', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <ClientCombobox
                    value={filters.clienteId}
                    onChange={(value) => updateFilter('clienteId', value)}
                    allowedClientIds={clientesConPedidos}
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Domicilio destino</Label>
                  <DomicilioCombobox
                    value={filters.domicilioDestinoId ?? null}
                    onChange={(value) => updateFilter('domicilioDestinoId', value ?? undefined)}
                    clienteId={filters.clienteId ?? null}
                    placeholder="Selecciona un domicilio"
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`order-filter-${tipoPedido}`}>Orden</Label>
                  <Select
                    value={`${filters.sortBy}:${filters.order}`}
                    onValueChange={(value) => {
                      const [nextSortBy, nextOrder] = value.split(':');
                      updateFilter('sortBy', (nextSortBy as 'business_date' | 'email_arrival') ?? 'business_date');
                      updateFilter('order', (nextOrder as 'asc' | 'desc') ?? 'desc');
                    }}
                  >
                    <SelectTrigger id={`order-filter-${tipoPedido}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="business_date:desc">Más recientes (fecha carga/pedido)</SelectItem>
                      <SelectItem value="business_date:asc">Más antiguos (fecha carga/pedido)</SelectItem>
                      <SelectItem value="email_arrival:desc">Más recientes (llegada al correo)</SelectItem>
                      <SelectItem value="email_arrival:asc">Más antiguos (llegada al correo)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha de pedido</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'w-full justify-start text-left font-normal',
                          !(filters.fechaPedidoRango.from || filters.fechaPedidoRango.to) && 'text-muted-foreground',
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        <span>{dateRangeLabel}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <DateRangeCalendar
                        initialFocus
                        mode="range"
                        defaultMonth={pedidoDateRange.from}
                        selected={pedidoDateRange}
                        onSelect={handlePedidoDateRangeChange}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Fecha de carga</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'w-full justify-start text-left font-normal',
                          !(filters.fechaCargaRango.from || filters.fechaCargaRango.to) && 'text-muted-foreground',
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        <span>{cargaDateRangeLabel}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <DateRangeCalendar
                        initialFocus
                        mode="range"
                        defaultMonth={cargaDateRange.from}
                        selected={cargaDateRange}
                        onSelect={handleCargaDateRangeChange}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor={`ceox-status-${tipoPedido}`}>Estado en Ceox</Label>
                  <Select
                    value={filters.ceoxStatus}
                    onValueChange={(value) => updateFilter('ceoxStatus', value as CeoxStatusFilter)}
                  >
                    <SelectTrigger id={`ceox-status-${tipoPedido}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ceoxStatusOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-6">
                <p className="text-sm font-semibold text-muted-foreground mb-3">Estado del pedido</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {booleanFilterOptions.map((option) => (
                    <div
                      key={option.key}
                      className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3"
                    >
                      <div className="mr-3">
                        <p className="text-sm font-medium text-foreground">{option.label}</p>
                        <p className="text-xs text-muted-foreground">{option.description}</p>
                      </div>
                      <Switch
                        checked={Boolean(filters[option.key])}
                        onCheckedChange={(checked) => updateFilter(option.key, checked)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Lista de pedidos */}
        <Card>
          <CardContent className="p-6">
            {pedidosError ? (
              <div className="text-center py-12 space-y-3">
                <Package className="h-10 w-10 mx-auto mb-1 text-destructive/70" />
                <div>
                  <p className="text-sm font-medium text-destructive">No se pudieron cargar los datos.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {pedidosError.message || 'Error de conexión con Supabase.'}
                  </p>
                </div>
                <div className="flex justify-center">
                  <Button variant="outline" size="sm" onClick={() => fetchPedidos()} className="gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Reintentar
                  </Button>
                </div>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
              </div>
            ) : paginatedGroups.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-sm font-medium text-muted-foreground">
                  {activeFiltersCount > 0 ? `No se encontraron ${title.toLowerCase()}` : emptyMessage}
                </p>
                {activeFiltersCount > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">Intenta ajustar los filtros de búsqueda</p>
                )}
              </div>
            ) : (
              <>
                {/* Lista de grupos */}
                <div className="relative">
                  <div className={cn('space-y-3 transition-opacity', pageTransitionLoading && 'opacity-55')}>
                    {paginatedGroups.map((group) => (
                      <PdfGroup
                        key={group.archivoPdfId ?? 'sin-pdf'}
                        archivoPdfId={group.archivoPdfId}
                        pedidos={group.pedidos}
                        totalPedidos={group.totalPedidos}
                        fechaMasReciente={group.fechaMasReciente}
                        clientesUnicos={group.clientesUnicos}
                        tipoPedido={tipoPedido}
                        incompleteDataPedidos={incompleteDataPedidos}
                        domicilioNombres={domicilioNombres}
                        domicilioPlataformas={domicilioPlataformas}
                        clienteNombres={clienteNombres}
                        loadingPedidoId={loadingPedidoId}
                        sendingPedidoId={sendingPedidoId}
                        onViewDetails={viewPedidoDetails}
                        onDelete={openDeleteDialog}
                        onDeleteGroup={openDeleteGroupDialog}
                        onSend={enviarPedido}
                        onOpenPrevision={tipoPedido === 'P220' ? handleOpenPrevisionFromBadge : undefined}
                        openingPrevisionPedidoId={tipoPedido === 'P220' ? loadingPrevisionPedidoId : null}
                        pickingBlockedIds={pickingBlockedIds}
                        isAdmin={isAdmin}
                        senderLabelsById={sentByUserLabels}
                      />
                    ))}
                  </div>
                  {pageTransitionLoading && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-background/55">
                      <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Cargando página...
                      </div>
                    </div>
                  )}
                </div>

                {/* Paginación */}
                {totalGroups > 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 mt-4 border-t">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Mostrar</span>
                      <select
                        value={itemsPerPage}
                        onChange={(e) => {
                          setItemsPerPage(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        disabled={pageTransitionLoading}
                        className="h-8 rounded-md border bg-background px-2 text-sm"
                      >
                        <option value={10}>10</option>
                        <option value={15}>15</option>
                        <option value={30}>30</option>
                      </select>
                      <span className="text-muted-foreground">archivos de {totalGroups}</span>
                      <span className="text-xs text-muted-foreground/70">({totalPedidos} pedidos total)</span>
                      {pageTransitionLoading && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Cargando...
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentPage(1)}
                        disabled={pageTransitionLoading || currentPage === 1}
                        className="h-8 w-8"
                      >
                        <ChevronsLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentPage(currentPage - 1)}
                        disabled={pageTransitionLoading || currentPage === 1}
                        className="h-8 w-8"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      
                      <div className="flex items-center gap-1 px-2">
                        <span className="text-sm font-medium">{currentPage}</span>
                        <span className="text-sm text-muted-foreground">/</span>
                        <span className="text-sm text-muted-foreground">{totalGroupPages}</span>
                      </div>
                      
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentPage(Math.min(totalGroupPages, currentPage + 1))}
                        disabled={pageTransitionLoading || currentPage >= totalGroupPages}
                        className="h-8 w-8"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentPage(totalGroupPages)}
                        disabled={pageTransitionLoading || currentPage >= totalGroupPages}
                        className="h-8 w-8"
                      >
                        <ChevronsRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {tipoPedido === 'P220' && (
        <ManualPedidoDialog
          open={manualPedidoDialogOpen}
          onOpenChange={setManualPedidoDialogOpen}
          allowedClientIds={manualAllowedClientIds}
          onSuccess={async () => {
            await fetchPedidos();
          }}
        />
      )}

      {/* Dialog de detalles del pedido */}
      <PedidoDetailsDialog
        open={dialogOpen}
        onOpenChange={handleCloseDialog}
        pedido={selectedPedido}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        editedPedido={editedPedido}
        setEditedPedido={setEditedPedido}
        editedLineas={editedLineas}
        setEditedLineas={setEditedLineas}
        editedCentros={editedCentros}
        setEditedCentros={setEditedCentros}
        newCentros={newCentros}
        setNewCentros={setNewCentros}
        deletedCentros={deletedCentros}
        setDeletedCentros={setDeletedCentros}
        previousPedidoId={previousPedidoId}
        onBackToPreviousPedido={async () => {
          if (!previousPedidoId) return;
          const targetId = previousPedidoId;
          setPreviousPedidoId(null);
          setNavigatingToRelated(true);
          await handlePedidoRelacionadoClick(targetId);
          setNavigatingToRelated(false);
        }}
        editingLineaId={editingLineaId}
        setEditingLineaId={setEditingLineaId}
        newLineas={newLineas}
        setNewLineas={setNewLineas}
        onRequestDeleteLinea={handleRequestDeleteLinea}
        clienteNombre={clienteNombre}
        clienteEnvioNombre={clienteEnvioNombre}
        divisaNombre={divisaNombre}
        clienteDivisaNombre={clienteDivisaNombre}
        serieDescripcion={serieDescripcion}
        comercialNombre={comercialNombre}
        acreedorNombre={acreedorNombre}
        domicilioDestinoNombre={domicilioDestinoNombre}
        generoNombres={generoNombres}
        calibreNombres={calibreNombres}
        origenNombres={origenNombres}
        tipoCultivoNombres={tipoCultivoNombres}
        catalogoConfecNombres={catalogoConfecNombres}
        grupoConfeccionNombres={grupoConfeccionNombres}
        confeccionPaletNombres={confeccionPaletNombres}
        confeccionSalidaNombres={confeccionSalidaNombres}
        onSave={savePedidoChanges}
        onReload={fetchPedidoDetails}
        onPedidoRelacionadoClick={handlePedidoRelacionadoClick}
        onSendPedido={enviarPedido}
        sendingPedidoId={sendingPedidoId}
        lineClipboard={lineClipboard}
        onCopyLinea={handleCopyLineaToClipboard}
        autoOpenPicking={Boolean(autoOpenPickingPedidoId && selectedPedido && autoOpenPickingPedidoId === selectedPedido.id)}
        onAutoOpenPickingHandled={() => setAutoOpenPickingPedidoId(null)}
        matchingPrevisionId={
          selectedPedidoMatchInfo?.matching_prevision_id ??
          (selectedPedido as any)?.matching_prevision_id ??
          null
        }
        matchingPrevisionUploaded={
          selectedPedidoMatchInfo?.matching_prevision_uploaded ??
          (selectedPedido as any)?.matching_prevision_uploaded ??
          false
        }
        pickingBlocked={selectedPedido ? pickingBlockedIds.has(selectedPedido.id) : false}
        matchingCambioId={currentMatchingCambioId}
        matchingCambioRevisado={Boolean(currentMatchingCambioRevisado)}
        onOpenCambioDialog={openCambioDialogFromPedido}
        cambioMetaAvailable={selectedCambioHasMeta}
      />

      <CambioReviewDialog
        open={cambioDialogOpen}
        onOpenChange={handleCloseCambioDialog}
        cambio={cambioDialogCambio}
        pedido={cambioDialogPedido}
        acreedorActual={cambioDialogAcreedorActual}
        acreedorNuevo={cambioDialogAcreedorNuevo}
        loading={cambioDialogLoading}
        applying={cambioDialogApplying}
        updatingOrizon={Boolean(
          cambioDialogPedido?.id && sendingPedidoId === cambioDialogPedido.id,
        )}
        acceptDisabledReason={cambioDialogDisabledReason}
        onAccept={applyTransportistaCambio}
        onChangeAcreedorNuevo={handleCambioAcreedorNuevoChange}
        pdfActualUrl={cambioDialogPdfActualUrl}
        pdfActualLoading={cambioDialogPdfActualLoading}
        pdfActualError={cambioDialogPdfActualError}
        pdfCambioUrl={cambioDialogPdfCambioUrl}
        pdfCambioLoading={cambioDialogPdfCambioLoading}
        pdfCambioError={cambioDialogPdfCambioError}
        contextTitle={cambioDialogContext.title}
        contextSubtitle={cambioDialogContext.subtitle}
        onUpdateOrizon={handleUpdateOrizonFromCambio}
        mode={cambioDialogMode}
      />

      <AlertDialog
        open={pickingConfirmOpen}
        onOpenChange={(open) => {
          setPickingConfirmOpen(open);
          if (!open) {
            setPickingPayload(null);
            setPickingPedidoId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Picking listo</AlertDialogTitle>
            <AlertDialogDescription>
              {pickingPayload
                ? `${pickingPayload[0]?.detalles?.length ?? 0} línea(s) preparadas para enviar.`
                : '¿Enviar el picking a Orizon?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex flex-wrap gap-2 sm:justify-end">
            <AlertDialogCancel disabled={pickingSending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={sendPickingToAgroiris} disabled={pickingSending}>
              {pickingSending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                'Enviar'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showDeleteLineaDialog} onOpenChange={setShowDeleteLineaDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
          <AlertDialogTitle>Eliminar línea del pedido</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción eliminará la línea seleccionada y los centros asociados. ¿Deseas continuar?
            {lineaToRemove && (
              <div className="mt-3 rounded-md border p-3 text-sm text-muted-foreground">
                <p>
                  <span className="font-semibold">Línea ID:</span> {lineaToRemove}
                </p>
                {lineaToRemoveDescripcion && (
                  <p>
                    <span className="font-semibold">Descripción:</span> {lineaToRemoveDescripcion}
                  </p>
                )}
                {lineaToRemoveOrizonId && (
                  <p className="text-amber-700 font-medium flex items-center gap-1">
                    <span>También se eliminará en Orizon (idpedidodet_orizon #{lineaToRemoveOrizonId}).</span>
                  </p>
                )}
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteLineaDialog(false)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deletePedidoLinea} className="bg-destructive text-destructive-foreground">
              Eliminar línea
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteGroupDialogOpen}
        onOpenChange={(open) => {
          if (deletingGroup) return;
          setDeleteGroupDialogOpen(open);
          if (!open) {
            setGroupToDelete(null);
            setDeletingGroupProgress(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <AlertDialogTitle className="text-xl">Eliminar bloque completo</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-base pt-2">
              {groupToDelete && (
                <div className="space-y-3">
                  <p>
                    Se eliminarán <strong>todos los {tipoPedido === 'P220' ? 'pedidos' : 'previsiones'}</strong> de este bloque.
                  </p>
                  <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Total:</span>
                      <span className="font-semibold">{groupToDelete.pedidos.length}</span>
                    </div>
                    {groupToDelete.archivoPdfId !== null && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">PDF:</span>
                        <span className="font-mono font-semibold">#{groupToDelete.archivoPdfId}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-destructive font-medium">
                    ⚠️ Esta acción no se puede deshacer.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDeleteGroup} disabled={deletingGroup}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={confirmDeleteGroup}
              disabled={deletingGroup}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deletingGroup ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Eliminando...
                  {deletingGroupProgress && (
                    <span className="ml-1">
                      ({deletingGroupProgress.done}/{deletingGroupProgress.total})
                    </span>
                  )}
                </>
              ) : (
                'Eliminar bloque'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog de confirmación de eliminación */}
      <AlertDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (deletingPedido) return;
          setDeleteDialogOpen(open);
          if (!open) setPedidoToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <AlertDialogTitle className="text-xl">
                Confirmar eliminación
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-base pt-2">
              {pedidoToDelete && (
                <div className="space-y-3">
                  <p>
                    ¿Estás seguro de que deseas eliminar este <strong>{tipoPedido === 'P220' ? 'pedido' : 'previsión'}</strong>?
                  </p>
                  <div className="rounded-lg bg-muted p-3 space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">ID:</span>
                      <span className="font-mono font-semibold">#{String(pedidoToDelete.id).slice(0, 8)}</span>
                    </div>
                    {pedidoToDelete.referencia_cliente && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Referencia:</span>
                        <span className="font-medium">{pedidoToDelete.referencia_cliente}</span>
                      </div>
                    )}
                    {pedidoToDelete.referencia2_cliente && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Referencia 2:</span>
                        <span className="font-medium">{pedidoToDelete.referencia2_cliente}</span>
                      </div>
                    )}
                    {pedidoToDelete.fecha_pedido && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Fecha:</span>
                        <span>{formatDateSafe(pedidoToDelete.fecha_pedido, 'dd/MM/yyyy', 'Sin fecha')}</span>
                      </div>
                    )}
                    {parseOrizonId((pedidoToDelete as any)?.idpedido_orizon) && (
                      <div className="flex items-center gap-2 text-amber-700">
                        <span className="text-muted-foreground">Orizon:</span>
                        <span className="font-medium">
                          Se eliminará también en Orizon (ID{' '}
                          {parseOrizonId((pedidoToDelete as any)?.idpedido_orizon)}).
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-destructive font-medium">
                    ⚠️ Esta acción no se puede deshacer. Se eliminarán todas las líneas y centros asociados.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDelete} disabled={deletingPedido}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={confirmDelete}
              disabled={deletingPedido}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deletingPedido ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Eliminando...
                </>
              ) : (
                'Eliminar definitivamente'
              )}
            </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    </div>
  );
};
