import { useCallback, useEffect, useState } from 'react';
import { legacySupabase as supabase } from '@/integrations/supabase/legacyClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Package, Truck, Calendar, FileText, MapPin, Edit, Edit2, Save, X, AlertTriangle, ExternalLink, Plus, Trash2, Send, Loader2, Eye, EyeOff, CheckCircle2, RefreshCw, Copy, ClipboardPaste, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import { ClientCombobox } from '@/components/ClientCombobox';
import { DivisaCombobox } from '@/components/DivisaCombobox';
import { SerieCombobox } from '@/components/SerieCombobox';
import { ComercialCombobox } from '@/components/ComercialCombobox';
import { AcreedorCombobox } from '@/components/AcreedorCombobox';
import { DomicilioCombobox } from '@/components/DomicilioCombobox';
import { GeneroCombobox } from '@/components/GeneroCombobox';
import { CalibreCombobox } from '@/components/CalibreCombobox';
import { OrigenCombobox } from '@/components/OrigenCombobox';
import { TipoCultivoCombobox } from '@/components/TipoCultivoCombobox';
import { CatalogoConfecCombobox } from '@/components/CatalogoConfecCombobox';
import { GrupoConfeccionCombobox } from '@/components/GrupoConfeccionCombobox';
import { ConfeccionPaletCombobox } from '@/components/ConfeccionPaletCombobox';
import { ConfeccionSalidaCombobox } from '@/components/ConfeccionSalidaCombobox';
import { SubcentroCombobox } from '@/components/SubcentroCombobox';
import { cn } from '@/lib/utils';
import { PdfSharedInfo } from '@/components/PdfSharedInfo';
import { PdfViewer } from '@/components/PdfViewer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { agroirisClients } from '@/services/agroirisClients';
import { agroirisDivisas } from '@/services/agroirisDivisas';
import { agroirisPdfFiles } from '@/services/agroirisPdfFiles';
import { agroirisCatConfeckilos, type CatConfeckilosOption } from '@/services/agroirisCatConfeckilos';
import { agroirisCatalogoConfeccionPieza, type CatalogoConfeccionPiezaOption } from '@/services/agroirisCatalogoConfeccionPieza';
import { agroirisCatalogoConfec } from '@/services/agroirisCatalogoConfec';
import { agroirisDomicilios } from '@/services/agroirisDomicilios';
import { agroirisClientePlataformas, type ClientePlataforma } from '@/services/agroirisClientePlataformas';
import { Skeleton } from '@/components/ui/skeleton';
import { agroirisPicking, type PickingRequest } from '@/services/agroirisPicking';
import { getPedidoClienteCeoxDetalle } from '@/services/agroirisPedidos';
import type { Subcentro } from '@/services/agroirisSubcentro';
import type { NewPedidoLineaDraft, PedidoLineaClipboard } from '@/types/pedidos';
import { formatDateSafe } from '@/utils/dateSafe';
import { resolveOrizonId } from '@/utils/orizon';
import { normalizeApiNumber } from '@/utils/number';
// Tipos flexibles que se adaptan a ambas páginas
interface BasePedido {
  id: number;
  referencia_cliente: string;
  referencia2_cliente?: string | null;
  fecha_pedido: string;
  fecha_carga: string;
  tipo_pedido: string;
  clienteid: number;
  clienteid_envio: number;
  divisa_cliente: number;
  seriedoc?: string;
  comercialid: number;
  acreedorid_porte: number;
  domicilio_destino?: number;
  archivo_pdf_id: number | null;
  b64_pedido?: string | null;
  matricula_tractora: string | null;
  matricula_remolque: string | null;
  lineas?: BasePedidoLinea[];
}
interface BasePedidoLinea {
  pedidodetid: number;
  bultos: number;
  bultosxpalet: number;
  numero_palet: number;
  ean?: string | null;
  ean_pieza?: string | null;
  ean_bulto?: string | null;
  ean_caja?: string | null;
  nlote_cliente?: string | null;
  precio_venta?: number | null;
  piezasxbulto?: number;
  total_piezas?: number;
  kilosxbulto?: number;
  kilos_cliente?: number;
  generoid: number;
  calibreid: number;
  origenid: number;
  tipocultivoid: number;
  catalogoconfecid: number;
  grupoconfeccionid: number;
  confeccionpaletid: number;
  confeccionsalidaid: number;
  catconfeckilosbultoid?: number;
  catconfecpiezaid?: number;
  descripcion_salida?: string;
  centros?: BasePedidoLineaCentro[];
}
interface BasePedidoLineaCentro {
  pedcentroid: number;
  asignacion: string;
  numero_palets: number;
  subprov: number;
  pedidodetid: number;
}
interface NewCentroDraft {
  tempId: string;
  asignacion: string;
  numero_palets: number | null;
  subprov: number | null;
  accepted?: boolean;
}
interface PedidoDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pedido: any;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  editedPedido: any;
  setEditedPedido: (pedido: any) => void;
  editedLineas: any;
  setEditedLineas: (lineas: any | ((prev: any) => any)) => void;
  editedCentros: any;
  setEditedCentros: (centros: any | ((prev: any) => any)) => void;
  newCentros: Record<string, NewCentroDraft[]>;
  setNewCentros: (centros: Record<string, NewCentroDraft[]> | ((prev: Record<string, NewCentroDraft[]>) => any)) => void;
  deletedCentros: number[];
  setDeletedCentros: (centros: number[] | ((prev: number[]) => number[])) => void;
  previousPedidoId?: number | null;
  onBackToPreviousPedido?: () => void;
  navigatingToRelated?: boolean;
  editingLineaId: number | null;
  setEditingLineaId: (id: number | null) => void;
  newLineas: NewPedidoLineaDraft[];
  setNewLineas: (
    lineas: NewPedidoLineaDraft[] | ((prev: NewPedidoLineaDraft[]) => NewPedidoLineaDraft[])
  ) => void;
  onRequestDeleteLinea: (lineaId: number) => void;
  clienteNombre: string;
  clienteEnvioNombre: string;
  divisaNombre: string;
  clienteDivisaNombre: string;
  serieDescripcion: string;
  comercialNombre: string;
  acreedorNombre: string;
  domicilioDestinoNombre: string;
  generoNombres: Record<number, string>; // Mapa de generoid -> nombre_genero
  calibreNombres: Record<number, string>; // Mapa de calibreid -> nombre_calibre
  origenNombres: Record<number, string>; // Mapa de origenid -> nombre_origen
  tipoCultivoNombres: Record<number, string>; // Mapa de tipocultivoid -> nombre_tipocultivo
  catalogoConfecNombres: Record<number, string>; // Mapa de catalogoconfecid -> nombre_catalogoconfeccion
  grupoConfeccionNombres: Record<number, string>; // Mapa de grupoconfeccionid -> nombre_grupo_confeccion
  confeccionPaletNombres: Record<number, string>; // Mapa de confeccionpaletid -> nombre_confeccionpalet
  confeccionSalidaNombres: Record<number, string>; // Mapa de confeccionsalidaid -> nombre_confeccionsalida
  onSave: () => Promise<void>;
  onReload: (pedido: any) => Promise<void>;
  onPedidoRelacionadoClick?: (pedidoId: number) => void;
  onSendPedido?: (pedido: any, options?: { ignorePrevision?: boolean }) => void;
  sendingPedidoId?: number | null;
  lineClipboard: PedidoLineaClipboard | null;
  onCopyLinea: (clip: PedidoLineaClipboard) => void;
  matchingPrevisionId?: number | null;
  matchingPrevisionUploaded?: boolean | null;
  pickingBlocked?: boolean;
  autoOpenPicking?: boolean;
  onAutoOpenPickingHandled?: () => void;
  matchingCambioId?: number | null;
  matchingCambioRevisado?: boolean;
  onOpenCambioDialog?: () => void;
  cambioMetaAvailable?: boolean | null;
}

const getLineaEanPieza = (linea: {
  ean?: string | null;
  ean_pieza?: string | null;
  ean_bulto?: string | null;
}) => {
  const value = linea.ean_pieza ?? linea.ean_bulto ?? linea.ean ?? null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return !trimmed || trimmed === '0' ? null : trimmed;
};

const getLineaEanCaja = (linea: { ean_caja?: string | null }) => {
  const value = linea.ean_caja ?? null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return !trimmed || trimmed === '0' ? null : trimmed;
};

const getLineaPrecioVenta = (linea: { precio_venta?: number | string | null }) =>
  normalizeApiNumber(linea.precio_venta);

