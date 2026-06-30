import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CambioReviewDialog } from '@/components/CambioReviewDialog';
import { CambioCreatePedidoDialog } from '@/components/CambioCreatePedidoDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useUserLabels } from '@/hooks/useUserLabels';
import { ClientCombobox } from '@/components/ClientCombobox';
import { DomicilioCombobox } from '@/components/DomicilioCombobox';
import type { PedidoLinea, TipoPedido } from '@/types/pedidos';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  RefreshCw,
  ExternalLink,
  Trash2,
  Users,
  MapPin,
  Filter,
  X,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Calendar,
} from 'lucide-react';
import type { CambioLinea, CambioPedido, ChangeMeta } from '@/types/cambios';
import type { Database } from '@/integrations/supabase/types';
import { agroirisAcreedores } from '@/services/agroirisAcreedores';
import { agroirisClients } from '@/services/agroirisClients';
import { agroirisDomicilios } from '@/services/agroirisDomicilios';
import { agroirisAuth } from '@/services/agroirisAuth';
import { agroirisPdfFiles } from '@/services/agroirisPdfFiles';
import { sendPedidoToOrizon } from '@/services/agroirisPedidos';
import {
  getClienteBehaviorRulesMap,
  type ClienteBehaviorRule,
} from '@/services/clienteBehaviorRules';
import {
  extractMatchedPedidoId,
  extractMatchedPedidoIds,
  getAppliedFlags,
  hasNonEmptyMeta,
  resolveAcreedorId,
  updateAppliedFlags,
  updateCambioMetaAcreedor,
  updateCambioMetaMatch,
  updateCambioMetaMatchList,
} from '@/utils/cambioMeta';
import { resolveOrizonId } from '@/utils/orizon';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { NewPedidoLineaDraft } from '@/types/pedidos';
import { buildCambioDetailPath, buildPedidoDetailPath, ROUTE_BASES } from '@/utils/entityRoutes';

type CambioMatchSummary = {
  headerMatched: boolean;
  pedidoId?: number;
  pedidoReferencia?: string | null;
  lineMatches?: {
    matched: number;
    total: number;
  };
  reason?: 'missing_reference' | 'no_reference_in_change' | 'ambiguous' | 'manual_search';
  candidates?: PedidoMatchCandidate[];
};

type PedidoMatchCandidate = Pick<
  Database['public']['Tables']['pedidos']['Row'],
  | 'id'
  | 'referencia_cliente'
  | 'referencia2_cliente'
  | 'fecha_carga'
  | 'fecha_pedido'
  | 'clienteid'
  | 'sujetodomicilioid_destino'
  | 'created_at'
  | 'idpedido_orizon'
  | 'archivo_pdf_id'
>;

type MatchSelectionMode = 'cambio' | 'nuevo_pedido';

type AcreedorInfo = {
  id: number | null;
  label: string | null;
};

type LineChangeSummary = {
  hasLineMeta: boolean;
  allAdd: boolean;
  actions: Set<string>;
};

type CambiosRpcRow = {
  row_type: 'meta' | 'item';
  total_groups: number | null;
  total_items: number | null;
  row_json: CambioPedido | null;
};

type RpcResponse = {
  data: unknown;
  error: { message: string } | null;
};

type GroupedCambio = {
  archivoPdfId: number | null;
  cambios: CambioPedido[];
  total: number;
  fechaReferencia: string | null;
  entradaLabel: string | null;
  clienteNombre?: string;
  domicilioNombre?: string;
};

type GroupPdfApplyState = {
  allReviewed: boolean;
  missingMatch: boolean;
  pedidoIdList: number[];
  canApplyPdf: boolean;
  pdfAlreadyApplied: boolean;
};

type AutoApplyQueueItem = {
  archivoPdfId: number;
  sourceCambioId: number;
};

type GroupRecency = {
  timestamp: number;
  maxCambioId: number;
};

const parseTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getCambioRecencyTimestamp = (cambio: Pick<CambioPedido, 'fecha_carga' | 'fecha_pedido' | 'created_at'>) => {
  return parseTimestamp(cambio.fecha_carga ?? cambio.fecha_pedido ?? cambio.created_at ?? null);
};

const getCambioEntryTimestamp = (cambio: Pick<CambioPedido, 'fecha_carga' | 'fecha_pedido' | 'created_at'>) => {
  return parseTimestamp(cambio.fecha_carga ?? cambio.fecha_pedido ?? cambio.created_at ?? null);
};

const getGroupRecency = (group: Pick<GroupedCambio, 'cambios'>): GroupRecency => {
  let timestamp = 0;
  let maxCambioId = 0;

  group.cambios.forEach((cambio) => {
    const cambioTimestamp = getCambioRecencyTimestamp(cambio);
    const cambioId = Number.isFinite(cambio.id) ? cambio.id : 0;
    if (cambioTimestamp > timestamp || (cambioTimestamp === timestamp && cambioId > maxCambioId)) {
      timestamp = cambioTimestamp;
      maxCambioId = cambioId;
    }
  });

  return { timestamp, maxCambioId };
};

const isSameRecency = (a: GroupRecency, b: GroupRecency) =>
  a.timestamp === b.timestamp && a.maxCambioId === b.maxCambioId;

const isMoreRecent = (a: GroupRecency, b: GroupRecency) =>
  a.timestamp > b.timestamp || (a.timestamp === b.timestamp && a.maxCambioId > b.maxCambioId);

const ENABLE_AUTO_PDF_APPLY_FROM_CAMBIOS = false;

const changeToneMap: Record<string, string> = {
  nuevo: 'border-sky-200 bg-sky-50 text-sky-800',
  anulacion: 'border-rose-200 bg-rose-50 text-rose-800',
  mixto: 'border-teal-200 bg-teal-50 text-teal-800',
  transportista: 'border-blue-200 bg-blue-50 text-blue-800',
  matricula: 'border-amber-200 bg-amber-50 text-amber-800',
  lineas: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  cabecera: 'border-cyan-200 bg-cyan-50 text-cyan-800',
  legacy: 'border-slate-200 bg-slate-50 text-slate-700',
};

const tipoBadgeMap: Record<string, string> = {
  pedido: 'border-blue-200 bg-blue-50 text-blue-800',
  prevision: 'border-orange-200 bg-orange-50 text-orange-800',
};

const getCambioFlags = (cambio: CambioPedido, lineSummary?: LineChangeSummary | null) => {
  const hasHeaderMeta = hasNonEmptyMeta(cambio.change_meta);
  const hasLineMeta = Boolean(lineSummary?.hasLineMeta);
  const headerChange = getHeaderChange(cambio.change_meta);
  const headerColumns = (headerChange?.columns ?? [])
    .map((column) => column.toLowerCase().trim())
    .filter(Boolean);
  const hasTransportistaChange =
    hasHeaderMeta && headerChange?.action === 'update' && headerColumns.includes('transportista');
  const matriculaFromMeta =
    hasHeaderMeta &&
    headerChange?.action === 'update' &&
    headerColumns.some((column) =>
      ['matricula', 'matricula_tractora', 'matricula_remolque'].includes(column),
    );
  const fallbackMatricula = !hasHeaderMeta || !headerChange || headerColumns.length === 0;
  const hasMatriculaChange = matriculaFromMeta || (fallbackMatricula && hasMatriculaValues(cambio));
  const hasHeaderChange = hasTransportistaChange || hasMatriculaChange;
  const actions = lineSummary?.actions ? Array.from(lineSummary.actions).map((action) => action.toLowerCase()) : [];
  const isCancelacion = hasLineMeta && actions.length > 0 && actions.every((action) => action === 'cancel');
  const isNuevoPedido = Boolean(hasLineMeta && lineSummary?.allAdd);
  return {
    hasHeaderMeta,
    hasLineMeta,
    hasTransportistaChange,
    hasMatriculaChange,
    hasHeaderChange,
    isCancelacion,
    isNuevoPedido,
  };
};

type CambioFlags = ReturnType<typeof getCambioFlags> & { isPrevisionAdd: boolean; isPedidoAdd: boolean };

const resolveCambioFlags = (
  cambio: CambioPedido,
  lineSummary?: LineChangeSummary | null,
  matchSummary?: CambioMatchSummary | null,
): CambioFlags => {
  const base = getCambioFlags(cambio, lineSummary);
  const hasMatch = Boolean(matchSummary?.headerMatched);
  const isAddLine = base.isNuevoPedido && hasMatch;
  const isPrevisionAdd = (cambio.tipo_pedido ?? 'P220') === 'P22E' && isAddLine;
  const isPedidoAdd = (cambio.tipo_pedido ?? 'P220') !== 'P22E' && isAddLine;
  return {
    ...base,
    isPrevisionAdd,
    isPedidoAdd,
    isNuevoPedido: base.isNuevoPedido && !isAddLine,
  };
};

const getCambioLabelWithContext = (
  flags: CambioFlags,
  tipoPedido: string | null,
  nuevoPedidoLabel: string,
) => {
  if (flags.isPrevisionAdd) return 'Añadir líneas a previsión';
  if (flags.isPedidoAdd) return 'Añadir líneas al pedido';
  return getCambioLabel(flags, tipoPedido, nuevoPedidoLabel);
};

const getChangeKindWithContext = (flags: CambioFlags) => {
  if (flags.isPrevisionAdd) return 'lineas';
  if (flags.isPedidoAdd) return 'lineas';
  return getChangeKind(flags);
};

const getCambioLabel = (flags: ReturnType<typeof getCambioFlags>, tipoPedido: string | null, nuevoPedidoLabel: string) => {
  if (flags.isNuevoPedido) return nuevoPedidoLabel;
  if (flags.isCancelacion) {
    return tipoPedido === 'P22E' ? 'Anulación de previsión' : 'Anulación de pedido';
  }
  if (flags.hasHeaderChange && flags.hasLineMeta) {
    if (flags.hasTransportistaChange && flags.hasMatriculaChange) {
      return 'Cambio de transportista, matrícula y líneas';
    }
    return flags.hasTransportistaChange
      ? 'Cambio de transportista y líneas'
      : flags.hasMatriculaChange
        ? 'Cambio de matrícula y líneas'
        : 'Cambio de líneas';
  }
  if (flags.hasTransportistaChange) return 'Cambio de transportista';
  if (flags.hasMatriculaChange) return 'Cambio de matrícula';
  if (flags.hasHeaderMeta && !flags.hasLineMeta) return 'Cambio de cabecera';
  if (flags.hasLineMeta) return 'Cambio de líneas';
  return 'Cambio legacy';
};

const getChangeKind = (flags: ReturnType<typeof getCambioFlags>) => {
  if (flags.isNuevoPedido) return 'nuevo';
  if (flags.isCancelacion) return 'anulacion';
  if (flags.hasHeaderChange && flags.hasLineMeta) return 'mixto';
  if (flags.hasTransportistaChange) return 'transportista';
  if (flags.hasMatriculaChange) return 'matricula';
  if (flags.hasHeaderMeta && !flags.hasLineMeta) return 'cabecera';
  if (flags.hasLineMeta) return 'lineas';
  return 'legacy';
};
type CambioPedidoDraft = CambioPedido & {
  serieid?: number | null;
  clienteid_envio?: number | null;
  divisa_cliente?: number | null;
  comercialid?: number | null;
  sujetodomicilioid_envio?: number | null;
  matricula_tractora?: string | null;
  matricula_remolque?: string | null;
};

type NuevoPedidoCentroDraft = {
  tempId: string;
  asignacion: string;
  numero_palets: number | null;
  subprov: number | null;
};

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

const getLineaEanPieza = (linea: {
  ean?: string | number | null;
  ean_pieza?: string | number | null;
  ean_bulto?: string | number | null;
}) => {
  const raw = linea.ean_pieza ?? linea.ean_bulto ?? linea.ean ?? null;
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  return !trimmed || trimmed === '0' ? null : trimmed;
};

const getLineaEanCaja = (linea: { ean_caja?: string | number | null }) => {
  const raw = linea.ean_caja ?? null;
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  return !trimmed || trimmed === '0' ? null : trimmed;
};

const buildLineaKey = (linea: {
  idpedidodet_orizon?: number | null;
  descripcion_salida?: string | null;
  catalogoconfecid?: number | null;
  generoid?: number | null;
  bultos?: number | null;
  kilos_cliente?: number | null;
  ean?: string | number | null;
  ean_pieza?: string | number | null;
  ean_bulto?: string | number | null;
}) => {
  if (linea.idpedidodet_orizon) {
    return `orizon:${linea.idpedidodet_orizon}`;
  }

  const eanPieza = getLineaEanPieza(linea);
  const eanKey = eanPieza ? `ean:${eanPieza}` : '';
  // Match by EAN when exista, si no, por descripción (evita requerir atributos numéricos exactos)
  const desc = (linea.descripcion_salida || '').toLowerCase().trim();
  return [eanKey, desc].filter(Boolean).join('|');
};

const getHeaderChange = (meta: unknown): ChangeMeta | null => {
  if (!meta || typeof meta !== 'object') return null;
  const record = meta as Record<string, unknown>;
  const change = record._change;
  if (!change || typeof change !== 'object') return null;
  return change as ChangeMeta;
};

const getLineChangeAction = (meta: unknown): string | null => {
  if (!meta) return null;
  let record: Record<string, unknown> | null = null;
  if (typeof meta === 'string') {
    try {
      record = JSON.parse(meta) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof meta === 'object') {
    record = meta as Record<string, unknown>;
  }
  if (!record) return null;
  const change = record._change as Record<string, unknown> | undefined;
  const action = change?.action;
  return typeof action === 'string' && action.trim() ? action.trim() : null;
};

const buildLineChangeSummaries = (
  lineas: Array<{ pedidoid?: number | null; change_meta?: unknown; accion?: string | null }>,
): Record<number, LineChangeSummary> => {
  const summaryById: Record<number, LineChangeSummary> = {};
  lineas.forEach((linea) => {
    const pedidoId = linea.pedidoid;
    if (!pedidoId) return;
    const hasMeta = hasNonEmptyMeta(linea.change_meta);
    const rawAction =
      getLineChangeAction(linea.change_meta) ??
      (typeof linea.accion === 'string' && linea.accion.trim() ? linea.accion.trim() : null);
    if (!hasMeta && !rawAction) return;
    const entry = summaryById[pedidoId] ?? {
      hasLineMeta: false,
      allAdd: false,
      actions: new Set<string>(),
    };
    if (hasMeta) {
      entry.hasLineMeta = true;
    }
    if (rawAction) {
      entry.actions.add(rawAction.toLowerCase());
    }
    summaryById[pedidoId] = entry;
  });
  Object.values(summaryById).forEach((entry) => {
    const actions = Array.from(entry.actions);
    entry.allAdd = actions.length > 0 && actions.every((action) => action === 'add');
  });
  return summaryById;
};

const normalizeLineaAction = (value: unknown): LineaCambioAction => {
  const normalized = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (normalized === 'add') return 'add';
  if (normalized === 'cancel') return 'cancel';
  if (normalized === 'edit' || normalized === 'update' || normalized === 'upsert') return 'update';
  return 'update';
};

const getEffectiveLineaAction = (
  linea: Pick<CambioLinea, 'accion' | 'change_meta'>,
  draft?: Partial<Pick<LineaCambioDraft, 'action'>> | null,
): LineaCambioAction =>
  normalizeLineaAction(draft?.action ?? getLineChangeAction(linea.change_meta) ?? linea.accion ?? 'update');

const parseNumericValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseTextValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const ORIZON_PENDING_LINE_DELETES_KEY = 'orizon_line_delete_ids';

const getPendingOrizonLineDeletes = (meta: unknown): number[] => {
  if (!meta || typeof meta !== 'object') return [];
  const record = meta as Record<string, unknown>;
  const raw = record[ORIZON_PENDING_LINE_DELETES_KEY];
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((value) => parseNumericValue(value))
        .filter((value): value is number => value !== null && value > 0),
    ),
  );
};

const setPendingOrizonLineDeletes = (meta: unknown, lineIds: number[]): Record<string, unknown> => {
  const record =
    meta && typeof meta === 'object'
      ? { ...(meta as Record<string, unknown>) }
      : typeof meta === 'string' && meta.trim()
        ? { raw: meta }
        : {};

  if (lineIds.length === 0) {
    delete record[ORIZON_PENDING_LINE_DELETES_KEY];
    return record;
  }

  record[ORIZON_PENDING_LINE_DELETES_KEY] = Array.from(
    new Set(lineIds.filter((id) => Number.isFinite(id) && id > 0)),
  );
  return record;
};

const ORIZON_DELETE_NOT_FOUND_STATUSES = new Set([404, 410]);

const getErrorStatus = (error: unknown): number | null => {
  if (!error || typeof error !== 'object') return null;
  const status = parseNumericValue((error as { status?: unknown }).status);
  return status ?? null;
};

const isAlreadyDeletedError = (error: unknown): boolean => {
  const status = getErrorStatus(error);
  if (status !== null && ORIZON_DELETE_NOT_FOUND_STATUSES.has(status)) {
    return true;
  }

  const message =
    error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : '';
  return /\b404\b/.test(message) || /not found/i.test(message);
};

const deleteOrizonResource = async (endpoint: string, resourceLabel: string): Promise<'deleted' | 'already_deleted'> => {
  try {
    await agroirisAuth.authenticatedFetch(endpoint, { method: 'DELETE' });
    return 'deleted';
  } catch (error) {
    if (isAlreadyDeletedError(error)) {
      console.info(`${resourceLabel} ya eliminado en Orizon: ${endpoint}`);
      return 'already_deleted';
    }
    throw error;
  }
};

const normalizeMatricula = (value: string | null | undefined) => {
  if (value == null) return '';
  return value;
};

const normalizeMatriculaForSave = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const buildReferenciaRange = (referencia: string | null | undefined, offset = 20) => {
  if (!referencia) return [];
  const trimmed = referencia.trim();
  if (!trimmed) return [];
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) return [];
  const prefix = match[1] ?? '';
  const numericPart = match[2] ?? '';
  const base = Number(numericPart);
  if (!Number.isFinite(base)) return [];
  const padLength = numericPart.length;
  const refs: string[] = [];
  for (let delta = -offset; delta <= offset; delta += 1) {
    const candidate = base + delta;
    if (candidate < 0) continue;
    refs.push(`${prefix}${String(candidate).padStart(padLength, '0')}`);
  }
  return Array.from(new Set(refs));
};

const buildPedidoDateFilters = (fechaPedido: string | null | undefined, fechaCarga: string | null | undefined) => {
  const filters = new Set<string>();
  if (fechaPedido) {
    filters.add(`fecha_pedido.eq.${fechaPedido}`);
    filters.add(`fecha_carga.eq.${fechaPedido}`);
  }
  if (fechaCarga && fechaCarga !== fechaPedido) {
    filters.add(`fecha_pedido.eq.${fechaCarga}`);
    filters.add(`fecha_carga.eq.${fechaCarga}`);
  }
  return Array.from(filters);
};

const buildLineaMatchKey = (linea: {
  confeccionpaletid?: number | null;
  catalogoconfecid?: number | null;
  confeccionsalidaid?: number | null;
  grupoconfeccionid?: number | null;
  generoid?: number | null;
}) => {
  const values = [
    parseNumericValue(linea.confeccionpaletid),
    parseNumericValue(linea.catalogoconfecid),
    parseNumericValue(linea.confeccionsalidaid),
    parseNumericValue(linea.grupoconfeccionid),
    parseNumericValue(linea.generoid),
  ];
  if (values.some((value) => value == null)) return null;
  return values.join('|');
};

const buildLineaCambioDrafts = (lineas: CambioLinea[]): Record<number, LineaCambioDraft> => {
  const drafts: Record<number, LineaCambioDraft> = {};
  lineas.forEach((linea) => {
    drafts[linea.pedidodetid] = {
      action: getEffectiveLineaAction(linea),
      bultos: parseNumericValue(linea.bultos),
      bultosxpalet: parseNumericValue(linea.bultosxpalet),
      numero_palet: parseNumericValue(linea.numero_palet),
      piezasxbulto: parseNumericValue(linea.piezasxbulto),
      total_piezas: parseNumericValue(linea.total_piezas),
      kilosxbulto: parseNumericValue(linea.kilosxbulto),
      kilos_cliente: parseNumericValue(linea.kilos_cliente),
      catconfeckilosbultoid: parseNumericValue(linea.catconfeckilosbultoid),
      catconfecpiezaid: parseNumericValue(linea.catconfecpiezaid),
      ean_pieza: getLineaEanPieza(linea),
      ean_bulto: getLineaEanPieza(linea),
      ean_caja: getLineaEanCaja(linea),
      nlote_cliente: parseTextValue(linea.nlote_cliente),
      precio_venta: parseNumericValue(linea.precio_venta),
    };
  });
  return drafts;
};

const hasMatriculaValues = (cambio?: CambioPedido | null) =>
  Boolean(
    (cambio?.matricula_tractora ?? '').trim() ||
      (cambio?.matricula_remolque ?? '').trim(),
  );

const autoMatchLineas = (
  lineasCambio: CambioLinea[],
  lineasPedido: PedidoLinea[],
): Record<number, number | null> => {
  const availableByKey = new Map<string, number[]>();
  lineasPedido.forEach((linea) => {
    const key = buildLineaMatchKey(linea);
    if (!key) return;
    const list = availableByKey.get(key) ?? [];
    list.push(linea.pedidodetid);
    availableByKey.set(key, list);
  });

  const matches: Record<number, number | null> = {};
  const used = new Set<number>();
  lineasCambio.forEach((linea) => {
    const key = buildLineaMatchKey(linea);
    if (!key) {
      matches[linea.pedidodetid] = null;
      return;
    }
    const list = availableByKey.get(key) ?? [];
    const matchId = list.find((id) => !used.has(id));
    if (matchId) {
      used.add(matchId);
      matches[linea.pedidodetid] = matchId;
    } else {
      matches[linea.pedidodetid] = null;
    }
  });

  return matches;
};

const formatFechaCorta = (value?: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'dd/MM/yyyy', { locale: es });
};

const formatFechaHora = (value?: number | null) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'dd/MM/yyyy · HH:mm', { locale: es });
};

const normalizeFechaPedidoInput = (value?: string | null, bound: 'from' | 'to' = 'from') => {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T${bound === 'from' ? '00:00' : '23:59'}`;
  }
  return raw;
};

const toFechaPedidoIso = (value?: string | null, bound: 'from' | 'to' = 'from') => {
  const normalized = normalizeFechaPedidoInput(value, bound);
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const toFechaPedidoDateOnly = (value?: string | null, bound: 'from' | 'to' = 'from') => {
  const normalized = normalizeFechaPedidoInput(value, bound);
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'yyyy-MM-dd');
};

const buildCambioContext = (
  cambio: CambioPedido | null,
  domicilioNombres: Record<number, string>,
) => {
  if (!cambio) {
    return { title: null, subtitle: null };
  }
  const isPrevision = cambio.tipo_pedido === 'P22E';
  const base = isPrevision ? 'Cambio en la Previsión' : 'Cambio en el Pedido';
  const domicilioId = cambio.sujetodomicilioid_destino ?? null;
  const domicilioNombre = domicilioId ? domicilioNombres[domicilioId] ?? `Domicilio #${domicilioId}` : null;
  const title = domicilioNombre ? `${base} de ${domicilioNombre}` : base;

  if (isPrevision) {
    const fecha = formatFechaCorta(cambio.fecha_carga ?? cambio.fecha_pedido ?? null);
    return { title, subtitle: fecha ? `Del día ${fecha}` : null };
  }

  const referencia = cambio.referencia_cliente?.trim();
  return { title, subtitle: referencia ? `Con la referencia ${referencia}` : null };
};

const buildNuevoPedidoContext = (
  cambio: CambioPedido | null,
  domicilioNombres: Record<number, string>,
) => {
  if (!cambio) {
    return { title: null, subtitle: null };
  }
  const isPrevision = cambio.tipo_pedido === 'P22E';
  const base = isPrevision ? 'Nueva prevision' : 'Nuevo pedido';
  const domicilioId = cambio.sujetodomicilioid_destino ?? null;
  const domicilioNombre = domicilioId ? domicilioNombres[domicilioId] ?? `Domicilio #${domicilioId}` : null;
  const title = domicilioNombre ? `${base} de ${domicilioNombre}` : base;

  if (isPrevision) {
    const fecha = formatFechaCorta(cambio.fecha_carga ?? cambio.fecha_pedido ?? null);
    return { title, subtitle: fecha ? `Del día ${fecha}` : null };
  }

  const referencia = cambio.referencia_cliente?.trim();
  return { title, subtitle: referencia ? `Ref. ${referencia}` : null };
};

const getMatchSelectionHint = (reason?: CambioMatchSummary['reason'] | null) => {
  if (reason === 'no_reference_in_change') {
    return 'El cambio no incluye referencia cliente.';
  }
  if (reason === 'missing_reference') {
    return 'El pedido original no tiene referencia cliente.';
  }
  if (reason === 'ambiguous') {
    return 'Hay varios pedidos con la misma referencia.';
  }
  if (reason === 'manual_search') {
    return 'Busqueda manual por cliente, domicilio y fecha.';
  }
  return null;
};