export const PedidoDetailsDialog = ({
  open,
  onOpenChange,
  pedido,
  isEditing,
  setIsEditing,
  editedPedido,
  setEditedPedido,
  editedLineas,
  setEditedLineas,
  editedCentros,
  setEditedCentros,
  newCentros,
  setNewCentros,
  deletedCentros,
  setDeletedCentros,
  previousPedidoId,
  onBackToPreviousPedido,
  navigatingToRelated = false,
  editingLineaId,
  setEditingLineaId,
  newLineas,
  setNewLineas,
  onRequestDeleteLinea,
  clienteNombre,
  clienteEnvioNombre,
  divisaNombre,
  clienteDivisaNombre,
  serieDescripcion,
  comercialNombre,
  acreedorNombre,
  domicilioDestinoNombre,
  generoNombres,
  calibreNombres,
  origenNombres,
  tipoCultivoNombres,
  catalogoConfecNombres,
  grupoConfeccionNombres,
  confeccionPaletNombres,
  confeccionSalidaNombres,
  onSave,
  onReload,
  onPedidoRelacionadoClick,
  onSendPedido,
  sendingPedidoId,
  lineClipboard,
  onCopyLinea,
  matchingPrevisionId: matchingPrevisionIdProp,
  matchingPrevisionUploaded: matchingPrevisionUploadedProp,
  pickingBlocked: pickingBlockedProp = false,
  autoOpenPicking = false,
  onAutoOpenPickingHandled,
  matchingCambioId,
  matchingCambioRevisado,
  onOpenCambioDialog,
  cambioMetaAvailable = null,
}: PedidoDetailsDialogProps) => {
  const { toast } = useToast();
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [sharedPdfPanelOpen, setSharedPdfPanelOpen] = useState(false);
  const [sharedPdfRelatedCount, setSharedPdfRelatedCount] = useState(0);
  const [catalogoKilosOptions, setCatalogoKilosOptions] = useState<Record<number, CatConfeckilosOption[]>>({});
  const [catalogoPiezasOptions, setCatalogoPiezasOptions] = useState<Record<number, CatalogoConfeccionPiezaOption[]>>({});
  const [catalogoOptionsLoading, setCatalogoOptionsLoading] = useState<Record<number, boolean>>({});
  const [subcentroNombres, setSubcentroNombres] = useState<Record<number, string>>({});
  const [subcentrosList, setSubcentrosList] = useState<Subcentro[]>([]);
  const [plataformaDestino, setPlataformaDestino] = useState<ClientePlataforma | null>(null);
  const [plataformaDestinoLoading, setPlataformaDestinoLoading] = useState(false);
  const [plataformaDestinoError, setPlataformaDestinoError] = useState<string | null>(null);
  const [showPickingDialog, setShowPickingDialog] = useState(false);
  const [pickingSending, setPickingSending] = useState(false);
  const [previsionOrizonId, setPrevisionOrizonId] = useState<number | null>(null);
  const [previsionLineas, setPrevisionLineas] = useState<
    Array<{ pedidodetid: number; idpedidodet_orizon: number | null; descripcion_salida: string | null; numero_palet: number | null }>
  >([]);
  const [previsionClienteId, setPrevisionClienteId] = useState<number | null>(null);
  const [pickingPreviewPayload, setPickingPreviewPayload] = useState<Record<string, any> | null>(null);
  const [linePasteBackups, setLinePasteBackups] = useState<Record<string, Partial<BasePedidoLinea> | null>>({});
  const [ignorePrevisionDialogOpen, setIgnorePrevisionDialogOpen] = useState(false);
  const [autoPickingHandled, setAutoPickingHandled] = useState(false);
  const [descripcionLoadingByKey, setDescripcionLoadingByKey] = useState<Record<string, boolean>>({});
  const [ceoxCodigoPedido, setCeoxCodigoPedido] = useState<number | null>(null);
  const [ceoxCodigoPedidoLoading, setCeoxCodigoPedidoLoading] = useState(false);

  const selectedDomicilioDestinoId =
    editedPedido?.sujetodomicilioid_destino ?? pedido?.sujetodomicilioid_destino ?? null;
  const orizonId = resolveOrizonId(
    (pedido as any)?.idpedido_orizon,
    (pedido as any)?.pedidoclienteid,
  );
  const hasOrizonId = Boolean(orizonId);

  useEffect(() => {
    if (!open) {
      setSharedPdfPanelOpen(false);
    }
  }, [open]);

  useEffect(() => {
    let active = true;

    setSharedPdfRelatedCount(0);
    setSharedPdfPanelOpen(false);

    if (!open || !pedido?.archivo_pdf_id) {
      return () => {
        active = false;
      };
    }

    const loadSharedPdfRelatedCount = async () => {
      const pedidos = await agroirisPdfFiles.getPedidosByPdfId(
        pedido.archivo_pdf_id!,
        pedido.clienteid ?? null,
      );

      if (!active) return;
      const relatedCount = pedidos.filter((item) => item.pedido_id !== pedido.id).length;
      setSharedPdfRelatedCount(relatedCount);
    };

    void loadSharedPdfRelatedCount();

    return () => {
      active = false;
    };
  }, [open, pedido?.archivo_pdf_id, pedido?.clienteid, pedido?.id]);

  useEffect(() => {
    let active = true;
    const loadPlataformaDestino = async () => {
      if (!selectedDomicilioDestinoId) {
        if (!active) return;
        setPlataformaDestino(null);
        setPlataformaDestinoError(null);
        setPlataformaDestinoLoading(false);
        return;
      }
      setPlataformaDestinoLoading(true);
      setPlataformaDestinoError(null);
      try {
        const domicilio = await agroirisDomicilios.getDomicilioById(selectedDomicilioDestinoId);
        const plataformaId = domicilio?.clienteplataformaid ?? 0;
        if (!plataformaId) {
          if (active) {
            setPlataformaDestino(null);
          }
          return;
        }
        const plataforma = await agroirisClientePlataformas.getPlataformaById(plataformaId);
        if (active) {
          setPlataformaDestino(plataforma);
        }
      } catch (error) {
        console.error('Error cargando plataforma destino:', error);
        if (active) {
          setPlataformaDestino(null);
          setPlataformaDestinoError('No se pudo cargar la plataforma.');
        }
      } finally {
        if (active) {
          setPlataformaDestinoLoading(false);
        }
      }
    };
    loadPlataformaDestino();
    return () => {
      active = false;
    };
  }, [selectedDomicilioDestinoId]);
  useEffect(() => {
    if (autoOpenPicking) {
      setAutoPickingHandled(false);
    }
  }, [autoOpenPicking]);
  const resolvedMatchingPrevisionId =
    matchingPrevisionIdProp ?? (pedido as any)?.matching_prevision_id ?? null;
  const hasMatchingPrevision = Boolean(resolvedMatchingPrevisionId);
  const matchingPrevisionUploadedValue =
    matchingPrevisionUploadedProp ?? (pedido as any)?.matching_prevision_uploaded ?? false;
  const matchingPrevisionUploaded = Boolean(matchingPrevisionUploadedValue);
  const pickingBlocked = hasMatchingPrevision && (!matchingPrevisionUploaded || pickingBlockedProp);
  useEffect(() => {
    let isMounted = true;
    let objectUrl: string | null = null;
    const cleanup = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };
    const resetPreviewState = (message: string | null) => {
      setPdfPreviewUrl(null);
      setPdfPreviewError(message);
      setPdfPreviewLoading(false);
    };
    const createObjectUrlFromBase64 = (base64: string) => {
      const byteCharacters = atob(base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      return URL.createObjectURL(blob);
    };
    const loadPdfPreview = async () => {
      if (!pedido) {
        resetPreviewState(null);
        return;
      }
      const hasAttachment = Boolean(pedido.archivo_pdf_id || pedido.b64_pedido);
      if (!hasAttachment) {
        resetPreviewState('No hay documento PDF adjunto.');
        return;
      }
      setPdfPreviewLoading(true);
      setPdfPreviewError(null);
      try {
        let base64Content: string | null = null;
        if (pedido.archivo_pdf_id) {
          base64Content = await agroirisPdfFiles.getPdfContent(pedido.archivo_pdf_id);
        } else if (pedido.b64_pedido) {
          base64Content = pedido.b64_pedido;
        }
        if (!isMounted) return;
        if (base64Content) {
          objectUrl = createObjectUrlFromBase64(base64Content);
          setPdfPreviewUrl(objectUrl);
        } else {
          setPdfPreviewUrl(null);
          setPdfPreviewError('No se encontró contenido para este PDF.');
        }
      } catch (error) {
        console.error('Error cargando vista previa del PDF:', error);
        if (isMounted) {
          setPdfPreviewUrl(null);
          setPdfPreviewError('No se pudo cargar el PDF.');
        }
      } finally {
        if (isMounted) {
          setPdfPreviewLoading(false);
        }
      }
    };
    loadPdfPreview();
    return () => {
      isMounted = false;
      cleanup();
    };
  }, [pedido?.archivo_pdf_id, pedido?.b64_pedido, pedido?.id]);
  const handleInlinePdfOpen = () => {
    if (pdfPreviewUrl) {
      window.open(pdfPreviewUrl, '_blank');
    }
  };
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
  const getNewCentrosList = (lineaId: number | string, state?: Record<string, NewCentroDraft[]>) => {
    const key = getLineaKey(lineaId);
    const source = state || newCentros;
    return source[key] || (source as any)[lineaId] || [];
  };
  const updateNewLineaFields = (tempId: string, changes: Partial<NewPedidoLineaDraft>) => {
    setNewLineas(prev => prev.map(linea => (linea.tempId === tempId ? { ...linea, ...changes } : linea)));
  };
  const handleNewLineaChange = <K extends keyof NewPedidoLineaDraft>(tempId: string, field: K, value: NewPedidoLineaDraft[K]) => {
    updateNewLineaFields(tempId, { [field]: value } as Partial<NewPedidoLineaDraft>);
  };
  const handleAddNewLinea = () => {
    setNewLineas(prev => [...prev, createEmptyLinea()]);
  };
  const handleRemoveNewLinea = (tempId: string) => {
    setNewLineas(prev => prev.filter(linea => linea.tempId !== tempId));
  };
  const toClipboardPayload = (linea: Partial<BasePedidoLinea> | NewPedidoLineaDraft): Omit<NewPedidoLineaDraft, 'tempId'> => ({
    generoid: linea.generoid ?? null,
    tipocultivoid: linea.tipocultivoid ?? null,
    catalogoconfecid: linea.catalogoconfecid ?? null,
    grupoconfeccionid: linea.grupoconfeccionid ?? null,
    confeccionpaletid: linea.confeccionpaletid ?? null,
    confeccionsalidaid: linea.confeccionsalidaid ?? null,
    origenid: linea.origenid ?? null,
    calibreid: linea.calibreid ?? null,
    bultos: linea.bultos ?? null,
    bultosxpalet: linea.bultosxpalet ?? null,
    numero_palet: linea.numero_palet ?? null,
    piezasxbulto: linea.piezasxbulto ?? null,
    total_piezas: linea.total_piezas ?? null,
    kilosxbulto: (linea as any)?.kilosxbulto ?? null,
    kilos_cliente: (linea as any)?.kilos_cliente ?? null,
    descripcion_salida: (linea.descripcion_salida as string) ?? '',
    catconfecpiezaid: linea.catconfecpiezaid ?? null,
    catconfeckilosbultoid: linea.catconfeckilosbultoid ?? null,
    ean: getLineaEanPieza(linea as BasePedidoLinea),
    ean_pieza: getLineaEanPieza(linea as BasePedidoLinea),
    ean_bulto: getLineaEanPieza(linea as BasePedidoLinea),
    ean_caja: getLineaEanCaja(linea as BasePedidoLinea),
    nlote_cliente: (linea as any)?.nlote_cliente ?? null,
    precio_venta: getLineaPrecioVenta(linea as BasePedidoLinea),
  });
  const handleCopyLinea = (linea: Partial<BasePedidoLinea> | NewPedidoLineaDraft) => {
    const payload = toClipboardPayload(linea);
    const label =
      (linea as any)?.descripcion_salida?.toString().trim() ||
      `Línea ${(linea as any)?.pedidodetid ?? (linea as any)?.tempId ?? ''}`;
    onCopyLinea({
      payload,
      sourcePedidoId: (pedido as any)?.id ?? null,
      sourceLineaId: (linea as any)?.pedidodetid ?? (linea as any)?.tempId ?? null,
      label,
      createdAt: Date.now(),
    });
  };
  const handlePasteAsNewLinea = () => {
    if (!lineClipboard) return;
    const newLinea: NewPedidoLineaDraft = { tempId: generateTempId(), ...lineClipboard.payload };
    setIsEditing(true);
    setNewLineas((prev) => [...prev, newLinea]);
    ensureCatalogoOptions(newLinea.catalogoconfecid ?? null);
    toast({
      title: 'Línea pegada',
      description: 'Añadida como nueva línea.',
    });
  };
  const handlePasteOverwriteLinea = (lineaId: number) => {
    if (!lineClipboard) return;
    const key = getLineaKey(lineaId);
    setLinePasteBackups((prev) => ({
      ...prev,
      [key]: editedLineas[lineaId] ? { ...editedLineas[lineaId] } : null,
    }));
    setIsEditing(true);
    setEditedLineas((prev) => ({
      ...prev,
      [lineaId]: { ...lineClipboard.payload },
    }));
    setEditingLineaId(lineaId);
    ensureCatalogoOptions(lineClipboard.payload.catalogoconfecid ?? null);
    toast({
      title: 'Línea pegada',
      description: `Sustituye la línea #${lineaId}. Guarda para aplicar.`,
    });
  };
  const handleUndoPaste = (lineaId: number) => {
    const key = getLineaKey(lineaId);
    setEditedLineas((prev) => {
      const backup = linePasteBackups[key];
      const next = { ...prev };
      if (backup === undefined) return prev;
      if (backup === null) {
        delete next[lineaId];
      } else {
        next[lineaId] = backup;
      }
      return next;
    });
    setLinePasteBackups((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    toast({
      title: 'Pegado cancelado',
      description: `Restaurada la línea #${lineaId} al estado previo.`,
    });
  };
  const handleCancelLineaEdit = (lineaId: number) => {
    const lineKey = getLineaKey(lineaId);
    const centrosLinea = (pedido?.lineas ?? []).find((l: any) => getLineaKey(l.pedidodetid) === lineKey)?.centros ?? [];
    const centroIds = new Set<number>(centrosLinea.map((c: any) => c.pedcentroid));

    setEditedLineas((prev) => {
      if (!(lineaId in prev)) return prev;
      const next = { ...prev };
      delete next[lineaId];
      return next;
    });
    setEditedCentros((prev: Record<number, any>) => {
      const next = { ...prev };
      let changed = false;
      centroIds.forEach((id) => {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setDeletedCentros((prev) => prev.filter((id) => !centroIds.has(id)));
    setNewCentros((prev) => {
      if (!(lineKey in prev) && !(lineaId in (prev as Record<string, NewCentroDraft[]>))) return prev;
      const next = { ...prev };
      delete next[lineKey];
      delete next[String(lineaId)];
      return next;
    });
    setLinePasteBackups((prev) => {
      if (!(lineKey in prev)) return prev;
      const next = { ...prev };
      delete next[lineKey];
      return next;
    });
    setEditingLineaId(null);
    toast({
      title: 'Cambios descartados',
      description: `Se descartaron los cambios de la línea #${lineaId}.`,
    });
  };
  const updateEditedLineaFields = (lineaId: number, changes: Partial<BasePedidoLinea>) => {
    setEditedLineas(prev => ({
      ...prev,
      [lineaId]: {
        ...prev[lineaId],
        ...changes,
      },
    }));
  };
  const ensureCatalogoOptions = useCallback(
    async (catalogoconfecid: number | null | undefined) => {
      if (!catalogoconfecid) return;
      const hasKilos = Boolean(catalogoKilosOptions[catalogoconfecid]);
      const hasPiezas = Boolean(catalogoPiezasOptions[catalogoconfecid]);
      if (hasKilos && hasPiezas) return;
      if (catalogoOptionsLoading[catalogoconfecid]) return;
      setCatalogoOptionsLoading(prev => ({ ...prev, [catalogoconfecid]: true }));
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
          setCatalogoKilosOptions(prev => ({ ...prev, [catalogoconfecid]: kilos }));
        }
        if (!hasPiezas) {
          setCatalogoPiezasOptions(prev => ({ ...prev, [catalogoconfecid]: piezas }));
        }
      } catch (error) {
        console.error('Error cargando opciones dinámicas de catálogo:', error);
        setCatalogoKilosOptions(prev => ({ ...prev, [catalogoconfecid]: prev[catalogoconfecid] ?? [] }));
        setCatalogoPiezasOptions(prev => ({ ...prev, [catalogoconfecid]: prev[catalogoconfecid] ?? [] }));
      } finally {
        setCatalogoOptionsLoading(prev => {
          const next = { ...prev };
          delete next[catalogoconfecid];
          return next;
        });
      }
    },
    [catalogoKilosOptions, catalogoPiezasOptions, catalogoOptionsLoading]
  );
  useEffect(() => {
    const catalogoIds = new Set<number>();
    pedido?.lineas?.forEach(linea => {
      if (linea.catalogoconfecid) {
        catalogoIds.add(linea.catalogoconfecid);
      }
    });
    newLineas.forEach(linea => {
      if (linea.catalogoconfecid) {
        catalogoIds.add(linea.catalogoconfecid);
      }
    });
    catalogoIds.forEach(id => {
      ensureCatalogoOptions(id);
    });
  }, [pedido?.lineas, newLineas, ensureCatalogoOptions]);

  useEffect(() => {
    const loadSubcentros = async () => {
      try {
        const { agroirisSubcentro } = await import('@/services/agroirisSubcentro');
        const list = await agroirisSubcentro.getAll();
        const map: Record<number, string> = {};
        list.forEach((s) => {
          map[s.subcentroid] = `${s.nombre_subcentro} (ID: ${s.subcentroid})`;
        });
        setSubcentroNombres(map);
        setSubcentrosList(list);
      } catch (error) {
        console.error('Error cargando subcentros:', error);
      }
    };
    loadSubcentros();
  }, []);

  // Obtener id de Orizon de la previsión vinculada para el payload de picking
  useEffect(() => {
    const fetchPrevisionOrizon = async () => {
      if (!resolvedMatchingPrevisionId || !matchingPrevisionUploaded) {
        setPrevisionOrizonId(null);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('pedidos')
          .select('idpedido_orizon, pedidoclienteid, clienteid, clienteid_envio')
          .eq('id', resolvedMatchingPrevisionId)
          .maybeSingle();
        if (error) throw error;
        const orizonId = resolveOrizonId(
          (data as any)?.idpedido_orizon,
          (data as any)?.pedidoclienteid,
        );
        setPrevisionOrizonId(orizonId);
        const clienteOrigen =
          (data as any)?.clienteid ??
          (data as any)?.clienteid_envio ??
          null;
        setPrevisionClienteId(clienteOrigen);
      } catch (err) {
        console.error('Error obteniendo id Orizon de previsión:', err);
        setPrevisionOrizonId(null);
        setPrevisionClienteId(null);
      }
    };
    fetchPrevisionOrizon();
  }, [resolvedMatchingPrevisionId, matchingPrevisionUploaded]);

  // Cargar líneas de la previsión para obtener idpedidodet_orizon
  useEffect(() => {
    const fetchPrevisionLineas = async () => {
      if (!resolvedMatchingPrevisionId) {
        setPrevisionLineas([]);
        return;
      }
      try {
        const { data, error } = await supabase
          .from('pedido_linea')
          .select('pedidodetid, idpedidodet_orizon, descripcion_salida, numero_palet')
          .eq('pedidoid', resolvedMatchingPrevisionId);
        if (error) throw error;
        setPrevisionLineas(
          (data as any[])?.map((l) => ({
            pedidodetid: l.pedidodetid,
            idpedidodet_orizon: l.idpedidodet_orizon ?? null,
            descripcion_salida: l.descripcion_salida ?? null,
            numero_palet: normalizeApiNumber(l.numero_palet),
          })) ?? []
        );
      } catch (err) {
        console.error('Error obteniendo líneas de previsión:', err);
        setPrevisionLineas([]);
      }
    };
    fetchPrevisionLineas();
  }, [resolvedMatchingPrevisionId]);

  useEffect(() => {
    let cancelled = false;

    const loadCeoxPedido = async () => {
      if (!hasOrizonId || !orizonId) {
        setCeoxCodigoPedido(null);
        setCeoxCodigoPedidoLoading(false);
        return;
      }

      setCeoxCodigoPedidoLoading(true);

      try {
        const detalle = await getPedidoClienteCeoxDetalle(orizonId);
        if (!cancelled) {
          setCeoxCodigoPedido(detalle?.codigo_pedido ?? null);
        }
      } catch (error) {
        console.error('Error cargando número de pedido en Ceox:', error);
        if (!cancelled) {
          setCeoxCodigoPedido(null);
        }
      } finally {
        if (!cancelled) {
          setCeoxCodigoPedidoLoading(false);
        }
      }
    };

    loadCeoxPedido();

    return () => {
      cancelled = true;
    };
  }, [hasOrizonId, orizonId]);
  const getKilosOptions = (catalogoconfecid?: number | null) =>
    catalogoconfecid ? catalogoKilosOptions[catalogoconfecid] ?? [] : [];
  const getPiezasOptions = (catalogoconfecid?: number | null) =>
    catalogoconfecid ? catalogoPiezasOptions[catalogoconfecid] ?? [] : [];
  const isCatalogoLoading = (catalogoconfecid?: number | null) =>
    catalogoconfecid ? Boolean(catalogoOptionsLoading[catalogoconfecid]) : false;
  const formatDescripcionNumber = (value: number) => {
    const hasDecimals = Math.abs(value - Math.trunc(value)) > Number.EPSILON;
    return new Intl.NumberFormat('es-ES', {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: hasDecimals ? 2 : 0,
    }).format(value);
  };
  const normalizeTipoGrupo = (value?: string | null): 'S' | 'N' | 'P' | 'B' => {
    const normalized = (value ?? 'S').trim().toUpperCase();
    if (normalized === 'N' || normalized === 'P' || normalized === 'B') return normalized;
    return 'S';
  };
  const buildDescripcionSalidaERP = useCallback(
    async (
      catalogoconfecid: number | null | undefined,
      nombreCatalogo: string | null | undefined,
      piezasxbulto: number | null | undefined,
      kilosxbulto: number | null | undefined,
    ): Promise<string> => {
      let fallbackNombre =
        nombreCatalogo?.trim() ||
        (catalogoconfecid ? catalogoConfecNombres[catalogoconfecid]?.trim() : '') ||
        '';

      try {
        let tipoGrupo: 'S' | 'N' | 'P' | 'B' = 'S';
        if (catalogoconfecid) {
          const catalogo = await agroirisCatalogoConfec.getCatalogoById(catalogoconfecid);
          if (!fallbackNombre) {
            fallbackNombre = catalogo?.nombre_catalogoconfeccion?.trim() || '';
          }
          tipoGrupo = normalizeTipoGrupo(catalogo?.tipo_grupo_confeccion);
        }
        if (!fallbackNombre) return '';

        switch (tipoGrupo) {
          case 'N': {
            const piezas = Number.isFinite(piezasxbulto as number) ? (piezasxbulto as number) : 0;
            return `${fallbackNombre} ${formatDescripcionNumber(piezas)} Pz`;
          }
          case 'P': {
            const piezas = Number.isFinite(piezasxbulto as number) ? (piezasxbulto as number) : null;
            const kilos = Number.isFinite(kilosxbulto as number) ? (kilosxbulto as number) : null;
            if (!piezas || piezas <= 0 || kilos == null) {
              return fallbackNombre;
            }
            let gramos = (kilos / piezas) * 1000;
            let unidad = ' gr';
            if (gramos >= 1000) {
              gramos /= 1000;
              unidad = ' Kg';
            }
            return `${fallbackNombre} ${formatDescripcionNumber(piezas)} x ${formatDescripcionNumber(gramos)}${unidad}`;
          }
          case 'B': {
            const kilos = Number.isFinite(kilosxbulto as number) ? (kilosxbulto as number) : null;
            if (kilos == null) return fallbackNombre;
            return `${fallbackNombre} ${formatDescripcionNumber(kilos)} Kg`;
          }
          case 'S':
          default:
            return fallbackNombre;
        }
      } catch (error) {
        console.error('Error generando descripción ERP:', error);
        return fallbackNombre;
      }
    },
    [catalogoConfecNombres],
  );
  const setDescripcionLoading = (key: string, loading: boolean) => {
    setDescripcionLoadingByKey((prev) => {
      if (loading) return { ...prev, [key]: true };
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };
  const handleCatalogoChangeForLinea = (
    lineaId: number,
    catalogoId: number,
    catalogoNombre?: string,
    confeccionSalidaId?: number | null,
    grupoConfeccionId?: number | null,
  ) => {
    const descripcion = catalogoNombre?.trim() || catalogoConfecNombres[catalogoId];
    updateEditedLineaFields(lineaId, {
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
  };
  const handleCatalogoChangeForNewLinea = (
    tempId: string,
    catalogoId: number,
    catalogoNombre?: string,
    confeccionSalidaId?: number | null,
    grupoConfeccionId?: number | null,
  ) => {
    const descripcion = catalogoNombre?.trim() || catalogoConfecNombres[catalogoId];
    updateNewLineaFields(tempId, {
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
  };
  const handleConfeccionSalidaChangeForLinea = (
    lineaId: number,
    confeccionSalidaId: number | null,
    grupoConfeccionId?: number | null,
  ) => {
    updateEditedLineaFields(lineaId, {
      confeccionsalidaid: confeccionSalidaId,
      grupoconfeccionid: grupoConfeccionId ?? null,
    });
  };
  const handleConfeccionSalidaChangeForNewLinea = (
    tempId: string,
    confeccionSalidaId: number | null,
    grupoConfeccionId?: number | null,
  ) => {
    updateNewLineaFields(tempId, {
      confeccionsalidaid: confeccionSalidaId,
      grupoconfeccionid: grupoConfeccionId ?? null,
    });
  };
  const handleCatConfeckilosChange = (lineaId: number, catalogoId: number | null | undefined, selectedId: number | null) => {
    const option =
      catalogoId && selectedId
        ? getKilosOptions(catalogoId).find(opt => opt.catconfeckilosbultoid === selectedId)
        : null;
    updateEditedLineaFields(lineaId, {
      catconfeckilosbultoid: selectedId,
      kilosxbulto: option?.kilosxbulto ?? null,
    });
  };
  const handleCatConfeckilosChangeForNew = (tempId: string, catalogoId: number | null | undefined, selectedId: number | null) => {
    const option =
      catalogoId && selectedId
        ? getKilosOptions(catalogoId).find(opt => opt.catconfeckilosbultoid === selectedId)
        : null;
    updateNewLineaFields(tempId, {
      catconfeckilosbultoid: selectedId,
      kilosxbulto: option?.kilosxbulto ?? null,
    });
  };
  const handleCatConfecPiezaChange = (lineaId: number, catalogoId: number | null | undefined, selectedId: number | null) => {
    const option =
      catalogoId && selectedId
        ? getPiezasOptions(catalogoId).find(opt => opt.catalogoconfeccionpiezaid === selectedId)
        : null;
    updateEditedLineaFields(lineaId, {
      catconfecpiezaid: selectedId,
      piezasxbulto: option?.nro_piezas ?? null,
    });
  };
  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  const isFractionalPalet = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value);
  const calculateBultos = (
    numeroPalet: number | null | undefined,
    bultosxpalet: number | null | undefined
  ) =>
    isFiniteNumber(numeroPalet) && isFiniteNumber(bultosxpalet)
      ? numeroPalet * bultosxpalet
      : null;
  const calculateKilosCliente = (kilosxbulto: number | null | undefined, bultos: number | null | undefined) =>
    isFiniteNumber(kilosxbulto) && isFiniteNumber(bultos) ? kilosxbulto * bultos : null;
  const calculateTotalPiezas = (
    piezasxbulto: number | null | undefined,
    bultos: number | null | undefined
  ) =>
    isFiniteNumber(piezasxbulto) && isFiniteNumber(bultos)
      ? piezasxbulto * bultos
      : null;
  const handleCalculateBultos = (
    lineaId: number,
    numeroPalet?: number | null,
    bultosxpalet?: number | null
  ) => {
    const calculated = calculateBultos(numeroPalet, bultosxpalet);
    if (calculated == null) {
      toast({
        title: 'No se pudo calcular bultos',
        description: 'Completa numero de palet y bultos x palet antes de calcular.',
      });
      return;
    }
    updateEditedLineaFields(lineaId, { bultos: calculated });
  };
  const handleCalculateBultosForNew = (
    tempId: string,
    numeroPalet?: number | null,
    bultosxpalet?: number | null
  ) => {
    const calculated = calculateBultos(numeroPalet, bultosxpalet);
    if (calculated == null) {
      toast({
        title: 'No se pudo calcular bultos',
        description: 'Completa numero de palet y bultos x palet antes de calcular.',
      });
      return;
    }
    updateNewLineaFields(tempId, { bultos: calculated });
  };
  const handleCalculateKilosCliente = (lineaId: number, kilosxbulto?: number | null, bultos?: number | null) => {
    const calculated = calculateKilosCliente(kilosxbulto, bultos);
    if (calculated == null) {
      toast({
        title: 'No se pudo calcular kilos cliente',
        description: 'Completa kilos x bulto y bultos antes de calcular.',
      });
      return;
    }
    updateEditedLineaFields(lineaId, { kilos_cliente: calculated });
  };
  const handleCalculateKilosClienteForNew = (tempId: string, kilosxbulto?: number | null, bultos?: number | null) => {
    const calculated = calculateKilosCliente(kilosxbulto, bultos);
    if (calculated == null) {
      toast({
        title: 'No se pudo calcular kilos cliente',
        description: 'Completa kilos x bulto y bultos antes de calcular.',
      });
      return;
    }
    updateNewLineaFields(tempId, { kilos_cliente: calculated });
  };
  const handleCalculateTotalPiezas = (
    lineaId: number,
    piezasxbulto?: number | null,
    bultos?: number | null
  ) => {
    const calculated = calculateTotalPiezas(piezasxbulto, bultos);
    if (calculated == null) {
      toast({
        title: 'No se pudo calcular total piezas',
        description: 'Completa piezas x bulto y bultos antes de calcular.',
      });
      return;
    }
    updateEditedLineaFields(lineaId, { total_piezas: calculated });
  };
  const handleCalculateTotalPiezasForNew = (
    tempId: string,
    piezasxbulto?: number | null,
    bultos?: number | null
  ) => {
    const calculated = calculateTotalPiezas(piezasxbulto, bultos);
    if (calculated == null) {
      toast({
        title: 'No se pudo calcular total piezas',
        description: 'Completa piezas x bulto y bultos antes de calcular.',
      });
      return;
    }
    updateNewLineaFields(tempId, { total_piezas: calculated });
  };
  const addNewCentro = (lineaId: number | string) => {
    const key = getLineaKey(lineaId);
    const tempId = `temp-centro-${key}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const usedSubprovIds = getUsedSubprovIds(lineaId);
    const available = subcentrosList.filter(s => !usedSubprovIds.has(s.subcentroid));
    if (available.length === 0) {
      toast({
        title: 'Sin subcentros disponibles',
        description: 'Ya has asignado todos los subcentros disponibles a esta línea.',
        variant: 'destructive',
      });
      return;
    }
    setNewCentros((prev) => {
      const list = getNewCentrosList(lineaId, prev);
      return {
        ...prev,
        [key]: [
          ...list,
          { tempId, asignacion: getNextAsignacionLibre(lineaId), numero_palets: 0, subprov: available[0]?.subcentroid ?? null, accepted: false },
        ],
      };
    });
  };
  const updateNewCentro = (
    lineaId: number | string,
    tempId: string,
    field: 'asignacion' | 'numero_palets' | 'subprov' | 'accepted',
    value: string | number | boolean | null
  ) => {
    const key = getLineaKey(lineaId);
    setNewCentros((prev) => {
      const list = getNewCentrosList(lineaId, prev);
      return {
        ...prev,
        [key]: list.map((c) =>
          c.tempId === tempId ? { ...c, [field]: value } : c
        ),
      };
    });
  };
  const removeNewCentro = (lineaId: number | string, tempId: string) => {
    const key = getLineaKey(lineaId);
    setNewCentros((prev) => {
      const list = getNewCentrosList(lineaId, prev);
      const target = list.find((c) => c.tempId === tempId);
      const activeExisting = getActiveExistingCount(lineaId);
      const activeNew = list.filter((c) => c.accepted && c.tempId !== tempId).length;
      if (target?.accepted && activeExisting + activeNew <= 1) {
        toast({
          title: 'Debe quedar al menos un centro',
          description: 'No puedes eliminar todos los centros de la línea.',
          variant: 'destructive',
        });
        return prev;
      }
      const next = list.filter((c) => c.tempId !== tempId);
      const copy = { ...prev, [key]: next };
      if (next.length === 0) {
        delete copy[key];
      }
      return copy;
    });
  };
  const toggleDeleteCentro = (pedcentroid: number) => {
    setDeletedCentros((prev) => {
      const currentLine = pedido.lineas?.find((l: any) =>
        l.centros?.some((c: any) => c.pedcentroid === pedcentroid)
      );
      const lineaId = currentLine?.pedidodetid;
      const activeExisting = lineaId ? getActiveExistingCount(lineaId) : 0;
      const acceptedNew = lineaId ? getNewCentrosList(lineaId).filter((c) => c.accepted).length : 0;
      const currentlyDeleted = prev.includes(pedcentroid);
      if (!currentlyDeleted && activeExisting + acceptedNew - 1 < 1) {
        toast({
          title: 'Debe quedar al menos un centro',
          description: 'No puedes eliminar todos los centros de la línea.',
          variant: 'destructive',
        });
        return prev;
      }
      return currentlyDeleted ? prev.filter((id) => id !== pedcentroid) : [...prev, pedcentroid];
    });
  };
  const handleCatConfecPiezaChangeForNew = (tempId: string, catalogoId: number | null | undefined, selectedId: number | null) => {
    const option =
      catalogoId && selectedId
        ? getPiezasOptions(catalogoId).find(opt => opt.catalogoconfeccionpiezaid === selectedId)
        : null;
    updateNewLineaFields(tempId, {
      catconfecpiezaid: selectedId,
      piezasxbulto: option?.nro_piezas ?? null,
    });
  };
  const handleGenerateDescripcionForNewLinea = async (linea: NewPedidoLineaDraft) => {
    const key = `new-${linea.tempId}`;
    setDescripcionLoading(key, true);
    try {
      const descripcion = await buildDescripcionSalidaERP(
        linea.catalogoconfecid ?? null,
        linea.catalogoconfecid ? catalogoConfecNombres[linea.catalogoconfecid] ?? '' : '',
        linea.piezasxbulto ?? null,
        linea.kilosxbulto ?? null,
      );
      if (!descripcion) {
        toast({
          title: 'No se pudo generar la descripción',
          description: 'Selecciona catálogo de confección y revisa piezas/kilos por bulto.',
        });
        return;
      }
      updateNewLineaFields(linea.tempId, { descripcion_salida: descripcion });
    } finally {
      setDescripcionLoading(key, false);
    }
  };
  const handleGenerateDescripcionForLinea = async (
    lineaId: number,
    linea: Partial<BasePedidoLinea>,
  ) => {
    const key = `linea-${lineaId}`;
    setDescripcionLoading(key, true);
    try {
      const descripcion = await buildDescripcionSalidaERP(
        linea.catalogoconfecid ?? null,
        linea.catalogoconfecid ? catalogoConfecNombres[linea.catalogoconfecid] ?? '' : '',
        linea.piezasxbulto ?? null,
        linea.kilosxbulto ?? null,
      );
      if (!descripcion) {
        toast({
          title: 'No se pudo generar la descripción',
          description: 'Selecciona catálogo de confección y revisa piezas/kilos por bulto.',
        });
        return;
      }
      updateEditedLineaFields(lineaId, { descripcion_salida: descripcion });
    } finally {
      setDescripcionLoading(key, false);
    }
  };
  const renderCatOptionField = (
    catalogoId: number | null,
    label: string,
    value: number | null | undefined,
    onSelect: (selectedId: number | null) => void,
    variant: 'kilos' | 'piezas'
  ) => {
    const loading = isCatalogoLoading(catalogoId);
    const placeholder = !catalogoId
      ? 'Selecciona un catálogo primero'
      : loading
      ? 'Cargando opciones...'
      : 'Seleccionar opción';
    const selectValue = value ? String(value) : 'unset';
    const helperNoCatalog = !catalogoId ? 'Selecciona un catálogo para ver opciones disponibles.' : null;
    if (variant === 'kilos') {
      const options = getKilosOptions(catalogoId);
      return (
        <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
          <Label className="text-xs text-muted-foreground">{label}</Label>
          <Select
            value={selectValue}
            onValueChange={(newValue) => onSelect(newValue === 'unset' ? null : Number(newValue))}
            disabled={!catalogoId || loading}
          >
            <SelectTrigger className="h-8 text-sm font-mono">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unset">Sin asignar</SelectItem>
              {options.map((option) => (
                <SelectItem
                  key={option.catconfeckilosbultoid}
                  value={String(option.catconfeckilosbultoid)}
                >
                  {`${option.kilosxbulto ?? '-'} kg · ID ${option.catconfeckilosbultoid}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {helperNoCatalog && (
            <p className="text-xs text-muted-foreground">{helperNoCatalog}</p>
          )}
          {catalogoId && !loading && options.length === 0 && (
            <p className="text-xs text-muted-foreground">Sin valores activos para este catálogo.</p>
          )}
        </div>
      );
    }
    const options = getPiezasOptions(catalogoId);
    return (
      <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Select
          value={selectValue}
          onValueChange={(newValue) => onSelect(newValue === 'unset' ? null : Number(newValue))}
          disabled={!catalogoId || loading}
        >
          <SelectTrigger className="h-8 text-sm font-mono">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unset">Sin asignar</SelectItem>
            {options.map((option) => (
              <SelectItem
                key={option.catalogoconfeccionpiezaid}
                value={String(option.catalogoconfeccionpiezaid)}
              >
                {`${option.nro_piezas ?? '-'} piezas · ID ${option.catalogoconfeccionpiezaid}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {helperNoCatalog && (
          <p className="text-xs text-muted-foreground">{helperNoCatalog}</p>
        )}
        {catalogoId && !loading && options.length === 0 && (
          <p className="text-xs text-muted-foreground">Sin valores activos para este catálogo.</p>
        )}
      </div>
    );
  };
  const formatCatKilosLabel = (catalogoId: number | null | undefined, selectedId: number | null | undefined) => {
    if (!selectedId) return 'Sin asignar';
    const option =
      catalogoId && selectedId
        ? getKilosOptions(catalogoId).find(opt => opt.catconfeckilosbultoid === selectedId)
        : null;
    return option
      ? `${option.kilosxbulto ?? '-'} kg · ID ${option.catconfeckilosbultoid}`
      : `ID: ${selectedId}`;
  };
  const formatCatPiezaLabel = (catalogoId: number | null | undefined, selectedId: number | null | undefined) => {
    if (!selectedId) return 'Sin asignar';
    const option =
      catalogoId && selectedId
        ? getPiezasOptions(catalogoId).find(opt => opt.catalogoconfeccionpiezaid === selectedId)
        : null;
    return option
      ? `${option.nro_piezas ?? '-'} piezas · ID ${option.catalogoconfeccionpiezaid}`
      : `ID: ${selectedId}`;
  };
  const formatWithId = (name?: string | null, id?: number | null) => {
    if (id === undefined || id === null) return '-';
    return name ? `${name} (ID: ${id})` : `ID: ${id}`;
  };
  const getUsedSubprovIds = (lineaId: number | string, ignore?: { existingId?: number; tempId?: string }) => {
    const used = new Set<number>();
    const deletedSet = new Set(deletedCentros);
    const key = getLineaKey(lineaId);
    pedido?.lineas?.forEach((l: any) => {
      if (getLineaKey(l.pedidodetid) !== key) return;
      l.centros?.forEach((c: any) => {
        if (deletedSet.has(c.pedcentroid)) return;
        if (ignore?.existingId && ignore.existingId === c.pedcentroid) return;
        if (c.subprov) used.add(c.subprov);
      });
    });
    getNewCentrosList(lineaId).forEach((c) => {
      if (ignore?.tempId && ignore.tempId === c.tempId) return;
      if (c.subprov) used.add(c.subprov);
    });
    return used;
  };
  const getActiveExistingCount = (lineaId: number | string) => {
    const deletedSet = new Set(deletedCentros);
    const key = getLineaKey(lineaId);
    const linea = pedido?.lineas?.find((l: any) => getLineaKey(l.pedidodetid) === key);
    return linea?.centros?.filter((c: any) => !deletedSet.has(c.pedcentroid)).length ?? 0;
  };
  const ceilPickingPalets = (value: unknown) => {
    const normalized = normalizeApiNumber(value);
    return normalized === null ? 0 : Math.ceil(normalized);
  };

  const buildPickingPayloadPreview = () => {
    const normalize = (s: string) => s.trim().toLowerCase();
    const matchPrevisionLinea = (lineaPedido: any) => {
      const desc = typeof lineaPedido?.descripcion_salida === 'string' ? normalize(lineaPedido.descripcion_salida) : '';
      if (!desc) return null;
      return previsionLineas.find((pl) =>
        pl.descripcion_salida ? normalize(pl.descripcion_salida) === desc : false
      ) ?? null;
    };

    const missing: string[] = [];

    const payload = {
      pedidoclienteid_origen: previsionOrizonId ?? null,
      fecha_pedido_destino: pedido?.fecha_pedido ?? null,
      fecha_carga_destino: pedido?.fecha_carga ?? null,
      clienteid_destino: pedido?.clienteid ?? pedido?.clienteid_envio ?? previsionClienteId ?? null,
      sujetodomicilioid_destino: pedido?.sujetodomicilioid_destino ?? null,
      referencia_cliente_destino: pedido?.referencia_cliente ?? '',
      referencia2_cliente_destino: pedido?.referencia2_cliente ?? '',
      detalles:
        pedido?.lineas?.map((linea: any, idx: number) => {
          const previsionMatch = matchPrevisionLinea(linea);
          if (!previsionMatch || !previsionMatch.idpedidodet_orizon) {
            const label =
              linea?.descripcion_salida?.trim() ||
              `Línea #${idx + 1}`;
            missing.push(label);
          }
          return {
            pedidodetid_origen: previsionMatch?.idpedidodet_orizon ?? null,
            palets_origen: ceilPickingPalets(previsionMatch?.numero_palet ?? linea?.numero_palet),
            palets_seleccionados: ceilPickingPalets(linea?.numero_palet),
          };
        }) ?? [],
    };

    return { payload, missing };
  };
  useEffect(() => {
    if (!autoOpenPicking || autoPickingHandled) return;
    const cleanup = () => {
      setAutoPickingHandled(true);
      onAutoOpenPickingHandled?.();
    };
    if (!hasMatchingPrevision || !matchingPrevisionUploaded) {
      cleanup();
      return;
    }
    if (!previsionOrizonId) {
      toast({
        title: 'Previsión sin Orizon',
        description: 'Sube la previsión vinculada a Orizon antes de hacer el picking.',
        variant: 'destructive',
      });
      cleanup();
      return;
    }
    const { payload, missing } = buildPickingPayloadPreview();
    if (missing.length > 0) {
      toast({
        title: 'Faltan líneas para el picking',
        description: `No se encontró match en la previsión para: ${missing.join(', ')}.`,
        variant: 'destructive',
      });
      cleanup();
      return;
    }
    setPickingPreviewPayload(payload);
    setShowPickingDialog(true);
    cleanup();
  }, [autoOpenPicking, autoPickingHandled, hasMatchingPrevision, matchingPrevisionUploaded, previsionOrizonId, buildPickingPayloadPreview, toast, onAutoOpenPickingHandled]);
  const handleSendPicking = async () => {
    const result = buildPickingPayloadPreview();
    const payload = pickingPreviewPayload ?? result.payload;
    const missing = pickingPreviewPayload ? [] : result.missing;

    if (missing.length > 0) {
      toast({
        title: 'Faltan líneas para el picking',
        description: `No se encontró match en la previsión para: ${missing.join(', ')}.`,
        variant: 'destructive',
      });
      return;
    }

    const detallesInvalidos =
      payload.detalles?.filter((d: any) => !d.pedidodetid_origen).length ?? 0;
    if (detallesInvalidos > 0) {
      toast({
        title: 'Faltan IDs de líneas de previsión',
        description: 'Alguna línea no tiene pedidodetid_origen. Revisa la previsión en Orizon antes de continuar.',
        variant: 'destructive',
      });
      return;
    }

    const bodyToSend = [payload];

    try {
      setPickingSending(true);
      try {
        console.log('📦 Payload picking -> AgroIris', JSON.stringify(bodyToSend, null, 2));
      } catch (e) {
        console.log('📦 Payload picking -> AgroIris', bodyToSend);
      }

      const response = await agroirisPicking.generarPedidos(bodyToSend as PickingRequest[]);

      try {
        console.log('📦 Respuesta picking <- AgroIris', JSON.stringify(response, null, 2));
      } catch (e) {
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

      if (responseId) {
        try {
          const { error } = await supabase
            .from('pedidos')
            .update({ idpedido_orizon: responseId, pedidoclienteid: responseId })
            .eq('id', pedido.id);
          if (error) {
            console.error('No se pudo actualizar el pedido con el ID de Orizon', error);
          } else {
            // Actualizar el objeto local para que se refleje en la vista actual
            (pedido as any).idpedido_orizon = responseId;
            (pedido as any).pedidoclienteid = responseId;
          }
        } catch (updateError) {
          console.error('Error actualizando pedido tras picking', updateError);
        }
      }

      setShowPickingDialog(false);
      setPickingPreviewPayload(null);
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
  const getUsedAsignaciones = (lineaId: number | string, ignore?: { existingId?: number; tempId?: string }) => {
    const deletedSet = new Set(deletedCentros);
    const used = new Set<string>();
    const key = getLineaKey(lineaId);
    pedido?.lineas?.forEach((l: any) => {
      if (getLineaKey(l.pedidodetid) !== key) return;
      l.centros?.forEach((c: any) => {
        if (deletedSet.has(c.pedcentroid)) return;
        if (ignore?.existingId && ignore.existingId === c.pedcentroid) return;
        const edited = editedCentros[c.pedcentroid];
        const asign = edited?.asignacion ?? c.asignacion;
        if (asign) used.add(asign);
      });
    });
    getNewCentrosList(lineaId).forEach((c) => {
      if (ignore?.tempId && ignore.tempId === c.tempId) return;
      if (c.asignacion) used.add(c.asignacion);
    });
    return used;
  };
  const getNextAsignacionLibre = (lineaId: number | string) => {
    const used = getUsedAsignaciones(lineaId);
    const candidates = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const free = candidates.find((c) => !used.has(c));
    if (free) return free;
    let idx = 1;
    while (used.has(`N${idx}`)) idx += 1;
    return `N${idx}`;
  };
  const parseNumberInput = (value: string) => (value === '' ? null : Number(value));
  if (!pedido) return null;
  const hasIncompleteData = !pedido.clienteid || !pedido.fecha_carga || !pedido.fecha_pedido;
  const hasMatriculas = pedido.matricula_tractora || pedido.matricula_remolque;
  const hasPdfAttachment = Boolean(pedido.archivo_pdf_id || pedido.b64_pedido);
  const hasSharedPdfRelations = sharedPdfRelatedCount > 0;
  const pdfPreviewFileName = `${String(
    pedido.referencia_cliente || pedido.referencia2_cliente || `pedido_${pedido.id}`
  ).replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
  const needsSync = Boolean(hasOrizonId && (pedido as any)?.needs_sync);
  const isPrevision = (pedido as any)?.tipo_pedido === 'P22E';
  const actionsLockedByPicking = hasMatchingPrevision && hasOrizonId;
  const referenciaLabel = 'Referencia Cliente';
  const referenciaHeaderLabel = 'Referencia';
  const referenciaEmptyLabel = 'Sin referencia';
  const referencia2Label = 'Referencia Cliente 2';
  const referencia2HeaderLabel = 'Referencia 2';
  const referencia2EmptyLabel = 'Sin referencia 2';
  const referencia2Value = (pedido.referencia2_cliente ?? '').toString().trim();
  const infoGridColumns = showPdfPreview
    ? 'grid-cols-1 md:grid-cols-2'
    : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
  const acreedorDisplayName =
    acreedorNombre && acreedorNombre.trim().toUpperCase() !== 'N/A'
      ? acreedorNombre
      : 'Sin acreedor de porte (no aplica)';
  const plataformaDestinoNombre =
    plataformaDestino?.nombre_plataforma?.trim() ||
    (plataformaDestino?.clienteplataformaid ? `Plataforma #${plataformaDestino.clienteplataformaid}` : '');
  const plataformaDestinoDescripcion = plataformaDestino?.descripcion?.trim() || '';
  const plataformaDestinoFallback = selectedDomicilioDestinoId ? 'Sin plataforma' : 'Sin domicilio';
  const plataformaDestinoDisplay = plataformaDestinoLoading
    ? 'Cargando plataforma...'
    : plataformaDestino
    ? [plataformaDestinoNombre, plataformaDestinoDescripcion].filter(Boolean).join(' · ')
    : plataformaDestinoError ?? plataformaDestinoFallback;
  const fechaPedidoLabel = formatDateSafe(pedido.fecha_pedido, 'PPP', 'N/A');
  const fechaCargaLabel = formatDateSafe(pedido.fecha_carga, 'PPP', 'N/A');
  const fechaLlegadaLabel = formatDateSafe(
    pedido.llegada_correo ?? pedido.created_at,
    'PPP HH:mm',
    'N/A',
  );
  const infoLabelClass = 'min-h-[20px] flex items-center gap-2';
  const infoValueClass = 'text-sm font-medium p-2 rounded-md bg-muted h-9 flex items-center truncate';
  const infoGroupTitleClass = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const infoSectionGrid = 'lg:grid-cols-1';
  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-slate-900/45"
        className="flex h-[calc(100dvh-16px)] max-h-[calc(100dvh-16px)] w-[min(1900px,calc(100vw-16px))] max-w-[min(1900px,calc(100vw-16px))] flex-col gap-0 overflow-visible rounded-xl border border-border/70 bg-background px-0 py-0 shadow-2xl"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-background">
          <div className="shrink-0 border-b border-border/60 bg-background px-5 py-3 sm:px-6">
            <DialogHeader className="space-y-0">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <DialogTitle className="flex shrink-0 items-center gap-2 text-lg font-semibold">
                      <Package className="h-5 w-5 text-primary" />
                      {isPrevision ? 'Detalles de la Previsión' : 'Detalles del Pedido'}
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                      {isPrevision
                        ? 'Vista de detalle de la previsión enlazada'
                        : 'Vista de detalle del pedido'}
                    </DialogDescription>
                    {!isPrevision && (
                      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                        <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted px-2.5 text-muted-foreground">
                          {referenciaHeaderLabel}
                          <span className="font-semibold text-foreground">
                            {pedido.referencia_cliente || referenciaEmptyLabel}
                          </span>
                        </span>
                        {referencia2Value && (
                          <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-muted px-2.5 text-muted-foreground">
                            {referencia2HeaderLabel}
                            <span className="font-semibold text-foreground">{referencia2Value}</span>
                          </span>
                        )}
                      </div>
                    )}
                    {orizonId || (matchingCambioId && !matchingCambioRevisado) || hasMatchingPrevision ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {orizonId ? (
                          <Badge
                            className="h-7 w-fit gap-1 border border-sky-200 bg-sky-600/10 text-xs text-sky-800 dark:border-sky-800 dark:bg-sky-900/30 dark:text-sky-100"
                            title={`ID Ceox: ${orizonId}`}
                          >
                            Pedido Orizon
                            <span className="font-mono font-semibold">
                              {ceoxCodigoPedidoLoading ? 'Cargando...' : ceoxCodigoPedido ?? 'No disponible'}
                            </span>
                          </Badge>
                        ) : null}
                        {matchingCambioId && !matchingCambioRevisado ? (
                          cambioMetaAvailable === false ? (
                            <Badge variant="outline" className="w-fit text-xs text-muted-foreground">
                              Cambio obsoleto
                            </Badge>
                          ) : cambioMetaAvailable === true && onOpenCambioDialog ? (
                            <button
                              type="button"
                              onClick={onOpenCambioDialog}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-200 bg-background px-2.5 text-xs font-medium text-amber-800 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-1 dark:border-amber-900/70 dark:text-amber-200 dark:hover:bg-amber-950/30"
                              title="Abrir revisión del cambio asociado"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Revisar cambio
                            </button>
                          ) : (
                            <Badge variant="outline" className="w-fit text-xs text-muted-foreground">
                              Revisando cambio...
                            </Badge>
                          )
                        ) : null}
                        {hasMatchingPrevision ? (
                          <Badge
                            className={cn(
                              'flex h-7 w-fit cursor-pointer items-center gap-1 text-xs',
                              matchingPrevisionUploaded
                                ? 'border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-100'
                                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100',
                            )}
                            onClick={() => {
                              if (onPedidoRelacionadoClick && resolvedMatchingPrevisionId) {
                                onPedidoRelacionadoClick(resolvedMatchingPrevisionId);
                              }
                            }}
                            title="Abrir previsión vinculada"
                          >
                            {matchingPrevisionUploaded ? (
                              <RefreshCw className="h-3 w-3" />
                            ) : (
                              <AlertTriangle className="h-3 w-3" />
                            )}
                            Previsión #{resolvedMatchingPrevisionId}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                    {hasMatchingPrevision && !matchingPrevisionUploaded && (
                      <span className="inline-flex min-h-7 items-center text-xs text-muted-foreground">
                        Sube la previsión a Orizon para habilitar el picking.
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 xl:justify-end">
                  {isPrevision && previousPedidoId && onBackToPreviousPedido && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onBackToPreviousPedido}
                      className="shadow-sm hover:shadow transition-shadow"
                      disabled={navigatingToRelated}
                    >
                      {navigatingToRelated ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Cargando…
                        </>
                      ) : (
                        'Volver al pedido'
                      )}
                    </Button>
                  )}
                  {onSendPedido && !actionsLockedByPicking && (
                    <Button
                      variant={
                        hasMatchingPrevision
                          ? matchingPrevisionUploaded
                            ? "secondary"
                            : "outline"
                          : needsSync
                          ? "default"
                          : hasOrizonId
                          ? "secondary"
                          : "default"
                      }
                      size="sm"
                      onClick={() => {
                        if (hasMatchingPrevision && matchingPrevisionUploaded && !pickingBlocked) {
                          // Validar matching antes de abrir el popup
                          if (!previsionOrizonId) {
                            toast({
                              title: 'Previsión sin Orizon',
                              description: 'Sube la previsión vinculada a Orizon antes de hacer el picking.',
                              variant: 'destructive',
                            });
                            return;
                          }
                          if (!previsionLineas.length) {
                            toast({
                              title: 'Previsión sin líneas cargadas',
                              description: 'No se pudieron cargar las líneas de la previsión para el picking.',
                              variant: 'destructive',
                            });
                            return;
                          }
                          const { payload, missing } = buildPickingPayloadPreview();
                          if (missing.length > 0) {
                            toast({
                              title: 'Faltan líneas para el picking',
                              description: `No se encontró match en la previsión para: ${missing.join(', ')}.`,
                              variant: 'destructive',
                            });
                            return;
                          }
                          setPickingPreviewPayload(payload);
                          setShowPickingDialog(true);
                          return;
                        }
                        onSendPedido(pedido);
                      }}
                      disabled={sendingPedidoId === pedido.id || isEditing}
                      className={cn(
                        "shadow-sm hover:shadow transition-shadow",
                        pickingBlocked &&
                          "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-100 dark:hover:bg-red-900/30",
                      )}
                      title={
                        hasMatchingPrevision
                          ? matchingPrevisionUploaded
                            ? 'Generar picking con la previsión asociada'
                            : 'La previsión vinculada no está en Orizon'
                          : hasOrizonId
                          ? 'Actualizar pedido en Orizon'
                          : 'Enviar pedido a Orizon'
                      }
                    >
                      {sendingPedidoId === pedido.id ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : hasMatchingPrevision ? (
                        <Send className="h-4 w-4 mr-2" />
                      ) : hasOrizonId ? (
                        <RefreshCw className="h-4 w-4 mr-2" />
                      ) : (
                        <Send className="h-4 w-4 mr-2" />
                      )}
                      {hasMatchingPrevision ? 'Picking' : hasOrizonId ? 'Actualizar' : 'Enviar'}
                    </Button>
                  )}
                  {onSendPedido && hasMatchingPrevision && !hasOrizonId && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setIgnorePrevisionDialogOpen(true)}
                      disabled={sendingPedidoId === pedido.id || isEditing}
                      className="h-8"
                      title="Ignorar previsión y enviar directamente"
                    >
                      Ignorar previsión y enviar
                    </Button>
                  )}
                  {onSendPedido && pickingBlocked && !hasOrizonId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onSendPedido(pedido)}
                      disabled={sendingPedidoId === pedido.id || isEditing}
                      className="h-8"
                      title="Reintentar picking tras corregir la previsión"
                    >
                      Reintentar picking
                    </Button>
                  )}
                  {hasOrizonId && hasMatchingPrevision && (
                    <div className="text-xs text-muted-foreground font-medium">
                      {`Picking listo y pedido generado en Orizon (ID ${orizonId ?? '—'}).`}
                    </div>
                  )}
                  {isEditing ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setIsEditing(false);
                          setEditedPedido({});
                          setEditedLineas({});
                          setEditedCentros({});
                          setEditingLineaId(null);
                          setNewLineas([]);
                        }}
                        className="shadow-sm hover:shadow transition-shadow"
                      >
                        <X className="h-4 w-4 mr-2" />
                        Cancelar
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={onSave}
                        className="shadow-sm hover:shadow-md transition-shadow"
                      >
                        <Save className="h-4 w-4 mr-2" />
                        Guardar
                      </Button>
                    </>
                  ) : actionsLockedByPicking ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // Inicializar editedPedido con los valores actuales del pedido
                        setEditedPedido({
                          clienteid: pedido.clienteid,
                          clienteid_envio: pedido.clienteid_envio,
                          divisa_cliente: pedido.divisa_cliente,
                          serieid: pedido.serieid,
                          comercialid: pedido.comercialid,
                          acreedorid_porte: pedido.acreedorid_porte,
                          sujetodomicilioid_destino: pedido.domicilio_destino,
                          fecha_pedido: pedido.fecha_pedido,
                          fecha_carga: pedido.fecha_carga,
                          matricula_tractora: pedido.matricula_tractora,
                          matricula_remolque: pedido.matricula_remolque,
                        });
                        setNewLineas([]);
                        setIsEditing(true);
                      }}
                      className="shadow-sm hover:shadow transition-shadow"
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Editar
                    </Button>
                  )}
                </div>
              </div>
            </DialogHeader>
          </div>
          <div
            className={cn(
              'min-h-0 flex-1 px-5 sm:px-6 lg:px-8',
              showPdfPreview ? 'flex flex-col overflow-hidden pb-4' : 'overflow-y-auto pb-8'
            )}
          >
            {!showPdfPreview && (
              <section className="mt-4 border-b border-border/60 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/15 bg-primary/5 px-3 py-3">
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-base font-semibold">
                      <FileText className="h-5 w-5 shrink-0 text-primary" />
                      Documento PDF
                    </h3>
                    <p className="mt-0.5 truncate text-sm font-medium text-muted-foreground">
                      {hasPdfAttachment ? 'PDF asociado al pedido' : 'Sin PDF vinculado a este pedido'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowPdfPreview(true)}
                      disabled={!hasPdfAttachment || (!pdfPreviewUrl && !pdfPreviewLoading)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Ver PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleInlinePdfOpen}
                      disabled={!pdfPreviewUrl}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Abrir
                    </Button>
                  </div>
                </div>
              </section>
            )}
            <div
              className={cn(
                'mt-4 grid gap-6 lg:grid-cols-1',
                showPdfPreview
                  ? 'min-h-0 flex-1 overflow-y-auto xl:grid-cols-[minmax(520px,1.08fr)_minmax(0,0.92fr)] xl:items-stretch xl:overflow-hidden'
                  : 'xl:items-start'
              )}
            >
          {showPdfPreview && (
            <div className="min-h-[520px] min-w-0 xl:min-h-0 xl:overflow-hidden">
              <section className="flex h-full min-h-0 flex-col rounded-md border border-border/60 bg-background">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <h3 className="truncate text-base font-semibold">Vista del documento</h3>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPdfPreview(false)}
                    className="h-8 w-8 shrink-0 p-0"
                    title="Ocultar documento"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  {pdfPreviewLoading ? (
                    <Skeleton className="h-full min-h-[420px] w-full rounded-none" />
                  ) : pdfPreviewUrl ? (
                    <PdfViewer
                      url={pdfPreviewUrl}
                      showControls
                      fileName={pdfPreviewFileName}
                      className="h-full min-h-0"
                      onError={() => setPdfPreviewError('No se pudo cargar el PDF.')}
                    />
                  ) : (
                    <div className="flex h-full min-h-[420px] items-center justify-center bg-muted/20 px-6 text-center text-sm text-muted-foreground">
                      {pdfPreviewError || 'No se encontró un documento PDF para este pedido.'}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
          <div
            className={cn(
              'min-w-0 space-y-6',
              showPdfPreview ? 'h-full min-h-0 overflow-y-scroll overscroll-contain pb-8 pr-2' : 'pr-1'
            )}
          >
          {hasIncompleteData && (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-lg p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="font-semibold text-red-900 dark:text-red-400 mb-1">Datos incompletos</h4>
                <p className="text-sm text-red-700 dark:text-red-300">
                  Este pedido tiene información incompleta. Por favor, completa los campos requeridos.
                </p>
              </div>
            </div>
          )}
          {/* Información General + cambio asociado */}
          <section>
            <div className={`grid gap-6 ${infoSectionGrid} items-start`}>
              <div>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 border-b pb-2">
                  <FileText className="h-5 w-5 text-primary" />
                  Información General
                </h3>
                <div className="space-y-6 min-w-0">
                  <div className="space-y-2">
                    <p className={infoGroupTitleClass}>Cliente y pedido</p>
                    <div className={`grid ${infoGridColumns} gap-4`}>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Cliente</Label>
                        {isEditing ? (
                          <ClientCombobox
                            value={editedPedido.clienteid ?? pedido.clienteid}
                            onChange={(value) => setEditedPedido({ ...editedPedido, clienteid: value })}
                          />
                        ) : (
                          <p className={infoValueClass} title={clienteNombre || 'N/A'}>
                            {clienteNombre || 'N/A'}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Cliente Envío</Label>
                        {isEditing ? (
                          <ClientCombobox
                            value={editedPedido.clienteid_envio ?? pedido.clienteid_envio}
                            onChange={(value) => setEditedPedido({ ...editedPedido, clienteid_envio: value })}
                          />
                        ) : (
                          <p className={infoValueClass} title={clienteEnvioNombre || 'N/A'}>
                            {clienteEnvioNombre || 'N/A'}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Tipo de Pedido</Label>
                        {isEditing ? (
                          <Select
                            value={editedPedido.tipo_pedido ?? pedido.tipo_pedido}
                            onValueChange={(value) => setEditedPedido({ ...editedPedido, tipo_pedido: value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Selecciona tipo" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="P220">Pedido</SelectItem>
                              <SelectItem value="P22E">Previsión</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <p
                            className={infoValueClass}
                            title={pedido.tipo_pedido === 'P22E' ? 'Previsión' : 'Pedido'}
                          >
                            {pedido.tipo_pedido === 'P22E' ? 'Previsión' : 'Pedido'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-border/60 pt-4">
                    <p className={infoGroupTitleClass}>Comercial</p>
                    <div className={`grid ${infoGridColumns} gap-4`}>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Divisa Cliente</Label>
                        {isEditing ? (
                          <DivisaCombobox
                            value={editedPedido.divisa_cliente ?? pedido.divisa_cliente}
                            onChange={(value) => setEditedPedido({ ...editedPedido, divisa_cliente: value })}
                          />
                        ) : (
                          <p className={infoValueClass} title={divisaNombre || 'N/A'}>
                            {divisaNombre || 'N/A'}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Serie Documento</Label>
                        {isEditing ? (
                          <SerieCombobox
                            value={editedPedido.serieid ?? pedido.serieid}
                            onChange={(value) => setEditedPedido({ ...editedPedido, serieid: value })}
                          />
                        ) : (
                          <p className={infoValueClass} title={serieDescripcion || 'N/A'}>
                            {serieDescripcion || 'N/A'}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Comercial</Label>
                        {isEditing ? (
                          <ComercialCombobox
                            value={editedPedido.comercialid ?? pedido.comercialid}
                            onChange={(value) => setEditedPedido({ ...editedPedido, comercialid: value })}
                          />
                        ) : (
                          <p
                            className={infoValueClass}
                            title={comercialNombre || (pedido.comercialid ? 'N/A' : 'Sin comercial')}
                          >
                            {comercialNombre || (pedido.comercialid ? 'N/A' : 'Sin comercial')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-border/60 pt-4">
                    <p className={infoGroupTitleClass}>Fechas</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>
                          <Calendar className="h-4 w-4" />
                          Fecha Pedido
                        </Label>
                        {isEditing ? (
                          <Input
                            type="date"
                            value={editedPedido.fecha_pedido ?? pedido.fecha_pedido}
                            onChange={(e) => setEditedPedido({ ...editedPedido, fecha_pedido: e.target.value })}
                          />
                        ) : (
                          <p className={infoValueClass} title={fechaPedidoLabel}>
                            {fechaPedidoLabel}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>
                          <Truck className="h-4 w-4" />
                          Fecha Carga
                        </Label>
                        {isEditing ? (
                          <Input
                            type="date"
                            value={editedPedido.fecha_carga ?? pedido.fecha_carga}
                            onChange={(e) => setEditedPedido({ ...editedPedido, fecha_carga: e.target.value })}
                          />
                        ) : (
                          <p className={infoValueClass} title={fechaCargaLabel}>
                            {fechaCargaLabel}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>
                          <Calendar className="h-4 w-4" />
                          Llegada pedido
                        </Label>
                        <p className={infoValueClass} title={fechaLlegadaLabel}>
                          {fechaLlegadaLabel}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-border/60 pt-4">
                    <p className={infoGroupTitleClass}>Destino</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Domicilio Destino</Label>
                        {isEditing ? (
                          <DomicilioCombobox
                            clienteId={editedPedido.clienteid ?? pedido.clienteid ?? null}
                            value={editedPedido.sujetodomicilioid_destino ?? pedido.sujetodomicilioid_destino}
                            onChange={(value) => setEditedPedido({ ...editedPedido, sujetodomicilioid_destino: value })}
                          />
                        ) : (
                          <p className={infoValueClass} title={domicilioDestinoNombre || 'N/A'}>
                            {domicilioDestinoNombre || 'N/A'}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Plataforma</Label>
                        <p className={infoValueClass} title={plataformaDestinoDisplay}>
                          {plataformaDestinoDisplay}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-border/60 pt-4">
                    <p className={infoGroupTitleClass}>Referencias</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>{referenciaLabel}</Label>
                        {isEditing ? (
                          <Input
                            value={editedPedido.referencia_cliente ?? pedido.referencia_cliente ?? ''}
                            onChange={(e) => setEditedPedido({ ...editedPedido, referencia_cliente: e.target.value })}
                          />
                        ) : (
                          <p
                            className={infoValueClass}
                            title={pedido.referencia_cliente || referenciaEmptyLabel}
                          >
                            {pedido.referencia_cliente || referenciaEmptyLabel}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>{referencia2Label}</Label>
                        {isEditing ? (
                          <Input
                            value={editedPedido.referencia2_cliente ?? pedido.referencia2_cliente ?? ''}
                            onChange={(e) => setEditedPedido({ ...editedPedido, referencia2_cliente: e.target.value })}
                          />
                        ) : (
                          <p
                            className={infoValueClass}
                            title={pedido.referencia2_cliente || referencia2EmptyLabel}
                          >
                            {pedido.referencia2_cliente || referencia2EmptyLabel}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-border/60 pt-4">
                    <p className={infoGroupTitleClass}>Transporte</p>
                    <div className={`grid ${infoGridColumns} gap-4`}>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Acreedor Porte</Label>
                        {isEditing ? (
                          <AcreedorCombobox
                            value={editedPedido.acreedorid_porte ?? pedido.acreedorid_porte}
                            onChange={(value) => setEditedPedido({ ...editedPedido, acreedorid_porte: value })}
                          />
                        ) : (
                          <p className={infoValueClass} title={acreedorDisplayName}>
                            {acreedorDisplayName}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Matrícula tractora</Label>
                        {isEditing ? (
                          <Input
                            value={editedPedido.matricula_tractora ?? pedido.matricula_tractora ?? ''}
                            onChange={(e) => setEditedPedido({ ...editedPedido, matricula_tractora: e.target.value })}
                            placeholder="Introduce matrícula tractora"
                          />
                        ) : (
                          <p
                            className={infoValueClass}
                            title={pedido.matricula_tractora?.trim() || 'Sin matrícula tractora'}
                          >
                            {pedido.matricula_tractora?.trim() || 'Sin matrícula tractora'}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Matrícula remolque</Label>
                        {isEditing ? (
                          <Input
                            value={editedPedido.matricula_remolque ?? pedido.matricula_remolque ?? ''}
                            onChange={(e) => setEditedPedido({ ...editedPedido, matricula_remolque: e.target.value })}
                            placeholder="Introduce matrícula remolque"
                          />
                        ) : (
                          <p
                            className={infoValueClass}
                            title={pedido.matricula_remolque?.trim() || 'Sin matrícula remolque'}
                          >
                            {pedido.matricula_remolque?.trim() || 'Sin matrícula remolque'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-border/60 pt-4">
                    <p className={infoGroupTitleClass}>Observaciones</p>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-2">
                        <Label className={infoLabelClass}>Observaciones</Label>
                        {isEditing ? (
                          <Input
                            value={editedPedido.observaciones_cabecera ?? pedido.observaciones_cabecera ?? ''}
                            onChange={(e) => setEditedPedido({ ...editedPedido, observaciones_cabecera: e.target.value })}
                          />
                        ) : (
                          <p
                            className={infoValueClass}
                            title={pedido.observaciones_cabecera || 'Sin observaciones'}
                          >
                            {pedido.observaciones_cabecera || 'Sin observaciones'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          {/* Líneas del Pedido */}
          <section>
            <div className="flex flex-col gap-3 mb-4 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-semibold flex flex-wrap items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                Líneas del Pedido
                {pedido.lineas && pedido.lineas.length > 0 && (
                  <span className="text-sm font-normal text-muted-foreground">
                    · {pedido.lineas.length} {pedido.lineas.length === 1 ? 'línea' : 'líneas'}
                  </span>
                )}
                {isEditing && newLineas.length > 0 && (
                  <span className="text-sm font-normal text-muted-foreground">
                    · +{newLineas.length} {newLineas.length === 1 ? 'nueva' : 'nuevas'}
                  </span>
                )}
              </h3>
              <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
                {lineClipboard && (
                  <Button variant="outline" size="sm" onClick={handlePasteAsNewLinea}>
                    <ClipboardPaste className="h-4 w-4 mr-2" />
                    Pegar como nueva
                  </Button>
                )}
                {isEditing && (
                  <Button variant="secondary" size="sm" onClick={handleAddNewLinea} className="w-full sm:w-auto">
                    <Plus className="h-4 w-4 mr-2" />
                    Añadir línea
                  </Button>
                )}
              </div>
            </div>
            {lineClipboard && (
              <div className="flex flex-wrap items-center gap-2 mb-3 text-xs text-muted-foreground">
                <Badge variant="outline">Copiada: {lineClipboard.label}</Badge>
                {lineClipboard.sourcePedidoId && (
                  <span>Origen pedido #{lineClipboard.sourcePedidoId}</span>
                )}
              </div>
            )}
            {isEditing && newLineas.length > 0 && (
              <div className="space-y-4 mb-6">
                {newLineas.map((linea, index) => (
                  <div key={linea.tempId} className="border rounded-lg overflow-hidden bg-card shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 bg-muted/40 border-b">
                      <h4 className="font-semibold flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                          {index + 1}
                        </span>
                        Nueva línea #{index + 1}
                        <Badge variant="secondary" className="text-xs">Borrador</Badge>
                      </h4>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-8 px-3"
                          onClick={onSave}
                        >
                          Guardar línea
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 px-3"
                          onClick={() => handleGenerateDescripcionForNewLinea(linea)}
                          disabled={
                            Boolean(descripcionLoadingByKey[`new-${linea.tempId}`]) ||
                            !linea.catalogoconfecid
                          }
                          title="Genera la descripción usando la regla del ERP"
                        >
                          {descripcionLoadingByKey[`new-${linea.tempId}`] ? (
                            <span className="inline-flex items-center gap-1">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Generando...
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <RefreshCw className="h-3.5 w-3.5" />
                              Generar descripción
                            </span>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => handleCopyLinea(linea)}
                          title="Copiar esta línea"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveNewLinea(linea.tempId)}
                          className="h-7 px-2 text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <div className="p-4 space-y-4">
                      <div className="space-y-1 border-b border-border/60 pb-4">
                        <Label className="text-sm font-semibold text-muted-foreground">Descripción</Label>
                        <Input
                          value={linea.descripcion_salida}
                          placeholder="Detalle de la línea"
                          onChange={(e) => handleNewLineaChange(linea.tempId, 'descripcion_salida', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1 border-b border-border/60 pb-4">
                        <Label className="text-sm font-semibold text-muted-foreground">EAN pieza</Label>
                        <Input
                          value={linea.ean_pieza ?? linea.ean_bulto ?? linea.ean ?? ''}
                          placeholder="EAN de la pieza"
                          onChange={(e) => {
                            const value = e.target.value.trim() || null;
                            handleNewLineaChange(linea.tempId, 'ean', value);
                            handleNewLineaChange(linea.tempId, 'ean_pieza', value);
                          }}
                        />
                      </div>
                      <div className="space-y-1 border-b border-border/60 pb-4">
                        <Label className="text-sm font-semibold text-muted-foreground">EAN caja</Label>
                        <Input
                          value={linea.ean_caja ?? ''}
                          placeholder="EAN de la caja"
                          onChange={(e) =>
                            handleNewLineaChange(linea.tempId, 'ean_caja', e.target.value.trim() || null)
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
                            handleNewLineaChange(
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
                            handleNewLineaChange(
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
                            { label: 'Número Palet', field: 'numero_palet' },
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
                                      handleNewLineaChange(
                                        linea.tempId,
                                        field as keyof NewPedidoLineaDraft,
                                        parseNumberInput(e.target.value) as NewPedidoLineaDraft[keyof NewPedidoLineaDraft]
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
                                          linea.bultosxpalet
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
                                      handleNewLineaChange(
                                        linea.tempId,
                                        field as keyof NewPedidoLineaDraft,
                                        parseNumberInput(e.target.value) as NewPedidoLineaDraft[keyof NewPedidoLineaDraft]
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
                                          linea.bultos
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
                                      handleNewLineaChange(
                                        linea.tempId,
                                        field as keyof NewPedidoLineaDraft,
                                        parseNumberInput(e.target.value) as NewPedidoLineaDraft[keyof NewPedidoLineaDraft]
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
                                          linea.bultos
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
                                    handleNewLineaChange(
                                      linea.tempId,
                                      field as keyof NewPedidoLineaDraft,
                                      parseNumberInput(e.target.value) as NewPedidoLineaDraft[keyof NewPedidoLineaDraft]
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
                          Identificadores de Configuración
                        </h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                          <div className="col-span-full text-[11px] text-muted-foreground mb-1 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="bg-muted/60">Flujo de dependencias</Badge>
                            <span className="font-medium">1. Género</span>
                            <span>→</span>
                            <span className="font-medium">2. Catálogo Confección</span>
                            <span>→</span>
                            <span className="font-medium">3. Confección salida / Grupo / Calibre</span>
                            <span>→</span>
                            <span className="font-medium">4. Resto de identificadores</span>
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Género</Label>
                            <GeneroCombobox value={linea.generoid} onChange={(value) => handleNewLineaChange(linea.tempId, 'generoid', value)} />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Catálogo Confección</Label>
                            <CatalogoConfecCombobox
                              value={linea.catalogoconfecid ?? undefined}
                              generoid={linea.generoid ?? null}
                              onChange={(value, catalogo) =>
                                handleCatalogoChangeForNewLinea(
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
                            <Label className="text-xs text-muted-foreground">Confección Salida</Label>
                            <ConfeccionSalidaCombobox
                              value={linea.confeccionsalidaid}
                              catalogoconfecid={linea.catalogoconfecid ?? null}
                              onChange={(value, confeccion) =>
                                handleConfeccionSalidaChangeForNewLinea(
                                  linea.tempId,
                                  value,
                                  confeccion?.grupoconfeccionid
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Grupo Confección</Label>
                            <GrupoConfeccionCombobox
                              value={linea.grupoconfeccionid}
                              catalogoconfecid={linea.catalogoconfecid ?? null}
                              onChange={(value) => handleNewLineaChange(linea.tempId, 'grupoconfeccionid', value)}
                            />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Confección Palet</Label>
                            <ConfeccionPaletCombobox value={linea.confeccionpaletid} onChange={(value) => handleNewLineaChange(linea.tempId, 'confeccionpaletid', value)} />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Calibre</Label>
                            <CalibreCombobox
                              value={linea.calibreid}
                              catalogoconfecid={linea.catalogoconfecid ?? null}
                              onChange={(value) => handleNewLineaChange(linea.tempId, 'calibreid', value)}
                            />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Origen</Label>
                            <OrigenCombobox value={linea.origenid} onChange={(value) => handleNewLineaChange(linea.tempId, 'origenid', value)} />
                          </div>
                          <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                            <Label className="text-xs text-muted-foreground">Tipo Cultivo</Label>
                            <TipoCultivoCombobox value={linea.tipocultivoid} onChange={(value) => handleNewLineaChange(linea.tempId, 'tipocultivoid', value)} />
                          </div>
                          {renderCatOptionField(
                            linea.catalogoconfecid ?? null,
                            'Cat. Confec Kilos/Bulto',
                            linea.catconfeckilosbultoid,
                            (selectedId) =>
                              handleCatConfeckilosChangeForNew(linea.tempId, linea.catalogoconfecid ?? null, selectedId),
                            'kilos'
                          )}
                          {renderCatOptionField(
                            linea.catalogoconfecid ?? null,
                            'Cat. Confec Pieza',
                            linea.catconfecpiezaid,
                            (selectedId) =>
                              handleCatConfecPiezaChangeForNew(linea.tempId, linea.catalogoconfecid ?? null, selectedId),
                            'piezas'
                          )}
                        </div>
                      {(() => {
                        const lineKey = getLineaKey(linea.tempId);
                        const newCentrosLinea = getNewCentrosList(lineKey);
                        const activeCount = newCentrosLinea.filter(c => c.accepted).length;
                        return (
                          <div className="mt-4 pt-3 border-t space-y-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <h5 className="text-sm font-semibold flex items-center gap-2">
                                <MapPin className="h-4 w-4 text-primary" />
                                Centros de Distribución
                                <span className="text-muted-foreground font-normal">
                                  ({newCentrosLinea.length})
                                </span>
                              </h5>
                              <Button variant="secondary" size="sm" className="h-8" onClick={() => addNewCentro(lineKey)}>
                                Añadir centro
                              </Button>
                            </div>
                            {newCentrosLinea.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Aún no hay centros. Añade al menos uno si aplica.</p>
                            ) : (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {newCentrosLinea.map((centro) => (
                                  <div
                                    key={centro.tempId}
                                    className="bg-muted/30 rounded-lg p-3 border border-dashed hover:border-primary/50 transition-colors"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                      <Badge variant="secondary" className="text-xs">Nuevo centro</Badge>
                                      <div className="flex items-center gap-2">
                                        {!centro.accepted && (
                                          <Button
                                            variant="secondary"
                                            size="sm"
                                            className="h-7 px-3"
                                            onClick={() => updateNewCentro(lineKey, centro.tempId, 'accepted', true)}
                                          >
                                            Aceptar
                                          </Button>
                                        )}
                                        {centro.accepted && (
                                          <Badge variant="outline" className="text-xs">Aceptado</Badge>
                                        )}
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-destructive"
                                          disabled={centro.accepted && activeCount - 1 < 0}
                                          onClick={() => removeNewCentro(lineKey, centro.tempId)}
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3 text-sm">
                                      <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">Asignación</Label>
                                        <Input
                                          value={centro.asignacion}
                                          onChange={(e) => updateNewCentro(lineKey, centro.tempId, 'asignacion', e.target.value)}
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
                                            updateNewCentro(lineKey, centro.tempId, 'numero_palets', val);
                                          }}
                                          className="h-7"
                                          step="0.001"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">Subprov</Label>
                                        <SubcentroCombobox
                                          value={centro.subprov}
                                          excludeIds={[...getUsedSubprovIds(lineKey, { tempId: centro.tempId })]}
                                          onChange={(val) => updateNewCentro(lineKey, centro.tempId, 'subprov', val)}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                ))}
              </div>
            )}
            {pedido.lineas && pedido.lineas.length > 0 ? (
              <div className="space-y-4">
                {pedido.lineas.map((linea, index) => {
                  const editedLinea = editedLineas[linea.pedidodetid] || {};
                  const currentLinea = { ...linea, ...editedLinea };
                  const isEditingThisLine = editingLineaId === linea.pedidodetid;
                  const isCambioLinea = typeof currentLinea.numero_palet === 'number' && currentLinea.numero_palet < 0;
                  const absIfCambio = (value: unknown) =>
                    isCambioLinea && typeof value === 'number' ? Math.abs(value) : value;
                  return (
                    <div
                      key={linea.pedidodetid}
                      className={cn(
                        'border rounded-lg overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow',
                        isCambioLinea
                          && 'relative border-amber-300 ring-1 ring-amber-300/40 before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:bg-amber-400 dark:border-amber-800 dark:ring-amber-800/40 dark:before:bg-amber-600'
                      )}
                    >
                      <div
                        className={cn(
                          'flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 bg-muted/30 border-b',
                          isCambioLinea && 'bg-amber-50/70 border-amber-200 dark:bg-amber-950/25 dark:border-amber-900'
                        )}
                      >
                        <h4 className="font-semibold flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                            {index + 1}
                          </span>
                          Línea #{index + 1}
                          <Badge variant="outline" className="w-fit">ID: {linea.pedidodetid}</Badge>
                        </h4>
                    <div className="flex items-center gap-2 flex-wrap">
                      {isCambioLinea && (
                        <Badge className="w-fit bg-amber-500/10 text-amber-950 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-800 flex items-center gap-1">
                          <RefreshCw className="w-3 h-3" />
                          Cambio
                        </Badge>
                      )}
                      {linea.idpedidodet_orizon && (
                        <Badge className="w-fit bg-sky-600/10 text-sky-800 border border-sky-200 dark:bg-sky-900/30 dark:text-sky-100 dark:border-sky-800 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          En Orizon #{linea.idpedidodet_orizon}
                        </Badge>
                      )}
                      {isEditing && (
                        isEditingThisLine ? (
                          <div className="flex items-center gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              className="h-8 px-3"
                              onClick={onSave}
                            >
                              <Save className="h-3.5 w-3.5 mr-1" />
                              Guardar línea
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  title="Acciones de la línea"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel>Acciones de línea</DropdownMenuLabel>
                                <DropdownMenuItem
                                  onSelect={() => {
                                    void handleGenerateDescripcionForLinea(linea.pedidodetid, currentLinea);
                                  }}
                                  disabled={
                                    Boolean(descripcionLoadingByKey[`linea-${linea.pedidodetid}`]) ||
                                    !currentLinea.catalogoconfecid
                                  }
                                >
                                  {descripcionLoadingByKey[`linea-${linea.pedidodetid}`] ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  ) : (
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                  )}
                                  Generar descripción
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => handleCopyLinea(currentLinea)}>
                                  <Copy className="mr-2 h-4 w-4" />
                                  Copiar línea
                                </DropdownMenuItem>
                                {lineClipboard && (
                                  <DropdownMenuItem onSelect={() => handlePasteOverwriteLinea(linea.pedidodetid)}>
                                    <ClipboardPaste className="mr-2 h-4 w-4" />
                                    Pegar sobre línea
                                  </DropdownMenuItem>
                                )}
                                {linePasteBackups[getLineaKey(linea.pedidodetid)] !== undefined && (
                                  <DropdownMenuItem onSelect={() => handleUndoPaste(linea.pedidodetid)}>
                                    <X className="mr-2 h-4 w-4" />
                                    Deshacer pegado
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => handleCancelLineaEdit(linea.pedidodetid)}
                                >
                                  <X className="mr-2 h-4 w-4" />
                                  Cancelar edición
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCopyLinea(currentLinea)}
                              className="h-7 px-2"
                              title="Copiar esta línea"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                            {lineClipboard && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => handlePasteOverwriteLinea(linea.pedidodetid)}
                                title="Pegar sobre esta línea"
                              >
                                <ClipboardPaste className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditedLineas(prev => ({
                                  ...prev,
                                  [linea.pedidodetid]: {
                                    generoid: linea.generoid,
                                    calibreid: linea.calibreid,
                                    origenid: linea.origenid,
                                    tipocultivoid: linea.tipocultivoid,
                                    catalogoconfecid: linea.catalogoconfecid,
                                    grupoconfeccionid: linea.grupoconfeccionid,
                                    confeccionpaletid: linea.confeccionpaletid,
                                    confeccionsalidaid: linea.confeccionsalidaid,
                                    bultos: linea.bultos,
                                    bultosxpalet: linea.bultosxpalet,
                                    numero_palet: linea.numero_palet,
                                    piezasxbulto: linea.piezasxbulto,
                                    total_piezas: linea.total_piezas,
                                    nlote_cliente: linea.nlote_cliente ?? null,
                                  }
                                }));
                                setEditingLineaId(linea.pedidodetid);
                              }}
                              className="h-7 px-2"
                            >
                              <Edit2 className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-destructive"
                              onClick={() => onRequestDeleteLinea(linea.pedidodetid)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )
                      )}
                      {!isEditing && (
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => handleCopyLinea(currentLinea)}
                            title="Copiar esta línea"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          {lineClipboard && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => handlePasteOverwriteLinea(linea.pedidodetid)}
                              title="Pegar sobre esta línea"
                            >
                              <ClipboardPaste className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => {
                              setIsEditing(true);
                              setEditedLineas(prev => ({
                                ...prev,
                                [linea.pedidodetid]: {
                                  generoid: linea.generoid,
                                  calibreid: linea.calibreid,
                                  origenid: linea.origenid,
                                  tipocultivoid: linea.tipocultivoid,
                                  catalogoconfecid: linea.catalogoconfecid,
                                  grupoconfeccionid: linea.grupoconfeccionid,
                                  confeccionpaletid: linea.confeccionpaletid,
                                  confeccionsalidaid: linea.confeccionsalidaid,
                                  bultos: linea.bultos,
                                  bultosxpalet: linea.bultosxpalet,
                                  numero_palet: linea.numero_palet,
                                  piezasxbulto: linea.piezasxbulto,
                                  total_piezas: linea.total_piezas,
                                  nlote_cliente: linea.nlote_cliente ?? null,
                                }
                              }));
                              setEditingLineaId(linea.pedidodetid);
                            }}
                            title="Editar esta línea sin desplazarte al inicio"
                          >
                            <Edit2 className="h-3 w-3" />
                            <span className="text-xs ml-1">Editar línea</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive"
                            onClick={() => onRequestDeleteLinea(linea.pedidodetid)}
                            title="Eliminar esta línea"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-4">
                        <div className="mb-4 pb-3 border-b border-border/60">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-1 block">
                            Descripción
                          </Label>
                          {isEditingThisLine ? (
                            <Input
                              value={currentLinea.descripcion_salida ?? ''}
                              onChange={(e) => {
                                setEditedLineas(prev => ({
                                  ...prev,
                                  [linea.pedidodetid]: { ...prev[linea.pedidodetid], descripcion_salida: e.target.value }
                                }));
                              }}
                              className="h-8"
                            />
                          ) : (
                            <p className="text-sm leading-relaxed">{currentLinea.descripcion_salida ?? '-'}</p>
                          )}
                        </div>
                        <div className="mb-4 pb-3 border-b border-border/60">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-1 block">
                            EAN pieza
                          </Label>
                          {isEditingThisLine ? (
                            <Input
                              value={getLineaEanPieza(currentLinea) ?? ''}
                              onChange={(e) => {
                                const value = e.target.value.trim();
                                setEditedLineas((prev) => ({
                                  ...prev,
                                  [linea.pedidodetid]: {
                                    ...prev[linea.pedidodetid],
                                    ean_pieza: value === '' ? null : value,
                                  },
                                }));
                              }}
                              className="h-8"
                              placeholder="EAN de la pieza"
                            />
                          ) : (
                            <p className="text-sm leading-relaxed">{getLineaEanPieza(currentLinea) || 'Sin EAN pieza'}</p>
                          )}
                        </div>
                        <div className="mb-4 pb-3 border-b border-border/60">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-1 block">
                            EAN caja
                          </Label>
                          {isEditingThisLine ? (
                            <Input
                              value={getLineaEanCaja(currentLinea) ?? ''}
                              onChange={(e) => {
                                const value = e.target.value.trim();
                                setEditedLineas((prev) => ({
                                  ...prev,
                                  [linea.pedidodetid]: {
                                    ...prev[linea.pedidodetid],
                                    ean_caja: value === '' ? null : value,
                                  },
                                }));
                              }}
                              className="h-8"
                              placeholder="EAN de la caja"
                            />
                          ) : (
                            <p className="text-sm leading-relaxed">{getLineaEanCaja(currentLinea) || 'Sin EAN caja'}</p>
                          )}
                        </div>
                        <div className="mb-4 pb-3 border-b border-border/60">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-1 block">
                            Precio venta
                          </Label>
                          {isEditingThisLine ? (
                            <Input
                              type="number"
                              step="any"
                              value={getLineaPrecioVenta(currentLinea) ?? ''}
                              onChange={(e) => {
                                const value = e.target.value;
                                setEditedLineas((prev) => ({
                                  ...prev,
                                  [linea.pedidodetid]: {
                                    ...prev[linea.pedidodetid],
                                    precio_venta: value === '' ? null : Number(value),
                                  },
                                }));
                              }}
                              className="h-8"
                              placeholder="Precio de venta"
                            />
                          ) : (
                            <p className="text-sm leading-relaxed">
                              {getLineaPrecioVenta(currentLinea) ?? 'Sin precio venta'}
                            </p>
                          )}
                        </div>
                        <div className="mb-4 pb-3 border-b border-border/60">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide mb-1 block">
                            Número de lote
                          </Label>
                          {isEditingThisLine ? (
                            <Input
                              value={currentLinea.nlote_cliente ?? ''}
                              onChange={(e) => {
                                const value = e.target.value.trim();
                                setEditedLineas((prev) => ({
                                  ...prev,
                                  [linea.pedidodetid]: {
                                    ...prev[linea.pedidodetid],
                                    nlote_cliente: value === '' ? null : value,
                                  },
                                }));
                              }}
                              className="h-8"
                              placeholder="Número de lote"
                            />
                          ) : (
                            <p className="text-sm leading-relaxed">
                              {currentLinea.nlote_cliente?.trim() || 'Sin lote'}
                            </p>
                          )}
                        </div>
                        {/* Cantidades principales */}
                        <div className="mb-4">
                          <h5 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                            Cantidades
                          </h5>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Bultos</Label>
                              {isEditingThisLine ? (
                                <div className="space-y-2">
                                  <Input
                                    type="number"
                                    value={currentLinea.bultos ?? ''}
                                    onChange={(e) => {
                                      const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                      setEditedLineas(prev => ({
                                        ...prev,
                                        [linea.pedidodetid]: { ...prev[linea.pedidodetid], bultos: value }
                                      }));
                                    }}
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
                                        handleCalculateBultos(
                                          linea.pedidodetid,
                                          currentLinea.numero_palet,
                                          currentLinea.bultosxpalet
                                        )
                                      }
                                      title="Calcula bultos = numero de palets x bultos x palet"
                                    >
                                      Calcular
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <p className={cn('font-semibold text-lg break-words', isCambioLinea && 'text-amber-950 dark:text-amber-100')}>
                                  {typeof currentLinea.bultos === 'number' ? absIfCambio(currentLinea.bultos) : currentLinea.bultos}
                                </p>
                              )}
                            </div>
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Bultos x Palet</Label>
                              {isEditingThisLine ? (
                                <Input
                                  type="number"
                                  value={currentLinea.bultosxpalet ?? ''}
                                  onChange={(e) => {
                                    const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                    setEditedLineas(prev => ({
                                      ...prev,
                                      [linea.pedidodetid]: { ...prev[linea.pedidodetid], bultosxpalet: value }
                                    }));
                                  }}
                                  className="h-8"
                                />
                              ) : (
                                <p className={cn('font-semibold text-lg break-words', isCambioLinea && 'text-amber-950 dark:text-amber-100')}>
                                  {typeof currentLinea.bultosxpalet === 'number' ? absIfCambio(currentLinea.bultosxpalet) : currentLinea.bultosxpalet}
                                </p>
                              )}
                            </div>
                            <div
                              className={cn(
                                'space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0',
                                isCambioLinea && 'bg-amber-50/70 border-amber-200 dark:bg-amber-950/25 dark:border-amber-900',
                                isFractionalPalet(currentLinea.numero_palet) &&
                                  'bg-rose-50/70 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900'
                              )}
                            >
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Número palets</Label>
                              {isEditingThisLine ? (
                                <Input
                                  type="number"
                                  value={currentLinea.numero_palet ?? ''}
                                  onChange={(e) => {
                                    const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                    setEditedLineas(prev => ({
                                      ...prev,
                                      [linea.pedidodetid]: { ...prev[linea.pedidodetid], numero_palet: value }
                                    }));
                                  }}
                                  className="h-8"
                                  step="0.001"
                                />
                              ) : (
                                <p className={cn('font-semibold text-lg break-words', isCambioLinea && 'text-amber-950 dark:text-amber-100')}>
                                  {typeof currentLinea.numero_palet === 'number' ? Math.abs(currentLinea.numero_palet) : currentLinea.numero_palet}
                                </p>
                              )}
                            </div>
                            
                            {/* Campos de piezas - siempre visibles */}
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Piezas x Bulto</Label>
                              {isEditingThisLine ? (
                                <Input
                                  type="number"
                                  value={currentLinea.piezasxbulto ?? ''}
                                  onChange={(e) => {
                                    const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                    setEditedLineas(prev => ({
                                      ...prev,
                                      [linea.pedidodetid]: { ...prev[linea.pedidodetid], piezasxbulto: value }
                                    }));
                                  }}
                                  className="h-8"
                                />
                              ) : (
                                <p className={cn('font-semibold text-lg break-words', isCambioLinea && 'text-amber-950 dark:text-amber-100')}>
                                  {typeof currentLinea.piezasxbulto === 'number' ? absIfCambio(currentLinea.piezasxbulto) : currentLinea.piezasxbulto ?? '-'}
                                </p>
                              )}
                            </div>
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Total piezas</Label>
                              {isEditingThisLine ? (
                                <div className="space-y-2">
                                  <Input
                                    type="number"
                                    value={currentLinea.total_piezas ?? ''}
                                    onChange={(e) => {
                                      const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                      setEditedLineas(prev => ({
                                        ...prev,
                                        [linea.pedidodetid]: { ...prev[linea.pedidodetid], total_piezas: value }
                                      }));
                                    }}
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
                                        handleCalculateTotalPiezas(
                                          linea.pedidodetid,
                                          currentLinea.piezasxbulto,
                                          currentLinea.bultos
                                        )
                                      }
                                      title="Calcula total piezas = piezas x bulto x bultos"
                                    >
                                      Calcular
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <p className={cn('font-semibold text-lg break-words', isCambioLinea && 'text-amber-950 dark:text-amber-100')}>
                                  {typeof currentLinea.total_piezas === 'number' ? absIfCambio(currentLinea.total_piezas) : currentLinea.total_piezas ?? '-'}
                                </p>
                              )}
                            </div>
                            
                            {/* Campos de kilos - siempre visibles */}
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos x Bulto</Label>
                              {isEditingThisLine ? (
                                <Input
                                  type="number"
                                  value={currentLinea.kilosxbulto ?? ''}
                                  onChange={(e) => {
                                    const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                    setEditedLineas(prev => ({
                                      ...prev,
                                      [linea.pedidodetid]: { ...prev[linea.pedidodetid], kilosxbulto: value }
                                    }));
                                  }}
                                  className="h-8"
                                />
                              ) : (
                                <p className={cn('font-semibold text-lg break-words', isCambioLinea && 'text-amber-950 dark:text-amber-100')}>
                                  {typeof currentLinea.kilosxbulto === 'number' ? absIfCambio(currentLinea.kilosxbulto) : currentLinea.kilosxbulto ?? '-'}
                                </p>
                              )}
                            </div>
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos cliente</Label>
                              {isEditingThisLine ? (
                                <div className="space-y-2">
                                  <Input
                                    type="number"
                                    value={currentLinea.kilos_cliente ?? ''}
                                    onChange={(e) => {
                                      const value = e.target.value === '' ? null : parseFloat(e.target.value);
                                      setEditedLineas(prev => ({
                                        ...prev,
                                        [linea.pedidodetid]: { ...prev[linea.pedidodetid], kilos_cliente: value }
                                      }));
                                    }}
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
                                        handleCalculateKilosCliente(
                                          linea.pedidodetid,
                                          currentLinea.kilosxbulto,
                                          currentLinea.bultos
                                        )
                                      }
                                      title="Calcula kilos cliente = kilos x bulto x bultos"
                                    >
                                      Calcular
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <p className={cn('font-semibold text-lg break-words', isCambioLinea && 'text-amber-950 dark:text-amber-100')}>
                                  {typeof currentLinea.kilos_cliente === 'number' ? absIfCambio(currentLinea.kilos_cliente) : currentLinea.kilos_cliente ?? '-'}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* IDs de Configuración */}
                        <div className="mb-4">
                          <h5 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                            Identificadores de Configuración
                          </h5>
                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                            <div className="col-span-full text-[11px] text-muted-foreground mb-1 flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="bg-muted/60">Flujo de dependencias</Badge>
                              <span className="font-medium">1. Género</span>
                              <span>→</span>
                              <span className="font-medium">2. Catálogo Confección</span>
                              <span>→</span>
                              <span className="font-medium">3. Confección salida / Grupo / Calibre</span>
                              <span>→</span>
                              <span className="font-medium">4. Resto de identificadores</span>
                            </div>
                            {/* Género ID - con combobox */}
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground">Género</Label>
                              {isEditingThisLine ? (
                                <GeneroCombobox
                                  value={currentLinea.generoid}
                                  onChange={(value) => {
                                    setEditedLineas(prev => ({
                                      ...prev,
                                      [linea.pedidodetid]: { ...prev[linea.pedidodetid], generoid: value }
                                    }));
                                  }}
                                />
                              ) : (
                                <p className="font-semibold text-sm">
                                  {formatWithId(generoNombres[currentLinea.generoid], currentLinea.generoid)}
                                </p>
                              )}
                            </div>
                            {/* Catálogo de Confección con combobox */}
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground">Catálogo Confección</Label>
                              {isEditingThisLine ? (
                                <CatalogoConfecCombobox
                                  value={currentLinea.catalogoconfecid ?? undefined}
                                  generoid={currentLinea.generoid ?? null}
                                  onChange={(value, catalogo) =>
                                    handleCatalogoChangeForLinea(
                                      linea.pedidodetid,
                                      value,
                                      catalogo?.nombreCatalogo,
                                      catalogo?.confeccionSalidaId,
                                      catalogo?.grupoConfeccionId
                                    )
                                  }
                                />
                              ) : (
                                <p className="font-semibold text-sm">
                                  {formatWithId(catalogoConfecNombres[currentLinea.catalogoconfecid], currentLinea.catalogoconfecid)}
                                </p>
                              )}
                            </div>
                            {/* Confección Salida con combobox */}
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground">Confección Salida</Label>
                              {isEditingThisLine ? (
                                <ConfeccionSalidaCombobox
                                  value={currentLinea.confeccionsalidaid}
                                  catalogoconfecid={currentLinea.catalogoconfecid ?? null}
                                  onChange={(value, confeccion) =>
                                    handleConfeccionSalidaChangeForLinea(
                                      linea.pedidodetid,
                                      value,
                                      confeccion?.grupoconfeccionid
                                    )
                                  }
                                />
                              ) : (
                                <p className="font-semibold text-sm">
                                  {formatWithId(confeccionSalidaNombres[currentLinea.confeccionsalidaid], currentLinea.confeccionsalidaid)}
                                </p>
                              )}
                            </div>
                            {/* Grupo Confección con combobox */}
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground">Grupo Confección</Label>
                              {isEditingThisLine ? (
                                <GrupoConfeccionCombobox
                                  value={currentLinea.grupoconfeccionid}
                                  catalogoconfecid={currentLinea.catalogoconfecid ?? null}
                                  onChange={(value) => {
                                    setEditedLineas(prev => ({
                                      ...prev,
                                      [linea.pedidodetid]: { ...prev[linea.pedidodetid], grupoconfeccionid: value }
                                    }));
                                  }}
                                />
                              ) : (
                                <p className="font-semibold text-sm">
                                  {formatWithId(grupoConfeccionNombres[currentLinea.grupoconfeccionid], currentLinea.grupoconfeccionid)}
                                </p>
                              )}
                            </div>
                            {/* Confección Palet con combobox */}
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground">Confección Palet</Label>
                              {isEditingThisLine ? (
                                <ConfeccionPaletCombobox
                                  value={currentLinea.confeccionpaletid}
                                  onChange={(value) => {
                                    setEditedLineas(prev => ({
                                      ...prev,
                                      [linea.pedidodetid]: { ...prev[linea.pedidodetid], confeccionpaletid: value }
                                    }));
                                  }}
                                />
                              ) : (
                                <p className="font-semibold text-sm">
                                  {formatWithId(confeccionPaletNombres[currentLinea.confeccionpaletid], currentLinea.confeccionpaletid)}
                                </p>
                              )}
                            </div>
                            {/* Calibre con combobox */}
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground">Calibre</Label>
                              {isEditingThisLine ? (
                                <CalibreCombobox
                                  value={currentLinea.calibreid}
                                  catalogoconfecid={currentLinea.catalogoconfecid ?? null}
                                  onChange={(value) => {
                                    setEditedLineas(prev => ({
                                      ...prev,
                                      [linea.pedidodetid]: { ...prev[linea.pedidodetid], calibreid: value }
                                    }));
                                  }}
                                />
                              ) : (
                                <p className="font-semibold text-sm">
                                  {formatWithId(calibreNombres[currentLinea.calibreid], currentLinea.calibreid)}
                                </p>
                              )}
                            </div>
                            {/* Origen con combobox */}
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground">Origen</Label>
                              {isEditingThisLine ? (
                                <OrigenCombobox
                                  value={currentLinea.origenid}
                                  onChange={(value) => {
                                    setEditedLineas(prev => ({
                                      ...prev,
                                      [linea.pedidodetid]: { ...prev[linea.pedidodetid], origenid: value }
                                    }));
                                  }}
                                />
                              ) : (
                                <p className="font-semibold text-sm">
                                  {formatWithId(origenNombres[currentLinea.origenid], currentLinea.origenid)}
                                </p>
                              )}
                            </div>
                            {/* Tipo Cultivo con combobox */}
                            <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                              <Label className="text-xs text-muted-foreground">Tipo Cultivo</Label>
                              {isEditingThisLine ? (
                                <TipoCultivoCombobox
                                  value={currentLinea.tipocultivoid}
                                  onChange={(value) => {
                                    setEditedLineas(prev => ({
                                      ...prev,
                                      [linea.pedidodetid]: { ...prev[linea.pedidodetid], tipocultivoid: value }
                                    }));
                                  }}
                                />
                              ) : (
                                <p className="font-semibold text-sm">
                                  {formatWithId(tipoCultivoNombres[currentLinea.tipocultivoid], currentLinea.tipocultivoid)}
                                </p>
                              )}
                            </div>
                            
                            {/* Cat. Confec Kilos Bulto ID - editable */}
                            {isEditingThisLine
                              ? renderCatOptionField(
                                  currentLinea.catalogoconfecid ?? null,
                                  'Cat. Confec Kilos Bulto ID',
                                  currentLinea.catconfeckilosbultoid,
                                  (selectedId) =>
                                    handleCatConfeckilosChange(linea.pedidodetid, currentLinea.catalogoconfecid ?? null, selectedId),
                                  'kilos'
                                )
                              : (
                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                                  <Label className="text-xs text-muted-foreground">Cat. Confec Kilos Bulto ID</Label>
                                  <p className="font-medium text-sm">
                                    {formatCatKilosLabel(currentLinea.catalogoconfecid, currentLinea.catconfeckilosbultoid)}
                                  </p>
                                </div>
                              )}
                            
                            {/* Cat. Confec Pieza ID - editable */}
                            {isEditingThisLine
                              ? renderCatOptionField(
                                  currentLinea.catalogoconfecid ?? null,
                                  'Cat. Confec Pieza ID',
                                  currentLinea.catconfecpiezaid,
                                  (selectedId) =>
                                    handleCatConfecPiezaChange(linea.pedidodetid, currentLinea.catalogoconfecid ?? null, selectedId),
                                  'piezas'
                                )
                              : (
                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border min-w-0">
                                  <Label className="text-xs text-muted-foreground">Cat. Confec Pieza ID</Label>
                                  <p className="font-medium text-sm">
                                    {formatCatPiezaLabel(currentLinea.catalogoconfecid, currentLinea.catconfecpiezaid)}
                                  </p>
                                </div>
                              )}
                          </div>
                        </div>
                        {(() => {
                          const lineKey = getLineaKey(linea.pedidodetid);
                          const newCentrosLinea = getNewCentrosList(lineKey);
                          const deletedSet = new Set(deletedCentros);
                          const activeExisting = (linea.centros || []).filter(c => !deletedSet.has(c.pedcentroid));
                          const acceptedNew = newCentrosLinea.filter(c => c.accepted);
                          const activeCount = activeExisting.length + acceptedNew.length;
                          const totalDisplay = (linea.centros?.length || 0) + newCentrosLinea.length;
                          const shouldShowCentros = totalDisplay > 0 || isEditingThisLine;
                          const canDeleteExisting = (remainingAfterDelete: number) => remainingAfterDelete >= 1;
                          const canDeleteNew = (centro: NewCentroDraft) => {
                            if (!centro.accepted) return true;
                            const remaining = activeCount - 1;
                            return remaining >= 1;
                          };
                          if (!shouldShowCentros) return null;
                          return (
                            <div className="mt-3 pt-3 border-t space-y-3">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <h5 className="text-sm font-semibold flex items-center gap-2">
                                  <MapPin className="h-4 w-4 text-primary" />
                                  Centros de Distribución
                                  {linea.centros && (
                                    <span className="text-muted-foreground font-normal">
                                      ({totalDisplay})
                                    </span>
                                  )}
                                </h5>
                                {isEditingThisLine && (
                                  <Button variant="secondary" size="sm" className="h-8" onClick={() => addNewCentro(lineKey)}>
                                    Añadir centro
                                  </Button>
                                )}
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {linea.centros?.map((centro) => {
                                  const editedCentro = editedCentros[centro.pedcentroid] || {};
                                  const currentCentro = { ...centro, ...editedCentro };
                                  const isCambioCentro =
                                    typeof currentCentro.numero_palets === 'number' && currentCentro.numero_palets < 0;
                                  const numeroPaletsDisplay =
                                    typeof currentCentro.numero_palets === 'number'
                                      ? Math.abs(currentCentro.numero_palets)
                                      : currentCentro.numero_palets ?? '-';
                                  const markedDeleted = deletedSet.has(centro.pedcentroid);
                                  const remainingAfterDelete = activeCount - (markedDeleted ? 0 : 1);
                                  const canDelete = canDeleteExisting(remainingAfterDelete);
                                  return (
                                    <div
                                      key={centro.pedcentroid}
                                      className={cn(
                                        'bg-muted/30 rounded-lg p-3 border transition-colors',
                                        markedDeleted
                                          ? 'border-destructive/50 bg-destructive/5'
                                          : isCambioCentro
                                            ? 'border-amber-300 bg-amber-50/60 ring-1 ring-amber-300/40 dark:border-amber-800 dark:bg-amber-950/20 dark:ring-amber-800/40'
                                            : 'hover:border-primary/30'
                                      )}
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge variant="outline" className="text-xs">Centro ID: {centro.pedcentroid}</Badge>
                                          {isCambioCentro && !markedDeleted && (
                                            <Badge className="text-xs bg-amber-500/10 text-amber-900 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-800 flex items-center gap-1">
                                              <RefreshCw className="w-3 h-3" />
                                              Cambio
                                            </Badge>
                                          )}
                                          {centro.pedidocentroid_orizon && (
                                            <Badge className="text-xs bg-sky-600/10 text-sky-800 border border-sky-200 dark:bg-sky-900/30 dark:text-sky-100 dark:border-sky-800 flex items-center gap-1">
                                              <CheckCircle2 className="w-3 h-3" />
                                              Orizon #{centro.pedidocentroid_orizon}
                                            </Badge>
                                          )}
                                        </div>
                                        {isEditingThisLine && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className={cn('h-7 px-2', markedDeleted ? 'text-foreground' : 'text-destructive')}
                                            disabled={!markedDeleted && !canDelete}
                                            onClick={() => toggleDeleteCentro(centro.pedcentroid)}
                                          >
                                            {markedDeleted ? 'Deshacer' : 'Eliminar'}
                                          </Button>
                                        )}
                                      </div>
                                      {!markedDeleted && (
                                      <div className="grid grid-cols-3 gap-3 text-sm">
                                        <div className="space-y-1">
                                          <Label className="text-xs text-muted-foreground">Asignación</Label>
                                          {isEditingThisLine ? (
                                            <Input
                                              value={currentCentro.asignacion ?? ''}
                                              onChange={(e) => {
                                                setEditedCentros(prev => ({
                                                  ...prev,
                                                  [centro.pedcentroid]: { ...prev[centro.pedcentroid], asignacion: e.target.value }
                                                }));
                                              }}
                                              className="h-7"
                                            />
                                          ) : (
                                            <p className="font-medium">{currentCentro.asignacion}</p>
                                          )}
                                        </div>
                                        <div className="space-y-1">
                                          <Label className="text-xs text-muted-foreground">Palets</Label>
                                          {isEditingThisLine ? (
                                            <Input
                                              type="number"
                                              value={currentCentro.numero_palets ?? ''}
                                              onChange={(e) => {
                                                const value = parseNumberInput(e.target.value);
                                                setEditedCentros(prev => ({
                                                  ...prev,
                                                  [centro.pedcentroid]: { ...prev[centro.pedcentroid], numero_palets: value }
                                                }));
                                              }}
                                              className="h-7"
                                              step="0.001"
                                            />
                                          ) : (
                                            <p className={cn('font-medium', isCambioCentro && 'text-amber-900 dark:text-amber-100')}>
                                              {numeroPaletsDisplay}
                                            </p>
                                          )}
                                        </div>
                                        <div className="space-y-1">
                                          <Label className="text-xs text-muted-foreground">Subprov</Label>
                                          {isEditingThisLine ? (
                                            <SubcentroCombobox
                                              value={currentCentro.subprov ?? null}
                                              excludeIds={[...getUsedSubprovIds(lineKey, { existingId: centro.pedcentroid })]}
                                              onChange={(val) => {
                                                setEditedCentros(prev => ({
                                                  ...prev,
                                                  [centro.pedcentroid]: { ...prev[centro.pedcentroid], subprov: val ?? null }
                                                }));
                                              }}
                                            />
                                          ) : (
                                            <p className="font-medium">
                                              {currentCentro.subprov
                                                ? subcentroNombres[currentCentro.subprov] || `Subcentro ID: ${currentCentro.subprov}`
                                                : '-'}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {newCentrosLinea.map((centro) => (
                                  <div
                                    key={centro.tempId}
                                    className="bg-muted/30 rounded-lg p-3 border border-dashed hover:border-primary/50 transition-colors"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                                      <Badge variant="secondary" className="text-xs">Nuevo centro</Badge>
                                      <div className="flex items-center gap-2">
                                        {!centro.accepted && (
                                          <Button
                                            variant="secondary"
                                            size="sm"
                                            className="h-7 px-3"
                                            onClick={() => updateNewCentro(lineKey, centro.tempId, 'accepted', true)}
                                          >
                                            Aceptar
                                          </Button>
                                        )}
                                        {centro.accepted && (
                                          <Badge variant="outline" className="text-xs">Aceptado</Badge>
                                        )}
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-destructive"
                                          disabled={centro.accepted && activeCount - 1 < 1}
                                          onClick={() => removeNewCentro(lineKey, centro.tempId)}
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-3 text-sm">
                                      <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">Asignación</Label>
                                        <Input
                                          value={centro.asignacion}
                                          onChange={(e) => updateNewCentro(linea.pedidodetid, centro.tempId, 'asignacion', e.target.value)}
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
                                            updateNewCentro(linea.pedidodetid, centro.tempId, 'numero_palets', val);
                                          }}
                                          className="h-7"
                                          step="0.001"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">Subprov</Label>
                                        <SubcentroCombobox
                                          value={centro.subprov}
                                          excludeIds={[...getUsedSubprovIds(lineKey, { tempId: centro.tempId })]}
                                          onChange={(val) => updateNewCentro(lineKey, centro.tempId, 'subprov', val)}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : newLineas.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No hay líneas registradas para este pedido</p>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
    </div>
        {pedido.archivo_pdf_id && hasSharedPdfRelations && (
          <div
            data-shared-pdf-panel
            className="pointer-events-none absolute bottom-4 right-0 top-4 hidden w-[min(360px,calc(100vw-32px))] 2xl:block"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="pointer-events-auto absolute right-2 top-1/2 z-40 flex h-14 w-8 -translate-y-1/2 flex-col gap-0.5 rounded-full border border-border/70 bg-background/95 text-muted-foreground shadow-md transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-0 active:bg-muted/80"
              onClick={() => setSharedPdfPanelOpen((prev) => !prev)}
              aria-label={sharedPdfPanelOpen ? 'Ocultar PDF compartido' : 'Mostrar PDF compartido'}
              title={sharedPdfPanelOpen ? 'Ocultar PDF compartido' : 'Mostrar PDF compartido'}
            >
              <FileText className="h-4 w-4" />
              {sharedPdfPanelOpen ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
            <div
              className={`pointer-events-auto absolute bottom-0 right-0 top-0 z-30 w-[min(360px,calc(100vw-32px))] transform-gpu transition-[opacity,transform] duration-200 ease-out will-change-transform ${
                sharedPdfPanelOpen
                  ? 'translate-x-0 opacity-100'
                  : 'pointer-events-none translate-x-[calc(100%+12px)] opacity-0'
              }`}
              aria-hidden={!sharedPdfPanelOpen}
            >
              <div className="h-full rounded-lg shadow-2xl">
                <PdfSharedInfo
                  archivoPdfId={pedido.archivo_pdf_id}
                  currentPedidoId={pedido.id}
                  currentClienteId={pedido.clienteid ?? null}
                  onPedidoClick={onPedidoRelacionadoClick}
                  className="h-full"
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
</Dialog>
<AlertDialog open={showPickingDialog} onOpenChange={setShowPickingDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Picking listo</AlertDialogTitle>
      <AlertDialogDescription>
        {(pedido?.lineas?.length ?? 0)} línea(s) enlazadas con la previsión #{resolvedMatchingPrevisionId ?? '—'}.<br />
        ¿Quieres enviarlo ahora? (endpoint en construcción)
      </AlertDialogDescription>
    </AlertDialogHeader>
      <AlertDialogFooter className="flex flex-wrap gap-2 sm:justify-end">
        <AlertDialogCancel>Cancelar</AlertDialogCancel>
        <AlertDialogAction
          onClick={handleSendPicking}
          disabled={pickingSending}
          title="Enviar picking a Orizon"
        >
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
<AlertDialog open={ignorePrevisionDialogOpen} onOpenChange={setIgnorePrevisionDialogOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>¿Ignorar previsión y enviar?</AlertDialogTitle>
      <AlertDialogDescription>
        Este pedido tiene una previsión vinculada. Si continúas, se enviará directamente a Orizon sin usar la previsión para el picking.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={() => setIgnorePrevisionDialogOpen(false)}>Cancelar</AlertDialogCancel>
      <AlertDialogAction
        onClick={() => {
          setIgnorePrevisionDialogOpen(false);
          onSendPedido?.(pedido, { ignorePrevision: true });
        }}
        disabled={sendingPedidoId === pedido.id || isEditing}
      >
        Enviar ignorando previsión
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
</>
);
};