const Cambios = () => {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const [cambios, setCambios] = useState<CambioPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalCambios, setTotalCambios] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [matchSummaries, setMatchSummaries] = useState<Record<number, CambioMatchSummary>>({});
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchSelectionOpen, setMatchSelectionOpen] = useState(false);
  const [matchSelectionCambio, setMatchSelectionCambio] = useState<CambioPedido | null>(null);
  const [matchSelectionCandidates, setMatchSelectionCandidates] = useState<PedidoMatchCandidate[]>([]);
  const [matchSelectionReason, setMatchSelectionReason] = useState<CambioMatchSummary['reason'] | null>(null);
  const [matchSelectionMode, setMatchSelectionMode] = useState<MatchSelectionMode>('cambio');
  const [matchSelectionSelectedId, setMatchSelectionSelectedId] = useState<number | null>(null);
  const [matchSelectionLineSummary, setMatchSelectionLineSummary] = useState<
    Record<number, { total: number; descriptions: string[] }>
  >({});
  const [matchSelectionLoadingDetails, setMatchSelectionLoadingDetails] = useState(false);
  const [matchSelectionPdfUrl, setMatchSelectionPdfUrl] = useState<string | null>(null);
  const [matchSelectionPdfLoading, setMatchSelectionPdfLoading] = useState(false);
  const [matchSelectionPdfError, setMatchSelectionPdfError] = useState<string | null>(null);
  const [matchSelectionCambioPdfUrl, setMatchSelectionCambioPdfUrl] = useState<string | null>(null);
  const [matchSelectionCambioPdfLoading, setMatchSelectionCambioPdfLoading] = useState(false);
  const [matchSelectionCambioPdfError, setMatchSelectionCambioPdfError] = useState<string | null>(null);
  const [clienteNombres, setClienteNombres] = useState<Record<number, string>>({});
  const [clienteBehaviorRulesMap, setClienteBehaviorRulesMap] = useState<Record<number, ClienteBehaviorRule>>({});
  const [domicilioNombres, setDomicilioNombres] = useState<Record<number, string>>({});
  const [showFilters, setShowFilters] = useState(true);
  const [allowedClientIds, setAllowedClientIds] = useState<Set<number> | null>(null);
  const [filters, setFilters] = useState({
    referencia: '',
    fechaPedidoDesde: '',
    fechaPedidoHasta: '',
    clienteId: undefined as number | undefined,
    domicilioDestinoId: undefined as number | undefined,
    tipoPedido: '' as '' | 'P220' | 'P22E',
    version: 'new' as 'new' | 'old',
    revisado: '' as '' | 'revisado' | 'pendiente',
    changeType: '' as
      | ''
      | 'nuevo'
      | 'anulacion'
      | 'transportista'
      | 'matricula'
      | 'lineas'
      | 'mixto'
      | 'cabecera',
    order: 'desc' as 'desc' | 'asc',
  });
  const [lineChangeSummaryById, setLineChangeSummaryById] = useState<Record<number, LineChangeSummary>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cambioToDelete, setCambioToDelete] = useState<CambioPedido | null>(null);
  const [deletePdfDialogOpen, setDeletePdfDialogOpen] = useState(false);
  const [pdfToDelete, setPdfToDelete] = useState<{ id: number; label?: string | null } | null>(null);
  const [deletingPdfId, setDeletingPdfId] = useState<number | null>(null);
  const [applyPdfDialogOpen, setApplyPdfDialogOpen] = useState(false);
  const [applyPdfTarget, setApplyPdfTarget] = useState<{
    archivoPdfId: number;
    pedidoIds: number[];
    label?: string | null;
  } | null>(null);
  const [applyingPdfId, setApplyingPdfId] = useState<number | null>(null);
  const [pedidoPdfMap, setPedidoPdfMap] = useState<Record<number, number | null>>({});
  const [cambioPdfCreatedAtMap, setCambioPdfCreatedAtMap] = useState<Record<number, string | null>>({});
  const [autoApplyQueue, setAutoApplyQueue] = useState<AutoApplyQueueItem[]>([]);
  const autoApplyExecutedRef = useRef<Record<string, boolean>>({});
  const reviewedDialogAutoQueueRef = useRef<string | null>(null);
  const rpcFechaFilterSupportRef = useRef<'unknown' | 'supported' | 'date_only' | 'unsupported'>('unknown');
  const rpcFechaFilterNoticeShownRef = useRef(false);
  const rpcFechaFilterHourNoticeShownRef = useRef(false);
  const [applyingCambioId, setApplyingCambioId] = useState<number | null>(null);
  const [applyingLineasId, setApplyingLineasId] = useState<number | null>(null);
  const [cambioDialogOpen, setCambioDialogOpen] = useState(false);
  const [cambioDialogLoading, setCambioDialogLoading] = useState(false);
  const [cambioDialogUpdatingOrizon, setCambioDialogUpdatingOrizon] = useState(false);
  const [cambioDialogMarkingReviewed, setCambioDialogMarkingReviewed] = useState(false);
  const [cambioDialogMode, setCambioDialogMode] = useState<'transportista' | 'lineas' | 'cabecera'>('transportista');
  const [cambioDialogCambio, setCambioDialogCambio] = useState<CambioPedido | null>(null);
  const [cambioDialogPedido, setCambioDialogPedido] =
    useState<Database['public']['Tables']['pedidos']['Row'] | null>(null);
  const [cambioDialogAcreedorActual, setCambioDialogAcreedorActual] =
    useState<AcreedorInfo | null>(null);
  const [cambioDialogAcreedorNuevo, setCambioDialogAcreedorNuevo] =
    useState<AcreedorInfo | null>(null);
  const [cambioDialogDisabledReason, setCambioDialogDisabledReason] = useState<string | null>(null);
  const [cambioDialogMatch, setCambioDialogMatch] = useState<CambioMatchSummary | null>(null);
  const [cambioDialogPdfActualUrl, setCambioDialogPdfActualUrl] = useState<string | null>(null);
  const [cambioDialogPdfActualLoading, setCambioDialogPdfActualLoading] = useState(false);
  const [cambioDialogPdfActualError, setCambioDialogPdfActualError] = useState<string | null>(null);
  const [cambioDialogPdfCambioUrl, setCambioDialogPdfCambioUrl] = useState<string | null>(null);
  const [cambioDialogPdfCambioLoading, setCambioDialogPdfCambioLoading] = useState(false);
  const [cambioDialogPdfCambioError, setCambioDialogPdfCambioError] = useState<string | null>(null);
  const [cambioDialogSummaryLabel, setCambioDialogSummaryLabel] = useState<string | null>(null);
  const [cambioDialogHasLineChanges, setCambioDialogHasLineChanges] = useState(false);
  const [cambioDialogLineas, setCambioDialogLineas] = useState<CambioLinea[]>([]);
  const [cambioDialogLineasOriginales, setCambioDialogLineasOriginales] = useState<PedidoLinea[]>([]);
  const [cambioDialogLineasMatch, setCambioDialogLineasMatch] = useState<Record<number, number | null>>({});
  const [cambioDialogLineasDrafts, setCambioDialogLineasDrafts] = useState<Record<number, LineaCambioDraft>>({});
  const [cambioDialogLineasLabel, setCambioDialogLineasLabel] = useState<string | null>(null);
  const [cambioDialogLineasHint, setCambioDialogLineasHint] = useState<string | null>(null);
  const [cambioDialogHeaderLabel, setCambioDialogHeaderLabel] = useState<string | null>(null);
  const buildReviewUpdate = useCallback(
    () => ({
      revisado: true,
      revisado_por: user?.id ?? null,
      revisado_en: new Date().toISOString(),
    }),
    [user?.id],
  );
  const canCreatePedidoFromUnmatchedChange = useCallback(
    (cambio: Pick<CambioPedido, 'clienteid'> | null | undefined) => {
      const clienteId = cambio?.clienteid ?? null;
      if (!clienteId) return false;
      return Boolean(clienteBehaviorRulesMap[clienteId]?.allow_create_new_order_from_unmatched_change);
    },
    [clienteBehaviorRulesMap],
  );
  const [cambioDialogHasTransportistaChange, setCambioDialogHasTransportistaChange] = useState(false);
  const [cambioDialogHasMatriculaChange, setCambioDialogHasMatriculaChange] = useState(false);
  const [cancelPedidoDialogOpen, setCancelPedidoDialogOpen] = useState(false);
  const [cancelPedidoLoading, setCancelPedidoLoading] = useState(false);
  const [nuevoPedidoDialogOpen, setNuevoPedidoDialogOpen] = useState(false);
  const [nuevoPedidoLoading, setNuevoPedidoLoading] = useState(false);
  const [nuevoPedidoCreating, setNuevoPedidoCreating] = useState(false);
  const [nuevoPedidoCambio, setNuevoPedidoCambio] = useState<CambioPedidoDraft | null>(null);
  const [nuevoPedidoLineas, setNuevoPedidoLineas] = useState<NewPedidoLineaDraft[]>([]);
  const [nuevoPedidoCentros, setNuevoPedidoCentros] = useState<Record<string, NuevoPedidoCentroDraft[]>>({});
  const [nuevoPedidoPdfUrl, setNuevoPedidoPdfUrl] = useState<string | null>(null);
  const [nuevoPedidoPdfLoading, setNuevoPedidoPdfLoading] = useState(false);
  const [nuevoPedidoPdfError, setNuevoPedidoPdfError] = useState<string | null>(null);
  const [nuevoPedidoPdfActualUrl, setNuevoPedidoPdfActualUrl] = useState<string | null>(null);
  const [nuevoPedidoPdfActualLoading, setNuevoPedidoPdfActualLoading] = useState(false);
  const [nuevoPedidoPdfActualError, setNuevoPedidoPdfActualError] = useState<string | null>(null);
  const [nuevoPedidoOrizonPrompt, setNuevoPedidoOrizonPrompt] = useState<{
    pedidoId: number;
    referencia?: string | null;
    tipoPedido: TipoPedido;
  } | null>(null);
  const [nuevoPedidoOrizonDialogOpen, setNuevoPedidoOrizonDialogOpen] = useState(false);
  const [nuevoPedidoOrizonSending, setNuevoPedidoOrizonSending] = useState(false);
  const navigate = useNavigate();
  const { cambioId: routeCambioIdParam } = useParams<{ cambioId?: string }>();
  const [searchParams] = useSearchParams();
  const [pendingCambioDialogId, setPendingCambioDialogId] = useState<number | null>(null);
  const cambioDialogIntentRef = useRef(false);
  const cambioDialogRequestRef = useRef(0);
  const blockCambioRouteSyncRef = useRef(false);
  const openingCambioDialogIdRef = useRef<number | null>(null);

  const navigateToCambioDetail = useCallback(
    (cambioId: number, options?: { replace?: boolean; nextSearchParams?: URLSearchParams }) => {
      const resolvedSearchParams = options?.nextSearchParams ?? new URLSearchParams(searchParams);
      const nextSearch = resolvedSearchParams.toString();
      navigate(
        {
          pathname: buildCambioDetailPath(cambioId),
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: options?.replace ?? false },
      );
    },
    [navigate, searchParams],
  );

  const navigateToCambiosList = useCallback(
    (options?: { replace?: boolean; nextSearchParams?: URLSearchParams }) => {
      const resolvedSearchParams = options?.nextSearchParams ?? new URLSearchParams(searchParams);
      const nextSearch = resolvedSearchParams.toString();
      navigate(
        {
          pathname: ROUTE_BASES.cambios,
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: options?.replace ?? false },
      );
    },
    [navigate, searchParams],
  );

  const cambioReturnPedidoId = useMemo(() => {
    const raw = searchParams.get('volver_pedido');
    const parsed = raw ? Number(raw) : null;
    return parsed && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  const cambioReturnPedidoTipo = useMemo<TipoPedido>(() => {
    return searchParams.get('volver_tipo') === 'P22E' ? 'P22E' : 'P220';
  }, [searchParams]);

  const reviewerUserIds = useMemo(
    () =>
      cambios
        .map((cambio) => {
          const sentBy =
            typeof cambio.enviado_por === 'string' && cambio.enviado_por.trim().length > 0
              ? cambio.enviado_por.trim()
              : null;
          const reviewedBy =
            typeof cambio.revisado_por === 'string' && cambio.revisado_por.trim().length > 0
              ? cambio.revisado_por.trim()
              : null;
          return sentBy ?? reviewedBy;
        })
        .filter((userId): userId is string => Boolean(userId)),
    [cambios],
  );

  const { labelsById: changeUserLabelsById } = useUserLabels(reviewerUserIds, isAdmin);

  const rpcClient = supabase as unknown as {
    rpc: (fn: string, params?: Record<string, unknown>) => Promise<RpcResponse>;
  };
  const markCambioReviewedWithFallback = useCallback(
    async (cambioId: number, nextMeta?: Record<string, unknown>) => {
      const reviewUpdate = buildReviewUpdate();

      if (nextMeta) {
        const { error: cambioError } = await supabase
          .from('cambios_pedidos')
          .update({ change_meta: nextMeta, ...reviewUpdate })
          .eq('id', cambioId);
        if (!cambioError) {
          return { reviewUpdate, metaPersisted: true };
        }
        console.error(
          'Error guardando change_meta al marcar revisado; se intentará solo revisado',
          cambioError,
        );
      }

      const { error: reviewError } = await supabase
        .from('cambios_pedidos')
        .update(reviewUpdate)
        .eq('id', cambioId);
      if (reviewError) throw reviewError;

      return { reviewUpdate, metaPersisted: false };
    },
    [buildReviewUpdate, supabase],
  );

  useEffect(() => {
    if (!routeCambioIdParam) {
      blockCambioRouteSyncRef.current = false;
    }

    const legacyCambioParam = searchParams.get('cambio');
    const routeCambioId = routeCambioIdParam ? Number(routeCambioIdParam) : undefined;
    const legacyCambioId = legacyCambioParam ? Number(legacyCambioParam) : undefined;
    const cambioId =
      routeCambioId && Number.isFinite(routeCambioId) && routeCambioId > 0
        ? routeCambioId
        : legacyCambioId && Number.isFinite(legacyCambioId) && legacyCambioId > 0
          ? legacyCambioId
          : null;

    if (!routeCambioIdParam && cambioId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('cambio');
      navigateToCambioDetail(cambioId, { replace: true, nextSearchParams: nextParams });
      return;
    }

    if (blockCambioRouteSyncRef.current) return;
    if (!cambioId || matchSelectionOpen) return;
    if (openingCambioDialogIdRef.current === cambioId) return;
    if (cambioDialogOpen && cambioDialogCambio?.id === cambioId) return;
    if (pendingCambioDialogId === cambioId) return;

    cambioDialogIntentRef.current = true;
    setPendingCambioDialogId(cambioId);
  }, [
    searchParams,
    routeCambioIdParam,
    matchSelectionOpen,
    cambioDialogOpen,
    cambioDialogCambio,
    pendingCambioDialogId,
    navigateToCambioDetail,
  ]);

  const findMatchedPedido = useCallback(
    async (
      cambio: CambioPedido,
    ): Promise<{
      pedido: Database['public']['Tables']['pedidos']['Row'] | null;
      lineas: Database['public']['Tables']['pedido_linea']['Row'][];
      candidates?: PedidoMatchCandidate[];
      reason?: CambioMatchSummary['reason'];
    }> => {
      try {
        const tipoPedido = cambio.tipo_pedido ?? 'P220';
        const baseSelect =
          'id, tipo_pedido, clienteid, sujetodomicilioid_destino, fecha_carga, fecha_pedido, referencia_cliente, referencia2_cliente, archivo_pdf_id, idpedido_orizon, pedidoclienteid, acreedorid_porte, created_at';
        const buildQuery = () => supabase.from('pedidos').select(baseSelect).eq('tipo_pedido', tipoPedido);

        const fetchLineas = async (pedidoId: number) => {
          const { data: lineasPedido } = await supabase
            .from('pedido_linea')
            .select('*')
            .eq('pedidoid', pedidoId);
          return lineasPedido ?? [];
        };

        const manualMatchId = extractMatchedPedidoId(cambio.change_meta);
        if (manualMatchId) {
          const { data: pedidoManual, error } = await supabase
            .from('pedidos')
            .select(baseSelect)
            .eq('id', manualMatchId)
            .maybeSingle();
          if (error) throw error;
          if (pedidoManual && pedidoManual.tipo_pedido === tipoPedido) {
            return { pedido: pedidoManual, lineas: await fetchLineas(pedidoManual.id) };
          }
        }

        if (cambio.idpedido_orizon) {
          const { data: pedidoMatcheado, error } = await buildQuery()
            .eq('idpedido_orizon', cambio.idpedido_orizon)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) throw error;
          if (!pedidoMatcheado) return { pedido: null, lineas: [] };
          return { pedido: pedidoMatcheado, lineas: await fetchLineas(pedidoMatcheado.id) };
        }

        if (tipoPedido === 'P220') {
          const referencia = cambio.referencia_cliente?.trim();
          if (referencia) {
            let refQuery = buildQuery().eq('referencia_cliente', referencia);
            if (cambio.clienteid) refQuery = refQuery.eq('clienteid', cambio.clienteid);
            const { data: rawRefPedidos, error } = await refQuery.order('created_at', { ascending: false });
            if (error) throw error;
            const refPedidos = (rawRefPedidos ?? []) as PedidoMatchCandidate[];
            if (refPedidos.length === 1) {
              const matchedPedido = refPedidos[0] as Database['public']['Tables']['pedidos']['Row'];
              return { pedido: matchedPedido, lineas: await fetchLineas(matchedPedido.id) };
            }
            if (refPedidos.length > 1) {
              const sameDestination = cambio.sujetodomicilioid_destino
                ? refPedidos.filter((pedido) => pedido.sujetodomicilioid_destino === cambio.sujetodomicilioid_destino)
                : [];
              if (sameDestination.length === 1) {
                const matchedPedido = sameDestination[0] as Database['public']['Tables']['pedidos']['Row'];
                return { pedido: matchedPedido, lineas: await fetchLineas(matchedPedido.id) };
              }
              return {
                pedido: null,
                lineas: [],
                candidates: (sameDestination.length > 1 ? sameDestination : refPedidos) as PedidoMatchCandidate[],
                reason: 'ambiguous',
              };
            }
          }

          if (!cambio.clienteid || !cambio.sujetodomicilioid_destino || !cambio.fecha_carga) {
            return { pedido: null, lineas: [] };
          }

          const { data: candidates, error } = await buildQuery()
            .eq('clienteid', cambio.clienteid)
            .eq('sujetodomicilioid_destino', cambio.sujetodomicilioid_destino)
            .eq('fecha_carga', cambio.fecha_carga)
            .order('created_at', { ascending: false })
            .limit(8);
          if (error) throw error;

          const candidateList = (candidates ?? []) as PedidoMatchCandidate[];
          const hasReferenciaEnCandidatos = candidateList.some(
            (candidate) => Boolean(candidate.referencia_cliente && candidate.referencia_cliente.trim()),
          );
          return {
            pedido: null,
            lineas: [],
            candidates: candidateList,
            reason: referencia
              ? hasReferenciaEnCandidatos
                ? 'ambiguous'
                : 'missing_reference'
              : 'no_reference_in_change',
          };
        }

        if (!cambio.clienteid || !cambio.sujetodomicilioid_destino || !cambio.fecha_carga) {
          return { pedido: null, lineas: [] };
        }

        const { data: pedidoMatcheado, error } = await buildQuery()
          .eq('clienteid', cambio.clienteid)
          .eq('sujetodomicilioid_destino', cambio.sujetodomicilioid_destino)
          .eq('fecha_carga', cambio.fecha_carga)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!pedidoMatcheado) return { pedido: null, lineas: [] };
        return { pedido: pedidoMatcheado, lineas: await fetchLineas(pedidoMatcheado.id) };
      } catch (error) {
        console.error('Error matching pedido/previsión', error);
        return { pedido: null, lineas: [] };
      }
    },
    [],
  );

  const computeMatchSummaries = useCallback(
    async (items: CambioPedido[], lineSummaryMap: Record<number, LineChangeSummary> = {}) => {
      if (!items.length) {
        setMatchSummaries({});
        return;
      }

      setMatchesLoading(true);
      try {
        const summaryEntries = await Promise.all(
          items.map(async (cambio) => {
            try {
              const flags = getCambioFlags(cambio, lineSummaryMap[cambio.id] ?? null);
              if (cambio.revisado && flags.isCancelacion) {
                return [cambio.id, { headerMatched: false } satisfies CambioMatchSummary] as const;
              }

              const match = await findMatchedPedido(cambio);
              if (!match.pedido) {
                return [
                  cambio.id,
                  {
                    headerMatched: false,
                    reason: match.reason,
                    candidates: match.candidates,
                  } satisfies CambioMatchSummary,
                ] as const;
              }

              let lineMatches: CambioMatchSummary['lineMatches'];
              if ((cambio.tipo_pedido ?? 'P220') !== 'P22E') {
                const { data: cambioLineas } = await supabase
                  .from('cambios_pedido_linea')
                  .select('pedidodetid, descripcion_salida, generoid, catalogoconfecid, bultos, kilos_cliente, idpedidodet_orizon, ean, ean_caja, precio_venta, nlote_cliente')
                  .eq('pedidoid', cambio.id);

                if (cambioLineas && cambioLineas.length > 0) {
                  const pedidoLineaMap = new Map<string, number>();
                  (match.lineas || []).forEach((linea) => {
                    const key = buildLineaKey(linea);
                    pedidoLineaMap.set(key, (pedidoLineaMap.get(key) ?? 0) + 1);
                  });

                  let matchedCount = 0;
                  (cambioLineas as CambioLinea[]).forEach((linea) => {
                    const key = buildLineaKey(linea);
                    const available = pedidoLineaMap.get(key) ?? 0;
                    if (available > 0) {
                      matchedCount += 1;
                      pedidoLineaMap.set(key, available - 1);
                    }
                  });

                  lineMatches = { matched: matchedCount, total: cambioLineas.length };
                }
              }

              return [
                cambio.id,
                {
                  headerMatched: true,
                  pedidoId: match.pedido.id,
                  pedidoReferencia: match.pedido.referencia_cliente,
                  lineMatches,
                } satisfies CambioMatchSummary,
              ] as const;
            } catch (error) {
              console.error('Error computing match summary', error);
              return [cambio.id, { headerMatched: false } satisfies CambioMatchSummary] as const;
            }
          }),
        );

        setMatchSummaries(Object.fromEntries(summaryEntries) as Record<number, CambioMatchSummary>);
      } finally {
        setMatchesLoading(false);
      }
    },
    [findMatchedPedido],
  );

  const loadCambioLineSummary = useCallback(async (cambioId: number) => {
    const { data, error } = await supabase
      .from('cambios_pedido_linea')
      .select('pedidoid, change_meta, accion')
      .eq('pedidoid', cambioId);
    if (error) throw error;

    const lineSummary = buildLineChangeSummaries(data ?? [])[cambioId] ?? null;
    if (lineSummary) {
      setLineChangeSummaryById((prev) => (prev[cambioId] ? prev : { ...prev, [cambioId]: lineSummary }));
    }
    return lineSummary;
  }, [supabase]);

  const fetchCambios = useCallback(async () => {
    try {
      setLoading(true);
      const rpcParamsBase = {
        p_page: Math.max(1, currentPage),
        p_page_size: Math.max(1, itemsPerPage),
        p_order: filters.order,
        p_referencia: filters.referencia?.trim() || null,
        p_cliente_id: filters.clienteId ?? null,
        p_domicilio_destino_id: filters.domicilioDestinoId ?? null,
        p_tipo_pedido: filters.tipoPedido || null,
        p_revisado: filters.revisado || null,
        p_version: filters.version || null,
        p_change_type: filters.changeType || null,
      };
      const fechaPedidoFromIso = toFechaPedidoIso(filters.fechaPedidoDesde, 'from');
      const fechaPedidoToIso = toFechaPedidoIso(filters.fechaPedidoHasta, 'to');
      const fechaPedidoFromDateOnly = toFechaPedidoDateOnly(filters.fechaPedidoDesde, 'from');
      const fechaPedidoToDateOnly = toFechaPedidoDateOnly(filters.fechaPedidoHasta, 'to');
      const rpcParamsWithFecha = {
        ...rpcParamsBase,
        p_fecha_pedido_from: fechaPedidoFromIso,
        p_fecha_pedido_to: fechaPedidoToIso,
      };
      const rpcParamsWithFechaDateOnly = {
        ...rpcParamsBase,
        p_fecha_pedido_from: fechaPedidoFromDateOnly,
        p_fecha_pedido_to: fechaPedidoToDateOnly,
      };
      const hasFechaPedidoFilter = Boolean(filters.fechaPedidoDesde || filters.fechaPedidoHasta);
      const hasFechaPedidoHoraFilter = [filters.fechaPedidoDesde, filters.fechaPedidoHasta].some((value) =>
        String(value ?? '').includes('T'),
      );
      let rpcData: unknown = null;
      let rpcError: { code?: string; details?: string; hint?: string; message?: string } | null = null;

      const shouldRetryWithoutFecha =
        hasFechaPedidoFilter &&
        !rpcFechaFilterNoticeShownRef.current;
      const shouldWarnHoraNoDisponible =
        hasFechaPedidoHoraFilter &&
        !rpcFechaFilterHourNoticeShownRef.current;

      if (rpcFechaFilterSupportRef.current === 'unsupported') {
        const legacy = await rpcClient.rpc('get_cambios_group_page', rpcParamsBase);
        rpcData = legacy.data;
        rpcError = legacy.error;
        if (shouldRetryWithoutFecha) {
          rpcFechaFilterNoticeShownRef.current = true;
          toast({
            title: 'Filtro de fecha pendiente de migración',
            description: 'Se han cargado los cambios sin filtro de fecha porque la base de datos aún usa la versión anterior.',
          });
        }
      } else if (rpcFechaFilterSupportRef.current === 'date_only') {
        const byDay = await rpcClient.rpc('get_cambios_group_page', rpcParamsWithFechaDateOnly);
        rpcData = byDay.data;
        rpcError = byDay.error;
        if (shouldWarnHoraNoDisponible) {
          rpcFechaFilterHourNoticeShownRef.current = true;
          toast({
            title: 'Filtro por hora no disponible',
            description: 'El servidor actual filtra fecha de entrada del cambio solo por día. Ejecuta la migración para habilitar hora.',
          });
        }
      } else {
        const withFecha = await rpcClient.rpc('get_cambios_group_page', rpcParamsWithFecha);
        rpcData = withFecha.data;
        rpcError = withFecha.error;

        const missingFechaParams =
          rpcError?.code === 'PGRST202' &&
          [rpcError.message, rpcError.details, rpcError.hint].some((value) =>
            String(value ?? '').includes('p_fecha_pedido_from'),
          );
        const invalidDateCast =
          rpcError?.code === '22007' ||
          [rpcError?.message, rpcError?.details, rpcError?.hint].some((value) =>
            String(value ?? '').toLowerCase().includes('invalid input syntax for type date'),
          );

        if (missingFechaParams) {
          rpcFechaFilterSupportRef.current = 'unsupported';
          const fallback = await rpcClient.rpc('get_cambios_group_page', rpcParamsBase);
          rpcData = fallback.data;
          rpcError = fallback.error;
          if (shouldRetryWithoutFecha) {
            rpcFechaFilterNoticeShownRef.current = true;
            toast({
              title: 'Filtro de fecha pendiente de migración',
              description: 'Se han cargado los cambios sin filtro de fecha porque la base de datos aún usa la versión anterior.',
            });
          }
        } else if (invalidDateCast) {
          rpcFechaFilterSupportRef.current = 'date_only';
          const fallbackByDay = await rpcClient.rpc('get_cambios_group_page', rpcParamsWithFechaDateOnly);
          rpcData = fallbackByDay.data;
          rpcError = fallbackByDay.error;
          if (shouldWarnHoraNoDisponible) {
            rpcFechaFilterHourNoticeShownRef.current = true;
            toast({
              title: 'Filtro por hora no disponible',
              description: 'El servidor actual filtra fecha de entrada del cambio solo por día. Ejecuta la migración para habilitar hora.',
            });
          }
        } else if (!rpcError) {
          rpcFechaFilterSupportRef.current = 'supported';
        }
      }

      if (rpcError) throw rpcError;

      const rpcRows = ((rpcData as CambiosRpcRow[] | null) ?? []) as CambiosRpcRow[];
      const metaRow = rpcRows.find((row) => row.row_type === 'meta');
      setTotalGroups(Number(metaRow?.total_groups ?? 0));
      setTotalCambios(Number(metaRow?.total_items ?? 0));

      const listado = rpcRows
        .filter((row) => row.row_type === 'item' && row.row_json)
        .map((row) => row.row_json as CambioPedido)
        .map((item) => ({
        ...item,
        revisado: Boolean(item.revisado),
      }));
      setCambios(listado);
      let lineSummaryById: Record<number, LineChangeSummary> = {};
      if (listado.length > 0) {
        const cambioIds = listado.map((item) => item.id);
        const { data: lineasMeta, error: lineasMetaError } = await supabase
          .from('cambios_pedido_linea')
          .select('pedidoid, change_meta, accion')
          .in('pedidoid', cambioIds);
        if (lineasMetaError) throw lineasMetaError;
        lineSummaryById = buildLineChangeSummaries(lineasMeta ?? []);
        setLineChangeSummaryById(lineSummaryById);
      } else {
        setLineChangeSummaryById({});
      }
      const uniqueClientes = Array.from(new Set(listado.map((c) => c.clienteid).filter(Boolean))) as number[];
      const uniqueDomicilios = Array.from(new Set(listado.map((c) => c.sujetodomicilioid_destino).filter(Boolean))) as number[];
      if (uniqueClientes.length) {
        const [clients, behaviorRulesMap] = await Promise.all([
          agroirisClients.getClients(),
          getClienteBehaviorRulesMap(uniqueClientes, 'pedidos'),
        ]);
        const map: Record<number, string> = {};
        clients.forEach((client) => {
          if (uniqueClientes.includes(client.clienteid)) {
            map[client.clienteid] = client.nombre_sujeto || `Cliente #${client.clienteid}`;
          }
        });
        setClienteNombres(map);
        setClienteBehaviorRulesMap(behaviorRulesMap);
      } else {
        setClienteNombres({});
        setClienteBehaviorRulesMap({});
      }
      if (uniqueDomicilios.length) {
        const map: Record<number, string> = {};
        await Promise.all(
          uniqueDomicilios.map(async (domId) => {
            if (!domId) return;
            const domicilio = await agroirisDomicilios.getDomicilioById(domId);
            if (domicilio) {
              map[domId] = agroirisDomicilios.getDomicilioDisplayName(domicilio);
            }
          }),
        );
        setDomicilioNombres(map);
      } else {
        setDomicilioNombres({});
      }
      await computeMatchSummaries(listado, lineSummaryById);
    } catch (error) {
      console.error('Error fetching cambios', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los cambios.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [computeMatchSummaries, currentPage, filters, itemsPerPage, toast, rpcClient]);

  useEffect(() => {
    fetchCambios();
  }, [fetchCambios]);

  const deleteCambio = useCallback(
    async (id: number) => {
      try {
        const { error } = await supabase.from('cambios_pedidos').delete().eq('id', id);
        if (error) throw error;
        setCambios((prev) => prev.filter((cambio) => cambio.id !== id));
        setMatchSummaries((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        toast({
          title: 'Cambio eliminado',
          description: `Se eliminó el cambio #${id}`,
        });
        await fetchCambios();
      } catch (error) {
        console.error('Error deleting cambio', error);
        toast({
          title: 'Error',
          description: 'No se pudo eliminar el cambio.',
          variant: 'destructive',
        });
      }
    },
    [fetchCambios, toast],
  );

  const deleteCambioPdf = useCallback(
    async (archivoPdfId: number) => {
      try {
        const { data: cambiosHeaders, error: headersError } = await supabase
          .from('cambios_pedidos')
          .select('id')
          .eq('archivo_pdf_id', archivoPdfId);
        if (headersError) throw headersError;
        const cambioIds = (cambiosHeaders ?? []).map((row) => row.id);
        let lineIds: number[] = [];
        if (cambioIds.length > 0) {
          const { data: lineasData, error: lineasError } = await supabase
            .from('cambios_pedido_linea')
            .select('pedidodetid')
            .in('pedidoid', cambioIds);
          if (lineasError) throw lineasError;
          lineIds = (lineasData ?? []).map((row) => row.pedidodetid);
          if (lineIds.length > 0) {
            const { error: centrosError } = await supabase
              .from('cambios_pedido_linea_centro')
              .delete()
              .in('pedidodetid', lineIds);
            if (centrosError) throw centrosError;
          }

          const { error: deleteLineasError } = await supabase
            .from('cambios_pedido_linea')
            .delete()
            .in('pedidoid', cambioIds);
          if (deleteLineasError) throw deleteLineasError;

          const { error: deleteHeadersError } = await supabase
            .from('cambios_pedidos')
            .delete()
            .in('id', cambioIds);
          if (deleteHeadersError) throw deleteHeadersError;
        }

        const { error: deletePdfError } = await supabase
          .from('archivos_pdf')
          .delete()
          .eq('id', archivoPdfId);
        if (deletePdfError) throw deletePdfError;

        setCambios((prev) => prev.filter((cambio) => cambio.archivo_pdf_id !== archivoPdfId));
        setMatchSummaries((prev) => {
          if (!cambioIds.length) return prev;
          const next = { ...prev };
          cambioIds.forEach((id) => delete next[id]);
          return next;
        });

        toast({
          title: 'PDF eliminado',
          description: 'Se eliminaron el archivo y los cambios asociados.',
        });
        await fetchCambios();
      } catch (error) {
        console.error('Error eliminando PDF de cambios', error);
        toast({
          title: 'Error al eliminar PDF',
          description: 'No se pudo eliminar el PDF y sus cambios asociados.',
          variant: 'destructive',
        });
        throw error;
      }
    },
    [buildReviewUpdate, fetchCambios, toast],
  );

  const handleOpenPdf = async (archivoPdfId: number | null, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!archivoPdfId) return;
    try {
      console.log(`[Cambios] Abriendo PDF desde UI. archivo_pdf_id=${archivoPdfId}`);
      const { data, error } = await supabase
        .from('archivos_pdf')
        .select('b64_contenido')
        .eq('id', archivoPdfId)
        .single();
      if (error) throw error;
      if (data?.b64_contenido) {
        const byteCharacters = atob(data.b64_contenido);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
    } catch (err) {
      console.error('Error abriendo PDF de cambio:', err);
      toast({
        title: 'Error',
        description: 'No se pudo abrir el PDF del cambio.',
        variant: 'destructive',
      });
    }
  };

  const buildAcreedorInfo = useCallback(async (id: number | null): Promise<AcreedorInfo | null> => {
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

  const handleCloseCambioDialog = useCallback((open: boolean, options?: { preserveRoute?: boolean }) => {
    setCambioDialogOpen(open);
    if (!open) {
      cambioDialogIntentRef.current = false;
      cambioDialogRequestRef.current += 1;
      openingCambioDialogIdRef.current = null;
      setPendingCambioDialogId(null);
      if (!options?.preserveRoute) {
        blockCambioRouteSyncRef.current = true;
        navigateToCambiosList({ replace: true });
      }
      setCambioDialogLoading(false);
      setCambioDialogCambio(null);
      setCambioDialogPedido(null);
      setCambioDialogAcreedorActual(null);
      setCambioDialogAcreedorNuevo(null);
      setCambioDialogDisabledReason(null);
      setCambioDialogMatch(null);
      setCambioDialogUpdatingOrizon(false);
      setCambioDialogMode('transportista');
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
      setCambioDialogSummaryLabel(null);
      setCambioDialogHasLineChanges(false);
      setCambioDialogLineas([]);
      setCambioDialogLineasOriginales([]);
      setCambioDialogLineasMatch({});
      setCambioDialogLineasDrafts({});
      setCambioDialogLineasLabel(null);
      setCambioDialogLineasHint(null);
      setCambioDialogHeaderLabel(null);
      setCambioDialogHasTransportistaChange(false);
      setCambioDialogHasMatriculaChange(false);
      setCancelPedidoDialogOpen(false);
      setCancelPedidoLoading(false);
    }
  }, [navigateToCambiosList]);

  const handleBackToPedidoFromCambio = useCallback(() => {
    if (!cambioReturnPedidoId) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('volver_pedido');
    nextParams.delete('volver_tipo');
    const nextSearch = nextParams.toString();

    handleCloseCambioDialog(false, { preserveRoute: true });
    navigate(
      {
        pathname: buildPedidoDetailPath(cambioReturnPedidoId, cambioReturnPedidoTipo),
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  }, [
    cambioReturnPedidoId,
    cambioReturnPedidoTipo,
    handleCloseCambioDialog,
    navigate,
    searchParams,
  ]);

  const handleCloseNuevoPedidoDialog = useCallback((open: boolean) => {
    setNuevoPedidoDialogOpen(open);
    if (!open) {
      setNuevoPedidoCambio(null);
      setNuevoPedidoLineas([]);
      setNuevoPedidoCentros({});
      setNuevoPedidoCreating(false);
      setNuevoPedidoLoading(false);
      setNuevoPedidoPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setNuevoPedidoPdfLoading(false);
      setNuevoPedidoPdfError(null);
      setNuevoPedidoPdfActualUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setNuevoPedidoPdfActualLoading(false);
      setNuevoPedidoPdfActualError(null);
    }
  }, []);

  const handleOpenNuevoPedidoDialog = useCallback(
    async (
      cambio: CambioPedido,
      options?: { pdfActualId?: number | null; matchedPedidoIds?: number[] },
    ) => {
      setNuevoPedidoLoading(true);
      try {
        setNuevoPedidoCambio(null);
        setNuevoPedidoLineas([]);
        setNuevoPedidoCentros({});
        setNuevoPedidoPdfActualError(null);
        setNuevoPedidoPdfActualLoading(false);
        const { data: headerData, error: headerError } = await supabase
          .from('cambios_pedidos')
          .select(
            'id, serieid, tipo_pedido, fecha_pedido, fecha_carga, clienteid, clienteid_envio, divisa_cliente, comercialid, sujetodomicilioid_destino, sujetodomicilioid_envio, referencia_cliente, referencia2_cliente, acreedorid_porte, matricula_tractora, matricula_remolque, archivo_pdf_id, revisado',
          )
          .eq('id', cambio.id)
          .single();
        if (headerError) throw headerError;

        const header = {
          ...cambio,
          ...(headerData ?? {}),
          revisado: Boolean(headerData?.revisado ?? cambio.revisado),
        } as CambioPedidoDraft;
        setNuevoPedidoCambio(header);

        const { data: lineasData, error: lineasError } = await supabase
          .from('cambios_pedido_linea')
          .select(
            'pedidodetid, confeccionpaletid, catalogoconfecid, confeccionsalidaid, grupoconfeccionid, generoid, tipocultivoid, origenid, calibreid, bultos, descripcion_salida, bultosxpalet, numero_palet, piezasxbulto, total_piezas, catconfecpiezaid, kilosxbulto, kilos_cliente, catconfeckilosbultoid, ean, ean_caja, precio_venta, nlote_cliente',
          )
          .eq('pedidoid', cambio.id)
          .order('pedidodetid', { ascending: true });
        if (lineasError) throw lineasError;

        const lineDrafts: NewPedidoLineaDraft[] = (lineasData ?? []).map((linea, index) => {
          const tempId = linea.pedidodetid ? String(linea.pedidodetid) : `temp-${Date.now()}-${index}`;
          return {
            tempId,
            generoid: parseNumericValue(linea.generoid),
            tipocultivoid: parseNumericValue(linea.tipocultivoid),
            catalogoconfecid: parseNumericValue(linea.catalogoconfecid),
            grupoconfeccionid: parseNumericValue(linea.grupoconfeccionid),
            confeccionpaletid: parseNumericValue(linea.confeccionpaletid),
            confeccionsalidaid: parseNumericValue(linea.confeccionsalidaid),
            origenid: parseNumericValue(linea.origenid),
            calibreid: parseNumericValue(linea.calibreid),
            bultos: parseNumericValue(linea.bultos),
            bultosxpalet: parseNumericValue(linea.bultosxpalet),
            numero_palet: parseNumericValue(linea.numero_palet),
            piezasxbulto: parseNumericValue(linea.piezasxbulto),
            total_piezas: parseNumericValue(linea.total_piezas),
            kilosxbulto: parseNumericValue(linea.kilosxbulto),
            kilos_cliente: parseNumericValue(linea.kilos_cliente),
            descripcion_salida: linea.descripcion_salida ?? '',
            catconfecpiezaid: parseNumericValue(linea.catconfecpiezaid),
            catconfeckilosbultoid: parseNumericValue(linea.catconfeckilosbultoid),
            ean: getLineaEanPieza(linea),
            ean_pieza: getLineaEanPieza(linea),
            ean_bulto: getLineaEanPieza(linea),
            ean_caja: getLineaEanCaja(linea),
            nlote_cliente: parseTextValue(linea.nlote_cliente),
            precio_venta: parseNumericValue(linea.precio_venta),
          };
        });
        setNuevoPedidoLineas(lineDrafts);

        const lineIds = (lineasData ?? []).map((linea) => linea.pedidodetid).filter(Boolean) as number[];
        if (lineIds.length) {
          const { data: centrosData, error: centrosError } = await supabase
            .from('cambios_pedido_linea_centro')
            .select('pedidodetid, asignacion, numero_palets, subprov')
            .in('pedidodetid', lineIds);
          if (centrosError) throw centrosError;
          const centrosMap: Record<string, NuevoPedidoCentroDraft[]> = {};
          (centrosData ?? []).forEach((centro, idx) => {
            if (!centro.pedidodetid) return;
            const key = String(centro.pedidodetid);
            if (!centrosMap[key]) centrosMap[key] = [];
            centrosMap[key].push({
              tempId: `centro-${key}-${idx}`,
              asignacion: centro.asignacion ?? '',
              numero_palets: parseNumericValue(centro.numero_palets),
              subprov: centro.subprov ?? null,
            });
          });
          setNuevoPedidoCentros(centrosMap);
        } else {
          setNuevoPedidoCentros({});
        }

        const overridePdfActualId = options?.pdfActualId ?? null;
        const groupPdfId = header.archivo_pdf_id ?? cambio.archivo_pdf_id ?? null;
        let pdfActualId: number | null = overridePdfActualId;
        if (!pdfActualId && groupPdfId) {
          const relatedCambioIds = cambios
            .filter((item) => item.archivo_pdf_id === groupPdfId)
            .map((item) => item.id);
          const relatedPedidoIds = relatedCambioIds
            .map((id) => matchSummaries[id]?.pedidoId)
            .filter((id): id is number => Boolean(id));
          if (relatedPedidoIds.length > 0) {
            const { data: pedidosData, error: pedidosError } = await supabase
              .from('pedidos')
              .select('id, archivo_pdf_id')
              .in('id', relatedPedidoIds);
            if (pedidosError) throw pedidosError;
            pdfActualId = pedidosData?.find((pedido) => pedido.archivo_pdf_id)?.archivo_pdf_id ?? null;
          }
        }

        const existingMatchIds = extractMatchedPedidoIds(header.change_meta);
        let matchedPedidoIds: number[] = options?.matchedPedidoIds ?? [];
        const isPrevision = (header.tipo_pedido ?? 'P220') === 'P22E';
        if (!pdfActualId && !isPrevision) {
          const exactReferencia = header.referencia_cliente?.trim();
          if (exactReferencia) {
            let exactRefQuery = supabase
              .from('pedidos')
              .select('id, archivo_pdf_id, referencia_cliente, sujetodomicilioid_destino, created_at')
              .eq('tipo_pedido', header.tipo_pedido ?? 'P220')
              .eq('referencia_cliente', exactReferencia);
            if (header.clienteid) {
              exactRefQuery = exactRefQuery.eq('clienteid', header.clienteid);
            }
            const { data: rawExactRefPedidos, error: exactRefError } = await exactRefQuery.order('created_at', {
              ascending: false,
            });
            if (exactRefError) throw exactRefError;
            let exactRefPedidos =
              (rawExactRefPedidos ?? []) as Array<{
                id: number;
                archivo_pdf_id: number | null;
                referencia_cliente: string | null;
                sujetodomicilioid_destino: number | null;
                created_at: string | null;
              }>;
            if (exactRefPedidos.length > 1 && header.sujetodomicilioid_destino) {
              const sameDestination = exactRefPedidos.filter(
                (pedido) => pedido.sujetodomicilioid_destino === header.sujetodomicilioid_destino,
              );
              if (sameDestination.length > 0) {
                exactRefPedidos = sameDestination;
              }
            }
            if (exactRefPedidos.length > 0) {
              matchedPedidoIds = exactRefPedidos.map((pedido) => pedido.id);
              if (exactRefPedidos.length === 1) {
                pdfActualId = exactRefPedidos[0]?.archivo_pdf_id ?? null;
              }
            }
          }
        }
        if (!pdfActualId && !isPrevision && matchedPedidoIds.length === 0) {
          const referenciaRange = buildReferenciaRange(header.referencia_cliente, 20);
          const dateFilters = buildPedidoDateFilters(header.fecha_pedido ?? null, header.fecha_carga ?? null);
          if (
            referenciaRange.length > 0 &&
            header.clienteid &&
            header.sujetodomicilioid_destino &&
            dateFilters.length > 0
          ) {
            let query = supabase
              .from('pedidos')
              .select('id, archivo_pdf_id, referencia_cliente')
              .eq('tipo_pedido', header.tipo_pedido ?? 'P220')
              .eq('clienteid', header.clienteid)
              .eq('sujetodomicilioid_destino', header.sujetodomicilioid_destino)
              .in('referencia_cliente', referenciaRange);
            query = query.or(dateFilters.join(','));
            const { data: pedidosByRef, error: pedidosByRefError } = await query;
            if (pedidosByRefError) throw pedidosByRefError;
            matchedPedidoIds = (pedidosByRef ?? [])
              .map((pedido) => pedido.id)
              .filter((id): id is number => Boolean(id));
            if (!pdfActualId) {
              pdfActualId =
                pedidosByRef?.find((pedido) => pedido.archivo_pdf_id)?.archivo_pdf_id ?? null;
            }
          }
        }
        const mergedMatchIds =
          matchedPedidoIds.length > 0
            ? Array.from(new Set([...existingMatchIds, ...matchedPedidoIds]))
            : existingMatchIds;

        if (matchedPedidoIds.length > 0) {
          const nextMeta = updateCambioMetaMatchList(header.change_meta, mergedMatchIds);
          const sameIds =
            mergedMatchIds.length === existingMatchIds.length &&
            mergedMatchIds.every((id) => existingMatchIds.includes(id));
          if (!sameIds) {
            const { error: matchMetaError } = await supabase
              .from('cambios_pedidos')
              .update({ change_meta: nextMeta })
              .eq('id', header.id);
            if (matchMetaError) throw matchMetaError;
            setNuevoPedidoCambio((prev) =>
              prev ? { ...prev, change_meta: nextMeta } : prev,
            );
            setCambios((prev) =>
              prev.map((item) =>
                item.id === header.id ? { ...item, change_meta: nextMeta } : item,
              ),
            );
          }
        }

        if (pdfActualId) {
          await loadPdfPreview(
            pdfActualId,
            setNuevoPedidoPdfActualUrl,
            setNuevoPedidoPdfActualLoading,
            setNuevoPedidoPdfActualError,
          );
        } else {
          setNuevoPedidoPdfActualUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
          setNuevoPedidoPdfActualLoading(false);
          setNuevoPedidoPdfActualError('No hay PDF actual asociado a los pedidos del grupo.');
        }

        await loadPdfPreview(
          header.archivo_pdf_id ?? cambio.archivo_pdf_id ?? null,
          setNuevoPedidoPdfUrl,
          setNuevoPedidoPdfLoading,
          setNuevoPedidoPdfError,
        );
        setNuevoPedidoDialogOpen(true);
      } catch (error: any) {
        console.error('Error preparando nuevo pedido', error);
        toast({
          title: 'No se pudo abrir el cambio',
          description: error?.message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
      } finally {
        setNuevoPedidoLoading(false);
      }
    },
    [cambios, loadPdfPreview, matchSummaries, supabase, toast],
  );

  const openMatchSelection = useCallback(
    (
      cambio: CambioPedido,
      candidates: PedidoMatchCandidate[],
      reason?: CambioMatchSummary['reason'],
      mode: MatchSelectionMode = 'cambio',
    ) => {
      if (!candidates.length) return;
      setMatchSelectionCambio(cambio);
      setMatchSelectionCandidates(candidates);
      setMatchSelectionReason(reason ?? null);
      setMatchSelectionSelectedId(candidates[0]?.id ?? null);
      setMatchSelectionMode(mode);
      setMatchSelectionOpen(true);
    },
    [],
  );

  const handleBuscarMatchNuevoPedido = useCallback(
    async (cambio: CambioPedido) => {
      if (!cambio.clienteid || !cambio.sujetodomicilioid_destino) {
        toast({
          title: 'Datos incompletos',
          description: 'Faltan cliente o domicilio para buscar coincidencias.',
          variant: 'destructive',
        });
        return;
      }

      try {
        const tipoPedido = cambio.tipo_pedido ?? 'P220';
        const baseSelect =
          'id, referencia_cliente, referencia2_cliente, fecha_carga, fecha_pedido, clienteid, sujetodomicilioid_destino, created_at, idpedido_orizon, archivo_pdf_id';
        let query = supabase
          .from('pedidos')
          .select(baseSelect)
          .eq('tipo_pedido', tipoPedido)
          .eq('clienteid', cambio.clienteid)
          .eq('sujetodomicilioid_destino', cambio.sujetodomicilioid_destino);

        const fechaPedido = cambio.fecha_pedido ?? null;
        const fechaCarga = cambio.fecha_carga ?? null;
        if (fechaPedido && fechaCarga && fechaPedido !== fechaCarga) {
          query = query.or(`fecha_pedido.eq.${fechaPedido},fecha_carga.eq.${fechaCarga}`);
        } else if (fechaPedido) {
          query = query.eq('fecha_pedido', fechaPedido);
        } else if (fechaCarga) {
          query = query.eq('fecha_carga', fechaCarga);
        }

        const { data, error } = await query.order('created_at', { ascending: false }).limit(8);
        if (error) throw error;
        const candidates = (data ?? []) as PedidoMatchCandidate[];
        if (!candidates.length) {
          toast({
            title: 'Sin coincidencias',
            description: 'No se encontraron pedidos con los criterios seleccionados.',
          });
          return;
        }

        openMatchSelection(cambio, candidates, 'manual_search', 'nuevo_pedido');
      } catch (error: any) {
        console.error('Error buscando coincidencias para nuevo pedido', error);
        toast({
          title: 'No se pudo buscar coincidencias',
          description: error?.message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
      }
    },
    [openMatchSelection, supabase, toast],
  );

  const handleOpenCambioDialog = useCallback(
    async (cambio: CambioPedido, matchSummary?: CambioMatchSummary) => {
      if (!cambioDialogIntentRef.current) return;
      const requestId = ++cambioDialogRequestRef.current;
      const isStale = () =>
        requestId !== cambioDialogRequestRef.current || !cambioDialogIntentRef.current;

      let lineSummary = lineChangeSummaryById[cambio.id] ?? null;
      if (!lineSummary) {
        try {
          lineSummary = await loadCambioLineSummary(cambio.id);
        } catch (error: any) {
          if (isStale()) return;
          console.error('Error cargando resumen de líneas del cambio', error);
          toast({
            title: 'No se pudo abrir el cambio',
            description: error?.message ?? 'No se pudieron cargar sus líneas.',
            variant: 'destructive',
          });
          return;
        }
      }
      if (isStale()) return;

      const hasLineChanges = Boolean(lineSummary?.hasLineMeta || (lineSummary?.actions.size ?? 0) > 0);
      const hasMeta =
        hasNonEmptyMeta(cambio.change_meta) ||
        hasLineChanges ||
        hasMatriculaValues(cambio);
      if (!hasMeta) {
        toast({
          title: 'Cambio obsoleto',
          description: 'Este cambio no tiene metadatos compatibles con el nuevo flujo.',
        });
        return;
      }

      setCambioDialogOpen(true);
      setCambioDialogLoading(true);
      setCambioDialogCambio(cambio);
      setCambioDialogMatch(matchSummary ?? null);
      setCambioDialogPedido(null);
      setCambioDialogAcreedorActual(null);
      setCambioDialogAcreedorNuevo(null);
      setCambioDialogDisabledReason(null);
      setCambioDialogPdfActualLoading(false);
      setCambioDialogPdfActualError(null);
      setCambioDialogPdfCambioLoading(false);
      setCambioDialogPdfCambioError(null);
      setCambioDialogLineas([]);
      setCambioDialogLineasOriginales([]);
      setCambioDialogLineasMatch({});
      setCambioDialogLineasDrafts({});
      setCambioDialogHeaderLabel(null);
      setCambioDialogHasTransportistaChange(false);
      setCambioDialogHasMatriculaChange(false);

      try {
        let cambioData: CambioPedido = cambio;
        const { data: cambioHeader, error: cambioHeaderError } = await supabase
          .from('cambios_pedidos')
          .select(
            'id, created_at, fecha_carga, fecha_pedido, clienteid, referencia_cliente, referencia2_cliente, archivo_pdf_id, tipo_pedido, sujetodomicilioid_destino, idpedido_orizon, revisado, change_meta, acreedorid_porte, matricula_tractora, matricula_remolque',
          )
          .eq('id', cambio.id)
          .maybeSingle();
        if (cambioHeaderError) throw cambioHeaderError;
        if (cambioHeader) {
          cambioData = {
            ...cambio,
            ...(cambioHeader as CambioPedido),
            revisado: Boolean(cambioHeader.revisado),
          };
          setCambioDialogCambio(cambioData);
          setCambios((prev) =>
            prev.map((item) =>
              item.id === cambio.id
                ? { ...item, ...(cambioHeader as CambioPedido), revisado: Boolean(cambioHeader.revisado) }
                : item,
            ),
          );
        }
        if (isStale()) return;

        const hasHeaderMeta = hasNonEmptyMeta(cambioData.change_meta);
        const hasLineMeta = Boolean(lineSummary?.hasLineMeta || (lineSummary?.actions.size ?? 0) > 0);
        const headerChange = getHeaderChange(cambioData.change_meta);
        const headerColumns = (headerChange?.columns ?? [])
          .map((column) => column.toLowerCase().trim())
          .filter(Boolean);
        const hasTransportistaChange =
          hasHeaderMeta &&
          headerChange?.action === 'update' &&
          headerColumns.includes('transportista');
        const matriculaFromMeta =
          hasHeaderMeta &&
          headerChange?.action === 'update' &&
          headerColumns.some((column) =>
            ['matricula', 'matricula_tractora', 'matricula_remolque'].includes(column),
          );
        const fallbackMatricula = !hasHeaderMeta || !headerChange || headerColumns.length === 0;
        const hasMatriculaChange = matriculaFromMeta || (fallbackMatricula && hasMatriculaValues(cambioData));
        const hasHeaderChange = hasTransportistaChange || hasMatriculaChange;
        const appliedFlags = getAppliedFlags(cambioData.change_meta);
        const transportistaApplied = appliedFlags.transportista === true;
        const dialogMode = hasHeaderChange
          ? 'transportista'
          : hasLineMeta
            ? 'lineas'
            : hasHeaderMeta
              ? 'cabecera'
              : 'transportista';
        const summaryLabel =
          hasHeaderChange && hasLineMeta
            ? hasTransportistaChange && hasMatriculaChange
              ? 'Cambio de transportista, matrícula y líneas'
              : hasTransportistaChange
                ? 'Cambio de transportista y líneas'
                : 'Cambio de matrícula y líneas'
            : null;
        const headerLabel = hasTransportistaChange && hasMatriculaChange
          ? 'Aceptar transportista y matrícula'
          : hasTransportistaChange
            ? 'Aceptar transportista'
            : hasMatriculaChange
              ? 'Aceptar matrícula'
              : 'Aceptar cambio';
        setCambioDialogSummaryLabel(summaryLabel);
        setCambioDialogHasLineChanges(hasLineMeta);
        setCambioDialogMode(dialogMode);
        setCambioDialogHasTransportistaChange(hasTransportistaChange);
        setCambioDialogHasMatriculaChange(hasMatriculaChange);
        setCambioDialogHeaderLabel(headerLabel);

        let resolvedMatch: CambioMatchSummary | null = matchSummary ?? null;
        let pedidoId = matchSummary?.pedidoId ?? null;
        let pedido: Database['public']['Tables']['pedidos']['Row'] | null = null;
        if (pedidoId) {
          const { data: pedidoData, error: pedidoError } = await supabase
            .from('pedidos')
            .select(
              'id, referencia_cliente, referencia2_cliente, archivo_pdf_id, acreedorid_porte, idpedido_orizon, pedidoclienteid, matricula_tractora, matricula_remolque',
            )
            .eq('id', pedidoId)
            .single();
          if (pedidoError) throw pedidoError;
          pedido = pedidoData ?? null;
        }
        if (!pedido) {
          const match = await findMatchedPedido(cambioData);
          if (isStale()) return;
          if (match.pedido) {
            pedido = match.pedido;
            pedidoId = match.pedido.id;
            resolvedMatch = {
              headerMatched: true,
              pedidoId,
              pedidoReferencia: match.pedido.referencia_cliente,
            };
          } else if (match.candidates && match.candidates.length > 0) {
            handleCloseCambioDialog(false, { preserveRoute: true });
            openMatchSelection(cambioData, match.candidates, match.reason);
            const hint = getMatchSelectionHint(match.reason);
            toast({
              title: 'Selecciona el pedido correcto',
              description: hint ? `${hint} Selecciona el pedido correcto.` : 'Selecciona el pedido correcto.',
            });
            return;
          }
        }

        const isAddLine = Boolean(lineSummary?.allAdd) && Boolean(pedidoId);
        if (isAddLine) {
          const isPrevisionAdd = (cambioData.tipo_pedido ?? 'P220') === 'P22E';
          setCambioDialogSummaryLabel(isPrevisionAdd ? 'Añadir líneas a previsión' : 'Añadir líneas al pedido');
          setCambioDialogLineasLabel('Añadir líneas');
          setCambioDialogLineasHint(
            isPrevisionAdd
              ? 'Se añadirán nuevas líneas a la previsión existente.'
              : 'Se añadirán nuevas líneas al pedido existente.',
          );
        } else {
          setCambioDialogLineasLabel(null);
          setCambioDialogLineasHint(null);
        }

        let cambioLineas: CambioLinea[] = [];
        let pedidoLineas: PedidoLinea[] = [];
        if (hasLineMeta) {
          const { data: lineasData, error: lineasError } = await supabase
            .from('cambios_pedido_linea')
            .select(
              'pedidodetid, accion, change_meta, descripcion_salida, confeccionpaletid, catalogoconfecid, confeccionsalidaid, grupoconfeccionid, generoid, tipocultivoid, origenid, calibreid, bultos, bultosxpalet, numero_palet, piezasxbulto, total_piezas, kilosxbulto, kilos_cliente, catconfeckilosbultoid, catconfecpiezaid, ean, ean_caja, precio_venta, nlote_cliente',
            )
            .eq('pedidoid', cambioData.id)
            .order('pedidodetid', { ascending: true });
          if (lineasError) throw lineasError;
          cambioLineas = (lineasData ?? []) as CambioLinea[];

          if (pedidoId) {
            const { data: pedidoLineasData, error: pedidoLineasError } = await supabase
              .from('pedido_linea')
              .select(
                'pedidodetid, idpedidodet_orizon, descripcion_salida, confeccionpaletid, catalogoconfecid, confeccionsalidaid, grupoconfeccionid, generoid, bultos, bultosxpalet, numero_palet, piezasxbulto, total_piezas, kilosxbulto, kilos_cliente, catconfeckilosbultoid, catconfecpiezaid, ean, ean_caja, precio_venta, nlote_cliente',
              )
              .eq('pedidoid', pedidoId)
              .order('pedidodetid', { ascending: true });
            if (pedidoLineasError) throw pedidoLineasError;
            pedidoLineas = (pedidoLineasData ?? []) as PedidoLinea[];
          }
        }
        if (isStale()) return;

        setCambioDialogLineas(cambioLineas);
        setCambioDialogLineasOriginales(pedidoLineas);
        const nextLineasDrafts = buildLineaCambioDrafts(cambioLineas);
        setCambioDialogLineasDrafts(nextLineasDrafts);
        if (cambioLineas.length) {
          const autoMatches =
            cambioLineas.length && pedidoLineas.length ? autoMatchLineas(cambioLineas, pedidoLineas) : {};
          const sanitizedMatches: Record<number, number | null> = {};
          cambioLineas.forEach((linea) => {
            const action = getEffectiveLineaAction(linea, nextLineasDrafts[linea.pedidodetid]);
            sanitizedMatches[linea.pedidodetid] = action === 'add' ? null : autoMatches[linea.pedidodetid] ?? null;
          });
          setCambioDialogLineasMatch(sanitizedMatches);
        } else {
          setCambioDialogLineasMatch({});
        }

        const shouldShowTransportista = hasTransportistaChange;
        const acreedorNuevoId = shouldShowTransportista
          ? resolveAcreedorId(cambio.change_meta, cambio.acreedorid_porte)
          : null;
        const acreedorActualId = shouldShowTransportista ? pedido?.acreedorid_porte ?? null : null;

        const [acreedorActual, acreedorNuevo] = shouldShowTransportista
          ? await Promise.all([
              buildAcreedorInfo(acreedorActualId),
              buildAcreedorInfo(acreedorNuevoId),
            ])
          : [null, null];
        if (isStale()) return;

        setCambioDialogPedido(pedido);
        setCambioDialogAcreedorActual(acreedorActual);
        setCambioDialogAcreedorNuevo(acreedorNuevo);
        setCambioDialogMatch(resolvedMatch);
        if (resolvedMatch?.headerMatched && resolvedMatch.pedidoId) {
          setMatchSummaries((prev) => {
            const current = prev[cambioData.id];
            if (current?.headerMatched && current.pedidoId === resolvedMatch.pedidoId) {
              return prev;
            }
            return {
              ...prev,
              [cambioData.id]: {
                ...current,
                ...resolvedMatch,
                headerMatched: true,
                pedidoId: resolvedMatch.pedidoId,
              },
            };
          });
        }
        const hasMatriculaValuesLocal = hasMatriculaValues(cambioData);
        let headerDisabledReason: string | null = null;
        if (cambioData.revisado) {
          headerDisabledReason = 'Cambio ya revisado';
        } else if (!pedidoId) {
          headerDisabledReason = 'Sin pedido asociado';
        } else if (hasHeaderChange) {
          if (transportistaApplied) {
            headerDisabledReason =
              hasTransportistaChange && hasMatriculaChange
                ? 'Cabecera ya aplicada'
                : hasTransportistaChange
                  ? 'Transportista ya aplicado'
                  : 'Matrícula ya aplicada';
          } else {
            const missing: string[] = [];
            if (hasTransportistaChange && acreedorNuevoId == null) missing.push('transportista');
            if (hasMatriculaChange && !hasMatriculaValuesLocal) missing.push('matrícula');
            if (missing.length > 0) {
              headerDisabledReason = `Sin nuevo ${missing.join(' y ')}`;
            }
          }
        } else if (dialogMode === 'lineas') {
          headerDisabledReason = 'Cambio de líneas: revisa el PDF del cambio.';
        } else {
          headerDisabledReason = 'Cambio de cabecera: revisa el PDF del cambio.';
        }
        setCambioDialogDisabledReason(headerDisabledReason);
        await Promise.all([
          loadPdfPreview(
            pedido?.archivo_pdf_id ?? null,
            setCambioDialogPdfActualUrl,
            setCambioDialogPdfActualLoading,
            setCambioDialogPdfActualError,
          ),
          loadPdfPreview(
            cambioData.archivo_pdf_id ?? null,
            setCambioDialogPdfCambioUrl,
            setCambioDialogPdfCambioLoading,
            setCambioDialogPdfCambioError,
          ),
        ]);
        if (isStale()) return;
      } catch (error: any) {
        if (isStale()) return;
        console.error('Error preparando detalle del cambio', error);
        toast({
          title: 'No se pudo abrir el cambio',
          description: error?.message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
        handleCloseCambioDialog(false);
      } finally {
        if (!isStale()) {
          setCambioDialogLoading(false);
        }
      }
    },
    [
      buildAcreedorInfo,
      findMatchedPedido,
      handleCloseCambioDialog,
      handleOpenPdf,
      lineChangeSummaryById,
      loadCambioLineSummary,
      loadPdfPreview,
      openMatchSelection,
      supabase,
      toast,
    ],
  );

  const openCambioDetail = useCallback(
    (cambio: CambioPedido, matchSummary?: CambioMatchSummary | null) => {
      blockCambioRouteSyncRef.current = false;
      cambioDialogIntentRef.current = true;
      navigateToCambioDetail(cambio.id);
      void handleOpenCambioDialog(cambio, matchSummary);
    },
    [handleOpenCambioDialog, navigateToCambioDetail],
  );

  useEffect(() => {
    if (!pendingCambioDialogId || loading) return;

    const targetCambioId = pendingCambioDialogId;
    if (openingCambioDialogIdRef.current === targetCambioId) {
      setPendingCambioDialogId(null);
      return;
    }

    openingCambioDialogIdRef.current = targetCambioId;
    setPendingCambioDialogId(null);
    const isCurrentOpenRequest = () =>
      openingCambioDialogIdRef.current === targetCambioId && cambioDialogIntentRef.current;

    const openPendingCambioDialog = async () => {
      try {
        const cambioInPage = cambios.find((item) => item.id === targetCambioId);
        if (cambioInPage) {
          if (!isCurrentOpenRequest()) return;
          await handleOpenCambioDialog(cambioInPage, matchSummaries[cambioInPage.id]);
          return;
        }

        // Fallback: abrir por ID aunque no pertenezca a la página/filtro actual.
        const { data, error } = await supabase
          .from('cambios_pedidos')
          .select(
            'id, created_at, fecha_carga, fecha_pedido, clienteid, referencia_cliente, referencia2_cliente, archivo_pdf_id, tipo_pedido, sujetodomicilioid_destino, idpedido_orizon, revisado, change_meta, acreedorid_porte, matricula_tractora, matricula_remolque',
          )
          .eq('id', targetCambioId)
          .maybeSingle();

        if (!isCurrentOpenRequest()) return;
        if (error) throw error;

        if (!data) {
          toast({
            title: 'Cambio no encontrado',
            description: `No existe el cambio #${targetCambioId}.`,
            variant: 'destructive',
          });
          return;
        }

        const fallbackCambio = {
          ...(data as CambioPedido),
          revisado: Boolean((data as CambioPedido).revisado),
        };
        if (!isCurrentOpenRequest()) return;
        await handleOpenCambioDialog(fallbackCambio, matchSummaries[targetCambioId]);
      } catch (error: any) {
        if (!isCurrentOpenRequest()) return;
        console.error('Error abriendo cambio solicitado por URL', error);
        toast({
          title: 'No se pudo abrir el cambio',
          description: error?.message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
      } finally {
        if (openingCambioDialogIdRef.current === targetCambioId) {
          openingCambioDialogIdRef.current = null;
        }
      }
    };

    void openPendingCambioDialog();
  }, [
    cambios,
    handleOpenCambioDialog,
    loading,
    matchSummaries,
    pendingCambioDialogId,
    supabase,
    toast,
  ]);

  useEffect(() => {
    const clienteId = cambioDialogCambio?.clienteid ?? null;
    if (!clienteId || clienteBehaviorRulesMap[clienteId]) return;

    let cancelled = false;

    void getClienteBehaviorRulesMap([clienteId], 'pedidos').then((rules) => {
      if (cancelled || !rules[clienteId]) return;
      setClienteBehaviorRulesMap((prev) => ({
        ...prev,
        [clienteId]: rules[clienteId],
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [cambioDialogCambio?.clienteid, clienteBehaviorRulesMap]);

  const cambioDialogContext = useMemo(
    () => buildCambioContext(cambioDialogCambio, domicilioNombres),
    [cambioDialogCambio, domicilioNombres],
  );
  const nuevoPedidoOrizonLabel =
    nuevoPedidoOrizonPrompt?.tipoPedido === 'P22E' ? 'previsión' : 'pedido';
  const cambioDialogCancelTargetLabel =
    cambioDialogCambio?.tipo_pedido === 'P22E' ? 'previsión' : 'pedido';
  const cambioDialogOrizonId = resolveOrizonId(
    cambioDialogPedido?.idpedido_orizon,
    cambioDialogPedido?.pedidoclienteid,
  );
  const cambioDialogHasOrizonId = Boolean(cambioDialogOrizonId);
  const cambioDialogCanMarkReviewed = useMemo(() => {
    if (!cambioDialogCambio) return false;
    if (cambioDialogCambio.revisado) return false;
    return !cambioDialogPedido?.id;
  }, [cambioDialogCambio, cambioDialogPedido]);
  const cambioDialogEffectiveLineActions = useMemo(
    () =>
      cambioDialogLineas.map((linea) =>
        getEffectiveLineaAction(linea, cambioDialogLineasDrafts[linea.pedidodetid]),
      ),
    [cambioDialogLineas, cambioDialogLineasDrafts],
  );
  const cambioDialogAllLineasAreAdd = useMemo(
    () =>
      cambioDialogEffectiveLineActions.length > 0 &&
      cambioDialogEffectiveLineActions.every((action) => action === 'add'),
    [cambioDialogEffectiveLineActions],
  );
  const cambioDialogAllLineasAreCancel = useMemo(
    () =>
      cambioDialogEffectiveLineActions.length > 0 &&
      cambioDialogEffectiveLineActions.every((action) => action === 'cancel'),
    [cambioDialogEffectiveLineActions],
  );
  const cambioDialogAllLineasAreUpdate = useMemo(
    () =>
      cambioDialogEffectiveLineActions.length > 0 &&
      cambioDialogEffectiveLineActions.every((action) => action === 'update'),
    [cambioDialogEffectiveLineActions],
  );
  const cambioDialogCanCreateNuevoPedido = useMemo(() => {
    if (!cambioDialogCambio || cambioDialogCambio.revisado) return false;
    if (cambioDialogPedido?.id) return false;
    if (!cambioDialogHasLineChanges || cambioDialogLineas.length === 0) return false;
    if (!cambioDialogAllLineasAreUpdate) return false;
    return canCreatePedidoFromUnmatchedChange(cambioDialogCambio);
  }, [
    cambioDialogAllLineasAreUpdate,
    cambioDialogCambio,
    cambioDialogHasLineChanges,
    cambioDialogLineas.length,
    cambioDialogPedido,
    canCreatePedidoFromUnmatchedChange,
  ]);
  const cambioDialogCreateNuevoPedidoLabel = useMemo(() => {
    if (!cambioDialogCanCreateNuevoPedido) return null;
    return cambioDialogCambio?.tipo_pedido === 'P22E' ? 'Crear nueva previsión' : 'Crear nuevo pedido';
  }, [cambioDialogCanCreateNuevoPedido, cambioDialogCambio]);
  const cambioDialogCreateNuevoPedidoDescription = useMemo(() => {
    if (!cambioDialogCanCreateNuevoPedido) return null;
    return cambioDialogCambio?.tipo_pedido === 'P22E'
      ? 'No hay previsión asociada. Puedes crear una nueva con todas las líneas del cambio.'
      : 'No hay pedido asociado. Puedes crear uno nuevo con todas las líneas del cambio.';
  }, [cambioDialogCanCreateNuevoPedido, cambioDialogCambio]);
  const cambioDialogMarkReviewedDescription = useMemo(() => {
    if (!cambioDialogCanMarkReviewed) return null;
    if (cambioDialogCanCreateNuevoPedido) {
      return 'No hay pedido asociado. Puedes crear uno nuevo con este cambio o marcarlo como revisado.';
    }
    return 'No hay pedido asociado. Puedes marcar el cambio como revisado.';
  }, [cambioDialogCanCreateNuevoPedido, cambioDialogCanMarkReviewed]);
  const cambioDialogEffectiveSummaryLabel = useMemo(() => {
    if (!cambioDialogHasLineChanges) return cambioDialogSummaryLabel;
    if (cambioDialogAllLineasAreAdd) return cambioDialogSummaryLabel;
    return null;
  }, [cambioDialogAllLineasAreAdd, cambioDialogHasLineChanges, cambioDialogSummaryLabel]);
  const cambioDialogEffectiveLineasLabel = useMemo(() => {
    if (cambioDialogAllLineasAreAdd) return cambioDialogLineasLabel ?? 'Añadir líneas';
    if (cambioDialogAllLineasAreCancel) return 'Anular líneas';
    if (cambioDialogAllLineasAreUpdate) return 'Aplicar edición de líneas';
    return 'Aplicar cambios en líneas';
  }, [
    cambioDialogAllLineasAreAdd,
    cambioDialogAllLineasAreCancel,
    cambioDialogAllLineasAreUpdate,
    cambioDialogLineasLabel,
  ]);
  const cambioDialogEffectiveLineasHint = useMemo(() => {
    if (cambioDialogAllLineasAreAdd) return cambioDialogLineasHint;
    if (cambioDialogAllLineasAreCancel) {
      return `Se anularán las líneas emparejadas del ${cambioDialogCancelTargetLabel}.`;
    }
    if (cambioDialogAllLineasAreUpdate) {
      return 'Se editarán las líneas emparejadas con los valores nuevos.';
    }
    return 'Puedes combinar añadir, editar y anular línea a línea antes de aplicar.';
  }, [
    cambioDialogAllLineasAreAdd,
    cambioDialogAllLineasAreCancel,
    cambioDialogAllLineasAreUpdate,
    cambioDialogCancelTargetLabel,
    cambioDialogLineasHint,
  ]);

  const cambioDialogIsCancelacion = useMemo(() => {
    if (!cambioDialogHasLineChanges) return false;
    if (!cambioDialogCambio || !cambioDialogPedido?.id) return false;
    if (cambioDialogLineas.length === 0) return false;
    if (!cambioDialogAllLineasAreCancel) return false;
    if (cambioDialogLineasOriginales.length > 0 && cambioDialogLineas.length < cambioDialogLineasOriginales.length) {
      return false;
    }
    return true;
  }, [
    cambioDialogHasLineChanges,
    cambioDialogCambio,
    cambioDialogPedido,
    cambioDialogAllLineasAreCancel,
    cambioDialogLineas,
    cambioDialogLineasOriginales,
  ]);

  const cambioDialogCanCancelPedido = false;

  const cambioDialogCancelDescription = useMemo(() => {
    const base = `Todas las líneas del cambio están anuladas. Puedes eliminar el ${cambioDialogCancelTargetLabel}.`;
    if (cambioDialogHasOrizonId) {
      return `${base} También se intentará eliminar en Orizon.`;
    }
    return base;
  }, [cambioDialogCancelTargetLabel, cambioDialogHasOrizonId]);

  const cambioDialogLineasApplyDisabledReason = useMemo(() => {
    if (!cambioDialogHasLineChanges) return 'Sin cambios de líneas.';
    if (!cambioDialogCambio) return 'Sin cambio seleccionado.';
    if (!cambioDialogPedido?.id) return 'Sin pedido asociado.';
    if (cambioDialogCambio.revisado) return 'Cambio ya revisado.';
    const appliedFlags = getAppliedFlags(cambioDialogCambio.change_meta);
    if (appliedFlags.lineas === true) return 'Líneas ya aplicadas.';
    if (cambioDialogLineas.length === 0) return 'No hay líneas del cambio.';
    const missingMatch = cambioDialogLineas.some((linea) => {
      const action = getEffectiveLineaAction(linea, cambioDialogLineasDrafts[linea.pedidodetid]);
      if (action === 'add') return false;
      return !cambioDialogLineasMatch[linea.pedidodetid];
    });
    if (missingMatch) return 'Empareja todas las líneas antes de aplicar.';
    const matchIds = cambioDialogLineas
      .map((linea) => {
        const action = getEffectiveLineaAction(linea, cambioDialogLineasDrafts[linea.pedidodetid]);
        if (action === 'add') return null;
        return cambioDialogLineasMatch[linea.pedidodetid] ?? null;
      })
      .filter((id): id is number => typeof id === 'number');
    const unique = new Set(matchIds);
    if (unique.size !== matchIds.length) return 'Hay líneas emparejadas al mismo pedido.';
    const invalidDraft = cambioDialogLineas.find((linea) => {
      const action = getEffectiveLineaAction(linea, cambioDialogLineasDrafts[linea.pedidodetid]);
      if (action === 'cancel') return false;
      const draft = cambioDialogLineasDrafts[linea.pedidodetid];
      return !draft || draft.bultos == null || draft.bultosxpalet == null || draft.numero_palet == null;
    });
    if (invalidDraft) return 'Completa bultos, bultos x palet y número de palet.';
    return null;
  }, [
    cambioDialogHasLineChanges,
    cambioDialogCambio,
    cambioDialogPedido,
    cambioDialogLineas,
    cambioDialogLineasMatch,
    cambioDialogLineasDrafts,
  ]);

  const nuevoPedidoContext = useMemo(
    () => buildNuevoPedidoContext(nuevoPedidoCambio, domicilioNombres),
    [nuevoPedidoCambio, domicilioNombres],
  );

  const nuevoPedidoClienteNombre = useMemo(() => {
    const clienteId = nuevoPedidoCambio?.clienteid ?? null;
    if (!clienteId) return null;
    return clienteNombres[clienteId] ?? null;
  }, [clienteNombres, nuevoPedidoCambio]);

  const nuevoPedidoDisabledReason = useMemo(() => {
    if (nuevoPedidoLoading) return 'Cargando datos del cambio.';
    if (!nuevoPedidoCambio) return 'Sin datos del cambio.';
    if (nuevoPedidoCambio.revisado) return 'Cambio ya revisado.';
    if (!nuevoPedidoCambio.archivo_pdf_id) return 'Cambio sin PDF asociado.';
    return null;
  }, [nuevoPedidoCambio, nuevoPedidoLoading]);

  const handleCloseMatchSelection = useCallback((open: boolean) => {
    setMatchSelectionOpen(open);
    if (!open) {
      // Prevent the route watcher from reopening the detail dialog while the URL is still updating.
      blockCambioRouteSyncRef.current = true;
      cambioDialogIntentRef.current = false;
      cambioDialogRequestRef.current += 1;
      setPendingCambioDialogId(null);
      if (!cambioDialogOpen) {
        navigateToCambiosList({ replace: true });
      }
      setMatchSelectionCambio(null);
      setMatchSelectionCandidates([]);
      setMatchSelectionReason(null);
      setMatchSelectionSelectedId(null);
      setMatchSelectionMode('cambio');
      setMatchSelectionLineSummary({});
      setMatchSelectionLoadingDetails(false);
      setMatchSelectionPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setMatchSelectionPdfLoading(false);
      setMatchSelectionPdfError(null);
      setMatchSelectionCambioPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setMatchSelectionCambioPdfLoading(false);
      setMatchSelectionCambioPdfError(null);
    }
  }, [cambioDialogOpen, navigateToCambiosList]);

  const handleSelectMatchCandidate = useCallback(
    async (candidate: PedidoMatchCandidate) => {
      if (!matchSelectionCambio) return;
      const cambioReferencia = matchSelectionCambio.referencia_cliente?.trim() ?? '';
      const pedidoReferencia = candidate.referencia_cliente?.trim() ?? '';
      try {
        if (cambioReferencia && !pedidoReferencia) {
          const { error } = await supabase
            .from('pedidos')
            .update({ referencia_cliente: cambioReferencia })
            .eq('id', candidate.id);
          if (error) throw error;
        }

        const nextMeta = updateCambioMetaMatch(matchSelectionCambio.change_meta, candidate.id);
        const { error: updateCambioError } = await supabase
          .from('cambios_pedidos')
          .update({ change_meta: nextMeta })
          .eq('id', matchSelectionCambio.id);
        if (updateCambioError) throw updateCambioError;

        const summary: CambioMatchSummary = {
          headerMatched: true,
          pedidoId: candidate.id,
          pedidoReferencia: pedidoReferencia || cambioReferencia || null,
        };
        setCambios((prev) =>
          prev.map((item) =>
            item.id === matchSelectionCambio.id ? { ...item, change_meta: nextMeta } : item,
          ),
        );
        setMatchSummaries((prev) => ({
          ...prev,
          [matchSelectionCambio.id]: summary,
        }));
        handleCloseMatchSelection(false);
        if (matchSelectionMode === 'cambio') {
          openCambioDetail(matchSelectionCambio, summary);
        } else {
          toast({
            title: 'Match guardado',
            description: `Se enlazo el cambio con el pedido #${candidate.id}.`,
          });
        }
      } catch (error: any) {
        console.error('Error guardando el match del pedido', error);
        toast({
          title: 'No se pudo guardar el match',
          description: error?.message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
      }
    },
    [
      handleCloseMatchSelection,
      matchSelectionCambio,
      matchSelectionMode,
      openCambioDetail,
      supabase,
      toast,
    ],
  );

  const handleNuevoPedidoFromCandidate = useCallback(
    async (candidate: PedidoMatchCandidate) => {
      if (!matchSelectionCambio) return;
      try {
        let matchedPedidoIds: number[] = [];
        const pdfActualId = candidate.archivo_pdf_id ?? null;
        if (pdfActualId) {
          let query = supabase
            .from('pedidos')
            .select('id')
            .eq('tipo_pedido', matchSelectionCambio.tipo_pedido ?? 'P220')
            .eq('archivo_pdf_id', pdfActualId);
          if (matchSelectionCambio.clienteid) {
            query = query.eq('clienteid', matchSelectionCambio.clienteid);
          }
          if (matchSelectionCambio.sujetodomicilioid_destino) {
            query = query.eq('sujetodomicilioid_destino', matchSelectionCambio.sujetodomicilioid_destino);
          }
          const { data, error } = await query;
          if (error) throw error;
          matchedPedidoIds = (data ?? [])
            .map((row) => row.id)
            .filter((id): id is number => typeof id === 'number');
        }
        if (matchedPedidoIds.length === 0) {
          matchedPedidoIds = [candidate.id];
        }
        handleCloseMatchSelection(false);
        await handleOpenNuevoPedidoDialog(matchSelectionCambio, {
          pdfActualId,
          matchedPedidoIds,
        });
      } catch (error: unknown) {
        console.error('Error preparando nuevo pedido desde selección', error);
        const message = error instanceof Error ? error.message : null;
        toast({
          title: 'No se pudo preparar el nuevo pedido',
          description: message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
      }
    },
    [
      handleCloseMatchSelection,
      handleOpenNuevoPedidoDialog,
      matchSelectionCambio,
      supabase,
      toast,
    ],
  );

  const selectedMatchCandidate = useMemo(() => {
    if (!matchSelectionSelectedId) return null;
    return matchSelectionCandidates.find((candidate) => candidate.id === matchSelectionSelectedId) ?? null;
  }, [matchSelectionCandidates, matchSelectionSelectedId]);
  const matchSelectionCambioReferencia = matchSelectionCambio?.referencia_cliente?.trim() || 'Sin referencia';
  const matchSelectionCambioReferencia2 = matchSelectionCambio?.referencia2_cliente?.trim() || 'Sin referencia 2';
  const matchSelectionCambioFechaCarga =
    formatFechaCorta(matchSelectionCambio?.fecha_carga ?? matchSelectionCambio?.fecha_pedido ?? null) ?? 'Sin fecha';

  useEffect(() => {
    if (!matchSelectionOpen || matchSelectionCandidates.length === 0) {
      setMatchSelectionLineSummary({});
      return;
    }
    let active = true;
    setMatchSelectionLoadingDetails(true);
    const candidateIds = matchSelectionCandidates.map((candidate) => candidate.id);

    (async () => {
      try {
        const { data, error } = await supabase
          .from('pedido_linea')
          .select('pedidoid, descripcion_salida')
          .in('pedidoid', candidateIds);
        if (error) throw error;
        const summary: Record<number, { total: number; descriptions: string[] }> = {};
        matchSelectionCandidates.forEach((candidate) => {
          summary[candidate.id] = { total: 0, descriptions: [] };
        });
        (data ?? []).forEach((linea) => {
          if (!linea.pedidoid) return;
          const target = summary[linea.pedidoid] ?? { total: 0, descriptions: [] };
          target.total += 1;
          const desc = linea.descripcion_salida?.trim();
          if (desc && !target.descriptions.includes(desc) && target.descriptions.length < 6) {
            target.descriptions.push(desc);
          }
          summary[linea.pedidoid] = target;
        });
        if (active) {
          setMatchSelectionLineSummary(summary);
        }
      } catch (error) {
        console.error('Error cargando lineas candidatas', error);
        if (active) {
          setMatchSelectionLineSummary({});
        }
      } finally {
        if (active) setMatchSelectionLoadingDetails(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [matchSelectionCandidates, matchSelectionOpen, supabase]);

  useEffect(() => {
    if (!matchSelectionOpen) return;
    const selected = selectedMatchCandidate;
    if (!selected) {
      setMatchSelectionPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setMatchSelectionPdfError('Selecciona un pedido para ver el PDF.');
      return;
    }
    loadPdfPreview(
      selected.archivo_pdf_id ?? null,
      setMatchSelectionPdfUrl,
      setMatchSelectionPdfLoading,
      setMatchSelectionPdfError,
    );
  }, [loadPdfPreview, matchSelectionOpen, selectedMatchCandidate]);

  useEffect(() => {
    if (!matchSelectionOpen) return;
    loadPdfPreview(
      matchSelectionCambio?.archivo_pdf_id ?? null,
      setMatchSelectionCambioPdfUrl,
      setMatchSelectionCambioPdfLoading,
      setMatchSelectionCambioPdfError,
    );
  }, [loadPdfPreview, matchSelectionCambio, matchSelectionOpen]);

  const filteredCambios = useMemo(() => cambios, [cambios]);

  useEffect(() => {
    let active = true;
    const fetchAllowedClientIds = async () => {
      try {
        const ids = new Set<number>();
        const pageSize = 1000;
        let from = 0;

        while (true) {
          const to = from + pageSize - 1;
          let query = supabase
            .from('cambios_pedidos')
            .select('clienteid')
            .not('clienteid', 'is', null)
            .order('clienteid', { ascending: true })
            .range(from, to);

          if (filters.tipoPedido) {
            query = query.eq('tipo_pedido', filters.tipoPedido);
          }

          const { data, error } = await query;
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

        if (active) setAllowedClientIds(ids);
      } catch (error) {
        console.error('Error cargando clientes con cambios', error);
        if (active) setAllowedClientIds(null);
      }
    };

    fetchAllowedClientIds();
    return () => {
      active = false;
    };
  }, [filters.tipoPedido]);

  const cambioPdfIds = useMemo(() => {
    const ids = new Set<number>();
    filteredCambios.forEach((cambio) => {
      if (typeof cambio.archivo_pdf_id === 'number' && cambio.archivo_pdf_id > 0) {
        ids.add(cambio.archivo_pdf_id);
      }
    });
    return Array.from(ids).sort((a, b) => a - b);
  }, [filteredCambios]);

  useEffect(() => {
    let cancelled = false;
    if (cambioPdfIds.length === 0) {
      setCambioPdfCreatedAtMap({});
      return;
    }

    const fetchCambioPdfsCreatedAt = async () => {
      try {
        const { data, error } = await supabase
          .from('archivos_pdf')
          .select('id, created_at')
          .in('id', cambioPdfIds);
        if (error) throw error;
        if (!cancelled) {
          const next: Record<number, string | null> = {};
          (data ?? []).forEach((row) => {
            next[row.id] = row.created_at ?? null;
          });
          setCambioPdfCreatedAtMap(next);
        }
      } catch (error) {
        console.error('Error cargando created_at de PDFs de cambios', error);
      }
    };

    fetchCambioPdfsCreatedAt();

    return () => {
      cancelled = true;
    };
  }, [cambioPdfIds]);

  const groupedCambios = useMemo<GroupedCambio[]>(() => {
    const orderDirection = filters.order === 'asc' ? 1 : -1;
    const map = new Map<number | null, CambioPedido[]>();
    filteredCambios.forEach((c) => {
      const key = c.archivo_pdf_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    });
    const groups: GroupedCambio[] = Array.from(map.entries()).map(([archivoPdfId, list]) => {
      const ordenados = [...list].sort((a, b) => {
        const cmp = getCambioRecencyTimestamp(a) - getCambioRecencyTimestamp(b);
        if (cmp !== 0) return cmp * orderDirection;
        return (a.id - b.id) * orderDirection;
      });
      const fechaReferencia =
        ordenados[0]?.fecha_carga || ordenados[0]?.fecha_pedido || ordenados[0]?.created_at || null;
      const entradaTimestamp =
        typeof archivoPdfId === 'number'
          ? parseTimestamp(cambioPdfCreatedAtMap[archivoPdfId] ?? null)
          : ordenados.reduce((latestTimestamp, cambio) => {
              const entryTimestamp = getCambioEntryTimestamp(cambio);
              return entryTimestamp > latestTimestamp ? entryTimestamp : latestTimestamp;
            }, 0);
      const first = ordenados[0];
      const clienteNombre = first?.clienteid ? clienteNombres[first.clienteid] : undefined;
      const domicilioNombre = first?.sujetodomicilioid_destino
        ? domicilioNombres[first.sujetodomicilioid_destino]
        : undefined;
      return {
        archivoPdfId,
        cambios: ordenados,
        total: ordenados.length,
        fechaReferencia,
        entradaLabel: formatFechaHora(entradaTimestamp),
        clienteNombre,
        domicilioNombre,
      };
    });
    return groups.sort((a, b) => {
      const cmp = parseTimestamp(a.fechaReferencia) - parseTimestamp(b.fechaReferencia);
      if (cmp !== 0) return cmp * orderDirection;
      const aKey = a.archivoPdfId === null ? '__null__' : String(a.archivoPdfId);
      const bKey = b.archivoPdfId === null ? '__null__' : String(b.archivoPdfId);
      return aKey.localeCompare(bKey);
    });
  }, [filteredCambios, cambioPdfCreatedAtMap, clienteNombres, domicilioNombres, filters.order]);

  const totalGroupPages = Math.max(1, Math.ceil(totalGroups / Math.max(1, itemsPerPage)));
  const paginatedGroups = groupedCambios;
  const pageTransitionLoading = loading && totalGroups > 0;

  useEffect(() => {
    if (loading) return;
    if (currentPage <= totalGroupPages) return;
    setCurrentPage(totalGroupPages);
  }, [currentPage, loading, totalGroupPages, setCurrentPage]);

  const pedidoIdsForPdfCheck = useMemo(() => {
    const ids = new Set<number>();
    filteredCambios.forEach((cambio) => {
      const match = matchSummaries[cambio.id];
      if (match?.pedidoId) ids.add(match.pedidoId);
      extractMatchedPedidoIds(cambio.change_meta).forEach((id) => ids.add(id));
    });
    return Array.from(ids).sort((a, b) => a - b);
  }, [filteredCambios, matchSummaries]);

  useEffect(() => {
    let cancelled = false;
    if (pedidoIdsForPdfCheck.length === 0) {
      setPedidoPdfMap({});
      return;
    }

    const fetchPedidoPdfs = async () => {
      try {
        const { data, error } = await supabase
          .from('pedidos')
          .select('id, archivo_pdf_id')
          .in('id', pedidoIdsForPdfCheck);
        if (error) throw error;
        if (!cancelled) {
          setPedidoPdfMap((prev) => {
            const next = { ...prev };
            (data ?? []).forEach((row) => {
              next[row.id] = row.archivo_pdf_id ?? null;
            });
            return next;
          });
        }
      } catch (error) {
        console.error('Error cargando PDF de pedidos', error);
      }
    };

    fetchPedidoPdfs();

    return () => {
      cancelled = true;
    };
  }, [pedidoIdsForPdfCheck, supabase]);

  const collectGroupPedidoIds = useCallback(
    (group: GroupedCambio) => {
      const pedidoIds = new Set<number>();
      let missingMatch = false;

      group.cambios.forEach((cambio) => {
        const match = matchSummaries[cambio.id];
        const lineSummary = lineChangeSummaryById[cambio.id];
        const flags = resolveCambioFlags(cambio, lineSummary ?? null, match ?? null);
        const metaMatchIds = extractMatchedPedidoIds(cambio.change_meta);
        metaMatchIds.forEach((id) => pedidoIds.add(id));

        if (flags.isNuevoPedido) return;
        if (match?.headerMatched && match.pedidoId) {
          pedidoIds.add(match.pedidoId);
          return;
        }

        if (metaMatchIds.length > 0) {
          return;
        }

        if (!cambio.revisado) {
          missingMatch = true;
        }
      });

      return {
        pedidoIdList: Array.from(pedidoIds),
        missingMatch,
      };
    },
    [lineChangeSummaryById, matchSummaries],
  );

  const resolveGroupPdfApplyState = useCallback(
    (group: GroupedCambio): GroupPdfApplyState => {
      const allReviewed = group.cambios.length > 0 && group.cambios.every((cambio) => cambio.revisado);
      const { pedidoIdList, missingMatch } = collectGroupPedidoIds(group);
      const canApplyPdf =
        Boolean(group.archivoPdfId) &&
        allReviewed &&
        !missingMatch &&
        pedidoIdList.length > 0 &&
        !matchesLoading;
      const pdfAlreadyApplied =
        Boolean(group.archivoPdfId) &&
        pedidoIdList.length > 0 &&
        pedidoIdList.every((id) => pedidoPdfMap[id] === group.archivoPdfId);

      return {
        allReviewed,
        missingMatch,
        pedidoIdList,
        canApplyPdf,
        pdfAlreadyApplied,
      };
    },
    [
      collectGroupPedidoIds,
      matchesLoading,
      pedidoPdfMap,
    ],
  );

  const changeTypeSummary = useMemo(() => {
    const summary = {
      total: filteredCambios.length,
      transportista: 0,
      matricula: 0,
      lineas: 0,
      nuevos: 0,
      anulaciones: 0,
      mixtos: 0,
    };

    filteredCambios.forEach((cambio) => {
      const lineSummary = lineChangeSummaryById[cambio.id] ?? null;
      const matchSummary = matchSummaries[cambio.id] ?? null;
      const flags = resolveCambioFlags(cambio, lineSummary, matchSummary);

      if (flags.isNuevoPedido) summary.nuevos += 1;
      if (flags.isCancelacion) summary.anulaciones += 1;
      if (flags.hasTransportistaChange) summary.transportista += 1;
      if (flags.hasMatriculaChange) summary.matricula += 1;
      if (flags.hasLineMeta && !flags.isNuevoPedido && !flags.isCancelacion) summary.lineas += 1;

      const typeCount = [
        flags.hasTransportistaChange,
        flags.hasMatriculaChange,
        flags.hasLineMeta && !flags.isNuevoPedido && !flags.isCancelacion,
      ].filter(Boolean).length;
      if (typeCount >= 2) summary.mixtos += 1;
    });

    return summary;
  }, [filteredCambios, lineChangeSummaryById, matchSummaries]);

  const changeStatusSummary = useMemo(() => {
    let reviewed = 0;
    filteredCambios.forEach((cambio) => {
      if (cambio.revisado) reviewed += 1;
    });
    const pending = Math.max(filteredCambios.length - reviewed, 0);
    return { reviewed, pending };
  }, [filteredCambios]);

  const activeFiltersCount = useMemo(() => {
    const baseCount = [
      filters.referencia,
      filters.fechaPedidoDesde,
      filters.fechaPedidoHasta,
      filters.clienteId,
      filters.domicilioDestinoId,
      filters.tipoPedido,
      filters.revisado,
      filters.changeType,
    ].filter((v) => (typeof v === 'number' ? true : Boolean(v && String(v).trim() !== ''))).length;
    return baseCount + (filters.version === 'old' ? 1 : 0) + (filters.order === 'asc' ? 1 : 0);
  }, [filters]);

  const updateFilters = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'clienteId') {
        next.domicilioDestinoId = undefined;
      }
      return next;
    });
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilters({
      referencia: '',
      fechaPedidoDesde: '',
      fechaPedidoHasta: '',
      clienteId: undefined,
      domicilioDestinoId: undefined,
      tipoPedido: '',
      version: 'new',
      revisado: '',
      changeType: '',
      order: 'desc',
    });
    setCurrentPage(1);
  };


  const handleConfirmDelete = async () => {
    if (!cambioToDelete) return;
    await deleteCambio(cambioToDelete.id);
    setDeleteDialogOpen(false);
    setCambioToDelete(null);
  };

  const handleConfirmDeletePdf = async () => {
    if (!pdfToDelete) return;
    try {
      setDeletingPdfId(pdfToDelete.id);
      await deleteCambioPdf(pdfToDelete.id);
      setDeletePdfDialogOpen(false);
      setPdfToDelete(null);
    } finally {
      setDeletingPdfId(null);
    }
  };

  const applyPdfToPedidos = useCallback(
    async (
      archivoPdfId: number,
      pedidoIds: number[],
      options?: { label?: string | null; auto?: boolean },
    ) => {
      const uniquePedidoIds = Array.from(new Set(pedidoIds)).filter((id) => Number.isFinite(id));
      if (uniquePedidoIds.length === 0) {
        if (!options?.auto) {
          toast({
            title: 'Sin pedidos asociados',
            description: 'No se encontraron pedidos emparejados para aplicar este PDF.',
            variant: 'destructive',
          });
        }
        return false;
      }

      try {
        setApplyingPdfId(archivoPdfId);
        const { error } = await supabase
          .from('pedidos')
          .update({ archivo_pdf_id: archivoPdfId })
          .in('id', uniquePedidoIds);
        if (error) throw error;

        const countLabel =
          uniquePedidoIds.length === 1 ? '1 pedido/previsión' : `${uniquePedidoIds.length} pedidos/previsiones`;
        const contextLabel = options?.label?.trim();
        toast({
          title: options?.auto ? 'PDF aplicado automáticamente' : 'PDF aplicado',
          description: `${options?.auto ? 'Se aplicó automáticamente' : 'Se actualizó'} el PDF en ${countLabel}${
            contextLabel ? ` (${contextLabel})` : ''
          }.`,
        });
        setPedidoPdfMap((prev) => {
          const next = { ...prev };
          uniquePedidoIds.forEach((id) => {
            next[id] = archivoPdfId;
          });
          return next;
        });
        return true;
      } catch (error: any) {
        console.error('Error aplicando PDF de cambios', error);
        toast({
          title: options?.auto ? 'No se pudo aplicar el PDF automáticamente' : 'No se pudo aplicar el PDF',
          description: error?.message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
        return false;
      } finally {
        setApplyingPdfId(null);
      }
    },
    [supabase, toast],
  );

  const openApplyPdfDialog = (archivoPdfId: number, pedidoIds: number[], label?: string | null) => {
    const uniquePedidoIds = Array.from(new Set(pedidoIds)).filter((id) => Number.isFinite(id));
    if (uniquePedidoIds.length === 0) {
      toast({
        title: 'Sin pedidos asociados',
        description: 'No se encontraron pedidos emparejados para aplicar este PDF.',
        variant: 'destructive',
      });
      return;
    }

    setApplyPdfTarget({
      archivoPdfId,
      pedidoIds: uniquePedidoIds,
      label: label?.trim() || null,
    });
    setApplyPdfDialogOpen(true);
  };

  const handleConfirmApplyPdf = useCallback(async () => {
    if (!applyPdfTarget) return;

    try {
      await applyPdfToPedidos(applyPdfTarget.archivoPdfId, applyPdfTarget.pedidoIds, {
        label: applyPdfTarget.label || null,
      });
    } finally {
      setApplyPdfDialogOpen(false);
      setApplyPdfTarget(null);
    }
  }, [applyPdfTarget, applyPdfToPedidos]);

  const queueAutoApplyForCambio = useCallback((cambio: Pick<CambioPedido, 'id' | 'archivo_pdf_id'>) => {
    if (!ENABLE_AUTO_PDF_APPLY_FROM_CAMBIOS) return;
    if (!cambio.archivo_pdf_id) return;
    setAutoApplyQueue((prev) => {
      if (
        prev.some(
          (item) =>
            item.archivoPdfId === cambio.archivo_pdf_id &&
            item.sourceCambioId === cambio.id,
        )
      ) {
        return prev;
      }
      return [
        ...prev,
        {
          archivoPdfId: cambio.archivo_pdf_id,
          sourceCambioId: cambio.id,
        },
      ];
    });
  }, []);

  useEffect(() => {
    if (!ENABLE_AUTO_PDF_APPLY_FROM_CAMBIOS) return;
    if (autoApplyQueue.length === 0) return;
    if (loading || matchesLoading) return;
    if (applyingPdfId !== null) return;

    const currentItem = autoApplyQueue[0];
    if (!currentItem) return;

    const targetGroup =
      groupedCambios.find(
        (group) =>
          group.archivoPdfId === currentItem.archivoPdfId &&
          group.cambios.some((cambio) => cambio.id === currentItem.sourceCambioId),
      ) ?? groupedCambios.find((group) => group.archivoPdfId === currentItem.archivoPdfId);

    if (!targetGroup || !targetGroup.archivoPdfId) {
      setAutoApplyQueue((prev) => prev.slice(1));
      return;
    }

    const applyState = resolveGroupPdfApplyState(targetGroup);
    if (!applyState.canApplyPdf || applyState.pdfAlreadyApplied) {
      setAutoApplyQueue((prev) => prev.slice(1));
      return;
    }

    const recency = getGroupRecency(targetGroup);
    const executionKey = `${targetGroup.archivoPdfId}:${recency.timestamp}:${recency.maxCambioId}`;
    if (autoApplyExecutedRef.current[executionKey]) {
      setAutoApplyQueue((prev) => prev.slice(1));
      return;
    }
    autoApplyExecutedRef.current[executionKey] = true;
    setAutoApplyQueue((prev) => prev.slice(1));

    void applyPdfToPedidos(targetGroup.archivoPdfId, applyState.pedidoIdList, {
      label: targetGroup.domicilioNombre || targetGroup.clienteNombre || null,
      auto: true,
    }).then((applied) => {
      if (!applied) {
        delete autoApplyExecutedRef.current[executionKey];
      }
    });
  }, [
    autoApplyQueue,
    applyPdfToPedidos,
    applyingPdfId,
    groupedCambios,
    loading,
    matchesLoading,
    resolveGroupPdfApplyState,
  ]);

  useEffect(() => {
    if (!ENABLE_AUTO_PDF_APPLY_FROM_CAMBIOS) {
      reviewedDialogAutoQueueRef.current = null;
      return;
    }
    if (!cambioDialogOpen || !cambioDialogCambio) {
      reviewedDialogAutoQueueRef.current = null;
      return;
    }
    if (!cambioDialogCambio.revisado || !cambioDialogCambio.archivo_pdf_id) return;
    if (loading || matchesLoading) return;
    if (applyingPdfId !== null) return;

    const dialogKey = `${cambioDialogCambio.id}:${cambioDialogCambio.archivo_pdf_id}`;
    if (reviewedDialogAutoQueueRef.current === dialogKey) return;

    const targetGroup =
      groupedCambios.find(
        (group) =>
          group.archivoPdfId === cambioDialogCambio.archivo_pdf_id &&
          group.cambios.some((cambio) => cambio.id === cambioDialogCambio.id),
      ) ?? groupedCambios.find((group) => group.archivoPdfId === cambioDialogCambio.archivo_pdf_id);

    if (!targetGroup || !targetGroup.archivoPdfId) return;

    const applyState = resolveGroupPdfApplyState(targetGroup);
    if (!applyState.canApplyPdf || applyState.pdfAlreadyApplied) return;

    reviewedDialogAutoQueueRef.current = dialogKey;
    queueAutoApplyForCambio(cambioDialogCambio);
  }, [
    applyingPdfId,
    cambioDialogCambio,
    cambioDialogOpen,
    groupedCambios,
    loading,
    matchesLoading,
    queueAutoApplyForCambio,
    resolveGroupPdfApplyState,
  ]);

  const applyTransportistaHeaderChange = useCallback(
    async (
      cambio: CambioPedido,
      matchSummary?: CambioMatchSummary,
      options?: { markNeedsSync?: boolean; hasLineChanges?: boolean },
    ) => {
      const pedidoId = matchSummary?.pedidoId;
      if (!pedidoId) {
        toast({
          title: 'Pedido no emparejado',
          description: 'No se pudo encontrar un pedido asociado a este cambio.',
          variant: 'destructive',
        });
        return false;
      }
      const headerChange = getHeaderChange(cambio.change_meta);
      const headerColumns = (headerChange?.columns ?? [])
        .map((column) => column.toLowerCase().trim())
        .filter(Boolean);
      const hasTransportistaChange =
        headerChange?.action === 'update' && headerColumns.includes('transportista');
      const matriculaFromMeta =
        headerChange?.action === 'update' &&
        headerColumns.some((column) =>
          ['matricula', 'matricula_tractora', 'matricula_remolque'].includes(column),
        );
      const hasMatriculaValuesLocal = hasMatriculaValues(cambio);
      const fallbackMatricula = !headerChange || headerColumns.length === 0;
      const hasMatriculaChange = matriculaFromMeta || (fallbackMatricula && hasMatriculaValuesLocal);
      const acreedorNuevo = hasTransportistaChange
        ? resolveAcreedorId(cambio.change_meta, cambio.acreedorid_porte)
        : null;
      if (hasTransportistaChange && !acreedorNuevo) {
        toast({
          title: 'Cambio incompleto',
          description: 'No se encontró el nuevo acreedor en los metadatos del cambio.',
          variant: 'destructive',
        });
        return false;
      }
      if (hasMatriculaChange && !hasMatriculaValuesLocal) {
        toast({
          title: 'Cambio incompleto',
          description: 'No se encontró una nueva matrícula para aplicar.',
          variant: 'destructive',
        });
        return false;
      }
      if (!hasTransportistaChange && !hasMatriculaChange) {
        toast({
          title: 'Sin cambios de cabecera',
          description: 'Este cambio no tiene transportista ni matrícula para aplicar.',
          variant: 'destructive',
        });
        return false;
      }

      try {
        setApplyingCambioId(cambio.id);
        const updatePayload: Record<string, unknown> = {};
        if (hasTransportistaChange) {
          updatePayload.acreedorid_porte = acreedorNuevo;
        }
        if (hasMatriculaChange) {
          updatePayload.matricula_tractora = cambio.matricula_tractora ?? null;
          updatePayload.matricula_remolque = cambio.matricula_remolque ?? null;
        }
        if (options?.markNeedsSync) {
          updatePayload.needs_sync = true;
        }
        const { error: pedidoError } = await supabase
          .from('pedidos')
          .update(updatePayload)
          .eq('id', pedidoId);
        if (pedidoError) throw pedidoError;

        const appliedFlags = getAppliedFlags(cambio.change_meta);
        const nextMeta = updateAppliedFlags(cambio.change_meta, { transportista: true });
        const shouldMarkReviewed = !options?.hasLineChanges || appliedFlags.lineas === true;
        const reviewUpdate = shouldMarkReviewed ? buildReviewUpdate() : null;
        const { error: cambioError } = await supabase
          .from('cambios_pedidos')
          .update({ change_meta: nextMeta, ...(reviewUpdate ?? {}) })
          .eq('id', cambio.id);
        if (cambioError) throw cambioError;

        setCambios((prev) =>
          prev.map((item) =>
            item.id === cambio.id
              ? {
                  ...item,
                  change_meta: nextMeta,
                  ...(reviewUpdate ?? {}),
                }
              : item,
          ),
        );
        if (reviewUpdate) {
          queueAutoApplyForCambio(cambio);
        }

        const headerDescription =
          hasTransportistaChange && hasMatriculaChange
            ? 'Se actualizó el transportista y la matrícula.'
            : hasTransportistaChange
              ? 'Se actualizó el transportista del pedido.'
              : 'Se actualizó la matrícula del pedido.';
        toast({
          title: 'Cambio aplicado',
          description: `${headerDescription} Pedido #${pedidoId}.`,
        });
        return true;
      } catch (error: any) {
        console.error('Error aplicando cambio de cabecera', error);
        toast({
          title: 'No se pudo aplicar el cambio',
          description: error?.message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
        return false;
      } finally {
        setApplyingCambioId(null);
      }
    },
    [queueAutoApplyForCambio, toast],
  );

  const handleAcceptCambioDialog = useCallback(async () => {
    if (!cambioDialogCambio) return;
    const shouldMarkSync = Boolean(
      resolveOrizonId(cambioDialogPedido?.idpedido_orizon, cambioDialogPedido?.pedidoclienteid),
    );
    const headerChange = getHeaderChange(cambioDialogCambio.change_meta);
    const headerColumns = (headerChange?.columns ?? [])
      .map((column) => column.toLowerCase().trim())
      .filter(Boolean);
    const hasTransportistaChange =
      headerChange?.action === 'update' && headerColumns.includes('transportista');
    const matriculaFromMeta =
      headerChange?.action === 'update' &&
      headerColumns.some((column) =>
        ['matricula', 'matricula_tractora', 'matricula_remolque'].includes(column),
      );
    const hasMatriculaValuesLocal = hasMatriculaValues(cambioDialogCambio);
    const fallbackMatricula = !headerChange || headerColumns.length === 0;
    const hasMatriculaChange = matriculaFromMeta || (fallbackMatricula && hasMatriculaValuesLocal);
    const applied = await applyTransportistaHeaderChange(
      cambioDialogCambio,
      cambioDialogMatch ?? undefined,
      { markNeedsSync: shouldMarkSync, hasLineChanges: cambioDialogHasLineChanges },
    );
    if (applied) {
      const updatedMeta = updateAppliedFlags(cambioDialogCambio.change_meta, { transportista: true });
      const shouldMarkReviewed = !cambioDialogHasLineChanges || getAppliedFlags(updatedMeta).lineas === true;
      const reviewUpdate = shouldMarkReviewed ? buildReviewUpdate() : null;
      setCambioDialogCambio((prev) =>
        prev
          ? {
              ...prev,
              change_meta: updatedMeta,
              ...(reviewUpdate ?? {}),
            }
          : prev,
      );
      const nuevoAcreedorId = hasTransportistaChange
        ? resolveAcreedorId(cambioDialogCambio.change_meta, cambioDialogCambio.acreedorid_porte)
        : null;
      setCambioDialogPedido((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          ...(shouldMarkSync ? { needs_sync: true } : {}),
        };
        if (hasTransportistaChange && nuevoAcreedorId !== null) {
          next.acreedorid_porte = nuevoAcreedorId;
        }
        if (hasMatriculaChange) {
          next.matricula_tractora = cambioDialogCambio.matricula_tractora ?? null;
          next.matricula_remolque = cambioDialogCambio.matricula_remolque ?? null;
        }
        return next;
      });
      if (hasTransportistaChange) {
        setCambioDialogAcreedorActual(cambioDialogAcreedorNuevo ?? null);
      }
      setCambioDialogDisabledReason(
        shouldMarkReviewed
          ? 'Cambio ya revisado'
          : hasTransportistaChange && hasMatriculaChange
            ? 'Cabecera ya aplicada'
            : hasTransportistaChange
              ? 'Transportista ya aplicado'
              : 'Matrícula ya aplicada',
      );
    }
  }, [
    applyTransportistaHeaderChange,
    buildReviewUpdate,
    cambioDialogAcreedorNuevo,
    cambioDialogCambio,
    cambioDialogMatch,
    cambioDialogPedido,
    cambioDialogHasLineChanges,
  ]);

  const handleCreateNuevoPedidoFromCambioDialog = useCallback(() => {
    if (!cambioDialogCambio) return;
    const targetCambio = cambioDialogCambio;
    handleCloseCambioDialog(false);
    void handleOpenNuevoPedidoDialog(targetCambio);
  }, [cambioDialogCambio, handleCloseCambioDialog, handleOpenNuevoPedidoDialog]);

  const handleCreateNuevoPedido = useCallback(async () => {
    if (!nuevoPedidoCambio) return;

    if (nuevoPedidoCambio.revisado) {
      toast({
        title: 'Cambio ya revisado',
        description: 'Este cambio ya fue aplicado.',
        variant: 'destructive',
      });
      return;
    }

    const fechaPedido = nuevoPedidoCambio.fecha_pedido ?? null;
    const fechaCarga = nuevoPedidoCambio.fecha_carga ?? fechaPedido ?? null;
    const clienteEnvio = nuevoPedidoCambio.clienteid_envio ?? nuevoPedidoCambio.clienteid ?? null;
    const domicilioEnvio =
      nuevoPedidoCambio.sujetodomicilioid_envio ?? nuevoPedidoCambio.sujetodomicilioid_destino ?? null;

    const missingHeader: string[] = [];
    if (!nuevoPedidoCambio.serieid) missingHeader.push('serieid');
    if (!nuevoPedidoCambio.tipo_pedido) missingHeader.push('tipo_pedido');
    if (!fechaPedido) missingHeader.push('fecha_pedido');
    if (nuevoPedidoCambio.tipo_pedido === 'P22E' && !fechaCarga) missingHeader.push('fecha_carga');
    if (!nuevoPedidoCambio.clienteid) missingHeader.push('clienteid');
    if (!clienteEnvio) missingHeader.push('clienteid_envio');
    if (!nuevoPedidoCambio.divisa_cliente) missingHeader.push('divisa_cliente');
    if (!nuevoPedidoCambio.comercialid) missingHeader.push('comercialid');
    if (!nuevoPedidoCambio.sujetodomicilioid_destino) missingHeader.push('sujetodomicilioid_destino');
    if (!domicilioEnvio) missingHeader.push('sujetodomicilioid_envio');

    if (missingHeader.length > 0) {
      toast({
        title: 'Faltan datos en la cabecera',
        description: `Completa: ${missingHeader.join(', ')}.`,
        variant: 'destructive',
      });
      return;
    }

    if (!nuevoPedidoCambio.archivo_pdf_id) {
      toast({
        title: 'Sin PDF asociado',
        description: 'Este cambio no tiene PDF para vincular.',
        variant: 'destructive',
      });
      return;
    }

    if (nuevoPedidoLineas.length === 0) {
      toast({
        title: 'Sin líneas',
        description: 'Añade al menos una línea para crear el pedido.',
        variant: 'destructive',
      });
      return;
    }

    const invalidCentro = nuevoPedidoLineas
      .map((linea) => ({
        linea,
        centro: (nuevoPedidoCentros[linea.tempId] ?? []).find(
          (centro) =>
            !centro.asignacion?.trim() ||
            centro.subprov === null ||
            centro.subprov === undefined ||
            centro.numero_palets === null ||
            centro.numero_palets === undefined,
        ),
      }))
      .find((item) => item.centro);

    if (invalidCentro) {
      toast({
        title: 'Centros incompletos',
        description: 'Completa asignación, subprov y palets en todos los centros antes de crear el pedido.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setNuevoPedidoCreating(true);
      const pdfBase64 = await agroirisPdfFiles.getPdfContent(nuevoPedidoCambio.archivo_pdf_id);
      if (!pdfBase64) {
        throw new Error('No se pudo obtener el PDF del cambio.');
      }

      const payloadLineas = nuevoPedidoLineas.map((linea) => {
        const centros = (nuevoPedidoCentros[linea.tempId] ?? [])
          .filter(
            (centro) =>
              centro.asignacion?.trim() &&
              centro.subprov !== null &&
              centro.subprov !== undefined &&
              centro.numero_palets !== null &&
              centro.numero_palets !== undefined,
          )
          .map((centro) => ({
            asignacion: centro.asignacion || null,
            numero_palets: centro.numero_palets,
            subprov: centro.subprov,
          }));
        return {
          confeccionpaletid: linea.confeccionpaletid ?? 0,
          catalogoconfecid: linea.catalogoconfecid,
          confeccionsalidaid: linea.confeccionsalidaid,
          grupoconfeccionid: linea.grupoconfeccionid,
          generoid: linea.generoid,
          tipocultivoid: linea.tipocultivoid,
          origenid: linea.origenid,
          calibreid: linea.calibreid,
          bultos: linea.bultos,
          descripcion_salida: linea.descripcion_salida,
          bultosxpalet: linea.bultosxpalet,
          numero_palet: linea.numero_palet,
          piezasxbulto: linea.piezasxbulto,
          total_piezas: linea.total_piezas,
          catconfecpiezaid: linea.catconfecpiezaid,
          kilosxbulto: linea.kilosxbulto,
          kilos_cliente: linea.kilos_cliente,
          catconfeckilosbultoid: linea.catconfeckilosbultoid,
          ean_pieza: linea.ean_pieza ?? linea.ean_bulto ?? linea.ean ?? '',
          ean_bulto: linea.ean_pieza ?? linea.ean_bulto ?? linea.ean ?? '',
          ean_caja: linea.ean_caja ?? '',
          nlote_cliente:
            typeof linea.nlote_cliente === 'string' && linea.nlote_cliente.trim()
              ? linea.nlote_cliente.trim()
              : null,
          precio_venta: linea.precio_venta ?? null,
          listPedidoCentro: centros,
        };
      });

      const payload = {
        serieid: nuevoPedidoCambio.serieid,
        tipo_pedido: nuevoPedidoCambio.tipo_pedido,
        fecha_pedido: fechaPedido,
        fecha_carga: fechaCarga,
        referencia_cliente: nuevoPedidoCambio.referencia_cliente ?? '',
        referencia2_cliente: nuevoPedidoCambio.referencia2_cliente ?? '',
        clienteid: nuevoPedidoCambio.clienteid,
        clienteid_envio: clienteEnvio,
        divisa_cliente: nuevoPedidoCambio.divisa_cliente,
        comercialid: nuevoPedidoCambio.comercialid,
        sujetodomicilioid_destino: nuevoPedidoCambio.sujetodomicilioid_destino,
        sujetodomicilioid_envio: domicilioEnvio,
        acreedorid_porte: nuevoPedidoCambio.acreedorid_porte ?? 0,
        matricula_tractora: nuevoPedidoCambio.matricula_tractora ?? '',
        matricula_remolque: nuevoPedidoCambio.matricula_remolque ?? '',
        B64_Pedido: pdfBase64,
        listLineaPed: payloadLineas,
      };

      const { data, error } = await supabase.functions.invoke('create-pedidos', {
        body: [payload],
      });
      if (error) throw error;

      if (data?.success === false) {
        const errorMsg = data?.errors?.[0]?.error ?? 'No se pudo crear el pedido.';
        throw new Error(errorMsg);
      }

      const nuevoPedidoId = data?.results?.[0]?.pedido_id ?? null;

      const reviewUpdate = buildReviewUpdate();
      const { error: cambioError } = await supabase
        .from('cambios_pedidos')
        .update(reviewUpdate)
        .eq('id', nuevoPedidoCambio.id);
      if (cambioError) throw cambioError;

      setCambios((prev) =>
        prev.map((item) =>
          item.id === nuevoPedidoCambio.id ? { ...item, ...reviewUpdate } : item,
        ),
      );
      queueAutoApplyForCambio(nuevoPedidoCambio);
      if (nuevoPedidoId) {
        setMatchSummaries((prev) => ({
          ...prev,
          [nuevoPedidoCambio.id]: {
            headerMatched: true,
            pedidoId: nuevoPedidoId,
            pedidoReferencia: nuevoPedidoCambio.referencia_cliente ?? null,
          },
        }));
      }
      setNuevoPedidoCambio((prev) => (prev ? { ...prev, ...reviewUpdate } : prev));

      toast({
        title: 'Pedido creado',
        description: nuevoPedidoId
          ? `Se creó el pedido #${nuevoPedidoId}.`
          : 'Se creó el pedido.',
      });
      if (nuevoPedidoId) {
        setNuevoPedidoOrizonPrompt({
          pedidoId: nuevoPedidoId,
          referencia: nuevoPedidoCambio.referencia_cliente ?? null,
          tipoPedido: (nuevoPedidoCambio.tipo_pedido ?? 'P220') as TipoPedido,
        });
        setNuevoPedidoOrizonDialogOpen(true);
      }
      handleCloseNuevoPedidoDialog(false);
    } catch (error: any) {
      console.error('Error creando nuevo pedido desde cambio', error);
      toast({
        title: 'No se pudo crear el pedido',
        description: error?.message ?? 'Inténtalo nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setNuevoPedidoCreating(false);
    }
  }, [
    buildReviewUpdate,
    handleCloseNuevoPedidoDialog,
    nuevoPedidoCambio,
    nuevoPedidoCentros,
    nuevoPedidoLineas,
    queueAutoApplyForCambio,
    supabase,
    toast,
  ]);

  const handleSendNuevoPedidoToOrizon = useCallback(async () => {
    if (!nuevoPedidoOrizonPrompt?.pedidoId) return;
    setNuevoPedidoOrizonSending(true);
    try {
      const { data: pedidoFull, error } = await supabase
        .from('pedidos')
        .select('*')
        .eq('id', nuevoPedidoOrizonPrompt.pedidoId)
        .single();
      if (error) throw error;
      if (!pedidoFull) throw new Error('No se pudo cargar el pedido para enviar.');

      const result = await sendPedidoToOrizon({
        pedido: pedidoFull,
        tipoPedido: nuevoPedidoOrizonPrompt.tipoPedido,
        sentBy: user?.id ?? null,
      });

      if (result.updateError) {
        console.error('Error actualizando campos Orizon en Supabase:', result.updateError);
        toast({
          title: 'Pedido enviado, pero no se pudo actualizar Supabase',
          description: result.updateError.message,
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: result.isUpdate ? 'Pedido actualizado' : 'Pedido enviado',
      });
      setNuevoPedidoOrizonDialogOpen(false);
      setNuevoPedidoOrizonPrompt(null);
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
        title: 'Error al enviar a Orizon',
        description: errorDescription,
        variant: 'destructive',
      });
    } finally {
      setNuevoPedidoOrizonSending(false);
    }
  }, [nuevoPedidoOrizonPrompt, supabase, toast, user?.id]);

  const handleCambioAcreedorNuevoChange = useCallback(
    async (acreedorId: number | null) => {
      if (!cambioDialogCambio) return;
      if (!cambioDialogHasTransportistaChange) return;
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
        setCambios((prev) =>
          prev.map((item) =>
            item.id === cambioDialogCambio.id
              ? { ...item, acreedorid_porte: acreedorId ?? null, change_meta: updatedMeta }
              : item,
          ),
        );

        if (cambioDialogCambio.revisado) {
          setCambioDialogDisabledReason('Cambio ya revisado');
        } else {
          const hasMatriculaValues = Boolean(
            (cambioDialogCambio.matricula_tractora ?? '').trim() ||
              (cambioDialogCambio.matricula_remolque ?? '').trim(),
          );
          const missing: string[] = [];
          if (cambioDialogHasTransportistaChange && acreedorId == null) missing.push('transportista');
          if (cambioDialogHasMatriculaChange && !hasMatriculaValues) missing.push('matrícula');
          setCambioDialogDisabledReason(missing.length > 0 ? `Sin nuevo ${missing.join(' y ')}` : null);
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
      cambioDialogHasTransportistaChange,
      cambioDialogHasMatriculaChange,
      supabase,
      toast,
    ],
  );

  const handleCambioMatriculaDraftChange = useCallback(
    (field: 'matricula_tractora' | 'matricula_remolque', value: string) => {
      if (!cambioDialogCambio) return;
      const nextValue = normalizeMatricula(value);
      setCambioDialogCambio((prev) =>
        prev ? { ...prev, [field]: nextValue } : prev,
      );
      setCambios((prev) =>
        prev.map((item) =>
          item.id === cambioDialogCambio.id ? { ...item, [field]: nextValue } : item,
        ),
      );

      if (cambioDialogCambio.revisado) {
        setCambioDialogDisabledReason('Cambio ya revisado');
        return;
      }

      const currentTractora =
        field === 'matricula_tractora' ? nextValue : cambioDialogCambio.matricula_tractora ?? '';
      const currentRemolque =
        field === 'matricula_remolque' ? nextValue : cambioDialogCambio.matricula_remolque ?? '';
      const hasMatriculaValuesLocal = Boolean(currentTractora.trim() || currentRemolque.trim());
      const missing: string[] = [];
      if (cambioDialogHasTransportistaChange && (cambioDialogAcreedorNuevo?.id ?? null) == null) {
        missing.push('transportista');
      }
      if (cambioDialogHasMatriculaChange && !hasMatriculaValuesLocal) {
        missing.push('matrícula');
      }
      setCambioDialogDisabledReason(missing.length > 0 ? `Sin nuevo ${missing.join(' y ')}` : null);
    },
    [
      cambioDialogCambio,
      cambioDialogAcreedorNuevo,
      cambioDialogHasMatriculaChange,
      cambioDialogHasTransportistaChange,
      setCambios,
    ],
  );

  const handleSaveCambioMatricula = useCallback(
    async (field: 'matricula_tractora' | 'matricula_remolque', value: string) => {
      if (!cambioDialogCambio) return;
      const nextValue = normalizeMatriculaForSave(value);
      const updatePayload = {
        matricula_tractora:
          field === 'matricula_tractora'
            ? nextValue
            : normalizeMatriculaForSave(cambioDialogCambio.matricula_tractora),
        matricula_remolque:
          field === 'matricula_remolque'
            ? nextValue
            : normalizeMatriculaForSave(cambioDialogCambio.matricula_remolque),
      };
      try {
        const { error } = await supabase
          .from('cambios_pedidos')
          .update(updatePayload)
          .eq('id', cambioDialogCambio.id);
        if (error) throw error;

        setCambioDialogCambio((prev) =>
          prev ? { ...prev, ...updatePayload } : prev,
        );
        setCambios((prev) =>
          prev.map((item) =>
            item.id === cambioDialogCambio.id ? { ...item, ...updatePayload } : item,
          ),
        );
      } catch (error: any) {
        console.error('Error actualizando matricula del cambio', error);
        toast({
          title: 'No se pudo actualizar la matricula',
          description: error?.message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
      }
    },
    [cambioDialogCambio, supabase, toast],
  );

  const handleCambioLineaMatchChange = useCallback(
    (cambioLineaId: number, pedidoLineaId: number | null) => {
      setCambioDialogLineasMatch((prev) => ({
        ...prev,
        [cambioLineaId]: pedidoLineaId,
      }));
    },
    [],
  );

  const handleCambioLineaDraftChange = useCallback(
    (
      cambioLineaId: number,
      field: keyof LineaCambioDraft,
      value: number | string | null,
    ) => {
      setCambioDialogLineasDrafts((prev) => ({
        ...prev,
        [cambioLineaId]: {
          ...(prev[cambioLineaId] ?? {}),
          [field]: value,
        },
      }));
    },
    [],
  );

  const handleRequestCancelPedido = useCallback(() => {
    if (!cambioDialogCanCancelPedido) return;
    setCancelPedidoDialogOpen(true);
  }, [cambioDialogCanCancelPedido]);

  const handleConfirmCancelPedido = useCallback(async () => {
    if (!cambioDialogCambio || !cambioDialogPedido?.id) return;
    const pedidoId = cambioDialogPedido.id;
    const orizonId = resolveOrizonId(
      cambioDialogPedido.idpedido_orizon,
      cambioDialogPedido.pedidoclienteid,
    );

    setCancelPedidoLoading(true);
    try {
      const { data: lineas, error: lineasError } = await supabase
        .from('pedido_linea')
        .select('pedidodetid, idpedidodet_orizon')
        .eq('pedidoid', pedidoId);
      if (lineasError) throw lineasError;

      const lineaIds = (lineas ?? [])
        .map((linea) => linea.pedidodetid)
        .filter((id): id is number => typeof id === 'number');
      const lineasOrizonIds = Array.from(
        new Set(
          (lineas ?? [])
            .map((linea) => resolveOrizonId(linea.idpedidodet_orizon))
            .filter((id): id is number => id !== null),
        ),
      );

      if (orizonId) {
        try {
          await deleteOrizonResource(`/pedidocliente/${orizonId}`, `Pedido ${orizonId}`);
        } catch (error: any) {
          console.error('Error eliminando pedido en Orizon:', error);
          toast({
            title: 'No se pudo eliminar en Orizon',
            description: error?.message ?? 'Se eliminó localmente, revisa Orizon manualmente.',
            variant: 'destructive',
          });
        }
      }

      for (const lineId of lineasOrizonIds) {
        try {
          await deleteOrizonResource(`/pedidodet/${lineId}`, `Línea ${lineId}`);
        } catch (error) {
          console.error(`Error eliminando línea ${lineId} en Orizon:`, error);
        }
      }

      if (lineaIds.length > 0) {
        const { error: centrosError } = await supabase
          .from('pedido_linea_centro')
          .delete()
          .in('pedidodetid', lineaIds);
        if (centrosError) throw centrosError;
      }

      const { error: deleteLineasError } = await supabase
        .from('pedido_linea')
        .delete()
        .eq('pedidoid', pedidoId);
      if (deleteLineasError) throw deleteLineasError;

      const { error: deletePedidoError } = await supabase
        .from('pedidos')
        .delete()
        .eq('id', pedidoId);
      if (deletePedidoError) throw deletePedidoError;

      const nextMeta = updateAppliedFlags(cambioDialogCambio.change_meta, { lineas: true });
      const { reviewUpdate, metaPersisted } = await markCambioReviewedWithFallback(
        cambioDialogCambio.id,
        nextMeta,
      );

      setCambios((prev) =>
        prev.map((item) =>
          item.id === cambioDialogCambio.id
            ? {
                ...item,
                ...(metaPersisted ? { change_meta: nextMeta } : {}),
                ...reviewUpdate,
              }
            : item,
        ),
      );
      queueAutoApplyForCambio(cambioDialogCambio);
      setCambioDialogCambio((prev) =>
        prev
          ? {
              ...prev,
              ...(metaPersisted ? { change_meta: nextMeta } : {}),
              ...reviewUpdate,
            }
          : prev,
      );

      toast({
        title: 'Pedido eliminado',
        description: `Se eliminó el ${cambioDialogCancelTargetLabel} y el cambio quedó revisado.`,
      });

      handleCloseCambioDialog(false);
    } catch (error: any) {
      console.error('Error eliminando pedido del cambio', error);
      toast({
        title: 'No se pudo eliminar el pedido',
        description: error?.message ?? 'Inténtalo nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setCancelPedidoLoading(false);
      setCancelPedidoDialogOpen(false);
    }
  }, [
    cambioDialogCambio,
    cambioDialogPedido,
    cambioDialogCancelTargetLabel,
    handleCloseCambioDialog,
    markCambioReviewedWithFallback,
    queueAutoApplyForCambio,
    supabase,
    toast,
  ]);

  const handleApplyLineasDialog = useCallback(async () => {
    if (!cambioDialogCambio) return;
    if (!cambioDialogHasLineChanges) return;
    if (!cambioDialogPedido?.id) return;
    if (cambioDialogCambio.revisado) return;
    if (cambioDialogLineasApplyDisabledReason) {
      toast({
        title: 'Completa el emparejamiento',
        description: cambioDialogLineasApplyDisabledReason,
        variant: 'destructive',
      });
      return;
    }

    const headerChange = getHeaderChange(cambioDialogCambio.change_meta);
    const headerColumns = (headerChange?.columns ?? [])
      .map((column) => column.toLowerCase().trim())
      .filter(Boolean);
    const hasTransportistaChange =
      headerChange?.action === 'update' && headerColumns.includes('transportista');
    const matriculaFromMeta =
      headerChange?.action === 'update' &&
      headerColumns.some((column) =>
        ['matricula', 'matricula_tractora', 'matricula_remolque'].includes(column),
      );
    const hasMatriculaValuesLocal = hasMatriculaValues(cambioDialogCambio);
    const fallbackMatricula = !headerChange || headerColumns.length === 0;
    const hasMatriculaChange = matriculaFromMeta || (fallbackMatricula && hasMatriculaValuesLocal);
    const hasHeaderChange = hasTransportistaChange || hasMatriculaChange;

    try {
      setApplyingLineasId(cambioDialogCambio.id);
      const updates: Array<{ pedidodetid: number; update: Partial<PedidoLinea> }> = [];
      const inserts: Array<{ cambioLineaId: number; payload: Database['public']['Tables']['pedido_linea']['Insert'] }> =
        [];
      const deletes: Array<{ pedidodetid: number; idpedidodet_orizon: number | null }> = [];
      const insertLineIds: number[] = [];
      const lineasOriginalesById = new Map(
        cambioDialogLineasOriginales.map((linea) => [linea.pedidodetid, linea]),
      );
      const originalOrizonLineIds = Array.from(
        new Set(
          cambioDialogLineasOriginales
            .map((linea) => resolveOrizonId((linea as any).idpedidodet_orizon))
            .filter((id): id is number => id !== null),
        ),
      );

      cambioDialogLineas.forEach((linea) => {
        const action = getEffectiveLineaAction(linea, cambioDialogLineasDrafts[linea.pedidodetid]);

        if (action === 'add') {
          const draft = cambioDialogLineasDrafts[linea.pedidodetid];
          if (!draft) {
            throw new Error('No se encontraron los valores del cambio.');
          }
          if (draft.bultos == null || draft.bultosxpalet == null || draft.numero_palet == null) {
            throw new Error('Completa bultos, bultos x palet y número de palet.');
          }

          const requiredFields = [
            linea.generoid,
            linea.tipocultivoid,
            linea.origenid,
            linea.calibreid,
            linea.catalogoconfecid,
            linea.grupoconfeccionid,
            linea.confeccionsalidaid,
          ].map((value) => parseNumericValue(value));
          if (requiredFields.some((value) => value == null)) {
            throw new Error('Faltan datos de configuración para añadir la nueva línea.');
          }
          const payload: Database['public']['Tables']['pedido_linea']['Insert'] = {
            pedidoid: cambioDialogPedido.id,
            generoid: parseNumericValue(linea.generoid) ?? 0,
            tipocultivoid: parseNumericValue(linea.tipocultivoid) ?? 0,
            origenid: parseNumericValue(linea.origenid) ?? 0,
            calibreid: parseNumericValue(linea.calibreid) ?? 0,
            catalogoconfecid: parseNumericValue(linea.catalogoconfecid) ?? 0,
            grupoconfeccionid: parseNumericValue(linea.grupoconfeccionid) ?? 0,
            confeccionpaletid: parseNumericValue(linea.confeccionpaletid) ?? 0,
            confeccionsalidaid: parseNumericValue(linea.confeccionsalidaid) ?? 0,
            descripcion_salida: linea.descripcion_salida ?? '',
            bultos: draft.bultos ?? 0,
            bultosxpalet: draft.bultosxpalet ?? 0,
            numero_palet: draft.numero_palet ?? 0,
            piezasxbulto: draft.piezasxbulto ?? null,
            total_piezas: draft.total_piezas ?? null,
            kilosxbulto: draft.kilosxbulto ?? null,
            kilos_cliente: draft.kilos_cliente ?? null,
            catconfeckilosbultoid: draft.catconfeckilosbultoid ?? null,
            catconfecpiezaid: draft.catconfecpiezaid ?? null,
            nlote_cliente: parseTextValue(draft.nlote_cliente),
            ean: parseTextValue(draft.ean_pieza ?? draft.ean_bulto ?? getLineaEanPieza(linea)),
            ean_caja: parseTextValue(draft.ean_caja ?? getLineaEanCaja(linea)),
            precio_venta: draft.precio_venta ?? parseNumericValue(linea.precio_venta),
          };
          inserts.push({ cambioLineaId: linea.pedidodetid, payload });
          insertLineIds.push(linea.pedidodetid);
          return;
        }

        const matchId = cambioDialogLineasMatch[linea.pedidodetid] ?? null;
        if (!matchId) {
          throw new Error('Hay líneas sin emparejar.');
        }

        if (action === 'cancel') {
          const lineaOriginal = lineasOriginalesById.get(matchId);
          const lineOrizonId = resolveOrizonId(
            (lineaOriginal as any)?.idpedidodet_orizon,
            linea.idpedidodet_orizon,
          );
          deletes.push({
            pedidodetid: matchId,
            idpedidodet_orizon: lineOrizonId,
          });
          return;
        }

        const draft = cambioDialogLineasDrafts[linea.pedidodetid];
        if (!draft) {
          throw new Error('No se encontraron los valores del cambio.');
        }
        if (draft.bultos == null || draft.bultosxpalet == null || draft.numero_palet == null) {
          throw new Error('Completa bultos, bultos x palet y número de palet.');
        }

        updates.push({
          pedidodetid: matchId,
          update: {
            bultos: draft.bultos,
            bultosxpalet: draft.bultosxpalet,
            numero_palet: draft.numero_palet,
            piezasxbulto: draft.piezasxbulto,
            total_piezas: draft.total_piezas,
            kilosxbulto: draft.kilosxbulto,
            kilos_cliente: draft.kilos_cliente,
            catconfeckilosbultoid: draft.catconfeckilosbultoid,
            catconfecpiezaid: draft.catconfecpiezaid,
            ean: parseTextValue(draft.ean_pieza ?? draft.ean_bulto),
            ean_caja: parseTextValue(draft.ean_caja),
            nlote_cliente: parseTextValue(draft.nlote_cliente),
            precio_venta: draft.precio_venta ?? null,
          },
        });
      });

      for (const entry of updates) {
        const { error } = await supabase
          .from('pedido_linea')
          .update(entry.update)
          .eq('pedidodetid', entry.pedidodetid);
        if (error) throw error;
      }

      const deleteLineIds = Array.from(
        new Set(deletes.map((entry) => entry.pedidodetid)),
      );
      if (deleteLineIds.length > 0) {
        const { error: centrosDeleteError } = await supabase
          .from('pedido_linea_centro')
          .delete()
          .in('pedidodetid', deleteLineIds);
        if (centrosDeleteError) throw centrosDeleteError;

        const { error: deleteLineasError } = await supabase
          .from('pedido_linea')
          .delete()
          .in('pedidodetid', deleteLineIds);
        if (deleteLineasError) throw deleteLineasError;
      }

      let centrosByLinea: Record<number, { asignacion: string; numero_palets: number; subprov: number }[]> = {};
      if (insertLineIds.length > 0) {
        const { data: centrosData, error: centrosError } = await supabase
          .from('cambios_pedido_linea_centro')
          .select('pedidodetid, asignacion, numero_palets, subprov')
          .in('pedidodetid', insertLineIds);
        if (centrosError) throw centrosError;
        centrosByLinea = (centrosData ?? []).reduce((acc, centro) => {
          if (!centro.pedidodetid) return acc;
          const numeroPalets = parseNumericValue(centro.numero_palets);
          const subprov = parseNumericValue(centro.subprov);
          if (numeroPalets == null || subprov == null) return acc;
          const item = {
            asignacion: centro.asignacion ?? '',
            numero_palets: numeroPalets,
            subprov,
          };
          acc[centro.pedidodetid] = acc[centro.pedidodetid] ?? [];
          acc[centro.pedidodetid].push(item);
          return acc;
        }, {} as Record<number, { asignacion: string; numero_palets: number; subprov: number }[]>);
      }

      for (const entry of inserts) {
        const { data: insertedLinea, error } = await supabase
          .from('pedido_linea')
          .insert(entry.payload)
          .select('pedidodetid')
          .single();
        if (error) throw error;
        const centros = centrosByLinea[entry.cambioLineaId] ?? [];
        if (insertedLinea?.pedidodetid && centros.length > 0) {
          const centrosInsert = centros.map((centro) => ({
            ...centro,
            pedidodetid: insertedLinea.pedidodetid,
          }));
          const { error: centrosInsertError } = await supabase
            .from('pedido_linea_centro')
            .insert(centrosInsert);
          if (centrosInsertError) throw centrosInsertError;
        }
      }

      const appliedFlags = getAppliedFlags(cambioDialogCambio.change_meta);
      const shouldMarkReviewed = !hasHeaderChange || appliedFlags.transportista === true;
      const deletedOrizonLineIds = Array.from(
        new Set(
          deletes
            .map((entry) => entry.idpedidodet_orizon)
            .filter((id): id is number => typeof id === 'number' && id > 0),
        ),
      );

      const { count: remainingLineCount, error: remainingLineCountError } = await supabase
        .from('pedido_linea')
        .select('*', { count: 'exact', head: true })
        .eq('pedidoid', cambioDialogPedido.id);
      if (remainingLineCountError) throw remainingLineCountError;
      const isFullCancel = (remainingLineCount ?? 0) === 0;

      if (isFullCancel) {
        const orizonPedidoId = resolveOrizonId(
          cambioDialogPedido.idpedido_orizon,
          cambioDialogPedido.pedidoclienteid,
        );
        if (orizonPedidoId) {
          try {
            await deleteOrizonResource(`/pedidocliente/${orizonPedidoId}`, `Pedido ${orizonPedidoId}`);
          } catch (error: any) {
            console.error('Error eliminando pedido completo en Orizon:', error);
            toast({
              title: 'No se pudo eliminar el pedido en Orizon',
              description: error?.message ?? 'Se continuará con el borrado local.',
              variant: 'destructive',
            });
          }
        }

        const lineasOrizonAEliminar = Array.from(new Set([...originalOrizonLineIds, ...deletedOrizonLineIds]));
        for (const lineId of lineasOrizonAEliminar) {
          try {
            await deleteOrizonResource(`/pedidodet/${lineId}`, `Línea ${lineId}`);
          } catch (error) {
            console.error(`Error eliminando línea ${lineId} en Orizon:`, error);
          }
        }

        const { error: deletePedidoError } = await supabase
          .from('pedidos')
          .delete()
          .eq('id', cambioDialogPedido.id);
        if (deletePedidoError) throw deletePedidoError;

        let nextMeta = updateAppliedFlags(cambioDialogCambio.change_meta, { lineas: true });
        nextMeta = setPendingOrizonLineDeletes(nextMeta, []);
        const { reviewUpdate, metaPersisted } = await markCambioReviewedWithFallback(
          cambioDialogCambio.id,
          nextMeta,
        );

        setCambios((prev) =>
          prev.map((item) =>
            item.id === cambioDialogCambio.id
              ? {
                  ...item,
                  ...(metaPersisted ? { change_meta: nextMeta } : {}),
                  ...reviewUpdate,
                }
              : item,
          ),
        );
        queueAutoApplyForCambio(cambioDialogCambio);
        setCambioDialogCambio((prev) =>
          prev
            ? {
                ...prev,
                ...(metaPersisted ? { change_meta: nextMeta } : {}),
                ...reviewUpdate,
              }
            : prev,
        );
        setCambioDialogLineasOriginales([]);
        setCambioDialogPedido(null);
        setCambioDialogDisabledReason('Cambio ya revisado');

        toast({
          title: 'Pedido eliminado',
          description: `Se eliminaron todas las líneas y se borró el ${cambioDialogCancelTargetLabel}.`,
        });
        handleCloseCambioDialog(false);
        return;
      }

      const { error: syncError } = await supabase
        .from('pedidos')
        .update({ needs_sync: true })
        .eq('id', cambioDialogPedido.id);
      if (syncError) throw syncError;

      const existingPendingDeletes = getPendingOrizonLineDeletes(cambioDialogCambio.change_meta);
      const mergedPendingDeletes = Array.from(new Set([...existingPendingDeletes, ...deletedOrizonLineIds]));
      let nextMeta = updateAppliedFlags(cambioDialogCambio.change_meta, { lineas: true });
      nextMeta = setPendingOrizonLineDeletes(nextMeta, mergedPendingDeletes);
      const reviewUpdate = shouldMarkReviewed ? buildReviewUpdate() : null;
      const { error } = await supabase
        .from('cambios_pedidos')
        .update({ change_meta: nextMeta, ...(reviewUpdate ?? {}) })
        .eq('id', cambioDialogCambio.id);
      if (error) throw error;

      setCambios((prev) =>
        prev.map((item) =>
          item.id === cambioDialogCambio.id
            ? {
                ...item,
                change_meta: nextMeta,
                ...(reviewUpdate ?? {}),
              }
            : item,
        ),
      );
      if (reviewUpdate) {
        queueAutoApplyForCambio(cambioDialogCambio);
      }

      setCambioDialogCambio((prev) =>
        prev
          ? {
              ...prev,
              change_meta: nextMeta,
              ...(reviewUpdate ?? {}),
            }
          : prev,
      );

      setCambioDialogLineasOriginales((prev) => {
        const updatesById = new Map<number, Partial<PedidoLinea>>();
        updates.forEach((entry) => {
          updatesById.set(entry.pedidodetid, entry.update);
        });
        const deletedIds = new Set(deleteLineIds);
        return prev
          .filter((linea) => !deletedIds.has(linea.pedidodetid))
          .map((linea) => {
            const update = updatesById.get(linea.pedidodetid);
            return update ? { ...linea, ...update } : linea;
          });
      });

      setCambioDialogPedido((prev) =>
        prev ? { ...prev, needs_sync: true } : prev,
      );

      if (shouldMarkReviewed) {
        setCambioDialogDisabledReason('Cambio ya revisado');
      }

      toast({
        title: 'Líneas actualizadas',
        description: shouldMarkReviewed
          ? 'El cambio completo quedó revisado.'
          : 'Se aplicaron los cambios en las líneas.',
      });
    } catch (error: any) {
      console.error('Error aplicando cambios de líneas', error);
      toast({
        title: 'No se pudieron aplicar las líneas',
        description: error?.message ?? 'Inténtalo nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setApplyingLineasId(null);
    }
  }, [
    cambioDialogCambio,
    cambioDialogHasLineChanges,
    cambioDialogPedido,
    cambioDialogLineas,
    cambioDialogLineasApplyDisabledReason,
    cambioDialogLineasDrafts,
    cambioDialogLineasMatch,
    cambioDialogLineasOriginales,
    cambioDialogCancelTargetLabel,
    handleCloseCambioDialog,
    markCambioReviewedWithFallback,
    queueAutoApplyForCambio,
    supabase,
    toast,
  ]);

  const handleUpdateOrizonFromCambio = useCallback(async () => {
    if (!cambioDialogPedido?.id) return;
    const hasOrizonId = Boolean(
      resolveOrizonId(cambioDialogPedido.idpedido_orizon, cambioDialogPedido.pedidoclienteid),
    );
    if (!hasOrizonId) {
      toast({
        title: 'Pedido sin Orizon',
        description: 'El pedido no tiene ID en Orizon para actualizar.',
        variant: 'destructive',
      });
      return;
    }

    setCambioDialogUpdatingOrizon(true);
    try {
      const pendingLineDeletes = getPendingOrizonLineDeletes(cambioDialogCambio?.change_meta);
      if (pendingLineDeletes.length > 0) {
        const failedLineDeletes: number[] = [];
        for (const lineId of pendingLineDeletes) {
          try {
            await deleteOrizonResource(`/pedidodet/${lineId}`, `Línea ${lineId}`);
          } catch (error) {
            failedLineDeletes.push(lineId);
            console.error(`Error eliminando línea ${lineId} en Orizon:`, error);
          }
        }

        if (cambioDialogCambio) {
          const nextMeta = setPendingOrizonLineDeletes(cambioDialogCambio.change_meta, failedLineDeletes);
          const { error: metaUpdateError } = await supabase
            .from('cambios_pedidos')
            .update({ change_meta: nextMeta })
            .eq('id', cambioDialogCambio.id);
          if (metaUpdateError) throw metaUpdateError;

          setCambios((prev) =>
            prev.map((item) =>
              item.id === cambioDialogCambio.id
                ? {
                    ...item,
                    change_meta: nextMeta,
                  }
                : item,
            ),
          );
          setCambioDialogCambio((prev) =>
            prev
              ? {
                  ...prev,
                  change_meta: nextMeta,
                }
              : prev,
          );
        }

        if (failedLineDeletes.length > 0) {
          throw new Error(
            failedLineDeletes.length === 1
              ? `No se pudo eliminar la línea ${failedLineDeletes[0]} en Orizon.`
              : `No se pudieron eliminar ${failedLineDeletes.length} líneas en Orizon.`,
          );
        }
      }

      const { data: pedidoFull, error } = await supabase
        .from('pedidos')
        .select('*')
        .eq('id', cambioDialogPedido.id)
        .single();
      if (error) throw error;
      if (!pedidoFull) {
        throw new Error('No se pudo cargar el pedido para actualizar.');
      }

      const tipoPedido = (cambioDialogCambio?.tipo_pedido ?? 'P220') as TipoPedido;
      const result = await sendPedidoToOrizon({ pedido: pedidoFull, tipoPedido, sentBy: user?.id ?? null });

      if (result.updateError) {
        console.error('Error actualizando campos Orizon en Supabase:', result.updateError);
        toast({
          title: 'Pedido enviado, pero no se pudo actualizar Supabase',
          description: result.updateError.message,
          variant: 'destructive',
        });
        return;
      }

      setCambioDialogPedido((prev) =>
        prev
          ? { ...prev, idpedido_orizon: result.newOrizonId, needs_sync: false, enviado: true }
          : prev,
      );

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
        title: 'Error al actualizar en Orizon',
        description: errorDescription,
        variant: 'destructive',
      });
    } finally {
      setCambioDialogUpdatingOrizon(false);
    }
  }, [cambioDialogCambio, cambioDialogPedido, toast, user?.id]);

  const handleMarkCambioReviewed = useCallback(async () => {
    if (!cambioDialogCambio) return;
    if (cambioDialogCambio.revisado) return;
    setCambioDialogMarkingReviewed(true);
    try {
      const reviewUpdate = buildReviewUpdate();
      const { error } = await supabase
        .from('cambios_pedidos')
        .update(reviewUpdate)
        .eq('id', cambioDialogCambio.id);
      if (error) throw error;

      setCambios((prev) =>
        prev.map((item) =>
          item.id === cambioDialogCambio.id ? { ...item, ...reviewUpdate } : item,
        ),
      );
      queueAutoApplyForCambio(cambioDialogCambio);
      setCambioDialogCambio((prev) => (prev ? { ...prev, ...reviewUpdate } : prev));
      setCambioDialogDisabledReason('Cambio ya revisado');

      toast({
        title: 'Cambio revisado',
        description: 'Se marcó como revisado sin aplicar acciones.',
      });
    } catch (error: any) {
      console.error('Error marcando cambio como revisado', error);
      toast({
        title: 'No se pudo marcar como revisado',
        description: error?.message ?? 'Inténtalo nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setCambioDialogMarkingReviewed(false);
    }
  }, [buildReviewUpdate, cambioDialogCambio, queueAutoApplyForCambio, supabase, toast]);

  const handleNavigateToMatch = useCallback(
    (cambio: CambioPedido) => {
      if (!cambio.clienteid) return;
      const params = new URLSearchParams();
      params.set('cliente', String(cambio.clienteid));
      if (cambio.sujetodomicilioid_destino) {
        params.set('domicilio', String(cambio.sujetodomicilioid_destino));
      }
      if (cambio.fecha_carga) {
        params.set('fecha_carga', cambio.fecha_carga);
      }
      const path = (cambio.tipo_pedido ?? 'P220') === 'P22E' ? '/previsiones' : '/pedidos';
      navigate(`${path}?${params.toString()}`);
    },
    [navigate],
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleNavigateToPedidoDetalle = useCallback(
    (cambio: CambioPedido, pedidoId?: number | null) => {
      if (!pedidoId) return;
      const params = new URLSearchParams();
      params.set('cambio', String(cambio.id));
      if (cambio.clienteid) params.set('cliente', String(cambio.clienteid));
      if (cambio.sujetodomicilioid_destino) params.set('domicilio', String(cambio.sujetodomicilioid_destino));
      if (cambio.fecha_carga) params.set('fecha_carga', cambio.fecha_carga);
      navigate({
        pathname: buildPedidoDetailPath(pedidoId, cambio.tipo_pedido === 'P22E' ? 'P22E' : 'P220'),
        search: `?${params.toString()}`,
      });
    },
    [navigate],
  );

  return (
    <div className="bg-muted/40 min-h-screen">
      <main className="container mx-auto px-3 py-8 space-y-6">
        {/* Hero */}
        <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent_55%)]" />
          <CardHeader className="relative space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold uppercase tracking-wide text-white/70">Cambios</p>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Cronología de actualizaciones</h1>
                <p className="text-sm text-white/80">
                  Recibe cambios (PDF del cambio) y revisa las líneas con diferencias antes de aplicarlas.
                </p>
              </div>
              <Badge className="bg-white/15 border-white/20 text-white flex items-center gap-2 self-start">
                <Clock className="h-3.5 w-3.5" />
                {totalCambios} resultados
              </Badge>
            </div>
          </CardHeader>
        </Card>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchCambios} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refrescar
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowFilters((prev) => !prev)}
              className={`gap-2 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary dark:border-blue-400/70 dark:text-blue-200 dark:hover:bg-blue-400/10 ${showFilters ? 'bg-primary text-primary-foreground dark:bg-blue-500 dark:text-slate-50 border-transparent' : 'bg-background'}`}
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
        </div>

        {showFilters && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-base">Filtros de búsqueda</CardTitle>
              {activeFiltersCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-2">
                  <X className="h-4 w-4" />
                  Limpiar filtros
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 items-start">
                <div className="space-y-2 lg:col-span-2">
                  <Label htmlFor="filter-referencia-cambio">Referencia</Label>
                  <Input
                    id="filter-referencia-cambio"
                    placeholder="Buscar por referencia..."
                    value={filters.referencia}
                    onChange={(e) => updateFilters('referencia', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <ClientCombobox
                    value={filters.clienteId}
                    onChange={(value) => updateFilters('clienteId', value ?? undefined)}
                    allowedClientIds={allowedClientIds}
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Domicilio destino</Label>
                  <DomicilioCombobox
                    value={filters.domicilioDestinoId ?? null}
                    onChange={(value) => updateFilters('domicilioDestinoId', value ?? undefined)}
                    clienteId={filters.clienteId ?? null}
                    placeholder="Selecciona domicilio"
                    className="h-9"
                  />
                </div>
                <div className="space-y-2 lg:col-span-2">
                  <Label htmlFor="filter-fecha-llegada-from">Fecha y hora de entrada del cambio</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      id="filter-fecha-llegada-from"
                      type="datetime-local"
                      value={filters.fechaPedidoDesde}
                      onChange={(e) => updateFilters('fechaPedidoDesde', e.target.value)}
                      className="h-9"
                      placeholder="Desde"
                    />
                    <Input
                      id="filter-fecha-llegada-to"
                      type="datetime-local"
                      value={filters.fechaPedidoHasta}
                      onChange={(e) => updateFilters('fechaPedidoHasta', e.target.value)}
                      className="h-9"
                      placeholder="Hasta"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filter-tipo-pedido">Tipo pedido</Label>
                  <select
                    id="filter-tipo-pedido"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={filters.tipoPedido}
                    onChange={(e) => updateFilters('tipoPedido', e.target.value as '' | 'P220' | 'P22E')}
                  >
                    <option value="">Todos</option>
                    <option value="P220">Pedido</option>
                    <option value="P22E">Previsión</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filter-version-cambio">Versión</Label>
                  <select
                    id="filter-version-cambio"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={filters.version}
                    onChange={(e) => updateFilters('version', e.target.value as 'new' | 'old')}
                  >
                    <option value="new">Nueva versión</option>
                    <option value="old">Antiguos</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filter-revisado-cambio">Estado</Label>
                  <select
                    id="filter-revisado-cambio"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={filters.revisado}
                    onChange={(e) => updateFilters('revisado', e.target.value as '' | 'revisado' | 'pendiente')}
                  >
                    <option value="">Todos</option>
                    <option value="revisado">Revisado</option>
                    <option value="pendiente">Pendiente</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filter-change-type">Tipo de cambio</Label>
                  <select
                    id="filter-change-type"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={filters.changeType}
                    onChange={(e) =>
                      updateFilters(
                        'changeType',
                        e.target.value as
                          | ''
                          | 'nuevo'
                          | 'anulacion'
                          | 'transportista'
                          | 'matricula'
                          | 'lineas'
                          | 'mixto'
                          | 'cabecera',
                      )
                    }
                  >
                    <option value="">Todos</option>
                    <option value="nuevo">Nuevo pedido/previsión</option>
                    <option value="anulacion">Anulación</option>
                    <option value="transportista">Transportista</option>
                    <option value="matricula">Matrícula</option>
                    <option value="lineas">Líneas</option>
                    <option value="mixto">Mixtos</option>
                    <option value="cabecera">Cabecera</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="filter-order">Orden</Label>
                  <select
                    id="filter-order"
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    value={filters.order}
                    onChange={(e) => updateFilters('order', e.target.value as 'desc' | 'asc')}
                  >
                    <option value="desc">Más recientes</option>
                    <option value="asc">Más antiguos</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Cambios
            </CardTitle>
          </CardHeader>
        <CardContent className="space-y-3">
            {!loading && paginatedGroups.length > 0 && (
              <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Resumen de cambios</p>
                    <p className="text-xs text-muted-foreground">
                      Distribución del listado actual ({changeTypeSummary.total} cambios visibles).
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="h-7 rounded-md border-border/70 bg-background/80 px-2.5 text-[11px] font-medium text-foreground"
                    >
                      Total: {changeTypeSummary.total}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="h-7 rounded-md border-emerald-300/80 bg-emerald-50/70 px-2.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                    >
                      Revisados: {changeStatusSummary.reviewed}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="h-7 rounded-md border-amber-300/80 bg-amber-50/70 px-2.5 text-[11px] font-medium text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300"
                    >
                      Pendientes: {changeStatusSummary.pending}
                    </Badge>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    {
                      key: 'transportista',
                      label: 'Transportista',
                      value: changeTypeSummary.transportista,
                      dotClass: 'bg-blue-500/70',
                    },
                    {
                      key: 'matricula',
                      label: 'Matrícula',
                      value: changeTypeSummary.matricula,
                      dotClass: 'bg-amber-500/70',
                    },
                    {
                      key: 'lineas',
                      label: 'Líneas',
                      value: changeTypeSummary.lineas,
                      dotClass: 'bg-emerald-500/70',
                    },
                    {
                      key: 'nuevos',
                      label: 'Nuevos pedidos',
                      value: changeTypeSummary.nuevos,
                      dotClass: 'bg-sky-500/70',
                    },
                    {
                      key: 'anulaciones',
                      label: 'Anulaciones',
                      value: changeTypeSummary.anulaciones,
                      dotClass: 'bg-rose-500/70',
                    },
                    {
                      key: 'mixtos',
                      label: 'Mixtos',
                      value: changeTypeSummary.mixtos,
                      dotClass: 'bg-teal-500/70',
                    },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="rounded-lg border border-border/60 bg-background px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {item.label}
                        </p>
                        <span className={`h-2 w-2 rounded-full ${item.dotClass}`} />
                      </div>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {loading && paginatedGroups.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Cargando cambios...
              </div>
            ) : paginatedGroups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                No hay cambios registrados.
              </div>
            ) : (
              <div className="relative">
                <div className={`space-y-3 transition-opacity ${pageTransitionLoading ? 'opacity-55' : ''}`}>
                  {paginatedGroups.map((group, idx) => {
                const groupKey = `${group.archivoPdfId ?? 'sin-pdf'}-${idx}`;
                const isExpanded = expandedGroups.has(groupKey);
                const hasUnresolvedMismatch = group.cambios.some((cambio) => {
                  const match = matchSummaries[cambio.id];
                  return Boolean(match && !match.headerMatched && !cambio.revisado);
                });
                const applyState = resolveGroupPdfApplyState(group);
                const { allReviewed, pedidoIdList, canApplyPdf, pdfAlreadyApplied } = applyState;
                const hasPrevision = group.cambios.some((cambio) => cambio.tipo_pedido === 'P22E');
                const hasPedido = group.cambios.some((cambio) => cambio.tipo_pedido !== 'P22E');
                const targetSingular = hasPrevision && !hasPedido ? 'previsión' : 'pedido';
                const targetPlural =
                  hasPrevision && hasPedido ? 'pedidos/previsiones' : hasPrevision ? 'previsiones' : 'pedidos';
                const applyLabel = pdfAlreadyApplied
                  ? 'PDF ya aplicado'
                  : pedidoIdList.length === 1
                    ? `Aplicar PDF a 1 ${targetSingular}`
                    : `Aplicar PDF a ${pedidoIdList.length} ${targetPlural}`;
                const groupToneClass = hasUnresolvedMismatch
                  ? 'border-rose-200/70 bg-rose-50/40 dark:bg-rose-900/10 dark:border-rose-800/60'
                  : allReviewed
                    ? 'border-emerald-200/70 bg-emerald-50/40 dark:bg-emerald-900/10 dark:border-emerald-800/60'
                    : 'border-border/60 bg-background';
                return (
                  <div
                    key={groupKey}
                    className={`rounded-xl border shadow-sm transition-colors ${groupToneClass}`}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleGroup(groupKey)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleGroup(groupKey);
                        }
                      }}
                      className="w-full cursor-pointer px-4 py-3 text-left"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                        <div className="flex flex-1 items-start gap-3 min-w-0">
                          <div className="flex-shrink-0 text-muted-foreground">
                            {isExpanded ? (
                              <ChevronDown className="h-5 w-5" />
                            ) : (
                              <ChevronRight className="h-5 w-5" />
                            )}
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 text-foreground min-w-0">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="font-semibold text-sm text-foreground truncate flex items-center gap-1">
                                {group.domicilioNombre ? (
                                  <>
                                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                                    <span className="truncate">{group.domicilioNombre}</span>
                                  </>
                                ) : (
                                  group.clienteNombre || `PDF ${group.archivoPdfId ?? 'sin archivo'}`
                                )}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {group.clienteNombre && (
                                <Badge variant="outline" className="flex items-center gap-1">
                                  <Users className="h-3 w-3" />
                                  <span className="truncate max-w-[180px] sm:max-w-[220px]">{group.clienteNombre}</span>
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
                          {group.entradaLabel && (
                            <div className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-300/80 bg-slate-100/80 px-2.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
                              <Calendar className="h-3.5 w-3.5 text-slate-500 dark:text-slate-300" />
                              <span className="uppercase tracking-wide text-[10px] text-slate-500 dark:text-slate-400">
                                Entrada del cambio
                              </span>
                              <span className="text-slate-900 dark:text-slate-100">{group.entradaLabel}</span>
                            </div>
                          )}
                          {canApplyPdf && group.archivoPdfId && (
                            <Button
                              variant="secondary"
                              size="sm"
                              className={`h-7 px-3 text-xs border border-emerald-200 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-100 ${
                                pdfAlreadyApplied ? 'bg-emerald-700 shadow-inner' : 'disabled:opacity-60'
                              }`}
                              aria-pressed={pdfAlreadyApplied}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (pdfAlreadyApplied) return;
                                openApplyPdfDialog(
                                  group.archivoPdfId!,
                                  pedidoIdList,
                                  group.domicilioNombre || group.clienteNombre || null,
                                );
                              }}
                              disabled={applyingPdfId === group.archivoPdfId || pdfAlreadyApplied}
                              title="Sustituye el PDF del pedido/previsión por el PDF del cambio"
                            >
                              {applyingPdfId === group.archivoPdfId ? (
                                <>
                                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  Aplicando...
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="mr-1 h-3 w-3" />
                                  {applyLabel}
                                </>
                              )}
                            </Button>
                          )}
                          {group.archivoPdfId && (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                                onClick={(e) => {
                                  handleOpenPdf(group.archivoPdfId!, e);
                                  e.stopPropagation();
                                }}
                                aria-label="Abrir PDF"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive/80"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPdfToDelete({ id: group.archivoPdfId!, label: group.domicilioNombre || group.clienteNombre });
                                  setDeletePdfDialogOpen(true);
                                }}
                                aria-label="Eliminar PDF"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-2">
                        {group.cambios.map((cambio) => {
                        const fecha = cambio.created_at ? new Date(cambio.created_at) : null;
                        const fechaLabel = fecha ? format(fecha, "dd MMM yyyy · HH:mm'h'", { locale: es }) : 'Sin fecha';
                        const matchSummary = matchSummaries[cambio.id];
                        const hasMatriculaValuesLocal = hasMatriculaValues(cambio);
                        const lineSummary = lineChangeSummaryById[cambio.id] ?? null;
                        const flags = resolveCambioFlags(cambio, lineSummary, matchSummary ?? null);
                        const isLegacy = !flags.hasHeaderMeta && !flags.hasLineMeta && !hasMatriculaValuesLocal;
                        const isReviewedCancel = cambio.revisado && flags.isCancelacion;
                        const isClickable = !isLegacy && !isReviewedCancel;
                        const isMatched = Boolean(matchSummary?.headerMatched);
                        const isNuevoPedido = flags.isNuevoPedido;
                        const nuevoPedidoLabel = cambio.tipo_pedido === 'P22E' ? 'Nueva prevision' : 'Nuevo pedido';
                        const noMatch = Boolean(matchSummary && !matchSummary.headerMatched);
                        const unresolved = noMatch && !cambio.revisado && !isNuevoPedido;
                        const cardColorClass = unresolved
                          ? 'border-rose-200/70 bg-rose-50/50 dark:bg-rose-900/10 dark:border-rose-800/60'
                          : 'border-border/60 bg-card';
                        const handleCardClick = () => {
                          if (isNuevoPedido) {
                            handleOpenNuevoPedidoDialog(cambio);
                          } else {
                            openCambioDetail(cambio, matchSummary);
                          }
                        };
                        const changeLabel = getCambioLabelWithContext(flags, cambio.tipo_pedido, nuevoPedidoLabel);
                        const changeKind = getChangeKindWithContext(flags);
                        const changeToneClass = changeToneMap[changeKind] ?? changeToneMap.legacy;
                        const tipoLabel = cambio.tipo_pedido === 'P22E' ? 'Prevision' : 'Pedido';
                        const tipoBadgeClass = cambio.tipo_pedido === 'P22E' ? tipoBadgeMap.prevision : tipoBadgeMap.pedido;
                        const referenciaLabel = cambio.referencia_cliente?.trim() || 'Sin referencia';
                        const referencia2Label = cambio.referencia2_cliente?.trim() || 'Sin referencia 2';
                        const showCargaLabel = flags.hasLineMeta && cambio.tipo_pedido === 'P22E';
                        const fechaCargaLabel = formatFechaCorta(cambio.fecha_carga ?? null) ?? 'Sin fecha';
                        const clienteLabel = cambio.clienteid
                          ? clienteNombres[cambio.clienteid] ?? `Cliente #${cambio.clienteid}`
                          : 'Cliente sin identificar';
                        const sentByUserId =
                          typeof cambio.enviado_por === 'string' && cambio.enviado_por.trim().length > 0
                            ? cambio.enviado_por.trim()
                            : null;
                        const reviewedByUserId =
                          typeof cambio.revisado_por === 'string' && cambio.revisado_por.trim().length > 0
                            ? cambio.revisado_por.trim()
                            : null;
                        const actorUserId = sentByUserId ?? reviewedByUserId;
                        const actorUserLabel = actorUserId
                          ? changeUserLabelsById[actorUserId] ?? `Usuario ${actorUserId.slice(0, 6)}`
                          : null;
                        const actorDateRaw = cambio.enviado_en ?? cambio.revisado_en ?? null;
                        const actorDate = actorDateRaw ? new Date(actorDateRaw) : null;
                        const actorDateLabel =
                          actorDate && !Number.isNaN(actorDate.getTime())
                            ? format(actorDate, 'dd/MM/yy HH:mm', { locale: es })
                            : null;
                        const actorActionLabel = sentByUserId ? 'Enviado por' : 'Revisado por';
                        const adminHoverTitle =
                          isAdmin && actorUserLabel
                            ? `${actorActionLabel}: ${actorUserLabel}${actorDateLabel ? ` · ${actorDateLabel}` : ''}`
                            : undefined;
                        return (
                          <div
                            key={cambio.id}
                            {...(isClickable
                              ? {
                                  role: 'button',
                                  tabIndex: 0,
                                  onClick: handleCardClick,
                                  onKeyDown: (event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      handleCardClick();
                                    }
                                  },
                                }
                              : {})}
                            className={`rounded-xl border p-4 transition-colors shadow-sm ${cardColorClass} ${
                              isClickable ? 'cursor-pointer hover:border-primary/40 hover:shadow-md' : 'cursor-default'
                            }`}
                            title={adminHoverTitle}
                          >
                            <div className="flex flex-col gap-4">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div className="space-y-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className={`text-xs font-semibold ${changeToneClass}`}>
                                      {changeLabel}
                                    </Badge>
                                    <Badge variant="outline" className={`text-xs ${tipoBadgeClass}`}>
                                      {tipoLabel}
                                    </Badge>
                                    {showCargaLabel ? (
                                      <Badge variant="outline" className="text-xs">
                                        Carga: {fechaCargaLabel}
                                      </Badge>
                                    ) : (
                                      <>
                                        <Badge variant="outline" className="text-xs">
                                          Ref 1: {referenciaLabel}
                                        </Badge>
                                        <Badge variant="outline" className="text-xs border-border/70 text-muted-foreground">
                                          Ref 2: {referencia2Label}
                                        </Badge>
                                      </>
                                    )}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                                    <span>Cliente: {clienteLabel}</span>
                                    <span className="text-muted-foreground/60">•</span>
                                    <span>{fechaLabel}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    title="Eliminar cambio"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCambioToDelete(cambio);
                                      setDeleteDialogOpen(true);
                                    }}
                                    className="h-7 w-7 flex items-center justify-center rounded-full text-destructive hover:bg-destructive/10"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {isReviewedCancel ? (
                                  <Badge
                                    variant="outline"
                                    className="text-xs flex items-center gap-1 border-emerald-200 bg-emerald-50 text-emerald-700"
                                  >
                                    <CheckCircle2 className="h-3 w-3" />
                                    Anulación revisada
                                  </Badge>
                                ) : matchSummary ? (
                                  matchSummary.headerMatched ? (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleNavigateToPedidoDetalle(cambio, matchSummary.pedidoId);
                                      }}
                                    >
                                      <Badge variant="outline" className="text-xs flex items-center gap-1 text-emerald-700">
                                        <CheckCircle2 className="h-3 w-3" />
                                        Emparejado
                                      </Badge>
                                    </button>
                                  ) : isNuevoPedido ? (
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleBuscarMatchNuevoPedido(cambio);
                                        }}
                                      >
                                        <Badge variant="outline" className="text-xs flex items-center gap-1">
                                          Buscar match
                                        </Badge>
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (matchSummary.candidates && matchSummary.candidates.length > 0) {
                                          openMatchSelection(cambio, matchSummary.candidates, matchSummary.reason);
                                        } else {
                                          handleNavigateToMatch(cambio);
                                        }
                                      }}
                                      className="text-destructive hover:text-destructive/80"
                                      title={getMatchSelectionHint(matchSummary.reason) ?? 'Sin coincidencia'}
                                    >
                                      <Badge
                                        variant="outline"
                                        className={`text-xs flex items-center gap-1 ${
                                          cambio.revisado
                                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                                            : 'border-rose-200 bg-rose-50 text-rose-700'
                                        }`}
                                      >
                                        <AlertTriangle className="h-3 w-3" />
                                        {matchSummary.candidates && matchSummary.candidates.length > 0
                                          ? 'Seleccionar pedido'
                                          : 'Sin coincidencia'}
                                      </Badge>
                                    </button>
                                  )
                                ) : matchesLoading ? (
                                  <Badge variant="outline" className="text-xs">Analizando...</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs">Match pendiente</Badge>
                                )}
                                <Badge
                                  variant={cambio.revisado ? 'secondary' : 'outline'}
                                  className={`text-xs ${cambio.revisado ? 'bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200' : ''}`}
                                >
                                  {cambio.revisado ? 'Revisado' : 'Pendiente'}
                                </Badge>
                                {isLegacy && (
                                  <Badge variant="outline" className="text-xs text-muted-foreground">
                                    Cambio obsoleto
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
                  })}
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
            )}

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
                  <span className="text-xs text-muted-foreground/70">({totalCambios} cambios total)</span>
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
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
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
                    onClick={() => setCurrentPage((p) => Math.min(totalGroupPages, p + 1))}
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
          </CardContent>
        </Card>

      </main>
      <CambioReviewDialog
        open={cambioDialogOpen}
        onOpenChange={handleCloseCambioDialog}
        cambio={cambioDialogCambio}
        pedido={cambioDialogPedido}
        acreedorActual={cambioDialogAcreedorActual}
        acreedorNuevo={cambioDialogAcreedorNuevo}
        loading={cambioDialogLoading}
        applying={applyingCambioId === (cambioDialogCambio?.id ?? null)}
        updatingOrizon={cambioDialogUpdatingOrizon}
        acceptDisabledReason={cambioDialogDisabledReason}
        acceptLabel={cambioDialogHeaderLabel}
        hasTransportistaChange={cambioDialogHasTransportistaChange}
        hasMatriculaChange={cambioDialogHasMatriculaChange}
        lineasCambio={cambioDialogLineas}
        lineasPedido={cambioDialogLineasOriginales}
        lineasMatch={cambioDialogLineasMatch}
        lineasDrafts={cambioDialogLineasDrafts}
        onChangeLineaMatch={handleCambioLineaMatchChange}
        onChangeLineaDraft={handleCambioLineaDraftChange}
        onApplyLineas={handleApplyLineasDialog}
        applyingLineas={applyingLineasId === (cambioDialogCambio?.id ?? null)}
        lineasApplyDisabledReason={cambioDialogLineasApplyDisabledReason}
        lineasApplyLabel={cambioDialogEffectiveLineasLabel}
        lineasApplyHint={cambioDialogEffectiveLineasHint}
        canCancelPedido={cambioDialogCanCancelPedido}
        cancelPedidoLabel={`Eliminar ${cambioDialogCancelTargetLabel}`}
        cancelPedidoDescription={cambioDialogCancelDescription}
        onCancelPedido={handleRequestCancelPedido}
        cancelPedidoLoading={cancelPedidoLoading}
        onChangeMatriculaNueva={handleCambioMatriculaDraftChange}
        onSaveMatriculaNueva={handleSaveCambioMatricula}
        onAccept={handleAcceptCambioDialog}
        onChangeAcreedorNuevo={handleCambioAcreedorNuevoChange}
        summaryLabel={
          cambioDialogIsCancelacion
            ? `Anulación de ${cambioDialogCancelTargetLabel}`
            : cambioDialogEffectiveSummaryLabel
        }
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
        backToPedidoLabel={
          cambioReturnPedidoId
            ? cambioReturnPedidoTipo === 'P22E'
              ? 'Volver a la previsión'
              : 'Volver al pedido'
            : null
        }
        onBackToPedido={cambioReturnPedidoId ? handleBackToPedidoFromCambio : undefined}
        canMarkReviewed={cambioDialogCanMarkReviewed}
        markReviewedDescription={cambioDialogMarkReviewedDescription}
        onMarkReviewed={handleMarkCambioReviewed}
        markReviewedLoading={cambioDialogMarkingReviewed}
        canCreatePedidoFromCambio={cambioDialogCanCreateNuevoPedido}
        createPedidoLabel={cambioDialogCreateNuevoPedidoLabel}
        createPedidoDescription={cambioDialogCreateNuevoPedidoDescription}
        onCreatePedidoFromCambio={handleCreateNuevoPedidoFromCambioDialog}
        createPedidoLoading={nuevoPedidoLoading}
      />
      <CambioCreatePedidoDialog
        open={nuevoPedidoDialogOpen}
        onOpenChange={handleCloseNuevoPedidoDialog}
        cambio={nuevoPedidoCambio}
        contextTitle={nuevoPedidoContext.title}
        contextSubtitle={nuevoPedidoContext.subtitle}
        pdfCambioUrl={nuevoPedidoPdfUrl}
        pdfCambioLoading={nuevoPedidoPdfLoading}
        pdfCambioError={nuevoPedidoPdfError}
        pdfActualUrl={nuevoPedidoPdfActualUrl}
        pdfActualLoading={nuevoPedidoPdfActualLoading}
        pdfActualError={nuevoPedidoPdfActualError}
        clienteNombre={nuevoPedidoClienteNombre}
        lineas={nuevoPedidoLineas}
        setLineas={setNuevoPedidoLineas}
        centros={nuevoPedidoCentros}
        setCentros={setNuevoPedidoCentros}
        onCreate={handleCreateNuevoPedido}
        creating={nuevoPedidoCreating}
        createDisabledReason={nuevoPedidoDisabledReason}
      />
      <Dialog open={matchSelectionOpen} onOpenChange={handleCloseMatchSelection}>
        <DialogContent className="w-[98vw] max-w-[98vw] max-h-[96vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {matchSelectionCambio ? `Seleccionar pedido para cambio #${matchSelectionCambio.id}` : 'Seleccionar pedido'}
            </DialogTitle>
            <DialogDescription>
              {getMatchSelectionHint(matchSelectionReason) ??
                'Selecciona el pedido correcto para aplicar el cambio.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">PDF del pedido seleccionado</p>
                <p className="text-xs text-muted-foreground">
                  {selectedMatchCandidate ? `Pedido #${selectedMatchCandidate.id}` : 'Selecciona un pedido para previsualizar.'}
                </p>
              </div>
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 p-3">
                {matchSelectionPdfLoading ? (
                  <Skeleton className="h-[62vh] min-h-[360px] w-full" />
                ) : matchSelectionPdfUrl ? (
                  <object
                    data={matchSelectionPdfUrl}
                    type="application/pdf"
                    className="h-[62vh] min-h-[360px] w-full rounded-md border border-border/60 bg-background"
                  >
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      No se pudo incrustar el PDF.
                    </div>
                  </object>
                ) : (
                  <div className="flex h-[62vh] min-h-[360px] items-center justify-center text-xs text-muted-foreground">
                    {matchSelectionPdfError || 'No hay PDF asociado.'}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-3">
              {matchSelectionCambio && (
                <div className="rounded-lg border border-border/60 bg-background/80 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Cambio seleccionado
                    </p>
                    <Badge variant="secondary" className="text-[10px]">
                      #{matchSelectionCambio.id}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-3">
                    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Referencia 1</p>
                      <p className="text-sm font-semibold text-foreground break-all">{matchSelectionCambioReferencia}</p>
                    </div>
                    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Referencia 2</p>
                      <p className="text-sm font-semibold text-foreground break-all">{matchSelectionCambioReferencia2}</p>
                    </div>
                    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Fecha de carga</p>
                      <p className="text-sm font-semibold text-foreground">{matchSelectionCambioFechaCarga}</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Pedidos candidatos</p>
                  <p className="text-xs text-muted-foreground">
                    {matchSelectionCandidates.length} opciones encontradas
                  </p>
                </div>
                {matchSelectionLoadingDetails && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Cargando líneas...
                  </div>
                )}
              </div>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {matchSelectionCandidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay pedidos candidatos disponibles.</p>
                ) : (
                  matchSelectionCandidates.map((candidate) => {
                    const referencia = candidate.referencia_cliente?.trim() || 'Sin referencia';
                    const referencia2 = candidate.referencia2_cliente?.trim() || 'Sin referencia 2';
                    const fechaCarga = formatFechaCorta(candidate.fecha_carga ?? null);
                    const fechaPedido = formatFechaCorta(candidate.fecha_pedido ?? null);
                    const fecha = fechaCarga ?? fechaPedido ?? 'Sin fecha';
                    const fechaLabel = fechaCarga ? 'Carga' : 'Pedido';
                    const domicilioId = candidate.sujetodomicilioid_destino ?? null;
                    const domicilioLabel = domicilioId
                      ? domicilioNombres[domicilioId] ?? `Domicilio #${domicilioId}`
                      : null;
                    const summary = matchSelectionLineSummary[candidate.id];
                    const totalLineas = summary?.total ?? 0;
                    const descs = summary?.descriptions ?? [];
                    const remaining = totalLineas - descs.length;
                    const isSelected = candidate.id === matchSelectionSelectedId;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => setMatchSelectionSelectedId(candidate.id)}
                        className={`w-full rounded-lg border p-3 text-left transition-colors ${
                          isSelected ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-primary/40 hover:bg-accent/30'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">Pedido #{candidate.id}</span>
                          <Badge variant="outline" className="text-[11px] font-semibold">
                            Fecha {fechaLabel}: {fecha}
                          </Badge>
                        </div>
                        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                          <div className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Referencia 1</p>
                            <p className="text-sm font-semibold text-foreground break-all">{referencia}</p>
                          </div>
                          <div className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Referencia 2</p>
                            <p className="text-sm font-semibold text-foreground break-all">{referencia2}</p>
                          </div>
                        </div>
                        {domicilioLabel && (
                          <div className="mt-1 text-xs text-muted-foreground">{domicilioLabel}</div>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs">
                            Líneas: {totalLineas}
                          </Badge>
                        </div>
                        {descs.length > 0 && (
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                            {descs.map((desc) => (
                              <li key={desc}>{desc}</li>
                            ))}
                          </ul>
                        )}
                        {remaining > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            + {remaining} línea(s) más
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] text-muted-foreground">
                  ¿Es un pedido nuevo? Usa el PDF seleccionado como base.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (selectedMatchCandidate) {
                        handleNuevoPedidoFromCandidate(selectedMatchCandidate);
                      }
                    }}
                    disabled={!selectedMatchCandidate}
                    title="Crea un nuevo pedido usando el PDF del pedido seleccionado como documento actual"
                  >
                    Nuevo pedido con este PDF
                  </Button>
                  <Button
                    onClick={() => {
                      if (selectedMatchCandidate) {
                        handleSelectMatchCandidate(selectedMatchCandidate);
                      }
                    }}
                    disabled={!selectedMatchCandidate}
                  >
                    Usar pedido seleccionado
                  </Button>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">PDF del cambio</p>
                <p className="text-xs text-muted-foreground">
                  {matchSelectionCambio ? `Cambio #${matchSelectionCambio.id}` : 'Sin cambio seleccionado'}
                </p>
              </div>
              <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 p-3">
                {matchSelectionCambioPdfLoading ? (
                  <Skeleton className="h-[62vh] min-h-[360px] w-full" />
                ) : matchSelectionCambioPdfUrl ? (
                  <object
                    data={matchSelectionCambioPdfUrl}
                    type="application/pdf"
                    className="h-[62vh] min-h-[360px] w-full rounded-md border border-border/60 bg-background"
                  >
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                      No se pudo incrustar el PDF.
                    </div>
                  </object>
                ) : (
                  <div className="flex h-[62vh] min-h-[360px] items-center justify-center text-xs text-muted-foreground">
                    {matchSelectionCambioPdfError || 'No hay PDF del cambio.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open);
        if (!open) setCambioToDelete(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cambio</AlertDialogTitle>
            <AlertDialogDescription>
              {cambioToDelete
                ? `¿Seguro que quieres eliminar el cambio #${cambioToDelete.id}? Esta acción no se puede deshacer.`
                : '¿Seguro que quieres eliminar este cambio?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDelete}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deletePdfDialogOpen}
        onOpenChange={(open) => {
          setDeletePdfDialogOpen(open);
          if (!open) setPdfToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar PDF y cambios asociados</AlertDialogTitle>
            <AlertDialogDescription>
              {pdfToDelete
                ? `Se eliminará el PDF y todos los cambios relacionados con ${pdfToDelete.label || 'este archivo'}. Esta acción no se puede deshacer.`
                : '¿Seguro que quieres eliminar este PDF y todos sus cambios?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingPdfId !== null}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingPdfId !== null}
              onClick={handleConfirmDeletePdf}
            >
              {deletingPdfId !== null ? 'Eliminando...' : 'Eliminar PDF'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={applyPdfDialogOpen}
        onOpenChange={(open) => {
          setApplyPdfDialogOpen(open);
          if (!open) setApplyPdfTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar PDF del cambio</AlertDialogTitle>
            <AlertDialogDescription>
              {applyPdfTarget
                ? `Se sustituirá el PDF original de ${
                    applyPdfTarget.pedidoIds.length === 1
                      ? '1 pedido/previsión'
                      : `${applyPdfTarget.pedidoIds.length} pedidos/previsiones`
                  } asociados a ${applyPdfTarget.label || 'este grupo'}.`
                : '¿Seguro que quieres aplicar este PDF a los pedidos/previsiones asociados?'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applyingPdfId !== null}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={applyingPdfId !== null} onClick={handleConfirmApplyPdf}>
              {applyingPdfId !== null ? 'Aplicando...' : 'Aplicar PDF'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cancelPedidoDialogOpen}
        onOpenChange={(open) => {
          setCancelPedidoDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar {cambioDialogCancelTargetLabel}</AlertDialogTitle>
            <AlertDialogDescription>
              {cambioDialogCambio
                ? `Se eliminará el ${cambioDialogCancelTargetLabel} asociado al cambio #${cambioDialogCambio.id}.`
                : `¿Seguro que quieres eliminar este ${cambioDialogCancelTargetLabel}?`}{' '}
              {cambioDialogHasOrizonId && cambioDialogOrizonId
                ? `También se intentará eliminar en Orizon (ID ${cambioDialogOrizonId}).`
                : 'Esta acción no se puede deshacer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelPedidoLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelPedidoLoading}
              onClick={handleConfirmCancelPedido}
            >
              {cancelPedidoLoading ? 'Eliminando...' : `Eliminar ${cambioDialogCancelTargetLabel}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={nuevoPedidoOrizonDialogOpen}
        onOpenChange={(open) => {
          setNuevoPedidoOrizonDialogOpen(open);
          if (!open) setNuevoPedidoOrizonPrompt(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar {nuevoPedidoOrizonLabel} a Orizon</AlertDialogTitle>
            <AlertDialogDescription>
              {nuevoPedidoOrizonPrompt
                ? `Se creó el ${nuevoPedidoOrizonLabel} #${nuevoPedidoOrizonPrompt.pedidoId}${
                    nuevoPedidoOrizonPrompt.referencia
                      ? ` (Ref: ${nuevoPedidoOrizonPrompt.referencia})`
                      : ''
                  }. ¿Quieres enviarlo ahora a Orizon?`
                : `¿Quieres enviar el ${nuevoPedidoOrizonLabel} a Orizon ahora?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={nuevoPedidoOrizonSending}>Ahora no</AlertDialogCancel>
            <AlertDialogAction
              disabled={nuevoPedidoOrizonSending}
              onClick={handleSendNuevoPedidoToOrizon}
            >
              {nuevoPedidoOrizonSending ? 'Enviando...' : 'Enviar a Orizon'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

export default Cambios;
