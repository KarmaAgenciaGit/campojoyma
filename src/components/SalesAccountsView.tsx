import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useUserLabels } from '@/hooks/useUserLabels';
import { usePersistedState } from '@/hooks/usePersistedState';
import { agroirisClients } from '@/services/agroirisClients';
import {
  salesAccounts,
  type SalesAccountDetail,
  type SalesAccountError,
  type SalesAccountPdfInfo,
  type SalesAccountSalidaDetalleLink,
  type SalesAccountValue,
  type SalesAccountWithTotals,
} from '@/services/salesAccounts';
import { agroirisGastos } from '@/services/agroirisGastos';
import { GastoCombobox } from '@/components/GastoCombobox';
import { ClientCombobox } from '@/components/ClientCombobox';
import { SalesAccountPdfSharedInfo } from '@/components/SalesAccountPdfSharedInfo';
import { PdfViewer } from '@/components/PdfViewer';
import { SalidaDetalleCuentaVentaCombobox } from '@/components/SalidaDetalleCuentaVentaCombobox';
import { DivisaCombobox } from '@/components/DivisaCombobox';
import { agroirisPdfFiles } from '@/services/agroirisPdfFiles';
import { agroirisSeries } from '@/services/agroirisSeries';
import { agroirisDivisas } from '@/services/agroirisDivisas';
import {
  agroirisSalidas,
  type AgroirisCuentaVentaSalidaLookup,
  type AgroirisSalidaDetalle,
  type AgroirisSalidaDetalleCuentaVentaImportable,
} from '@/services/agroirisSalidas';
import { agroirisCuentaVentaAuth } from '@/services/agroirisAuth';
import {
  RefreshCw,
  Loader2,
  Send,
  AlertTriangle,
  FileText,
  Hash,
  Package,
  CircleDot,
  Filter,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ExternalLink,
  Trash2,
  Eye,
  EyeOff,
  Download,
  MoreHorizontal,
  Edit,
  Edit2,
  Copy,
  Save,
  Plus,
  Calendar as CalendarIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Calendar as DateRangeCalendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { DateRange } from 'react-day-picker';
import { buildCuentaDetailPath, ROUTE_BASES } from '@/utils/entityRoutes';

type SalesAccountStatus = 'pending' | 'sent';
type CeoxStatusFilter = 'all' | 'in_ceox' | 'not_in_ceox';
type SalesAccountOrder = 'date_desc' | 'date_asc' | 'numero_asc' | 'numero_desc';
const WARNING_CODE_SIN_LINEAS = 'SIN_LINEAS';
const WARNING_CODE_SIN_DETALLES = 'SIN_DETALLES';
const NO_ORIZON_LINE_DATA = '__no_orizon_line_data__';

const isWarningCode = (code?: string | null) =>
  code === WARNING_CODE_SIN_LINEAS || code === WARNING_CODE_SIN_DETALLES;

interface SalesAccountItem extends SalesAccountWithTotals {
  clienteNombre?: string;
}

interface SalesAccountGroup {
  archivoPdfId: number | null;
  accounts: SalesAccountItem[];
  errors: SalesAccountError[];
  latestDate: string | null;
  latestArrivalDate: string | null;
  latestTimestamp: number;
}

interface ImportByReferenceRow {
  salidadetalleid: number;
  referencia_cliente: string;
  referencia2_cliente: string;
  descripcion_salida: string;
  descripcion_genero: string;
  nombre_calibre: string;
  tipo_precio: string;
  total_kilosbrutos: number;
  total_kiloscliente: number;
  total_kilosnetos: number;
  total_piezas: number;
  total_bultos: number;
  nro_palets: number;
  divisaid: number | null;
  precio: number | null;
}

type SortableSalesAccount = Pick<
  SalesAccountWithTotals,
  'id' | 'numero_cuentaventa' | 'fechavaloracion' | 'created_at' | 'llegada_correo'
>;

const getSalesAccountDateValue = (
  account: Pick<SortableSalesAccount, 'fechavaloracion' | 'created_at' | 'llegada_correo'>,
) => {
  const rawDate = account.llegada_correo || account.created_at;
  if (!rawDate) return 0;
  const parsed = Date.parse(rawDate);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const compareSalesAccountNumbers = (
  left: Pick<SortableSalesAccount, 'id' | 'numero_cuentaventa'>,
  right: Pick<SortableSalesAccount, 'id' | 'numero_cuentaventa'>,
) => {
  const leftValue = (left.numero_cuentaventa || `${left.id}`).toString();
  const rightValue = (right.numero_cuentaventa || `${right.id}`).toString();
  return leftValue.localeCompare(rightValue, 'es', { numeric: true, sensitivity: 'base' });
};

const compareSalesAccounts = (
  left: SortableSalesAccount,
  right: SortableSalesAccount,
  orderBy: SalesAccountOrder,
) => {
  switch (orderBy) {
    case 'date_asc':
      return getSalesAccountDateValue(left) - getSalesAccountDateValue(right);
    case 'numero_asc':
      return compareSalesAccountNumbers(left, right);
    case 'numero_desc':
      return compareSalesAccountNumbers(right, left);
    case 'date_desc':
    default:
      return getSalesAccountDateValue(right) - getSalesAccountDateValue(left);
  }
};

const compareSalesAccountGroups = (
  left: SalesAccountGroup,
  right: SalesAccountGroup,
  orderBy: SalesAccountOrder,
) => {
  const leftHasPdf = typeof left.archivoPdfId === 'number';
  const rightHasPdf = typeof right.archivoPdfId === 'number';

  if (leftHasPdf && !rightHasPdf) return -1;
  if (!leftHasPdf && rightHasPdf) return 1;

  if (orderBy === 'date_asc' || orderBy === 'date_desc') {
    const dateDiff =
      orderBy === 'date_asc'
        ? left.latestTimestamp - right.latestTimestamp
        : right.latestTimestamp - left.latestTimestamp;
    if (dateDiff !== 0) return dateDiff;
  } else {
    const leftRepresentative = left.accounts[0] ?? null;
    const rightRepresentative = right.accounts[0] ?? null;

    if (leftRepresentative && rightRepresentative) {
      const accountDiff = compareSalesAccounts(leftRepresentative, rightRepresentative, orderBy);
      if (accountDiff !== 0) return accountDiff;
    } else if (leftRepresentative && !rightRepresentative) {
      return -1;
    } else if (!leftRepresentative && rightRepresentative) {
      return 1;
    }
  }

  const latestDiff = right.latestTimestamp - left.latestTimestamp;
  if (latestDiff !== 0) return latestDiff;

  return (left.archivoPdfId ?? Number.MAX_SAFE_INTEGER) - (right.archivoPdfId ?? Number.MAX_SAFE_INTEGER);
};

type CuentaVentaOrizonPayload = {
  cuentaventaid: number;
  serieid: number;
  codigo_cuentaventa: number;
  fechavaloracion: string;
  numero_cuentaventa: string;
  observaciones_valoracion: string;
  clienteid: number;
  listGastos: Array<{
    gastoid: number;
    valor_gasto: number;
    acreedorid: number;
  }>;
  listDetalle: Array<{
    salidadetalleid: number;
    cuentaventadetalleid: number;
    listaSalidaValor: Array<{
      total_kilosbrutos: number;
      total_kiloscliente: number;
      total_kilosnetos: number;
      total_piezas: number;
      total_bultos: number;
      nro_palets: number;
      divisaid: number;
      cambiodivisa: number;
      precio: number;
      tipo_precio: string;
    }>;
  }>;
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return format(parsed, "d MMM yyyy", { locale: es });
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return format(parsed, 'dd/MM/yyyy · HH:mm', { locale: es });
};

const statusFromAccount = (account: SalesAccountWithTotals): SalesAccountStatus => {
  if (account.idcuentaventa_orizon) return 'sent';
  return 'pending';
};

const statusBadge = (account: SalesAccountWithTotals, options?: { showId?: boolean }) => {
  const status = statusFromAccount(account);
  const showId = options?.showId ?? true;
  if (status === 'sent') {
    return (
      <Badge className="w-fit text-xs gap-1 bg-sky-600/10 text-sky-800 border border-sky-200 dark:bg-sky-900/30 dark:text-sky-100 dark:border-sky-800">
        {showId ? (
          <>
            ID Orizon: <span className="font-mono font-semibold">{account.idcuentaventa_orizon}</span>
          </>
        ) : (
          'Orizon'
        )}
      </Badge>
    );
  }
  if (status === 'pending') return <Badge className="bg-sky-100 text-sky-800">Pendiente</Badge>;
  return <Badge variant="secondary">Pendiente</Badge>;
};

const numberFormat = (value: number) => new Intl.NumberFormat('es-ES').format(value ?? 0);
const currencyFormat = (value: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value ?? 0);

const formatCuentaVentaReference = ({
  numero_cuentaventa,
  fallbackId,
  codigo_cuentaventa,
}: {
  numero_cuentaventa?: string | null;
  fallbackId?: number | null;
  codigo_cuentaventa?: number | null;
}) => {
  const numero = numero_cuentaventa?.toString().trim();
  if (numero) return numero;
  if (typeof codigo_cuentaventa === 'number' && Number.isFinite(codigo_cuentaventa) && codigo_cuentaventa > 0) {
    return `código ${codigo_cuentaventa}`;
  }
  if (typeof fallbackId === 'number' && Number.isFinite(fallbackId) && fallbackId > 0) {
    return `#${fallbackId}`;
  }
  return 'sin número';
};

const buildCuentaVentaConflictDescription = (
  externalLinks: AgroirisCuentaVentaSalidaLookup[],
  localLinks: SalesAccountSalidaDetalleLink[],
) => {
  if (externalLinks.length > 0) {
    const first = externalLinks[0];
    const reference = formatCuentaVentaReference({
      numero_cuentaventa: first.numero_cuentaventa,
      fallbackId: first.cuentaventaid,
      codigo_cuentaventa: first.codigo_cuentaventa,
    });
    const remaining = externalLinks.length - 1;
    return `La salida #${first.salidaid} ya está vinculada a la cuenta ${reference}${first.fechavaloracion ? ` (${formatDate(first.fechavaloracion)})` : ''}${remaining > 0 ? ` y hay ${remaining} albarán(es) más vinculados.` : '.'}`;
  }

  if (localLinks.length > 0) {
    const first = localLinks[0];
    const reference = formatCuentaVentaReference({
      numero_cuentaventa: first.numero_cuentaventa,
      fallbackId: first.cuentaventa_id,
      codigo_cuentaventa: first.codigo_cuentaventa,
    });
    const remaining = localLinks.length - 1;
    return `La línea SalidaDetalle #${first.salidadetalleid} ya está guardada en la cuenta de venta de XFuego ${reference}${first.fechavaloracion ? ` (${formatDate(first.fechavaloracion)})` : ''}${remaining > 0 ? `. Además, hay ${remaining} línea${remaining === 1 ? '' : 's'} más ya guardada${remaining === 1 ? '' : 's'} en cuentas de venta de XFuego.` : '.'}`;
  }

  return 'Ya existe una cuenta de venta vinculada a ese albarán.';
};

const base64ToUint8Array = (base64Content: string) => {
  const byteCharacters = atob(base64Content);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i += 1) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return new Uint8Array(byteNumbers);
};

const normalizeLooseText = (value: string) =>
  value
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');

const normalizeSearchCandidates = (rawInput?: string | string[] | null) => {
  const baseValues = (Array.isArray(rawInput) ? rawInput : rawInput ? [rawInput] : [])
    .map((value) => value.toString().trim())
    .filter((value) => value.length > 0);

  const expanded = baseValues.flatMap((value) => {
    const numericTokens = value.match(/\d{4,}/g) ?? [];
    return [value, ...numericTokens];
  });

  return Array.from(new Set(expanded.map((value) => value.trim()).filter((value) => value.length >= 3)));
};

const buildPdfSearchCandidatesFromAccount = (account: SalesAccountWithTotals) => {
  const candidates: string[] = [];

  const accountNumber = account.numero_cuentaventa?.toString().trim();
  if (accountNumber) candidates.push(accountNumber);

  const codigoCuenta = Number.isFinite(account.codigo_cuentaventa) ? String(account.codigo_cuentaventa) : '';
  if (codigoCuenta) candidates.push(codigoCuenta);

  const observaciones = account.observaciones_valoracion?.toString() ?? '';
  const observacionPatterns = [
    /buscado\s*[:=]\s*['"]?([A-Z0-9/_\-.]+)/i,
    /pos\.?\s*[:=]\s*['"]?([A-Z0-9/_\-.]+)/i,
  ];

  observacionPatterns.forEach((pattern) => {
    const match = observaciones.match(pattern);
    if (match?.[1]) candidates.push(match[1]);
  });

  return normalizeSearchCandidates(candidates);
};

const buildPdfMatchCacheKey = (archivoPdfId: number, rawCandidates?: string | string[] | null) => {
  const normalizedCandidates = normalizeSearchCandidates(rawCandidates)
    .map((candidate) => candidate.toLowerCase())
    .sort((left, right) => left.localeCompare(right));

  return `${archivoPdfId}:${normalizedCandidates.join('|')}`;
};

const buildPdfViewerUrl = (baseUrl: string, page?: number | null, searchText?: string | null) => {
  const params: string[] = [];
  const normalizedSearch = searchText?.toString().trim() || '';
  if (typeof page === 'number' && page > 0) params.push(`page=${page}`);
  if (normalizedSearch) params.push(`search=${encodeURIComponent(normalizedSearch)}`);
  return params.length > 0 ? `${baseUrl}#${params.join('&')}` : baseUrl;
};

const findFirstPageBySearchCandidates = async (
  pdfBytes: Uint8Array,
  rawCandidates: string | string[],
): Promise<number | null> => {
  const normalizedCandidates = normalizeSearchCandidates(rawCandidates);
  if (normalizedCandidates.length === 0) return null;

  const candidateTokens = normalizedCandidates
    .map((candidate) => ({
      strict: candidate.toUpperCase(),
      loose: normalizeLooseText(candidate),
      digits: candidate.replace(/\D/g, ''),
    }))
    .filter((candidate) => candidate.strict || candidate.loose || candidate.digits.length >= 4);

  if (candidateTokens.length === 0) return null;

  try {
    const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
      data: pdfBytes,
      disableWorker: true,
    });
    const document = await loadingTask.promise;

    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
        const strictHaystack = pageText.toUpperCase();
        const looseHaystack = normalizeLooseText(pageText);
        const digitsHaystack = strictHaystack.replace(/\D/g, '');

        for (const token of candidateTokens) {
          if (token.strict.length >= 3 && strictHaystack.includes(token.strict)) return pageNumber;
          if (token.loose.length >= 3 && looseHaystack.includes(token.loose)) return pageNumber;
          if (token.digits.length >= 4 && digitsHaystack.includes(token.digits)) return pageNumber;
        }
      }
    } finally {
      await loadingTask.destroy?.();
    }
  } catch (error) {
    console.warn('[PDF][CuentaVenta] No se pudo resolver página por búsqueda', error);
  }

  return null;
};

export const SalesAccountsView = () => {
  const { toast } = useToast();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { cuentaId: routeAccountIdParam } = useParams<{ cuentaId?: string }>();
  const routeAccountId = routeAccountIdParam ? Number(routeAccountIdParam) : null;
  const [searchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<SalesAccountItem[]>([]);
  const [pageAccountIds, setPageAccountIds] = useState<number[]>([]);
  const [accountErrors, setAccountErrors] = useState<SalesAccountError[]>([]);
  const [selectedAccountPdfInfo, setSelectedAccountPdfInfo] = useState<SalesAccountPdfInfo[]>([]);
  const [selectedAccountPdfErrors, setSelectedAccountPdfErrors] = useState<SalesAccountError[]>([]);
  const [totalGroupCount, setTotalGroupCount] = useState(0);
  const [totalFilteredAccountCount, setTotalFilteredAccountCount] = useState(0);
  const [overallAccountCount, setOverallAccountCount] = useState(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState('');
  const [ceoxStatusFilter, setCeoxStatusFilter] = useState<CeoxStatusFilter>('all');
  const [clienteFilter, setClienteFilter] = useState<number | null>(null);
  const [alertFilter, setAlertFilter] = useState<'all' | 'errors' | 'warnings' | 'clean'>('all');
  const [detalleFilter, setDetalleFilter] = useState<'all' | 'with' | 'without'>('all');
  const [orderBy, setOrderBy] = useState<SalesAccountOrder>('date_desc');
  const [fechaRango, setFechaRango] = useState<DateRange | undefined>(undefined);
  const [showFilters, setShowFilters] = usePersistedState<boolean>('sales_accounts_showFilters', true, localStorage);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = usePersistedState<number>(
    'sales_accounts_items_per_page',
    10,
    localStorage,
  );
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [pendingAccountDialogId, setPendingAccountDialogId] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [gastoNames, setGastoNames] = useState<Record<number, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState<Partial<SalesAccountItem>>({});
  const [deleting, setDeleting] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfPreviewPage, setPdfPreviewPage] = useState<number | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [sharedPdfPanelOpen, setSharedPdfPanelOpen] = useState(false);
  const [sharedAccountPdfRelatedCount, setSharedAccountPdfRelatedCount] = useState(0);
  const [seriesMap, setSeriesMap] = useState<Record<number, string>>({});
  const [divisaNames, setDivisaNames] = useState<Record<number, string>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [deletingPdfId, setDeletingPdfId] = useState<number | null>(null);
  const [pendingDeletePdfId, setPendingDeletePdfId] = useState<number | null>(null);
  const [salidaDetalleMap, setSalidaDetalleMap] = useState<Record<number, AgroirisSalidaDetalle>>({});
  const [salidaDetalleLoading, setSalidaDetalleLoading] = useState<Record<number, boolean>>({});
  const [salidaDetalleErrors, setSalidaDetalleErrors] = useState<Record<number, string>>({});
  const [newDetalle, setNewDetalle] = useState({
    salidadetalleid: null as number | null,
    total_kilosbrutos: 0,
    total_kiloscliente: 0,
    total_kilosnetos: 0,
    total_piezas: 0,
    total_bultos: 0,
    nro_palets: 0,
    divisaid: 0,
    precio: 0,
    tipo_precio: 'K',
  });
  const [addingDetalle, setAddingDetalle] = useState(false);
  const [showNewDetalleForm, setShowNewDetalleForm] = useState(false);
  const [editingDetalleId, setEditingDetalleId] = useState<number | null>(null);
  const [editedDetalleValues, setEditedDetalleValues] = useState<Record<number, Partial<SalesAccountValue>>>({});
  const [deletingDetalleId, setDeletingDetalleId] = useState<number | null>(null);
  const [showImportByReference, setShowImportByReference] = useState(false);
  const [referenceClienteQuery, setReferenceClienteQuery] = useState('');
  const [reference2ClienteQuery, setReference2ClienteQuery] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [activeImportSearchField, setActiveImportSearchField] = useState<'referencia_cliente' | 'referencia2_cliente' | null>(null);
  const [importRows, setImportRows] = useState<ImportByReferenceRow[]>([]);
  const [selectedImportRows, setSelectedImportRows] = useState<Record<number, boolean>>({});
  const [importingRows, setImportingRows] = useState(false);
  const [sendingOrizon, setSendingOrizon] = useState(false);
  const lastLoggedPreviewRef = useRef<string | null>(null);
  const pdfMatchPageCacheRef = useRef<Record<string, number | null>>({});
  const closingAccountDialogRef = useRef<number | null>(null);
  const selectedAccountIdRef = useRef<number | null>(null);
  const pendingAccountDialogIdRef = useRef<number | null>(null);
  const routeAccountIdRef = useRef<number | null>(routeAccountId);
  const numberInputNoSpin =
    '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
  const toNumberOrZero = (value: unknown) => (typeof value === 'number' ? value : Number(value) || 0);
  const toFiniteNullableNumber = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const mapImportableSalidaToRow = (
    linea: AgroirisSalidaDetalleCuentaVentaImportable,
    normalizeTipoPrecioValue: (value?: string | null) => string,
  ): ImportByReferenceRow => ({
    salidadetalleid: linea.salidadetalleid,
    referencia_cliente: linea.referencia_cliente ?? '',
    referencia2_cliente: linea.referencia2_cliente ?? '',
    descripcion_salida: linea.descripcion_salida ?? '',
    descripcion_genero: linea.descripcion_genero ?? '',
    nombre_calibre: linea.nombre_calibre ?? '',
    tipo_precio: normalizeTipoPrecioValue(linea.tipo_precio),
    total_kilosbrutos: toNumberOrZero(linea.total_kilosbrutos),
    total_kiloscliente: toNumberOrZero(linea.total_kiloscliente),
    total_kilosnetos: toNumberOrZero(linea.total_kilosnetos),
    total_piezas: toNumberOrZero(linea.total_piezas),
    total_bultos: toNumberOrZero(linea.bultos),
    nro_palets: toNumberOrZero(linea.nro_palets),
    divisaid: toFiniteNullableNumber(linea.divisaid),
    precio: toFiniteNullableNumber(linea.precio),
  });

  const analyzeImportReferenceConflicts = useCallback(
    async (lineas: AgroirisSalidaDetalleCuentaVentaImportable[]) => {
      const lineasConSalida = await agroirisSalidas.resolveSalidaIdsForCuentaVentaImportables(lineas);
      const [externalLinksBySalidaId, localLinks] = await Promise.all([
        agroirisSalidas.getCuentaVentaLinksBySalidaIds(lineasConSalida.map((linea) => linea.salidaid)),
        salesAccounts.getLinkedAccountsBySalidaDetalleIds(
          lineasConSalida.map((linea) => linea.salidadetalleid),
          { excludeAccountId: selectedAccountId ?? null },
        ),
      ]);

      const blockedSalidaDetalleIds = new Set<number>();
      const blockedSalidaIds = new Set<number>();
      const externalLinks = Object.values(externalLinksBySalidaId);

      lineasConSalida.forEach((linea) => {
        if (linea.salidaid && externalLinksBySalidaId[linea.salidaid]) {
          blockedSalidaDetalleIds.add(linea.salidadetalleid);
          blockedSalidaIds.add(linea.salidaid);
        }
      });

      localLinks.forEach((link) => {
        blockedSalidaDetalleIds.add(link.salidadetalleid);
        const matchingLinea = lineasConSalida.find((linea) => linea.salidadetalleid === link.salidadetalleid);
        if (matchingLinea?.salidaid) {
          blockedSalidaIds.add(matchingLinea.salidaid);
        }
      });

      return {
        resolvedLineas: lineasConSalida,
        blockedSalidaDetalleIds,
        blockedSalidaIds,
        externalLinks,
        localLinks,
      };
    },
    [selectedAccountId],
  );

  useEffect(() => {
    selectedAccountIdRef.current = selectedAccountId;
  }, [selectedAccountId]);

  useEffect(() => {
    pendingAccountDialogIdRef.current = pendingAccountDialogId;
  }, [pendingAccountDialogId]);

  useEffect(() => {
    routeAccountIdRef.current = routeAccountId;
  }, [routeAccountId]);

  const getGroupKeyForAccount = (archivoPdfId: number | null | undefined) =>
    typeof archivoPdfId === 'number' ? archivoPdfId.toString() : 'sin-pdf';

  const navigateToAccountDetail = useCallback(
    (accountId: number, options?: { replace?: boolean; nextSearchParams?: URLSearchParams }) => {
      const resolvedSearchParams = options?.nextSearchParams ?? new URLSearchParams(searchParams);
      const nextSearch = resolvedSearchParams.toString();
      navigate(
        {
          pathname: buildCuentaDetailPath(accountId),
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: options?.replace ?? false },
      );
    },
    [navigate, searchParams],
  );

  const navigateToAccountsList = useCallback(
    (options?: { replace?: boolean; nextSearchParams?: URLSearchParams }) => {
      const resolvedSearchParams = options?.nextSearchParams ?? new URLSearchParams(searchParams);
      const nextSearch = resolvedSearchParams.toString();
      navigate(
        {
          pathname: ROUTE_BASES.cuentas,
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: options?.replace ?? false },
      );
    },
    [navigate, searchParams],
  );

  const openAccountDetails = useCallback(
    (accountId: number) => {
      closingAccountDialogRef.current = null;
      setPendingAccountDialogId(accountId);
      navigateToAccountDetail(accountId);
    },
    [navigateToAccountDetail],
  );

  const closeAccountDetails = useCallback(() => {
    closingAccountDialogRef.current = selectedAccountId;
    navigateToAccountsList({ replace: true });
    setPendingAccountDialogId(null);
    setDetailsOpen(false);
    setSelectedAccountId(null);
  }, [navigateToAccountsList, selectedAccountId]);

  const fetchAccounts = useCallback(
    async (forceRefresh = false) => {
      try {
        setLoading(true);
        const [clients, totalCount] = await Promise.all([
          agroirisClients.getClients(forceRefresh).catch(() => []),
          salesAccounts.getTotalCount().catch(() => 0),
        ]);

        const normalizedSearch = search.trim().toLowerCase();
        const searchClientIds = normalizedSearch
          ? Array.from(
              new Set(
                clients
                  .filter((client) =>
                    `${client.nombre_sujeto ?? ''} ${client.identificador_fiscal ?? ''} ${client.nombre_comercial ?? ''}`
                      .toLowerCase()
                      .includes(normalizedSearch),
                  )
                  .map((client) => client.clienteid)
                  .filter((clientId) => Number.isFinite(clientId) && clientId > 0),
              ),
            )
          : [];

        const [pageResult] = await Promise.all([
          salesAccounts.getAccountsPage({
            page: currentPage,
            pageSize: itemsPerPage,
            orderBy,
            search,
            searchClientIds,
            clienteId: clienteFilter,
            ceoxStatus: ceoxStatusFilter,
            alertFilter,
            detalleFilter,
            fechaFrom: fechaRango?.from ? format(fechaRango.from, 'yyyy-MM-dd') : null,
            fechaTo: fechaRango?.to ? format(fechaRango.to, 'yyyy-MM-dd') : null,
          }),
        ]);

        const clientMap = new Map<number, string>(
          clients.map((c) => [c.clienteid, c.nombre_sujeto || c.nombre_comercial]),
        );

        const pdfIds = Array.from(
          new Set(pageResult.accounts.map((c) => c.archivo_pdf_id).filter((id): id is number => Boolean(id))),
        );
        let errores: SalesAccountError[] = [];
        if (pdfIds.length > 0) {
          try {
            errores = await salesAccounts.getErrorsByPdfIds(pdfIds);
          } catch (error) {
            console.error('Error cargando errores de cuentas de venta', error);
          }
        }

        const pageAccounts = pageResult.accounts.map((c) => ({
          ...c,
          clienteNombre: clientMap.get(c.clienteid),
        }));
        const pageAccountIdSet = new Set(pageAccounts.map((account) => account.id));

        setAccounts((prev) => {
          const preserved = prev.filter((account) => {
            if (pageAccountIdSet.has(account.id)) return false;
            return (
              account.id === selectedAccountIdRef.current ||
              account.id === pendingAccountDialogIdRef.current ||
              account.id === routeAccountIdRef.current
            );
          });

          return [
            ...pageAccounts,
            ...preserved.filter((account) => !pageAccountIdSet.has(account.id)),
          ];
        });
        setPageAccountIds(pageResult.pageAccountIds);
        setAccountErrors(errores);
        setTotalGroupCount(pageResult.totalGroups);
        setTotalFilteredAccountCount(pageResult.totalAccounts);
        setOverallAccountCount(totalCount);
      } catch (error: any) {
        console.error('Error cargando cuentas de venta', error);
        toast({
          title: 'No se pudieron cargar las cuentas',
          description: error?.message ?? 'Intenta refrescar de nuevo.',
          variant: 'destructive',
        });
        setPageAccountIds([]);
        setAccountErrors([]);
        setTotalGroupCount(0);
        setTotalFilteredAccountCount(0);
      } finally {
        setLoading(false);
      }
    },
    [
      alertFilter,
      ceoxStatusFilter,
      clienteFilter,
      currentPage,
      detalleFilter,
      fechaRango?.from,
      fechaRango?.to,
      itemsPerPage,
      orderBy,
      search,
      toast,
    ],
  );

  useEffect(() => {
    const legacyCuentaParam = searchParams.get('cuenta');
    const legacyCuentaId = legacyCuentaParam ? Number(legacyCuentaParam) : undefined;
    const accountId =
      routeAccountId && Number.isFinite(routeAccountId) && routeAccountId > 0
        ? routeAccountId
        : legacyCuentaId && Number.isFinite(legacyCuentaId) && legacyCuentaId > 0
          ? legacyCuentaId
          : null;

    if (!routeAccountIdParam && accountId) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('cuenta');
      navigateToAccountDetail(accountId, { replace: true, nextSearchParams: nextParams });
      return;
    }

    if (!accountId) {
      closingAccountDialogRef.current = null;
      return;
    }
    if (closingAccountDialogRef.current === accountId) return;
    if (detailsOpen && selectedAccountId === accountId) return;
    if (pendingAccountDialogId === accountId) return;

    setPendingAccountDialogId(accountId);
  }, [
    searchParams,
    routeAccountIdParam,
    routeAccountId,
    detailsOpen,
    selectedAccountId,
    pendingAccountDialogId,
    navigateToAccountDetail,
  ]);

  useEffect(() => {
    if (pendingAccountDialogId === null) return;
    if (loading) return;

    const existing = accounts.find((account) => account.id === pendingAccountDialogId);
    if (existing) {
      const groupKey = getGroupKeyForAccount(existing.archivo_pdf_id);
      setExpandedGroups((prev) => ({ ...prev, [groupKey]: true }));
      setSelectedAccountId(existing.id);
      setDetailsOpen(true);
      closingAccountDialogRef.current = null;
      setPendingAccountDialogId(null);
      return;
    }

    let cancelled = false;

    const loadPendingAccount = async () => {
      try {
        const fetchedAccount = await salesAccounts.getAccountById(pendingAccountDialogId);
        if (cancelled) return;

        if (!fetchedAccount) {
          toast({
            title: 'Cuenta no encontrada',
            description: `No se encontró la cuenta #${pendingAccountDialogId}.`,
            variant: 'destructive',
          });
          navigateToAccountsList({ replace: true });
          return;
        }

        let knownClientName = accounts.find((item) => item.clienteid === fetchedAccount.clienteid)?.clienteNombre;
        if (!knownClientName && fetchedAccount.clienteid) {
          try {
            const client = await agroirisClients.getClientById(fetchedAccount.clienteid);
            knownClientName = client?.nombre_sujeto || client?.nombre_comercial || undefined;
          } catch (clientError) {
            console.error('Error cargando cliente para cuenta solicitada por URL', clientError);
          }
        }
        const accountToInsert: SalesAccountItem = {
          ...fetchedAccount,
          clienteNombre: knownClientName,
        };

        setAccounts((prev) => {
          if (prev.some((item) => item.id === accountToInsert.id)) return prev;
          return [accountToInsert, ...prev];
        });
        const groupKey = getGroupKeyForAccount(accountToInsert.archivo_pdf_id);
        setExpandedGroups((prev) => ({ ...prev, [groupKey]: true }));
        setSelectedAccountId(accountToInsert.id);
        setDetailsOpen(true);
        closingAccountDialogRef.current = null;
      } catch (error: any) {
        if (cancelled) return;
        console.error('Error cargando cuenta solicitada por URL', error);
        toast({
          title: 'No se pudo abrir la cuenta',
          description: error?.message ?? 'Inténtalo nuevamente.',
          variant: 'destructive',
        });
        navigateToAccountsList({ replace: true });
      } finally {
        if (!cancelled) {
          setPendingAccountDialogId(null);
        }
      }
    };

    void loadPendingAccount();

    return () => {
      cancelled = true;
    };
  }, [accounts, loading, navigateToAccountsList, pendingAccountDialogId, toast]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  useEffect(() => {
    const loadSeries = async () => {
      try {
        const series = await agroirisSeries.getAllSeries();
        const map: Record<number, string> = {};
        series.forEach((s) => {
          map[s.serieid] = s.descripcion || s.serie || `Serie ${s.serieid}`;
        });
        setSeriesMap(map);
      } catch (error) {
        console.error('Error cargando series', error);
      }
    };
    loadSeries();
  }, []);

  useEffect(() => {
    const loadDivisas = async () => {
      try {
        const divisas = await agroirisDivisas.getDivisas();
        const map: Record<number, string> = {};
        divisas.forEach((divisa) => {
          map[divisa.divisaid] =
            divisa.nombre_divisa || divisa.simbolo_divisa || divisa.simbolo_cambio || `Divisa ${divisa.divisaid}`;
        });
        setDivisaNames(map);
      } catch (error) {
        console.error('Error cargando divisas', error);
      }
    };
    loadDivisas();
  }, []);

  useEffect(() => {
    const loadGastoNames = async () => {
      const ids = new Set<number>();
      accounts.forEach((acc) => acc.gastos.forEach((g) => ids.add(g.gastoid)));
      const missing = Array.from(ids).filter((id) => gastoNames[id] === undefined);
      if (missing.length === 0) return;
      const entries: [number, string][] = [];
      for (const id of missing) {
        try {
          const gasto = await agroirisGastos.getGasto(id);
          if (gasto?.nombre_gasto) {
            entries.push([id, gasto.nombre_gasto]);
          } else {
            entries.push([id, `Gasto ${id}`]);
          }
        } catch (error) {
          console.error('Error cargando gasto', id, error);
          entries.push([id, `Gasto ${id}`]);
        }
      }
      if (entries.length > 0) {
        setGastoNames((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    };
    loadGastoNames();
  }, [accounts, gastoNames]);

  const sentByUserIds = useMemo(
    () =>
      accounts
        .map((account) => account.enviado_por)
        .filter((userId): userId is string => typeof userId === 'string' && userId.trim().length > 0),
    [accounts],
  );

  const { labelsById: accountSenderLabelsById } = useUserLabels(sentByUserIds, isAdmin);

  const stats = useMemo(() => {
    const total = overallAccountCount;
    const sent = accounts.filter((c) => statusFromAccount(c) === 'sent').length;
    const pending = accounts.filter((c) => statusFromAccount(c) === 'pending').length;
    const withPdf = accounts.filter((c) => !!c.archivo_pdf_id).length;
    return { total, sent, pending, withPdf };
  }, [accounts, overallAccountCount]);

  const selectedImportCount = useMemo(
    () => importRows.filter((row) => selectedImportRows[row.salidadetalleid]).length,
    [importRows, selectedImportRows],
  );

  const resetImportReferenceResults = useCallback(() => {
    setImportRows([]);
    setSelectedImportRows({});
  }, []);

  const resetImportReferenceSearch = useCallback(() => {
    setReferenceClienteQuery('');
    setReference2ClienteQuery('');
    resetImportReferenceResults();
  }, [resetImportReferenceResults]);

  const getSerieLabel = useCallback(
    (serieid?: number | null) => {
      if (!serieid) return 'Serie —';
      return seriesMap[serieid] || `Serie ${serieid}`;
    },
    [seriesMap],
  );

  const getDivisaLabel = useCallback(
    (divisaid?: number | null) => {
      if (!divisaid) return '—';
      return divisaNames[divisaid] || `#${divisaid}`;
    },
    [divisaNames],
  );

  const normalizeTipoPrecio = (value?: string | null) => {
    const raw = (value || 'K').toString().toUpperCase();
    if (raw === 'U') return 'P';
    if (raw === 'K' || raw === 'B' || raw === 'P') return raw;
    return 'K';
  };

  const normalizeObservaciones = (value?: string | null) => {
    if (!value) return '';
    // Orizon es sensible a comillas en textos libres; las retiramos solo al enviar.
    const cleaned = value
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/[‘’`´]/g, "'")
      .replace(/[“”]/g, '"');
    return cleaned.trim().replace(/['"]/g, '');
  };

  const buildCuentaVentaOrizonPayload = useCallback(
    (account: SalesAccountItem): CuentaVentaOrizonPayload => ({
      cuentaventaid: 0,
      serieid: account.serieid ?? 0,
      codigo_cuentaventa: 0,
      fechavaloracion: account.fechavaloracion ?? '',
      numero_cuentaventa: account.numero_cuentaventa ?? '',
      observaciones_valoracion: normalizeObservaciones(account.observaciones_valoracion),
      clienteid: account.clienteid ?? 0,
      listGastos: (account.gastos || []).map((g) => ({
        gastoid: g.gastoid ?? 0,
        valor_gasto: Number(g.valor_gasto ?? 0),
        acreedorid: g.acreedorid ?? 0,
      })),
      listDetalle: (account.detalles || []).map((d) => ({
        salidadetalleid: d.salidadetalleid ?? d.id ?? 0,
        cuentaventadetalleid: 0,
        listaSalidaValor: (d.valores || []).map((v) => ({
          total_kilosbrutos: Number(v.total_kilosbrutos ?? 0),
          total_kiloscliente: Number(v.total_kiloscliente ?? 0),
          total_kilosnetos: Number(v.total_kilosnetos ?? 0),
          total_piezas: Number(v.total_piezas ?? 0),
          total_bultos: Number(v.total_bultos ?? 0),
          nro_palets: Number(v.nro_palets ?? 0),
          divisaid: Number(v.divisaid ?? 0),
          cambiodivisa: 1,
          precio: Number(v.precio ?? 0),
          tipo_precio: normalizeTipoPrecio(v.tipo_precio),
        })),
      })),
    }),
    [],
  );

  const resolveOrizonCuentaVentaId = (data: unknown): number | null => {
    const candidate =
      typeof data === 'object' && data !== null
        ? (data as any).cuentaventaid ??
          (data as any).cuentaVentaId ??
          (data as any).cuenta_venta_id ??
          (data as any).id ??
          (data as any).cuentaventa?.id
        : data;

    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      const parsed = Number(candidate);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const tipoPrecioDescriptions: Record<string, string> = {
    K: 'Por kilo',
    B: 'Por bulto',
    P: 'Por pieza',
  };

  const fechaRangoLabel = useMemo(() => {
    if (fechaRango?.from && fechaRango?.to) {
      return `${format(fechaRango.from, 'dd/MM/yyyy')} - ${format(fechaRango.to, 'dd/MM/yyyy')}`;
    }
    if (fechaRango?.from) {
      return `Desde ${format(fechaRango.from, 'dd/MM/yyyy')}`;
    }
    if (fechaRango?.to) {
      return `Hasta ${format(fechaRango.to, 'dd/MM/yyyy')}`;
    }
    return 'Selecciona un rango';
  }, [fechaRango]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count += 1;
    if (ceoxStatusFilter !== 'all') count += 1;
    if (clienteFilter) count += 1;
    if (alertFilter !== 'all') count += 1;
    if (detalleFilter !== 'all') count += 1;
    if (fechaRango?.from || fechaRango?.to) count += 1;
    return count;
  }, [search, ceoxStatusFilter, clienteFilter, alertFilter, detalleFilter, fechaRango]);

  const visibleAccounts = useMemo(() => {
    const pageAccountIdSet = new Set(pageAccountIds);
    return accounts
      .filter((account) => pageAccountIdSet.has(account.id))
      .sort((left, right) => compareSalesAccounts(left, right, orderBy));
  }, [accounts, orderBy, pageAccountIds]);

  useEffect(() => {
    setCurrentPage((prev) => (prev === 1 ? prev : 1));
  }, [
    search,
    ceoxStatusFilter,
    clienteFilter,
    alertFilter,
    detalleFilter,
    orderBy,
    fechaRango?.from,
    fechaRango?.to,
  ]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId],
  );

  useEffect(() => {
    let active = true;

    setSharedAccountPdfRelatedCount(0);
    setSharedPdfPanelOpen(false);

    if (!detailsOpen || !selectedAccount?.archivo_pdf_id) {
      return () => {
        active = false;
      };
    }

    const loadSharedAccountPdfRelatedCount = async () => {
      try {
        const accountsByPdf = await salesAccounts.getAccountsByPdfId(
          selectedAccount.archivo_pdf_id!,
          selectedAccount.clienteid,
        );

        if (!active) return;
        const relatedCount = accountsByPdf.filter((account) => account.account_id !== selectedAccount.id).length;
        setSharedAccountPdfRelatedCount(relatedCount);
      } catch (error) {
        if (!active) return;
        console.error('Error comprobando cuentas relacionadas por PDF:', error);
        setSharedAccountPdfRelatedCount(0);
      }
    };

    void loadSharedAccountPdfRelatedCount();

    return () => {
      active = false;
    };
  }, [detailsOpen, selectedAccount?.archivo_pdf_id, selectedAccount?.clienteid, selectedAccount?.id]);

  const visiblePdfIds = useMemo(
    () =>
      new Set(
        visibleAccounts
          .map((account) => account.archivo_pdf_id)
          .filter((archivoPdfId): archivoPdfId is number => typeof archivoPdfId === 'number'),
      ),
    [visibleAccounts],
  );

  useEffect(() => {
    if (!selectedAccount?.archivo_pdf_id || visiblePdfIds.has(selectedAccount.archivo_pdf_id)) {
      setSelectedAccountPdfInfo([]);
      setSelectedAccountPdfErrors([]);
      return;
    }

    let cancelled = false;

    const loadSelectedPdfContext = async () => {
      try {
        const [pdfAccounts, pdfErrors] = await Promise.all([
          salesAccounts.getAccountsByPdfId(selectedAccount.archivo_pdf_id!, selectedAccount.clienteid),
          salesAccounts.getErrorsByPdfIds([selectedAccount.archivo_pdf_id!]),
        ]);

        if (cancelled) return;
        setSelectedAccountPdfInfo(pdfAccounts);
        setSelectedAccountPdfErrors(pdfErrors);
      } catch (error) {
        if (cancelled) return;
        console.error('Error cargando contexto PDF de la cuenta seleccionada', error);
        setSelectedAccountPdfInfo([]);
        setSelectedAccountPdfErrors([]);
      }
    };

    void loadSelectedPdfContext();

    return () => {
      cancelled = true;
    };
  }, [selectedAccount?.archivo_pdf_id, selectedAccount?.clienteid, visiblePdfIds]);

  const allKnownAccountErrors = useMemo(() => {
    const merged = new Map<number, SalesAccountError>();
    [...accountErrors, ...selectedAccountPdfErrors].forEach((error) => {
      merged.set(error.id, error);
    });
    return Array.from(merged.values());
  }, [accountErrors, selectedAccountPdfErrors]);

  const selectedAccountPdfSearchCandidates = useMemo(
    () => (selectedAccount ? buildPdfSearchCandidatesFromAccount(selectedAccount) : []),
    [selectedAccount],
  );

  const getPdfDocumentOnlyPages = useCallback(
    (archivoPdfId: number | null | undefined) => {
      if (!archivoPdfId) return [];

      return Array.from(
        new Set(
          allKnownAccountErrors
            .filter(
              (err) =>
                err.archivo_pdf_id === archivoPdfId &&
                typeof err.numero_pagina === 'number' &&
                err.numero_pagina > 0,
            )
            .map((err) => err.numero_pagina as number),
        ),
      ).sort((left, right) => left - right);
    },
    [allKnownAccountErrors],
  );

  const inferPdfPageByAccountOrder = useCallback(
    (account: SalesAccountWithTotals): number | null => {
      if (!account.archivo_pdf_id) return null;

      const relatedAccounts = visibleAccounts.filter(
        (item) =>
          item.archivo_pdf_id === account.archivo_pdf_id &&
          (account.clienteid ? item.clienteid === account.clienteid : true),
      );
      const fallbackAccounts =
        relatedAccounts.length > 1
          ? relatedAccounts.map((item) => ({ id: item.id, numero_cuentaventa: item.numero_cuentaventa }))
          : selectedAccount?.id === account.id && selectedAccountPdfInfo.length > 1
            ? selectedAccountPdfInfo.map((item) => ({
                id: item.account_id,
                numero_cuentaventa: item.numero_cuentaventa,
              }))
            : [];

      if (fallbackAccounts.length <= 1) return null;

      const sortedAccounts = [...fallbackAccounts].sort((left, right) => {
        const leftRef = (left.numero_cuentaventa || `${left.id}`).toString();
        const rightRef = (right.numero_cuentaventa || `${right.id}`).toString();
        return leftRef.localeCompare(rightRef, 'es', { numeric: true, sensitivity: 'base' });
      });

      const accountIndex = sortedAccounts.findIndex((item) => item.id === account.id);
      if (accountIndex < 0) return null;

      const basePage = accountIndex + 1;
      const documentOnlyPages = getPdfDocumentOnlyPages(account.archivo_pdf_id);
      if (documentOnlyPages.length === 0) return basePage;

      // Ajusta el fallback cuando el PDF contiene páginas adicionales sin cuenta válida.
      let estimatedPage = basePage;
      while (true) {
        const shiftedPage =
          basePage + documentOnlyPages.filter((pageNumber) => pageNumber <= estimatedPage).length;
        if (shiftedPage === estimatedPage) return shiftedPage;
        estimatedPage = shiftedPage;
      }
    },
    [getPdfDocumentOnlyPages, selectedAccount?.id, selectedAccountPdfInfo, visibleAccounts],
  );

  const selectedAccountPdfFallbackPage = useMemo(
    () => (selectedAccount ? inferPdfPageByAccountOrder(selectedAccount) : null),
    [selectedAccount, inferPdfPageByAccountOrder],
  );

  const groupedAccounts = useMemo(() => {
    const groups = new Map<number | null, { accounts: SalesAccountItem[]; errors: SalesAccountError[] }>();

    const getDateValue = (value?: string | null) => {
      if (!value) return 0;
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    const ensureGroup = (key: number | null) => {
      if (!groups.has(key)) groups.set(key, { accounts: [], errors: [] });
      return groups.get(key)!;
    };

    const visiblePdfIds = new Set(visibleAccounts.map((acc) => acc.archivo_pdf_id ?? null));

    visibleAccounts.forEach((acc) => {
      const key = acc.archivo_pdf_id ?? null;
      ensureGroup(key).accounts.push(acc);
    });

    accountErrors
      .filter((err) => visiblePdfIds.has(err.archivo_pdf_id ?? null))
      .forEach((err) => {
        const key = err.archivo_pdf_id ?? null;
        ensureGroup(key).errors.push(err);
      });

    // Las cuentas sin detalles deben computar como aviso en el resumen/filtros del bloque.
    let syntheticWarningId = -1;
    visibleAccounts.forEach((acc) => {
      if ((acc.detalles?.length ?? 0) > 0) return;
      const key = acc.archivo_pdf_id ?? null;
      const ref = (acc.numero_cuentaventa || '').toString().trim() || `#${acc.id}`;
      ensureGroup(key).errors.push({
        id: syntheticWarningId--,
        archivo_pdf_id: key,
        codigo: WARNING_CODE_SIN_DETALLES,
        mensaje: `Cuenta ${ref} sin detalles de línea.`,
        numero_pagina: null,
        created_at: acc.updated_at || acc.created_at,
      });
    });

    const arr: SalesAccountGroup[] = Array.from(groups.entries()).map(([archivoPdfId, group]) => {
      const sortedAccounts = [...group.accounts].sort((a, b) => compareSalesAccounts(a, b, orderBy));
      const sortedErrors = [...group.errors].sort(
        (a, b) => getDateValue(b.created_at) - getDateValue(a.created_at),
      );

      const latestAccountDate = group.accounts.reduce<string | null>((latest, account) => {
        const candidate = account.fechavaloracion || account.created_at || null;
        if (!candidate) return latest;
        if (!latest) return candidate;
        return getDateValue(candidate) > getDateValue(latest) ? candidate : latest;
      }, null);
      const latestErrorDate = sortedErrors[0]?.created_at || null;
      const latestArrivalDate = sortedAccounts.reduce<string | null>((latest, account) => {
        const arrival = account.llegada_correo ?? account.created_at ?? null;
        if (!arrival) return latest;
        if (!latest) return arrival;
        return getDateValue(arrival) > getDateValue(latest) ? arrival : latest;
      }, null);
      const latestSortDate = latestArrivalDate || latestErrorDate || latestAccountDate;
      const latestTimestamp = getDateValue(latestSortDate);
      const latestDate =
        getDateValue(latestAccountDate) >= getDateValue(latestErrorDate) ? latestAccountDate : latestErrorDate;

      return {
        archivoPdfId,
        accounts: sortedAccounts,
        errors: sortedErrors,
        latestDate,
        latestArrivalDate,
        latestTimestamp,
      };
    });

    return arr.sort((a, b) => compareSalesAccountGroups(a, b, orderBy));
  }, [accountErrors, orderBy, visibleAccounts]);

  const totalGroupPages = Math.max(1, Math.ceil(totalGroupCount / Math.max(1, itemsPerPage)));
  const pageTransitionLoading = loading && visibleAccounts.length > 0;
  const blockingLoading = loading && !pageTransitionLoading;

  useEffect(() => {
    if (currentPage <= totalGroupPages) return;
    setCurrentPage(totalGroupPages);
  }, [currentPage, totalGroupPages]);

  useEffect(() => {
    if (!selectedAccount) {
      setIsEditing(false);
      setEditForm({});
      setPdfUrl(null);
      setSharedPdfPanelOpen(false);
      setEditingDetalleId(null);
      setEditedDetalleValues({});
      setShowNewDetalleForm(false);
      setShowImportByReference(false);
      resetImportReferenceSearch();
      return;
    }
    setEditForm({
      numero_cuentaventa: selectedAccount.numero_cuentaventa || '',
      serieid: selectedAccount.serieid,
      codigo_cuentaventa: selectedAccount.codigo_cuentaventa,
      fechavaloracion: selectedAccount.fechavaloracion,
      clienteid: selectedAccount.clienteid,
      observaciones_valoracion: selectedAccount.observaciones_valoracion || '',
      needs_sync: selectedAccount.needs_sync,
      enviado: selectedAccount.enviado,
      total_cuentaventa: selectedAccount.total_cuentaventa,
      gastos: selectedAccount.gastos.map((g) => ({ ...g })),
    } as Partial<SalesAccountItem>);
    setNewDetalle({
      salidadetalleid: null,
      total_kilosbrutos: 0,
      total_kiloscliente: 0,
      total_kilosnetos: 0,
      total_piezas: 0,
      total_bultos: 0,
      nro_palets: 0,
      divisaid: 0,
      precio: 0,
      tipo_precio: 'K',
    });
    setShowPdfPreview(false);
    setEditingDetalleId(null);
    setEditedDetalleValues({});
    setShowNewDetalleForm(false);
    setShowImportByReference(false);
    resetImportReferenceSearch();
  }, [resetImportReferenceSearch, selectedAccount]);

  const startEditingAccount = () => {
    if (!selectedAccount) return;
    if (selectedAccount.idcuentaventa_orizon) {
      toast({
        title: 'Cuenta bloqueada',
        description: `Esta cuenta ya está enviada a Orizon (ID ${selectedAccount.idcuentaventa_orizon}).`,
      });
      return;
    }
    setShowNewDetalleForm(false);
    setShowImportByReference(false);
    resetImportReferenceSearch();
    setEditForm({
      numero_cuentaventa: selectedAccount.numero_cuentaventa || '',
      serieid: selectedAccount.serieid,
      codigo_cuentaventa: selectedAccount.codigo_cuentaventa,
      fechavaloracion: selectedAccount.fechavaloracion,
      clienteid: selectedAccount.clienteid,
      observaciones_valoracion: selectedAccount.observaciones_valoracion || '',
      needs_sync: selectedAccount.needs_sync,
      enviado: selectedAccount.enviado,
      total_cuentaventa: selectedAccount.total_cuentaventa,
      gastos: selectedAccount.gastos.map((g) => ({ ...g })),
    } as Partial<SalesAccountItem>);
    setIsEditing(true);
  };

  const handleAddGasto = () => {
    if (!selectedAccount) return;
    setEditForm((prev) => {
      const baseGastos = ((prev.gastos as SalesAccountItem['gastos'] | undefined) ?? selectedAccount.gastos).map((g) => ({
        ...g,
      }));
      const minTempId = baseGastos.reduce((min, gasto) => (gasto.id < min ? gasto.id : min), 0);
      const nextTempId = minTempId <= 0 ? minTempId - 1 : -1;

      return {
        ...prev,
        gastos: [
          ...baseGastos,
          {
            id: nextTempId,
            gastoid: 0,
            valor_gasto: 0,
            acreedorid: null,
          },
        ],
      };
    });
  };

  const handleRemoveDraftGasto = (draftGastoId: number) => {
    if (!selectedAccount) return;
    setEditForm((prev) => {
      const baseGastos = ((prev.gastos as SalesAccountItem['gastos'] | undefined) ?? selectedAccount.gastos).map((g) => ({
        ...g,
      }));
      return {
        ...prev,
        gastos: baseGastos.filter((g) => g.id !== draftGastoId),
      };
    });
  };

  const updateDetalleValue = (valueId: number, changes: Partial<SalesAccountValue>) => {
    setEditedDetalleValues((prev) => ({
      ...prev,
      [valueId]: {
        ...prev[valueId],
        ...changes,
      },
    }));
  };

  const handleSave = async () => {
    if (!selectedAccount) return;
    try {
      setSaving(true);
      const {
        numero_cuentaventa,
        serieid,
        fechavaloracion,
        clienteid,
        observaciones_valoracion,
        needs_sync,
        enviado,
        total_cuentaventa,
        gastos,
      } = editForm as SalesAccountItem;

      const { error: headErr } = await supabase
        .from('cuentaventas')
        .update({
          numero_cuentaventa,
          serieid,
          codigo_cuentaventa: 0,
          fechavaloracion,
          clienteid,
          observaciones_valoracion,
          needs_sync,
          enviado,
          total_cuentaventa: toNumberOrZero(total_cuentaventa),
        })
        .eq('id', selectedAccount.id);

      if (headErr) throw headErr;

      if (gastos) {
        const normalizedGastos = gastos.map((g) => ({
          ...g,
          gastoid: Number(g.gastoid) || 0,
          valor_gasto: toNumberOrZero(g.valor_gasto),
          acreedorid: g.acreedorid ?? null,
        }));
        const invalidGasto = normalizedGastos.find((g) => g.gastoid <= 0);
        if (invalidGasto) {
          throw new Error('Debes seleccionar un gasto válido antes de guardar.');
        }

        for (const g of normalizedGastos) {
          if (g.id > 0) {
            const { error: gErr } = await supabase
              .from('cuentaventa_gastos')
              .update({
                gastoid: g.gastoid,
                valor_gasto: g.valor_gasto,
                acreedorid: g.acreedorid,
              })
              .eq('id', g.id);
            if (gErr) throw gErr;
            continue;
          }

          const { error: gErr } = await supabase.from('cuentaventa_gastos').insert({
            cuentaventaid: selectedAccount.id,
            gastoid: g.gastoid,
            valor_gasto: g.valor_gasto,
            acreedorid: g.acreedorid,
          });
          if (gErr) throw gErr;
        }
      }

      for (const [valorId, changes] of Object.entries(editedDetalleValues)) {
        if (!changes || Object.keys(changes).length === 0) continue;
        const payload: Partial<SalesAccountValue> = {};
        if (changes.total_kilosbrutos !== undefined) payload.total_kilosbrutos = toNumberOrZero(changes.total_kilosbrutos);
        if (changes.total_kiloscliente !== undefined) payload.total_kiloscliente = toNumberOrZero(changes.total_kiloscliente);
        if (changes.total_kilosnetos !== undefined) payload.total_kilosnetos = toNumberOrZero(changes.total_kilosnetos);
        if (changes.total_piezas !== undefined) payload.total_piezas = toNumberOrZero(changes.total_piezas);
        if (changes.total_bultos !== undefined) payload.total_bultos = toNumberOrZero(changes.total_bultos);
        if (changes.nro_palets !== undefined) payload.nro_palets = toNumberOrZero(changes.nro_palets);
        if (changes.divisaid !== undefined) payload.divisaid = toNumberOrZero(changes.divisaid);
        if (changes.precio !== undefined) payload.precio = toNumberOrZero(changes.precio);
        if (changes.tipo_precio !== undefined) {
          payload.tipo_precio = normalizeTipoPrecio(changes.tipo_precio);
        }
        if (Object.keys(payload).length === 0) continue;

        const { error: valorErr } = await supabase
          .from('cuentaventa_detalle_valor')
          .update(payload)
          .eq('id', Number(valorId));
        if (valorErr) throw valorErr;
      }

      toast({
        title: 'Cuenta actualizada',
        description: 'Los cambios se guardaron correctamente.',
      });
      setIsEditing(false);
      setEditingDetalleId(null);
      setEditedDetalleValues({});
      setNewDetalle({
        salidadetalleid: null,
        total_kilosbrutos: 0,
        total_kiloscliente: 0,
        total_kilosnetos: 0,
        total_piezas: 0,
        total_bultos: 0,
        nro_palets: 0,
        divisaid: 0,
        precio: 0,
        tipo_precio: 'K',
      });
      setShowNewDetalleForm(false);
      fetchAccounts(true);
    } catch (error: any) {
      console.error('Error guardando cuenta de venta', error);
      toast({
        title: 'Error al guardar',
        description: error?.message ?? 'No se pudieron guardar los cambios.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedAccount) return;
    if (selectedAccount.idcuentaventa_orizon) {
      toast({
        title: 'Cuenta bloqueada',
        description: `No se puede eliminar una cuenta ya enviada a Orizon (ID ${selectedAccount.idcuentaventa_orizon}).`,
        variant: 'destructive',
      });
      return;
    }
    try {
      setDeleting(true);
      const pdfId = selectedAccount.archivo_pdf_id;

      const { error: delErr } = await supabase
        .from('cuentaventas')
        .delete()
        .eq('id', selectedAccount.id);
      if (delErr) throw delErr;

      if (pdfId) {
        // Comprobar si el PDF sigue referenciado por otras cuentas/pedidos
        const { count: countCv } = await supabase
          .from('cuentaventas')
          .select('*', { count: 'exact', head: true })
          .eq('archivo_pdf_id', pdfId);
        const { count: countPedidos } = await supabase
          .from('pedidos')
          .select('*', { count: 'exact', head: true })
          .eq('archivo_pdf_id', pdfId);
        if ((countCv || 0) + (countPedidos || 0) === 0) {
          await supabase.from('archivos_pdf').delete().eq('id', pdfId);
        }
      }

      toast({ title: 'Cuenta eliminada', description: 'Se eliminó la cuenta y sus datos asociados.' });
      closeAccountDetails();
      fetchAccounts(true);
    } catch (error: any) {
      console.error('Error eliminando cuenta', error);
      toast({
        title: 'Error al eliminar',
        description: error?.message ?? 'No se pudo eliminar la cuenta.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const loadPdf = useCallback(
    async (
      archivoPdfId: number,
      searchInput?: string | string[] | null,
      fallbackPage?: number | null,
    ) => {
      try {
        setLoadingPdf(true);
        setPdfPreviewPage(null);
        const content = await agroirisPdfFiles.getPdfContent(archivoPdfId);
        if (content) {
          const pdfBytes = base64ToUint8Array(content);
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          setPdfUrl(url);

          const searchCandidates = normalizeSearchCandidates(searchInput);
          let resolvedPreviewPage: number | null = null;

          if (searchCandidates.length > 0) {
            const cacheKey = buildPdfMatchCacheKey(archivoPdfId, searchCandidates);
            if (cacheKey && Object.prototype.hasOwnProperty.call(pdfMatchPageCacheRef.current, cacheKey)) {
              resolvedPreviewPage = pdfMatchPageCacheRef.current[cacheKey] ?? null;
            } else {
              const pageFromMatch = await findFirstPageBySearchCandidates(pdfBytes, searchCandidates);
              if (cacheKey) {
                pdfMatchPageCacheRef.current[cacheKey] = pageFromMatch;
              }
              resolvedPreviewPage = pageFromMatch;
            }
          }

          if (!resolvedPreviewPage && typeof fallbackPage === 'number' && fallbackPage > 0) {
            resolvedPreviewPage = fallbackPage;
          }

          setPdfPreviewPage(resolvedPreviewPage);
        } else {
          setPdfPreviewPage(null);
          toast({
            title: 'PDF no disponible',
            description: 'No se pudo obtener el PDF.',
            variant: 'destructive',
          });
        }
      } catch (error) {
        setPdfPreviewPage(null);
        console.error('Error cargando PDF', error);
        toast({
          title: 'Error al cargar PDF',
          description: 'No se pudo cargar el PDF.',
          variant: 'destructive',
        });
      } finally {
        setLoadingPdf(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!selectedAccount?.archivo_pdf_id) {
      setPdfUrl(null);
      setPdfPreviewPage(null);
      setLoadingPdf(false);
      setShowPdfPreview(false);
      setNewDetalle({
        salidadetalleid: null,
        total_kilosbrutos: 0,
        total_kiloscliente: 0,
        total_kilosnetos: 0,
        total_piezas: 0,
        total_bultos: 0,
        nro_palets: 0,
        divisaid: 0,
        precio: 0,
        tipo_precio: 'K',
      });
      return;
    }
    loadPdf(
      selectedAccount.archivo_pdf_id,
      selectedAccountPdfSearchCandidates,
      selectedAccountPdfFallbackPage,
    );
  }, [
    selectedAccount?.archivo_pdf_id,
    selectedAccountPdfSearchCandidates,
    selectedAccountPdfFallbackPage,
    loadPdf,
  ]);

  useEffect(() => {
    if (!selectedAccount?.detalles?.length) return;
    const ids = Array.from(
      new Set(
        selectedAccount.detalles
          .map((d) => d.salidadetalleid)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      ),
    );
    const missing = ids.filter(
      (id) => !salidaDetalleMap[id] && !salidaDetalleLoading[id] && !salidaDetalleErrors[id],
    );
    if (!missing.length) return;

    let cancelled = false;

    const fetchSalidas = async () => {
      for (const id of missing) {
        if (cancelled) break;
        setSalidaDetalleLoading((prev) => ({ ...prev, [id]: true }));
        try {
          const data = await agroirisSalidas.getSalidaDetalle(id);
          if (cancelled) continue;
          if (data) {
            setSalidaDetalleMap((prev) => ({ ...prev, [id]: data }));
            setSalidaDetalleErrors((prev) => {
              if (!prev[id]) return prev;
              const next = { ...prev };
              delete next[id];
              return next;
            });
          } else {
            // La API de cuentas puede no devolver líneas de salida: lo marcamos internamente sin mensaje visible.
            setSalidaDetalleErrors((prev) => ({ ...prev, [id]: NO_ORIZON_LINE_DATA }));
          }
        } catch (error: any) {
          if (!cancelled) {
            setSalidaDetalleErrors((prev) => ({
              ...prev,
              [id]: error?.message ?? 'No se pudo cargar la salida.',
            }));
          }
        } finally {
          if (!cancelled) {
            setSalidaDetalleLoading((prev) => ({ ...prev, [id]: false }));
          }
        }
      }
    };

    fetchSalidas();

    return () => {
      cancelled = true;
    };
  }, [selectedAccount]);


  useEffect(() => {
    if (!detailsOpen || !selectedAccount) {
      lastLoggedPreviewRef.current = null;
      return;
    }

    const payload = buildCuentaVentaOrizonPayload(selectedAccount);
    const signature = JSON.stringify({
      accountId: selectedAccount.id,
      totalDetalles: payload.listDetalle.length,
      totalValores: payload.listDetalle.reduce((acc, detalle) => acc + detalle.listaSalidaValor.length, 0),
      payload,
    });

    if (signature === lastLoggedPreviewRef.current) return;
    lastLoggedPreviewRef.current = signature;

    const previewLabel =
      '[Orizon][CuentaVenta][Preview] Cuenta #' +
      String(selectedAccount.numero_cuentaventa || selectedAccount.id);

    try {
      console.log(previewLabel, JSON.stringify(payload, null, 2));
    } catch {
      console.log(previewLabel, payload);
    }
  }, [buildCuentaVentaOrizonPayload, detailsOpen, selectedAccount]);

  const openPdfInNewTab = async (
    archivoPdfId: number,
    page?: number | null,
    searchInput?: string | string[] | null,
    fallbackPage?: number | null,
  ) => {
    try {
      const { data, error } = await supabase
        .from('archivos_pdf')
        .select('b64_contenido')
        .eq('id', archivoPdfId)
        .single();
      if (error) throw error;
      if (!data?.b64_contenido) return;

      const pdfBytes = base64ToUint8Array(data.b64_contenido);
      const searchCandidates = normalizeSearchCandidates(searchInput);
      const primarySearchText = searchCandidates[0] ?? '';
      let resolvedPage = typeof page === 'number' && page > 0 ? page : null;

      if (!resolvedPage && searchCandidates.length > 0) {
        const cacheKey = buildPdfMatchCacheKey(archivoPdfId, searchCandidates);
        if (cacheKey && Object.prototype.hasOwnProperty.call(pdfMatchPageCacheRef.current, cacheKey)) {
          resolvedPage = pdfMatchPageCacheRef.current[cacheKey] ?? null;
        } else {
          const pageFromMatch = await findFirstPageBySearchCandidates(pdfBytes, searchCandidates);
          if (cacheKey) {
            pdfMatchPageCacheRef.current[cacheKey] = pageFromMatch;
          }
          resolvedPage = pageFromMatch;
        }
      }
      if (!resolvedPage && typeof fallbackPage === 'number' && fallbackPage > 0) {
        resolvedPage = fallbackPage;
      }

      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(buildPdfViewerUrl(url, resolvedPage, primarySearchText), '_blank');
    } catch (err) {
      console.error('Error opening PDF', err);
      toast({
        title: 'PDF no disponible',
        description: 'No se pudo abrir el PDF.',
        variant: 'destructive',
      });
    }
  };

  const handleCopyAccountNumber = async (account: SalesAccountItem) => {
    const numero = (account.numero_cuentaventa ?? '').toString().trim();
    if (!numero) {
      toast({
        title: 'Sin número',
        description: 'Esta cuenta no tiene número para copiar.',
      });
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(numero);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = numero;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        textArea.style.pointerEvents = 'none';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      toast({
        title: 'Número copiado',
        description: numero,
      });
    } catch (error) {
      console.error('Error copiando número de cuenta', error);
      toast({
        title: 'No se pudo copiar',
        description: 'Copia manualmente el número de cuenta.',
        variant: 'destructive',
      });
    }
  };

  const handleExportGroupExcel = async (group: SalesAccountGroup) => {
    if (!group.accounts.length) {
      toast({
        title: 'Sin cuentas para exportar',
        description: 'Este bloque no tiene cuentas válidas.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const XLSX = await import('xlsx');
      const ACCOUNT_HEADER = 'Cuenta de Venta';
      const TOTAL_HEADER = 'Total';
      const rows = group.accounts.map((acc) => ({
        [ACCOUNT_HEADER]: (acc.numero_cuentaventa || `#${acc.id}`).toString().trim(),
        [TOTAL_HEADER]: Number(toNumberOrZero(acc.total_cuentaventa).toFixed(2)),
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows, {
        header: [ACCOUNT_HEADER, TOTAL_HEADER],
      });

      // Ajustar ancho de columnas para que el Excel sea legible al abrirlo.
      const numeroMax = Math.max(
        ACCOUNT_HEADER.length,
        ...rows.map((row) => String(row[ACCOUNT_HEADER]).length),
      );
      const totalMax = Math.max(
        TOTAL_HEADER.length,
        ...rows.map((row) => Number(row[TOTAL_HEADER]).toFixed(2).length),
      );
      (worksheet as any)['!cols'] = [
        { wch: Math.min(40, numeroMax + 2) },
        { wch: Math.min(24, totalMax + 2) },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Cuentas');

      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const fileScope = group.archivoPdfId ? `pdf_${group.archivoPdfId}` : 'sin_pdf';
      const timestamp = format(new Date(), 'yyyyMMdd_HHmmss');
      anchor.href = url;
      anchor.download = `cuentaventas_${fileScope}_${timestamp}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Error exportando Excel de cuentas de venta', error);
      toast({
        title: 'No se pudo exportar el Excel',
        description: error?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    }
  };

  const handleDeletePdfGroup = async (archivoPdfId: number) => {
    try {
      setDeletingPdfId(archivoPdfId);
      const { error: delCuentasErr } = await supabase.from('cuentaventas').delete().eq('archivo_pdf_id', archivoPdfId);
      if (delCuentasErr) throw delCuentasErr;

      const { error: delPdfErr } = await supabase.from('archivos_pdf').delete().eq('id', archivoPdfId);
      if (delPdfErr) throw delPdfErr;

      toast({
        title: 'PDF eliminado',
        description: 'Se eliminaron todas las cuentas de venta asociadas a este PDF.',
      });
      closeAccountDetails();
      fetchAccounts(true);
    } catch (error: any) {
      console.error('Error eliminando PDF y cuentas asociadas', error);
      toast({
        title: 'No se pudo eliminar',
        description: error?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setDeletingPdfId(null);
      setPendingDeletePdfId(null);
    }
  };

  const handleSearchImportByReference = async (field: 'referencia_cliente' | 'referencia2_cliente') => {
    if (!selectedAccount) return;
    if (selectedAccount.idcuentaventa_orizon || (selectedAccount.detalles?.length ?? 0) > 0) return;

    const referenciaCliente = referenceClienteQuery.trim();
    const referencia2Cliente = reference2ClienteQuery.trim();
    const searchValue = field === 'referencia_cliente' ? referenciaCliente : referencia2Cliente;
    const searchLabel = field === 'referencia_cliente' ? 'referencia del cliente' : 'referencia 2 del cliente';

    if (!searchValue) {
      toast({
        title: 'Introduce una referencia',
        description: `Escribe una ${searchLabel} para buscar líneas.`,
      });
      return;
    }

    if (!selectedAccount.clienteid || selectedAccount.clienteid <= 0) {
      toast({
        title: 'Cliente inválido',
        description: 'La cuenta no tiene un cliente válido para buscar salidas.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setImportLoading(true);
      setActiveImportSearchField(field);
      const salidasEncontradas = await agroirisSalidas.searchSalidasDetalleCuentaVentaByReferencia(
        selectedAccount.clienteid,
        field === 'referencia_cliente'
          ? { referenciaCliente: searchValue }
          : { referencia2Cliente: searchValue },
      );
      const {
        resolvedLineas,
        blockedSalidaDetalleIds,
        blockedSalidaIds,
        externalLinks,
        localLinks,
      } = await analyzeImportReferenceConflicts(salidasEncontradas);

      const existingSalidaDetalleIds = new Set(
        (selectedAccount.detalles ?? [])
          .map((d) => d.salidadetalleid)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      );

      let omittedDuplicates = 0;
      const omittedLinked = blockedSalidaDetalleIds.size;
      const filteredAlbaranes = blockedSalidaIds.size;
      const rows = resolvedLineas
        .map((linea) => mapImportableSalidaToRow(linea, normalizeTipoPrecio))
        .filter((linea) => {
          if (existingSalidaDetalleIds.has(linea.salidadetalleid)) {
            omittedDuplicates += 1;
            return false;
          }
          return true;
        })
        .sort((left, right) => {
          const leftRef = left.referencia_cliente || left.referencia2_cliente || '';
          const rightRef = right.referencia_cliente || right.referencia2_cliente || '';
          const refCmp = leftRef.localeCompare(rightRef, 'es', { sensitivity: 'base', numeric: true });
          if (refCmp !== 0) return refCmp;
          const ref2Cmp = (left.referencia2_cliente || '').localeCompare(right.referencia2_cliente || '', 'es', {
            sensitivity: 'base',
            numeric: true,
          });
          if (ref2Cmp !== 0) return ref2Cmp;
          return left.salidadetalleid - right.salidadetalleid;
        });

      setImportRows(rows);
      setSelectedImportRows(
        Object.fromEntries(rows.map((linea) => [linea.salidadetalleid, true])) as Record<number, boolean>,
      );

      if (rows.length === 0) {
        const warningMessage =
          filteredAlbaranes > 0
            ? `${filteredAlbaranes} albarán${filteredAlbaranes === 1 ? '' : 'es'} ya tiene${filteredAlbaranes === 1 ? '' : 'n'} cuenta de venta. `
            : '';
        const emptyDescription =
          omittedLinked > 0
            ? `${warningMessage}${buildCuentaVentaConflictDescription(externalLinks, localLinks)}`
            : omittedDuplicates > 0
              ? `Se omitieron ${omittedDuplicates} líneas ya existentes.`
              : `No se encontraron líneas con esa ${searchLabel}.`;
        toast({
          title: omittedLinked > 0 ? 'Albaranes con cuenta de venta' : 'Sin líneas para importar',
          description: emptyDescription,
        });
        return;
      }

      const conflictDescription = omittedLinked > 0 ? buildCuentaVentaConflictDescription(externalLinks, localLinks) : '';
      const warningMessage =
        filteredAlbaranes > 0
          ? `${filteredAlbaranes} albarán${filteredAlbaranes === 1 ? '' : 'es'} ya tiene${filteredAlbaranes === 1 ? '' : 'n'} cuenta de venta, pero se muestra${filteredAlbaranes === 1 ? '' : 'n'} igualmente. `
          : '';
      const successDescription =
        omittedLinked > 0 && omittedDuplicates > 0
          ? `${warningMessage}${rows.length} líneas disponibles (${omittedDuplicates} duplicadas omitidas en esta cuenta). ${conflictDescription}`
          : omittedLinked > 0
            ? `${warningMessage}${rows.length} líneas disponibles. ${conflictDescription}`
            : omittedDuplicates > 0
              ? `${rows.length} líneas disponibles (${omittedDuplicates} duplicadas omitidas).`
              : `${rows.length} líneas listas para seleccionar.`;
      toast({
        title: 'Líneas encontradas',
        description: successDescription,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Intenta nuevamente.';
      console.error('Error buscando líneas por referencia', error);
      resetImportReferenceResults();
      toast({
        title: 'No se pudieron cargar las líneas',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setImportLoading(false);
      setActiveImportSearchField(null);
    }
  };

  const handleToggleImportRow = (salidadetalleid: number, checked: boolean | 'indeterminate') => {
    const nextChecked = checked === true;
    setSelectedImportRows((prev) => ({ ...prev, [salidadetalleid]: nextChecked }));
  };

  const handleRemoveImportRowFromSelection = (salidadetalleid: number) => {
    setSelectedImportRows((prev) => ({ ...prev, [salidadetalleid]: false }));
  };

  const handleUpdateImportRowDivisa = (divisaid: number | null) => {
    const normalizedDivisa = divisaid && divisaid > 0 ? divisaid : null;
    setImportRows((prev) =>
      prev.map((row) => ({ ...row, divisaid: normalizedDivisa })),
    );
  };

  const handleUpdateImportRowPrecio = (salidadetalleid: number, rawValue: string) => {
    setImportRows((prev) =>
      prev.map((row) =>
        row.salidadetalleid === salidadetalleid ? { ...row, precio: toFiniteNullableNumber(rawValue) } : row,
      ),
    );
  };

  const handleImportSelectedRows = async () => {
    if (!selectedAccount) return;
    if (selectedAccount.idcuentaventa_orizon) return;
    if ((selectedAccount.detalles?.length ?? 0) > 0) return;

    const rowsSelectedByUser = importRows.filter((row) => selectedImportRows[row.salidadetalleid]);
    if (rowsSelectedByUser.length === 0) {
      toast({
        title: 'No hay líneas seleccionadas',
        description: 'Marca al menos una línea para importar.',
      });
      return;
    }

    const firstMissingDivisa = rowsSelectedByUser.find((row) => !row.divisaid || row.divisaid <= 0);
    const firstMissingPrecio = rowsSelectedByUser.find(
      (row) => row.precio === null || row.precio === undefined || !Number.isFinite(Number(row.precio)),
    );

    if (firstMissingDivisa || firstMissingPrecio) {
      const target = firstMissingDivisa ?? firstMissingPrecio;
      const missingBits = [
        firstMissingDivisa ? 'divisa' : null,
        firstMissingPrecio ? 'precio' : null,
      ].filter(Boolean);
      toast({
        title: 'Faltan datos en líneas seleccionadas',
        description: `Falta ${missingBits.join(' y ')}. Revisa SalidaDetalle #${target?.salidadetalleid}.`,
        variant: 'destructive',
      });
      return;
    }

    const existingSalidaDetalleIds = new Set(
      (selectedAccount.detalles ?? [])
        .map((d) => d.salidadetalleid)
        .filter((id): id is number => typeof id === 'number' && id > 0),
    );

    const seenInSelection = new Set<number>();
    let omittedDuplicates = 0;
    const rowsToInsert: ImportByReferenceRow[] = [];

    for (const row of rowsSelectedByUser) {
      if (existingSalidaDetalleIds.has(row.salidadetalleid) || seenInSelection.has(row.salidadetalleid)) {
        omittedDuplicates += 1;
        continue;
      }
      seenInSelection.add(row.salidadetalleid);
      rowsToInsert.push(row);
    }

    if (rowsToInsert.length === 0) {
      toast({
        title: 'Sin líneas nuevas',
        description: 'Todas las líneas seleccionadas estaban duplicadas.',
      });
      return;
    }

    try {
      setImportingRows(true);

      const { data: insertedDetalles, error: detalleErr } = await supabase
        .from('cuentaventa_detalle')
        .insert(
          rowsToInsert.map((row) => ({
            cuentaventa_id: selectedAccount.id,
            salidadetalleid: row.salidadetalleid,
            externo_detalle_id: null,
            idcuentaventadet_orizon: null,
          })),
        )
        .select('id, salidadetalleid');

      if (detalleErr) throw detalleErr;
      if (!insertedDetalles || insertedDetalles.length === 0) {
        throw new Error('No se pudieron crear los detalles de la cuenta.');
      }

      type InsertedDetalleRow = {
        id: number;
        salidadetalleid: number;
      };
      const parsedInsertedDetalles = insertedDetalles as InsertedDetalleRow[];
      const detalleIdBySalidaDetalle = new Map<number, number>();
      parsedInsertedDetalles.forEach((detalle) => {
        const salidaDetalleId = Number(detalle.salidadetalleid);
        const id = Number(detalle.id);
        if (Number.isFinite(salidaDetalleId) && Number.isFinite(id)) {
          detalleIdBySalidaDetalle.set(salidaDetalleId, id);
        }
      });

      const valoresPayload = rowsToInsert.map((row) => {
        const cuentaventaDetalleId = detalleIdBySalidaDetalle.get(row.salidadetalleid);
        if (!cuentaventaDetalleId) {
          throw new Error(`No se pudo resolver el detalle insertado para SalidaDetalle #${row.salidadetalleid}.`);
        }
        return {
          cuentaventa_detalle_id: cuentaventaDetalleId,
          total_kilosbrutos: toNumberOrZero(row.total_kilosbrutos),
          total_kiloscliente: toNumberOrZero(row.total_kiloscliente),
          total_kilosnetos: toNumberOrZero(row.total_kilosnetos),
          total_piezas: toNumberOrZero(row.total_piezas),
          total_bultos: toNumberOrZero(row.total_bultos),
          nro_palets: toNumberOrZero(row.nro_palets),
          divisaid: Number(row.divisaid),
          precio: Number(row.precio),
          tipo_precio: normalizeTipoPrecio(row.tipo_precio),
        };
      });

      const { error: valoresErr } = await supabase.from('cuentaventa_detalle_valor').insert(valoresPayload);
      if (valoresErr) {
        const insertedDetalleIds = parsedInsertedDetalles
          .map((detalle) => Number(detalle.id))
          .filter((id: number) => Number.isFinite(id));
        if (insertedDetalleIds.length > 0) {
          const { error: rollbackErr } = await supabase.from('cuentaventa_detalle').delete().in('id', insertedDetalleIds);
          if (rollbackErr) {
            console.error('Error en rollback de detalles importados', rollbackErr);
          }
        }
        throw valoresErr;
      }

      toast({
        title: 'Líneas importadas',
        description:
          omittedDuplicates > 0
            ? `Se importaron ${rowsToInsert.length} líneas (${omittedDuplicates} duplicadas omitidas).`
            : `Se importaron ${rowsToInsert.length} líneas correctamente.`,
      });

      setShowImportByReference(false);
      resetImportReferenceSearch();
      await fetchAccounts(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Intenta nuevamente.';
      console.error('Error importando líneas por referencia', error);
      toast({
        title: 'No se pudieron importar las líneas',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setImportingRows(false);
    }
  };

  const handleAddDetalle = async () => {
    if (!selectedAccount) return;
    try {
      setAddingDetalle(true);
      const nextSalidaDetalle =
        (selectedAccount.detalles?.reduce((max, d) => Math.max(max, d.salidadetalleid || 0), 0) || 0) + 1;
      const selectedSalidaDetalle = Number(newDetalle.salidadetalleid) || 0;
      const salidadetalleid = selectedSalidaDetalle > 0 ? selectedSalidaDetalle : nextSalidaDetalle;

      const detallePayload = {
        cuentaventa_id: selectedAccount.id,
        salidadetalleid,
        externo_detalle_id: null,
        idcuentaventadet_orizon: null,
      };

      const { data: detalleData, error: detalleErr } = await supabase
        .from('cuentaventa_detalle')
        .insert(detallePayload)
        .select('id')
        .single();

      if (detalleErr || !detalleData) throw detalleErr || new Error('No se pudo crear el detalle.');

      const valorPayload = {
        cuentaventa_detalle_id: detalleData.id,
        total_kilosbrutos: Number(newDetalle.total_kilosbrutos) || 0,
        total_kiloscliente: Number(newDetalle.total_kiloscliente) || 0,
        total_kilosnetos: Number(newDetalle.total_kilosnetos) || 0,
        total_piezas: Number(newDetalle.total_piezas) || 0,
        total_bultos: Number(newDetalle.total_bultos) || 0,
        nro_palets: Number(newDetalle.nro_palets) || 0,
        divisaid: Number(newDetalle.divisaid) || 0,
        precio: Number(newDetalle.precio) || 0,
        tipo_precio: normalizeTipoPrecio(newDetalle.tipo_precio),
      };

      const { error: valorErr } = await supabase.from('cuentaventa_detalle_valor').insert(valorPayload);
      if (valorErr) throw valorErr;

      toast({
        title: 'Detalle añadido',
        description: 'Se añadió un detalle a la cuenta de venta.',
      });

      setNewDetalle({
        salidadetalleid: null,
        total_kilosbrutos: 0,
        total_kiloscliente: 0,
        total_kilosnetos: 0,
        total_piezas: 0,
        total_bultos: 0,
        nro_palets: 0,
        divisaid: 0,
        precio: 0,
        tipo_precio: 'K',
      });
      setShowNewDetalleForm(false);
      await fetchAccounts(true);
    } catch (error: any) {
      console.error('Error añadiendo detalle', error);
      toast({
        title: 'No se pudo añadir el detalle',
        description: error?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setAddingDetalle(false);
    }
  };

  const handleDeleteDetalle = async (detalle: SalesAccountDetail) => {
    if (!window.confirm('¿Eliminar este detalle de la cuenta de venta? Esta acción no se puede deshacer.')) return;
    try {
      setDeletingDetalleId(detalle.id);
      const { error: delValoresErr } = await supabase
        .from('cuentaventa_detalle_valor')
        .delete()
        .eq('cuentaventa_detalle_id', detalle.id);
      if (delValoresErr) throw delValoresErr;

      const { error: delDetalleErr } = await supabase
        .from('cuentaventa_detalle')
        .delete()
        .eq('id', detalle.id);
      if (delDetalleErr) throw delDetalleErr;

      toast({
        title: 'Detalle eliminado',
        description: 'Se eliminó el detalle de la cuenta de venta.',
      });
      if (editingDetalleId === detalle.id) {
        setEditingDetalleId(null);
      }
      setEditedDetalleValues((prev) => {
        const next = { ...prev };
        detalle.valores.forEach((v) => {
          delete next[v.id];
        });
        return next;
      });
      await fetchAccounts(true);
    } catch (error: any) {
      console.error('Error eliminando detalle', error);
      toast({
        title: 'No se pudo eliminar el detalle',
        description: error?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setDeletingDetalleId(null);
    }
  };

  const handleSendToOrizon = async () => {
    if (!selectedAccount) return;
    if (selectedAccount.idcuentaventa_orizon) {
      toast({
        title: 'Cuenta ya enviada',
        description: `Esta cuenta ya está en Orizon con ID ${selectedAccount.idcuentaventa_orizon}.`,
      });
      return;
    }
    if ((selectedAccount.detalles?.length ?? 0) === 0) {
      toast({
        title: 'No se puede enviar',
        description: 'La cuenta necesita al menos un detalle antes de enviarse a Orizon.',
        variant: 'destructive',
      });
      return;
    }
    try {
      setSendingOrizon(true);

      const payload = buildCuentaVentaOrizonPayload(selectedAccount);

      const baseUrl = import.meta.env.VITE_AGROIRIS_CUENTAVENTA_API_URL;
      if (!baseUrl) {
        throw new Error('VITE_AGROIRIS_CUENTAVENTA_API_URL no está configurado');
      }
      const endpoint = `${baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl}/cuentaventa/completo`;
      const token = await agroirisCuentaVentaAuth.getToken();
      if (!token) {
        throw new Error('No se pudo obtener el token de AgroIris');
      }

      try {
        console.log('[Orizon][CuentaVenta] Enviando cuenta', {
          method: 'POST',
          endpoint,
          cuentaventaLocalId: selectedAccount.id,
          numero_cuentaventa: selectedAccount.numero_cuentaventa ?? null,
          idcuentaventa_orizon: selectedAccount.idcuentaventa_orizon ?? null,
        });
        console.log('[Orizon][CuentaVenta] Payload', JSON.stringify(payload, null, 2));
      } catch {
        console.log('[Orizon][CuentaVenta] Payload', payload);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let data: any = null;
      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch {
          data = responseText;
        }
      }

      if (!response.ok) {
        const errorMessage =
          typeof data === 'object' && data?.title
            ? data.title
            : `Error ${response.status} al enviar la cuenta de venta`;
        const error: any = new Error(errorMessage);
        error.status = response.status;
        error.details = data;
        throw error;
      }

      try {
        console.log('[Orizon][CuentaVenta] Respuesta', JSON.stringify(data, null, 2));
      } catch {
        console.log('[Orizon][CuentaVenta] Respuesta', data);
      }

      const orizonId = resolveOrizonCuentaVentaId(data);
      const sentAt = new Date().toISOString();
      const updatePayload: Record<string, unknown> = {
        enviado: true,
        needs_sync: false,
        enviado_en: sentAt,
      };
      if (user?.id) {
        updatePayload.enviado_por = user.id;
      }
      if (orizonId !== null) {
        updatePayload.idcuentaventa_orizon = orizonId;
      }

      const { error: updateError } = await supabase
        .from('cuentaventas')
        .update(updatePayload)
        .eq('id', selectedAccount.id);

      if (updateError) {
        console.error('Error actualizando cuenta en Supabase:', updateError);
        toast({
          title: 'Cuenta enviada, pero no se pudo actualizar Supabase',
          description: updateError.message,
          variant: 'destructive',
        });
        return;
      }

      setAccounts((prev) =>
        prev.map((acc) =>
              acc.id === selectedAccount.id
                ? {
                    ...acc,
                    idcuentaventa_orizon: orizonId ?? acc.idcuentaventa_orizon,
                    enviado: true,
                    needs_sync: false,
                    enviado_en: sentAt,
                    ...(user?.id ? { enviado_por: user.id } : {}),
                  }
                : acc,
            ),
      );

      toast({
        title: 'Cuenta enviada a Orizon',
        description: orizonId ? `ID Orizon: ${orizonId}` : 'Envío completado.',
      });
    } catch (error: any) {
      console.error('Error enviando cuenta a Orizon', error);
      let errorDescription = error?.message ?? 'No se pudo enviar la cuenta.';
      if (error?.details?.errors) {
        const flatErrors = Object.values(error.details.errors)
          .flat()
          .join(' | ');
        if (flatErrors) {
          errorDescription = `${errorDescription} (${flatErrors})`;
        }
      }
      toast({
        title: 'Error enviando a Orizon',
        description: errorDescription,
        variant: 'destructive',
      });
    } finally {
      setSendingOrizon(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="container mx-auto p-6 space-y-6">
        <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent_55%)]" />
          <CardHeader className="relative space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold uppercase tracking-wide text-white/70">
                  Cuentas de venta
                </p>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                  Consola de cuentas
                </h1>
                <p className="text-sm text-white/80">
                  {numberFormat(stats.total)} cuentas totales
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchAccounts(true)}
              disabled={loading}
              className="flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Refrescando
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Refrescar
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((prev) => !prev)}
              className={`flex items-center gap-2 border-primary/50 text-primary hover:bg-primary/10 hover:text-primary dark:border-blue-400/70 dark:text-blue-200 dark:hover:bg-blue-400/10 ${showFilters ? 'bg-primary text-primary-foreground dark:bg-blue-500 dark:text-slate-50 border-transparent' : 'bg-background'}`}
            >
              <Filter className="h-4 w-4" />
              Filtros
              {activeFiltersCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-[11px]">
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    setSearch('');
                    setCeoxStatusFilter('all');
                    setClienteFilter(null);
                    setAlertFilter('all');
                    setDetalleFilter('all');
                    setFechaRango(undefined);
                    setOrderBy('date_desc');
                  }}
                >
                  <X className="h-4 w-4" />
                  Limpiar filtros
                </Button>
              )}
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="filter-search">Buscar</Label>
                  <Input
                    id="filter-search"
                    placeholder="Buscar número, cliente, externo, Orizon..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  <ClientCombobox
                    value={clienteFilter}
                    onChange={(value) => setClienteFilter(value)}
                    className="h-10"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Estado en Ceox</Label>
                  <Select
                    value={ceoxStatusFilter}
                    onValueChange={(value: CeoxStatusFilter) => setCeoxStatusFilter(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Estado en Ceox" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="in_ceox">Está en Ceox</SelectItem>
                      <SelectItem value="not_in_ceox">No está en Ceox</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Fecha de valoración</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={`w-full justify-start text-left font-normal ${
                          !(fechaRango?.from || fechaRango?.to) ? 'text-muted-foreground' : ''
                        }`}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        <span>{fechaRangoLabel}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <DateRangeCalendar
                        initialFocus
                        mode="range"
                        selected={fechaRango}
                        onSelect={setFechaRango}
                        numberOfMonths={2}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Orden</Label>
                  <Select value={orderBy} onValueChange={(value) => setOrderBy(value as typeof orderBy)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Orden" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="date_desc">Más recientes primero (llegada correo)</SelectItem>
                      <SelectItem value="date_asc">Más antiguas primero (llegada correo)</SelectItem>
                      <SelectItem value="numero_asc">Número A-Z</SelectItem>
                      <SelectItem value="numero_desc">Número Z-A</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Alertas</Label>
                  <Select value={alertFilter} onValueChange={(value) => setAlertFilter(value as typeof alertFilter)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Alertas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="errors">En PDF con errores</SelectItem>
                      <SelectItem value="warnings">Con avisos</SelectItem>
                      <SelectItem value="clean">Sin alertas</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Detalles</Label>
                  <Select value={detalleFilter} onValueChange={(value) => setDetalleFilter(value as typeof detalleFilter)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Detalles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="with">Con detalles</SelectItem>
                      <SelectItem value="without">Sin detalles</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="space-y-1 px-6 pt-6 pb-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg font-semibold">Listado de cuentas de venta</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {numberFormat(totalFilteredAccountCount)} cuentas filtradas · {numberFormat(stats.total)} totales
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            {blockingLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando cuentas de venta...
              </div>
            ) : totalFilteredAccountCount === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
                <Package className="h-10 w-10 text-muted-foreground/60" />
                <p className="mt-2 text-sm font-medium">No hay cuentas que coincidan con los filtros</p>
                <p className="text-xs text-muted-foreground">Ajusta la búsqueda o cambia los filtros de estado</p>
                <Button className="mt-4" variant="outline" onClick={() => fetchAccounts(true)}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refrescar
                </Button>
              </div>
            ) : (
              <>
                <AlertDialog
                  open={pendingDeletePdfId !== null}
                  onOpenChange={(open) => {
                    if (!open) setPendingDeletePdfId(null);
                  }}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Eliminar PDF y cuentas</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se eliminarán el PDF y todas las cuentas de venta asociadas.
                        {pendingDeletePdfId !== null && (
                          <span className="block mt-1 text-xs text-muted-foreground">PDF #{pendingDeletePdfId}</span>
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => pendingDeletePdfId !== null && handleDeletePdfGroup(pendingDeletePdfId)}
                        disabled={pendingDeletePdfId === null || deletingPdfId === pendingDeletePdfId}
                      >
                        {deletingPdfId === pendingDeletePdfId ? (
                          <span className="inline-flex items-center gap-2 text-xs">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Eliminando
                          </span>
                        ) : (
                          'Confirmar eliminación'
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <div className="relative">
                  {pageTransitionLoading && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/55">
                      <div className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Cargando página...
                      </div>
                    </div>
                  )}
                  <div className="space-y-4">
                    {groupedAccounts.map((group) => {
                  const groupKey = group.archivoPdfId !== null ? group.archivoPdfId.toString() : 'sin-pdf';
                  const isExpanded = expandedGroups[groupKey] ?? false;
                  const allAccountsSent =
                    group.archivoPdfId !== null &&
                    group.accounts.length > 0 &&
                    group.accounts.every((account) => statusFromAccount(account) === 'sent');
                  const firstAccount = group.accounts[0];
                  const warningErrors = group.errors.filter((err) => isWarningCode(err.codigo));
                  const criticalErrors = group.errors.filter((err) => !isWarningCode(err.codigo));
                  const visibleWarningErrors = warningErrors.filter((err) => err.codigo !== WARNING_CODE_SIN_DETALLES);
                  const warningAccounts = group.accounts.filter((account) => (account.detalles?.length ?? 0) === 0).length;
                  const inferredErrorAccounts = Math.min(criticalErrors.length, group.accounts.length);
                  const inferredWarningAccounts = Math.min(
                    warningAccounts,
                    Math.max(0, group.accounts.length - inferredErrorAccounts),
                  );
                  const hasWarnings = warningErrors.length > 0;
                  const hasCriticalErrors = criticalErrors.length > 0;
                  const headerTitle =
                    firstAccount?.clienteNombre || firstAccount?.clienteid
                      ? `${firstAccount?.clienteNombre || firstAccount?.clienteid}`
                      : hasCriticalErrors
                        ? 'PDF con errores'
                        : hasWarnings
                          ? 'PDF con avisos'
                        : 'Sin cliente';
                  const groupSummaryParts = group.accounts.length > 0
                    ? [
                        `${group.accounts.length} ${group.accounts.length === 1 ? 'cuenta' : 'cuentas'}`,
                        inferredWarningAccounts > 0
                          ? `${inferredWarningAccounts} ${inferredWarningAccounts === 1 ? 'con aviso' : 'con avisos'}`
                          : null,
                        inferredErrorAccounts > 0
                          ? `${inferredErrorAccounts} ${inferredErrorAccounts === 1 ? 'con error' : 'con errores'}`
                          : null,
                      ]
                    : [
                        `${visibleWarningErrors.length + criticalErrors.length} ${
                          visibleWarningErrors.length + criticalErrors.length === 1 ? 'incidencia' : 'incidencias'
                        }`,
                      ];
                  const groupSummaryLabel = groupSummaryParts.filter(Boolean).join(' · ');
                  return (
                    <div
                      key={groupKey}
                      className={`w-full overflow-hidden rounded-lg border shadow-sm ${
                        allAccountsSent
                          ? 'border-sky-300 bg-sky-50/70 dark:border-sky-800/60 dark:bg-sky-950/25'
                          : 'border-border/70 bg-card'
                      }`}
                    >
                      <div
                        className={`flex flex-wrap items-center gap-3 px-5 py-4 cursor-pointer transition-colors ${
                          allAccountsSent
                            ? 'hover:bg-sky-100/80 dark:hover:bg-sky-900/40'
                            : 'hover:bg-muted/70'
                        }`}
                        onClick={() => setExpandedGroups((prev) => ({ ...prev, [groupKey]: !isExpanded }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setExpandedGroups((prev) => ({ ...prev, [groupKey]: !isExpanded }));
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {headerTitle}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {group.archivoPdfId ? 'PDF adjunto' : 'Sin documento PDF'}
                            {group.latestDate && (
                              <span>
                                · {group.accounts.length > 0 ? 'Última valoración' : 'Última actividad'} {formatDate(group.latestDate)}
                              </span>
                            )}
                            {group.latestArrivalDate && (
                              <span>· Llegada {formatDateTime(group.latestArrivalDate)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="hidden min-w-0 max-w-[20rem] text-right text-xs font-medium text-muted-foreground md:block">
                            <span className="block truncate" title={groupSummaryLabel}>
                              {groupSummaryLabel}
                            </span>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-9 w-9"
                                onClick={(e) => e.stopPropagation()}
                                title="Acciones del bloque"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-56"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                              <DropdownMenuItem
                                onSelect={(e) => {
                                  e.stopPropagation();
                                  handleExportGroupExcel(group);
                                }}
                                disabled={group.accounts.length === 0}
                              >
                                <Download className="mr-2 h-4 w-4" />
                                Exportar Excel
                              </DropdownMenuItem>
                              {group.archivoPdfId && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onSelect={(e) => {
                                      e.stopPropagation();
                                      openPdfInNewTab(group.archivoPdfId!);
                                    }}
                                  >
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    Abrir PDF en nueva pestaña
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-rose-600 focus:text-rose-600"
                                    onSelect={(e) => {
                                      e.stopPropagation();
                                      setPendingDeletePdfId(group.archivoPdfId!);
                                    }}
                                    disabled={deletingPdfId === group.archivoPdfId}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Eliminar PDF y cuentas
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      {isExpanded && (
                        <div
                          className={`border-t ${
                            allAccountsSent
                              ? 'border-sky-200/80 bg-sky-50/40 dark:border-sky-800/60 dark:bg-sky-950/20'
                              : 'border-border/60 bg-muted/20'
                          }`}
                        >
                          <div className="space-y-4 p-4">
                            {visibleWarningErrors.length > 0 && (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-200">
                                  <AlertTriangle className="h-4 w-4" />
                                  Avisos detectados ({visibleWarningErrors.length})
                                </div>
                                {visibleWarningErrors.map((err) => (
                                  <Card key={err.id} className="border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/40">
                                    <CardContent className="p-4 space-y-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge className="text-[10px] uppercase bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-100">
                                            {err.codigo}
                                          </Badge>
                                          {err.numero_pagina !== null && (
                                            <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-800 dark:border-amber-900/70 dark:text-amber-100">
                                              Página {err.numero_pagina}
                                            </Badge>
                                          )}
                                        </div>
                                        {group.archivoPdfId && err.numero_pagina !== null && err.numero_pagina > 0 && (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-7 px-2 text-[11px] border-amber-200 text-amber-800 hover:bg-amber-100 dark:border-amber-900/70 dark:text-amber-100 dark:hover:bg-amber-900/50"
                                            onClick={() => openPdfInNewTab(group.archivoPdfId!, err.numero_pagina)}
                                          >
                                            <ExternalLink className="h-3 w-3 mr-1" />
                                            Ver página
                                          </Button>
                                        )}
                                      </div>
                                      <p className="text-xs text-amber-900/80 dark:text-amber-100/80">{err.mensaje}</p>
                                    </CardContent>
                                  </Card>
                                ))}
                              </div>
                            )}
                            {hasCriticalErrors && (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-200">
                                  <AlertTriangle className="h-4 w-4" />
                                  Errores detectados ({criticalErrors.length})
                                </div>
                                {criticalErrors.map((err) => (
                                  <Card key={err.id} className="border-rose-200 bg-rose-50/70 dark:border-rose-900/60 dark:bg-rose-950/40">
                                    <CardContent className="p-4 space-y-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <Badge variant="destructive" className="text-[10px] uppercase">
                                            {err.codigo}
                                          </Badge>
                                          {err.numero_pagina !== null && (
                                            <Badge variant="outline" className="text-[10px] border-rose-200 text-rose-700 dark:border-rose-900/70 dark:text-rose-100">
                                              Página {err.numero_pagina}
                                            </Badge>
                                          )}
                                        </div>
                                        {group.archivoPdfId && err.numero_pagina !== null && err.numero_pagina > 0 && (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-7 px-2 text-[11px] border-rose-200 text-rose-700 hover:bg-rose-100 dark:border-rose-900/70 dark:text-rose-100 dark:hover:bg-rose-900/50"
                                            onClick={() => openPdfInNewTab(group.archivoPdfId!, err.numero_pagina)}
                                          >
                                            <ExternalLink className="h-3 w-3 mr-1" />
                                            Ver página
                                          </Button>
                                        )}
                                      </div>
                                      <p className="text-xs text-rose-900/80 dark:text-rose-100/80">{err.mensaje}</p>
                                    </CardContent>
                                  </Card>
                                ))}
                              </div>
                            )}
                            {group.accounts.length === 0 ? (
                              <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                                No hay cuentas de venta válidas en este PDF.
                              </div>
                            ) : (
                              group.accounts.map((account) => {
                              const noDetalles = account.detalles.length === 0;
                              const sentToOrizon = Boolean(account.idcuentaventa_orizon);
                              const cardClasses = `w-full cursor-pointer rounded-lg border hover:shadow-sm transition-colors ${
                                sentToOrizon
                                  ? 'border-sky-300 bg-sky-100/90 hover:bg-sky-200 dark:border-sky-800/60 dark:bg-sky-900/50 dark:hover:bg-sky-900/70'
                                  : noDetalles
                                    ? 'border-amber-200 bg-amber-50 hover:bg-amber-100/80 dark:border-amber-900/60 dark:bg-amber-950/40 dark:hover:bg-amber-950/60'
                                    : 'bg-card border-border/70'
                              }`;
                              const infoGridColumns = 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';
                              const readOnlyFieldClass = 'text-sm font-medium p-2 rounded-md bg-muted';
                              const showPdfPanel = Boolean(account.archivo_pdf_id && showPdfPreview);
                              const isEditingSelectedAccount = isEditing && selectedAccount?.id === account.id;
                              const accountPdfSearchCandidates = buildPdfSearchCandidatesFromAccount(account);
                              const senderUserId =
                                typeof account.enviado_por === 'string' && account.enviado_por.trim().length > 0
                                  ? account.enviado_por.trim()
                                  : null;
                              const senderUserLabel = senderUserId
                                ? accountSenderLabelsById[senderUserId] ?? `Usuario ${senderUserId.slice(0, 6)}`
                                : null;
                              const registeredAtLabelRaw = account.created_at ? formatDateTime(account.created_at) : null;
                              const registeredAtLabel =
                                registeredAtLabelRaw && registeredAtLabelRaw !== '—' ? registeredAtLabelRaw : null;
                              const arrivalAtLabelRaw = formatDateTime(account.llegada_correo ?? account.created_at ?? null);
                              const arrivalAtLabel = arrivalAtLabelRaw && arrivalAtLabelRaw !== '—' ? arrivalAtLabelRaw : null;
                              const accountStatusLabel = sentToOrizon ? 'En Orizon' : 'Pendiente';
                              const accountDetailLabel = noDetalles
                                ? 'Sin detalles'
                                : `${account.detalles.length} ${account.detalles.length === 1 ? 'detalle' : 'detalles'}`;
                              const emailArrivalAtLabelRaw = account.llegada_correo ? formatDateTime(account.llegada_correo) : null;
                              const emailArrivalAtLabel =
                                emailArrivalAtLabelRaw && emailArrivalAtLabelRaw !== '—' ? emailArrivalAtLabelRaw : null;
                              const sentAtLabelRaw = account.enviado_en ? formatDateTime(account.enviado_en) : null;
                              const sentAtLabel = sentAtLabelRaw && sentAtLabelRaw !== '—' ? sentAtLabelRaw : null;
                              const orizonStatusLabel = account.idcuentaventa_orizon
                                ? `Sí · ID ${account.idcuentaventa_orizon}`
                                : 'Pendiente';
                              const accountPdfFileName = `${String(
                                account.numero_cuentaventa || `cuenta_venta_${account.id}`
                              ).replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
                              const accountPdfFallbackPage = inferPdfPageByAccountOrder(account);
                              const displayGastos =
                                isEditingSelectedAccount
                                  ? ((editForm.gastos as SalesAccountItem['gastos'] | undefined) ?? account.gastos)
                                  : account.gastos;

                              const sections = (
                                <div className="space-y-6">
                                  <section>
                                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 border-b pb-2">
                                      <FileText className="h-5 w-5 text-primary" />
                                      Información general
                                    </h3>
                                    <div className={`grid ${infoGridColumns} gap-4 min-w-0`}>
                                      <div className="space-y-2">
                                        <Label>Número</Label>
                                        {isEditing ? (
                                          <Input
                                            className={`text-foreground bg-background ${numberInputNoSpin}`}
                                            value={editForm.numero_cuentaventa as string}
                                            onChange={(e) =>
                                              setEditForm((prev) => ({ ...prev, numero_cuentaventa: e.target.value }))
                                            }
                                          />
                                        ) : (
                                          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                                            <p className={`${readOnlyFieldClass} min-w-0 flex-1`}>{account.numero_cuentaventa || '—'}</p>
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              onClick={() => handleCopyAccountNumber(account)}
                                              disabled={!account.numero_cuentaventa?.toString().trim()}
                                              className="h-9 w-full px-3 sm:w-auto sm:shrink-0"
                                            >
                                              <Copy className="h-4 w-4 mr-1" />
                                              Copiar
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                      <div className="space-y-2">
                                        <Label>Total cuenta</Label>
                                        {isEditing ? (
                                          <Input
                                            type="number"
                                            step="0.01"
                                            className={`text-foreground bg-background ${numberInputNoSpin}`}
                                            value={(editForm.total_cuentaventa ?? account.total_cuentaventa) as number}
                                            onChange={(e) => {
                                              const val = Number(e.target.value);
                                              setEditForm((prev) => ({
                                                ...prev,
                                                total_cuentaventa: Number.isFinite(val) ? val : 0,
                                              }));
                                            }}
                                          />
                                        ) : (
                                          <p className={readOnlyFieldClass}>{currencyFormat(account.total_cuentaventa)} €</p>
                                        )}
                                      </div>
                                      <div className="space-y-2">
                                        <Label>Serie</Label>
                                        <p className={readOnlyFieldClass}>{getSerieLabel(account.serieid)}</p>
                                      </div>
                                      <div className="space-y-2">
                                        <Label>Cliente</Label>
                                        {isEditing ? (
                                          <ClientCombobox
                                            value={editForm.clienteid ?? null}
                                            onChange={(val) =>
                                              setEditForm((prev) => ({ ...prev, clienteid: val ?? 0 }))
                                            }
                                          />
                                        ) : (
                                          <p className={readOnlyFieldClass}>{account.clienteNombre || account.clienteid}</p>
                                        )}
                                      </div>
                                      <div className="space-y-2">
                                        <Label>Fecha valoracion</Label>
                                        {isEditing ? (
                                          <Input
                                            type="date"
                                            className="text-foreground bg-background"
                                            value={editForm.fechavaloracion?.slice(0, 10) || ''}
                                            onChange={(e) =>
                                              setEditForm((prev) => ({ ...prev, fechavaloracion: e.target.value }))
                                            }
                                          />
                                        ) : (
                                          <p className={readOnlyFieldClass}>{formatDate(account.fechavaloracion)}</p>
                                        )}
                                      </div>
                                      <div className="space-y-2 md:col-span-2 xl:col-span-3">
                                        <Label>Observaciones</Label>
                                        {isEditing ? (
                                          <Textarea
                                            className="text-foreground bg-background"
                                            value={editForm.observaciones_valoracion as string}
                                            onChange={(e) =>
                                              setEditForm((prev) => ({
                                                ...prev,
                                                observaciones_valoracion: e.target.value,
                                              }))
                                            }
                                          />
                                        ) : (
                                          <p className={readOnlyFieldClass}>{account.observaciones_valoracion || '—'}</p>
                                        )}
                                      </div>
                                    </div>
                                  </section>

                                  <section className="rounded-2xl border border-border/60 bg-background shadow-sm">
                                    <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                                      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                                        <FileText className="h-4 w-4 text-primary" />
                                        Gastos ({displayGastos.length})
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {isEditingSelectedAccount && (
                                          <Button
                                            variant="secondary"
                                            size="sm"
                                            className="h-8"
                                            onClick={handleAddGasto}
                                          >
                                            <Plus className="h-4 w-4 mr-1" />
                                            Añadir gasto
                                          </Button>
                                        )}
                                        {displayGastos.length === 0 && (
                                          <Badge variant="secondary" className="text-[11px]">
                                            Sin gastos
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                    <div className="divide-y">
                                      {displayGastos.length === 0 ? (
                                        <div className="p-4 text-sm text-muted-foreground">No hay gastos registrados.</div>
                                      ) : (
                                        displayGastos.map((g) => (
                                          <div key={g.id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                                            <div className="min-w-[220px] flex-1">
                                              {isEditing ? (
                                                <GastoCombobox
                                                  value={g.gastoid as number}
                                                  onChange={(newId) => {
                                                    setEditForm((prev) => ({
                                                      ...prev,
                                                      gastos: (prev.gastos || account.gastos).map((gg) =>
                                                        gg.id === g.id ? { ...gg, gastoid: newId ?? 0 } : gg
                                                      ),
                                                    }));
                                                  }}
                                                />
                                              ) : (
                                                <p className="font-medium text-foreground">
                                                  {gastoNames[g.gastoid] || `Gasto ${g.gastoid}`}
                                                </p>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                              {isEditing ? (
                                                <Input
                                                  className={`w-24 text-right text-foreground bg-background ${numberInputNoSpin}`}
                                                  type="number"
                                                  step="0.01"
                                                  value={g.valor_gasto as number}
                                                  onChange={(e) => {
                                                    const val = Number(e.target.value);
                                                    setEditForm((prev) => ({
                                                      ...prev,
                                                      gastos: (prev.gastos || account.gastos).map((gg) =>
                                                        gg.id === g.id ? { ...gg, valor_gasto: isNaN(val) ? 0 : val } : gg
                                                      ),
                                                    }));
                                                  }}
                                                />
                                              ) : (
                                                <span className="text-foreground font-semibold">
                                                  {Number(g.valor_gasto).toFixed(2)} €
                                                </span>
                                              )}
                                              {isEditing && g.id <= 0 && (
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                                  onClick={() => handleRemoveDraftGasto(g.id)}
                                                  title="Quitar gasto nuevo"
                                                >
                                                  <X className="h-4 w-4" />
                                                </Button>
                                              )}
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </section>

                                  <section>
                                    <div className="flex flex-col gap-3 mb-4 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="text-lg font-semibold flex items-center gap-2">
                                          <Package className="h-5 w-5 text-primary" />
                                          Detalles de la cuenta
                                          {account.detalles.length > 0 && (
                                            <Badge variant="secondary">{account.detalles.length} detalles</Badge>
                                          )}
                                        </h3>
                                        {account.detalles.length === 0 && (
                                          <Button
                                            size="sm"
                                            variant={showImportByReference ? 'secondary' : 'outline'}
                                            onClick={() => {
                                              if (showImportByReference) {
                                                setShowImportByReference(false);
                                                resetImportReferenceSearch();
                                              } else {
                                                setShowImportByReference(true);
                                              }
                                            }}
                                            disabled={Boolean(account.idcuentaventa_orizon) || isEditing || importLoading || importingRows}
                                            className="h-8"
                                            title={
                                              account.idcuentaventa_orizon
                                                ? 'No disponible para cuentas enviadas a Orizon'
                                                : undefined
                                            }
                                          >
                                            {showImportByReference ? 'Ocultar importación' : 'Traer líneas por referencia'}
                                          </Button>
                                        )}
                                      </div>
                                      {isEditing && (
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          className="h-8"
                                          onClick={() => setShowNewDetalleForm((prev) => !prev)}
                                        >
                                          {showNewDetalleForm ? 'Ocultar nuevo detalle' : 'Añadir detalle'}
                                        </Button>
                                      )}
                                    </div>
                                    {!account.idcuentaventa_orizon &&
                                      account.detalles.length === 0 &&
                                      showImportByReference && (
                                      <div className="mb-6 rounded-lg border bg-muted/20 p-4 space-y-4">
                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                          <div className="space-y-2">
                                            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                                              Referencia cliente
                                            </Label>
                                            <div className="flex flex-col gap-2 sm:flex-row">
                                              <Input
                                                value={referenceClienteQuery}
                                                onChange={(e) => setReferenceClienteQuery(e.target.value)}
                                                placeholder="Ej: 8412 o 26/0008412"
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    if (!importLoading) {
                                                      void handleSearchImportByReference('referencia_cliente');
                                                    }
                                                  }
                                                }}
                                              />
                                              <Button
                                                type="button"
                                                onClick={() => void handleSearchImportByReference('referencia_cliente')}
                                                disabled={importLoading || importingRows || !referenceClienteQuery.trim()}
                                                className="sm:min-w-[140px]"
                                              >
                                                {importLoading && activeImportSearchField === 'referencia_cliente' ? (
                                                  <span className="inline-flex items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Buscando
                                                  </span>
                                                ) : (
                                                  'Buscar ref. 1'
                                                )}
                                              </Button>
                                            </div>
                                          </div>

                                          <div className="space-y-2">
                                            <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                                              Referencia cliente 2
                                            </Label>
                                            <div className="flex flex-col gap-2 sm:flex-row">
                                              <Input
                                                value={reference2ClienteQuery}
                                                onChange={(e) => setReference2ClienteQuery(e.target.value)}
                                                placeholder="Ej: 5101044363"
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    if (!importLoading) {
                                                      void handleSearchImportByReference('referencia2_cliente');
                                                    }
                                                  }
                                                }}
                                              />
                                              <Button
                                                type="button"
                                                onClick={() => void handleSearchImportByReference('referencia2_cliente')}
                                                disabled={importLoading || importingRows || !reference2ClienteQuery.trim()}
                                                className="sm:min-w-[140px]"
                                              >
                                                {importLoading && activeImportSearchField === 'referencia2_cliente' ? (
                                                  <span className="inline-flex items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Buscando
                                                  </span>
                                                ) : (
                                                  'Buscar ref. 2'
                                                )}
                                              </Button>
                                            </div>
                                          </div>
                                        </div>

                                        {importRows.length > 0 && (
                                          <div className="flex justify-end">
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              onClick={() => {
                                                resetImportReferenceResults();
                                              }}
                                              disabled={importLoading || importingRows}
                                            >
                                              Limpiar resultados
                                            </Button>
                                          </div>
                                        )}

                                        {importLoading ? (
                                          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                                            <span className="inline-flex items-center gap-2">
                                              <Loader2 className="h-4 w-4 animate-spin" />
                                              Cargando líneas...
                                            </span>
                                          </div>
                                        ) : importRows.length === 0 ? (
                                          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                                            Busca por referencia cliente o por referencia cliente 2 para traer líneas de salida del cliente.
                                          </div>
                                        ) : (
                                          <div className="space-y-3">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <p className="text-xs text-muted-foreground">
                                                {importRows.length} líneas encontradas · {selectedImportCount} seleccionadas
                                              </p>
                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                  if (selectedImportCount === importRows.length) {
                                                    setSelectedImportRows(
                                                      Object.fromEntries(
                                                        importRows.map((linea) => [linea.salidadetalleid, false]),
                                                      ) as Record<number, boolean>,
                                                    );
                                                    return;
                                                  }
                                                  setSelectedImportRows(
                                                    Object.fromEntries(
                                                      importRows.map((linea) => [linea.salidadetalleid, true]),
                                                    ) as Record<number, boolean>,
                                                  );
                                                }}
                                                disabled={importingRows}
                                              >
                                                {selectedImportCount === importRows.length
                                                  ? 'Deseleccionar todas'
                                                  : 'Seleccionar todas'}
                                              </Button>
                                            </div>

                                            <Table className="min-w-[1180px]">
                                              <TableHeader>
                                                <TableRow>
                                                  <TableHead className="w-[56px]">Sel</TableHead>
                                                  <TableHead>Ref. cliente</TableHead>
                                                  <TableHead>Ref. cliente 2</TableHead>
                                                  <TableHead>SalidaDetalle</TableHead>
                                                  <TableHead>Descripción</TableHead>
                                                  <TableHead className="w-[110px]">Bultos</TableHead>
                                                  <TableHead className="w-[110px]">K. cliente</TableHead>
                                                  <TableHead className="w-[110px]">Palets</TableHead>
                                                  <TableHead className="w-[220px]">Divisa</TableHead>
                                                  <TableHead className="w-[150px]">Precio</TableHead>
                                                  <TableHead className="w-[100px] text-right">Acción</TableHead>
                                                </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                {importRows.map((linea) => {
                                                  const selected = Boolean(selectedImportRows[linea.salidadetalleid]);
                                                  return (
                                                    <TableRow key={linea.salidadetalleid} className={!selected ? 'opacity-60' : undefined}>
                                                      <TableCell>
                                                        <Checkbox
                                                          checked={selected}
                                                          onCheckedChange={(checked) =>
                                                            handleToggleImportRow(linea.salidadetalleid, checked)
                                                          }
                                                        />
                                                      </TableCell>
                                                      <TableCell>{linea.referencia_cliente || '—'}</TableCell>
                                                      <TableCell>{linea.referencia2_cliente || '—'}</TableCell>
                                                      <TableCell className="font-mono text-xs">{linea.salidadetalleid}</TableCell>
                                                      <TableCell>
                                                        <div className="flex flex-col">
                                                          <span className="text-sm">
                                                            {linea.descripcion_salida || linea.descripcion_genero || 'Sin descripción'}
                                                          </span>
                                                          <span className="text-xs text-muted-foreground">
                                                            {linea.nombre_calibre || 'Sin calibre'} · Tipo {linea.tipo_precio}
                                                          </span>
                                                        </div>
                                                      </TableCell>
                                                      <TableCell>{numberFormat(linea.total_bultos)}</TableCell>
                                                      <TableCell>{numberFormat(linea.total_kiloscliente)}</TableCell>
                                                      <TableCell>{numberFormat(linea.nro_palets)}</TableCell>
                                                      <TableCell className="min-w-[220px]">
                                                        <DivisaCombobox
                                                          value={linea.divisaid}
                                                          onChange={(value) => handleUpdateImportRowDivisa(value)}
                                                          placeholder="Divisa..."
                                                          className="h-8 min-w-[200px]"
                                                        />
                                                      </TableCell>
                                                      <TableCell>
                                                        <Input
                                                          type="number"
                                                          step="0.01"
                                                          className={`${numberInputNoSpin} h-8`}
                                                          value={linea.precio ?? ''}
                                                          onChange={(e) =>
                                                            handleUpdateImportRowPrecio(linea.salidadetalleid, e.target.value)
                                                          }
                                                          placeholder="Precio"
                                                        />
                                                      </TableCell>
                                                      <TableCell className="text-right">
                                                        <Button
                                                          type="button"
                                                          variant="ghost"
                                                          size="sm"
                                                          className="text-destructive"
                                                          onClick={() => handleRemoveImportRowFromSelection(linea.salidadetalleid)}
                                                        >
                                                          Quitar
                                                        </Button>
                                                      </TableCell>
                                                    </TableRow>
                                                  );
                                                })}
                                              </TableBody>
                                            </Table>

                                            <div className="flex justify-end">
                                              <Button
                                                type="button"
                                                onClick={() => void handleImportSelectedRows()}
                                                disabled={importingRows || importLoading || selectedImportCount === 0}
                                              >
                                                {importingRows ? (
                                                  <span className="inline-flex items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Importando
                                                  </span>
                                                ) : (
                                                  'Importar seleccionadas'
                                                )}
                                              </Button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {isEditing && showNewDetalleForm && (
                                      <div className="space-y-4 mb-6">
                                        <div className="border rounded-lg overflow-hidden bg-card shadow-sm">
                                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 bg-muted/40 border-b">
                                            <h4 className="font-semibold flex items-center gap-2">
                                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                                                +
                                              </span>
                                              Nuevo detalle
                                              <Badge variant="secondary" className="text-xs">Borrador</Badge>
                                            </h4>
                                            <Button
                                              variant="secondary"
                                              size="sm"
                                              className="h-8 px-3"
                                              onClick={handleAddDetalle}
                                              disabled={addingDetalle}
                                            >
                                              {addingDetalle ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar detalle'}
                                            </Button>
                                          </div>
                                          <div className="p-4 space-y-4">
                                            <div>
                                              <h5 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                                                Salida asociada
                                              </h5>
                                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                                                    Salida detalle
                                                  </Label>
                                                  <SalidaDetalleCuentaVentaCombobox
                                                    value={newDetalle.salidadetalleid}
                                                    onChange={(value) =>
                                                      setNewDetalle((prev) => ({ ...prev, salidadetalleid: value }))
                                                    }
                                                    clienteid={account.clienteid}
                                                    placeholder="Buscar por referencia del cliente..."
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                            <div>
                                              <h5 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                                                Precio y divisa
                                              </h5>
                                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Divisa</Label>
                                                  <DivisaCombobox
                                                    value={newDetalle.divisaid || null}
                                                    onChange={(value) =>
                                                      setNewDetalle((prev) => ({ ...prev, divisaid: value ?? 0 }))
                                                    }
                                                  />
                                                </div>
                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Precio</Label>
                                                  <Input
                                                    type="number"
                                                    step="0.01"
                                                    className={`${numberInputNoSpin} h-8`}
                                                    value={newDetalle.precio}
                                                    onChange={(e) =>
                                                      setNewDetalle((prev) => ({ ...prev, precio: Number(e.target.value) || 0 }))
                                                    }
                                                  />
                                                </div>
                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Tipo precio</Label>
                                                  <Select
                                                    value={newDetalle.tipo_precio}
                                                    onValueChange={(val) => setNewDetalle((prev) => ({ ...prev, tipo_precio: val }))}
                                                  >
                                                    <SelectTrigger className="h-8">
                                                      <SelectValue placeholder="Tipo" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                      <SelectItem value="K">K</SelectItem>
                                                      <SelectItem value="B">B</SelectItem>
                                                      <SelectItem value="P">P</SelectItem>
                                                    </SelectContent>
                                                  </Select>
                                                </div>
                                              </div>
                                            </div>
                                            <div>
                                              <h5 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                                                Cantidades
                                              </h5>
                                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Palets</Label>
                                                  <Input
                                                    type="number"
                                                    className={`${numberInputNoSpin} h-8`}
                                                    value={newDetalle.nro_palets}
                                                    onChange={(e) =>
                                                      setNewDetalle((prev) => ({ ...prev, nro_palets: Number(e.target.value) || 0 }))
                                                    }
                                                  />
                                                </div>
                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Bultos</Label>
                                                  <Input
                                                    type="number"
                                                    className={`${numberInputNoSpin} h-8`}
                                                    value={newDetalle.total_bultos}
                                                    onChange={(e) =>
                                                      setNewDetalle((prev) => ({ ...prev, total_bultos: Number(e.target.value) || 0 }))
                                                    }
                                                  />
                                                </div>
                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos netos</Label>
                                                  <Input
                                                    type="number"
                                                    className={`${numberInputNoSpin} h-8`}
                                                    value={newDetalle.total_kilosnetos}
                                                    onChange={(e) =>
                                                      setNewDetalle((prev) => ({ ...prev, total_kilosnetos: Number(e.target.value) || 0 }))
                                                    }
                                                  />
                                                </div>
                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos cliente</Label>
                                                  <Input
                                                    type="number"
                                                    className={`${numberInputNoSpin} h-8`}
                                                    value={newDetalle.total_kiloscliente}
                                                    onChange={(e) =>
                                                      setNewDetalle((prev) => ({ ...prev, total_kiloscliente: Number(e.target.value) || 0 }))
                                                    }
                                                  />
                                                </div>
                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos brutos</Label>
                                                  <Input
                                                    type="number"
                                                    className={`${numberInputNoSpin} h-8`}
                                                    value={newDetalle.total_kilosbrutos}
                                                    onChange={(e) =>
                                                      setNewDetalle((prev) => ({ ...prev, total_kilosbrutos: Number(e.target.value) || 0 }))
                                                    }
                                                  />
                                                </div>
                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Piezas</Label>
                                                  <Input
                                                    type="number"
                                                    className={`${numberInputNoSpin} h-8`}
                                                    value={newDetalle.total_piezas}
                                                    onChange={(e) =>
                                                      setNewDetalle((prev) => ({ ...prev, total_piezas: Number(e.target.value) || 0 }))
                                                    }
                                                  />
                                                </div>
                                              </div>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground">
                                              Los valores se guardarán con la divisa y tipo de precio seleccionados. Usa 0 si algún campo no aplica.
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                    {account.detalles.length === 0 ? (
                                      <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                                        Sin detalles.
                                      </div>
                                    ) : (
                                      <div className="space-y-4">
                                        {account.detalles.map((d, index) => {
                                          const isEditingThisDetail = isEditing && editingDetalleId === d.id;
                                          const hasSalidaId = typeof d.salidadetalleid === 'number' && d.salidadetalleid > 0;
                                          const salidaInfo = salidaDetalleMap[d.salidadetalleid];
                                          const salidaLoading = salidaDetalleLoading[d.salidadetalleid];
                                          const salidaError = salidaDetalleErrors[d.salidadetalleid];
                                          const salidaTitulo =
                                            salidaInfo?.descripcion_salida ||
                                            salidaInfo?.nombre_catalogoconfeccion ||
                                            salidaInfo?.descripcion_genero ||
                                            null;
                                          return (
                                            <div key={d.id} className="border rounded-lg overflow-hidden bg-card shadow-sm">
                                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 bg-muted/40 border-b">
                                                <h4 className="font-semibold flex items-center gap-2">
                                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                                                    {index + 1}
                                                  </span>
                                                Detalle
                                              </h4>
                                              <div className="flex flex-wrap items-center gap-2">
                                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                  {d.externo_detalle_id && <Badge variant="outline">Externo {d.externo_detalle_id}</Badge>}
                                                  {d.idcuentaventadet_orizon && <Badge variant="outline">Orizon {d.idcuentaventadet_orizon}</Badge>}
                                                </div>
                                                  {isEditing ? (
                                                    isEditingThisDetail ? (
                                                      <div className="flex items-center gap-1">
                                                        <Button
                                                          variant="secondary"
                                                          size="sm"
                                                          className="h-8 px-3"
                                                          onClick={handleSave}
                                                          disabled={saving}
                                                        >
                                                          {saving ? (
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                          ) : (
                                                            'Guardar detalle'
                                                          )}
                                                        </Button>
                                                        <Button
                                                          variant="ghost"
                                                          size="sm"
                                                          className="h-7 w-7 p-0"
                                                          onClick={() => setEditingDetalleId(null)}
                                                        >
                                                          <X className="h-4 w-4" />
                                                        </Button>
                                                      </div>
                                                    ) : (
                                                      <div className="flex items-center gap-1">
                                                        <Button
                                                          variant="ghost"
                                                          size="sm"
                                                          className="h-7 px-2"
                                                          onClick={() => {
                                                            setEditingDetalleId(d.id);
                                                          }}
                                                        >
                                                          <Edit2 className="h-3 w-3" />
                                                        </Button>
                                                        <Button
                                                          variant="ghost"
                                                          size="sm"
                                                          className="h-7 px-2 text-destructive"
                                                          onClick={() => handleDeleteDetalle(d)}
                                                          disabled={deletingDetalleId === d.id}
                                                        >
                                                          {deletingDetalleId === d.id ? (
                                                            <Loader2 className="h-3 w-3 animate-spin" />
                                                          ) : (
                                                            <Trash2 className="h-3 w-3" />
                                                          )}
                                                        </Button>
                                                      </div>
                                                    )
                                                  ) : !account.idcuentaventa_orizon ? (
                                                    <div className="flex items-center gap-1">
                                                      <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 px-2"
                                                        onClick={() => {
                                                          startEditingAccount();
                                                          setEditingDetalleId(d.id);
                                                        }}
                                                      >
                                                        <Edit2 className="h-3 w-3" />
                                                        <span className="text-xs ml-1">Editar detalle</span>
                                                      </Button>
                                                      <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 px-2 text-destructive"
                                                        onClick={() => handleDeleteDetalle(d)}
                                                        disabled={deletingDetalleId === d.id}
                                                      >
                                                        {deletingDetalleId === d.id ? (
                                                          <Loader2 className="h-3 w-3 animate-spin" />
                                                        ) : (
                                                          <>
                                                            <Trash2 className="h-3 w-3" />
                                                            <span className="text-xs ml-1">Quitar detalle</span>
                                                          </>
                                                        )}
                                                      </Button>
                                                    </div>
                                                  ) : null
                                                  }
                                                </div>
                                              </div>
                                              <div className="p-4 space-y-4">
                                                <div className="rounded-xl border border-border/60 bg-muted/30 p-4">
                                                  <div className="flex flex-wrap items-center gap-2">
                                                    <Badge variant="outline" className="text-[10px] uppercase">
                                                      Orizon
                                                    </Badge>
                                                    <p className="text-sm font-semibold text-foreground">
                                                      {salidaTitulo ||
                                                        (hasSalidaId
                                                          ? salidaLoading
                                                            ? 'Cargando salida...'
                                                            : 'Salida pendiente de Orizon'
                                                          : 'Salida sin ID Orizon')}
                                                    </p>
                                                  </div>
                                                  {hasSalidaId && (
                                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                                                      <span>SalidaDetalle #{d.salidadetalleid}</span>
                                                      {salidaInfo?.salidaid && <span>· Salida #{salidaInfo.salidaid}</span>}
                                                    </div>
                                                  )}
                                                  {hasSalidaId && salidaLoading && (
                                                    <p className="mt-2 text-xs text-muted-foreground">Cargando datos de Orizon...</p>
                                                  )}
                                                  {hasSalidaId &&
                                                    !salidaLoading &&
                                                    salidaError &&
                                                    salidaError !== NO_ORIZON_LINE_DATA && (
                                                    <p className="mt-2 text-xs text-destructive">{salidaError}</p>
                                                  )}
                                                  {hasSalidaId && !salidaLoading && !salidaError && salidaInfo && (
                                                    <div className="mt-3 grid gap-3 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-3">
                                                      <div>
                                                        <p className="text-[11px] uppercase tracking-wide">Género</p>
                                                        <p className="text-sm font-semibold text-foreground">
                                                          {salidaInfo.descripcion_genero || '—'}
                                                        </p>
                                                      </div>
                                                      <div>
                                                        <p className="text-[11px] uppercase tracking-wide">Calibre</p>
                                                        <p className="text-sm font-semibold text-foreground">
                                                          {salidaInfo.nombre_calibre || '—'}
                                                        </p>
                                                      </div>
                                                      <div>
                                                        <p className="text-[11px] uppercase tracking-wide">Origen</p>
                                                        <p className="text-sm font-semibold text-foreground">
                                                          {salidaInfo.nombre_origen || '—'}
                                                        </p>
                                                      </div>
                                                      <div>
                                                        <p className="text-[11px] uppercase tracking-wide">Confección</p>
                                                        <p className="text-sm font-semibold text-foreground">
                                                          {salidaInfo.nombre_catalogoconfeccion || salidaInfo.abreviatura_confeccionpalet || '—'}
                                                        </p>
                                                      </div>
                                                      <div>
                                                        <p className="text-[11px] uppercase tracking-wide">Bultos / Palet</p>
                                                        <p className="text-sm font-semibold text-foreground">
                                                          {salidaInfo.bultosxpalet ?? '—'}
                                                        </p>
                                                      </div>
                                                      <div>
                                                        <p className="text-[11px] uppercase tracking-wide">Palets</p>
                                                        <p className="text-sm font-semibold text-foreground">
                                                          {salidaInfo.nro_palets ?? '—'}
                                                        </p>
                                                      </div>
                                                      <div>
                                                        <p className="text-[11px] uppercase tracking-wide">Bultos</p>
                                                        <p className="text-sm font-semibold text-foreground">
                                                          {salidaInfo.bultos ?? '—'}
                                                        </p>
                                                      </div>
                                                      <div>
                                                        <p className="text-[11px] uppercase tracking-wide">Kilos por bulto</p>
                                                        <p className="text-sm font-semibold text-foreground">
                                                          {salidaInfo.kilosxbulto ?? '—'}
                                                        </p>
                                                      </div>
                                                      <div>
                                                        <p className="text-[11px] uppercase tracking-wide">Kilos netos</p>
                                                        <p className="text-sm font-semibold text-foreground">
                                                          {salidaInfo.total_kilosnetos ?? '—'}
                                                        </p>
                                                      </div>
                                                    </div>
                                                  )}
                                                </div>
                                                {d.valores.length === 0 ? (
                                                  <p className="text-sm text-muted-foreground">Sin valores registrados.</p>
                                                ) : (
                                                  d.valores.map((v) => {
                                                    const currentValue = { ...v, ...editedDetalleValues[v.id] };
                                                    const divisaLabel = getDivisaLabel(currentValue.divisaid);
                                                    const divisaDisplay = divisaLabel === '—' ? '' : divisaLabel;
                                                    const tipoPrecio = normalizeTipoPrecio(currentValue.tipo_precio);
                                                    const tipoPrecioDescription = tipoPrecioDescriptions[tipoPrecio];
                                                    const tipoPrecioLabel = tipoPrecioDescription
                                                      ? `${tipoPrecio} (${tipoPrecioDescription})`
                                                      : tipoPrecio;
                                                    return (
                                                      <div key={v.id} className="space-y-3">
                                                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                          {!isEditingThisDetail && (
                                                            <Badge
                                                              variant="outline"
                                                              className="gap-2 px-3 py-1 text-[11px] font-semibold"
                                                            >
                                                              <span className="text-foreground">
                                                                {Number(currentValue.precio ?? 0).toFixed(2)}
                                                              </span>
                                                              {divisaDisplay && <span>{divisaDisplay}</span>}
                                                              <span className="text-muted-foreground">·</span>
                                                              <span>{tipoPrecioLabel}</span>
                                                            </Badge>
                                                          )}
                                                        </div>
                                                        {isEditingThisDetail ? (
                                                          <div className="space-y-4">
                                                            <div>
                                                              <h5 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                                                                Precio y divisa
                                                              </h5>
                                                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Divisa</Label>
                                                                  <DivisaCombobox
                                                                    value={currentValue.divisaid || null}
                                                                    onChange={(value) => updateDetalleValue(v.id, { divisaid: value ?? 0 })}
                                                                  />
                                                                </div>
                                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Precio</Label>
                                                                  <Input
                                                                    type="number"
                                                                    step="0.01"
                                                                    className={`${numberInputNoSpin} h-8`}
                                                                    value={currentValue.precio ?? 0}
                                                                    onChange={(e) =>
                                                                      updateDetalleValue(v.id, { precio: toNumberOrZero(e.target.value) })
                                                                    }
                                                                  />
                                                                </div>
                                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Tipo precio</Label>
                                                                  <Select
                                                                    value={normalizeTipoPrecio(currentValue.tipo_precio)}
                                                                    onValueChange={(val) => updateDetalleValue(v.id, { tipo_precio: val })}
                                                                  >
                                                                    <SelectTrigger className="h-8">
                                                                      <SelectValue placeholder="Tipo" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                      <SelectItem value="K">K</SelectItem>
                                                                      <SelectItem value="B">B</SelectItem>
                                                                      <SelectItem value="P">P</SelectItem>
                                                                    </SelectContent>
                                                                  </Select>
                                                                </div>
                                                              </div>
                                                            </div>
                                                            <div>
                                                              <h5 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                                                                Cantidades
                                                              </h5>
                                                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos netos</Label>
                                                                  <Input
                                                                    type="number"
                                                                    className={`${numberInputNoSpin} h-8`}
                                                                    value={currentValue.total_kilosnetos ?? 0}
                                                                    onChange={(e) =>
                                                                      updateDetalleValue(v.id, { total_kilosnetos: toNumberOrZero(e.target.value) })
                                                                    }
                                                                  />
                                                                </div>
                                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos cliente</Label>
                                                                  <Input
                                                                    type="number"
                                                                    className={`${numberInputNoSpin} h-8`}
                                                                    value={currentValue.total_kiloscliente ?? 0}
                                                                    onChange={(e) =>
                                                                      updateDetalleValue(v.id, { total_kiloscliente: toNumberOrZero(e.target.value) })
                                                                    }
                                                                  />
                                                                </div>
                                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos brutos</Label>
                                                                  <Input
                                                                    type="number"
                                                                    className={`${numberInputNoSpin} h-8`}
                                                                    value={currentValue.total_kilosbrutos ?? 0}
                                                                    onChange={(e) =>
                                                                      updateDetalleValue(v.id, { total_kilosbrutos: toNumberOrZero(e.target.value) })
                                                                    }
                                                                  />
                                                                </div>
                                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Bultos</Label>
                                                                  <Input
                                                                    type="number"
                                                                    className={`${numberInputNoSpin} h-8`}
                                                                    value={currentValue.total_bultos ?? 0}
                                                                    onChange={(e) =>
                                                                      updateDetalleValue(v.id, { total_bultos: toNumberOrZero(e.target.value) })
                                                                    }
                                                                  />
                                                                </div>
                                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Palets</Label>
                                                                  <Input
                                                                    type="number"
                                                                    className={`${numberInputNoSpin} h-8`}
                                                                    value={currentValue.nro_palets ?? 0}
                                                                    onChange={(e) =>
                                                                      updateDetalleValue(v.id, { nro_palets: toNumberOrZero(e.target.value) })
                                                                    }
                                                                  />
                                                                </div>
                                                                <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Piezas</Label>
                                                                  <Input
                                                                    type="number"
                                                                    className={`${numberInputNoSpin} h-8`}
                                                                    value={currentValue.total_piezas ?? 0}
                                                                    onChange={(e) =>
                                                                      updateDetalleValue(v.id, { total_piezas: toNumberOrZero(e.target.value) })
                                                                    }
                                                                  />
                                                                </div>
                                                              </div>
                                                            </div>
                                                          </div>
                                                        ) : (
                                                          <div>
                                                            <h5 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                                                              Cantidades
                                                            </h5>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                                                              <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos netos</Label>
                                                                <p className="text-sm font-semibold text-foreground">
                                                                  {numberFormat(currentValue.total_kilosnetos ?? 0)}
                                                                </p>
                                                              </div>
                                                              <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos cliente</Label>
                                                                <p className="text-sm font-semibold text-foreground">
                                                                  {numberFormat(currentValue.total_kiloscliente ?? 0)}
                                                                </p>
                                                              </div>
                                                              <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Kilos brutos</Label>
                                                                <p className="text-sm font-semibold text-foreground">
                                                                  {numberFormat(currentValue.total_kilosbrutos ?? 0)}
                                                                </p>
                                                              </div>
                                                              <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Bultos</Label>
                                                                <p className="text-sm font-semibold text-foreground">
                                                                  {numberFormat(currentValue.total_bultos ?? 0)}
                                                                </p>
                                                              </div>
                                                              <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Palets</Label>
                                                                <p className="text-sm font-semibold text-foreground">
                                                                  {numberFormat(currentValue.nro_palets ?? 0)}
                                                                </p>
                                                              </div>
                                                              <div className="space-y-1 p-3 rounded-lg bg-muted/30 border">
                                                                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Piezas</Label>
                                                                <p className="text-sm font-semibold text-foreground">
                                                                  {numberFormat(currentValue.total_piezas ?? 0)}
                                                                </p>
                                                              </div>
                                                            </div>
                                                          </div>
                                                        )}
                                                      </div>
                                                    );
                                                  })
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </section>
                                </div>
                              );

                              const handleCardActivate = () => {
                                openAccountDetails(account.id);
                              };

                              const cardContent = (
                                <Card
                                  className={cardClasses}
                                  role="button"
                                  tabIndex={0}
                                  onClick={handleCardActivate}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      handleCardActivate();
                                    }
                                  }}
                                >
                                  <CardContent className="flex flex-col gap-2 p-4">
                                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-foreground">
                                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        Cuenta de venta
                                      </span>
                                      <span className="text-base font-semibold">{account.numero_cuentaventa || `#${account.id}`}</span>
                                      <span aria-hidden="true" className="text-xs text-muted-foreground/70">
                                        ·
                                      </span>
                                      <span
                                        className={`text-xs font-medium ${
                                          sentToOrizon
                                            ? 'text-sky-700 dark:text-sky-200'
                                            : 'text-muted-foreground'
                                        }`}
                                      >
                                        {accountStatusLabel}
                                      </span>
                                      <span aria-hidden="true" className="text-xs text-muted-foreground/70">
                                        ·
                                      </span>
                                      <span
                                        className={`text-xs font-medium ${
                                          noDetalles
                                            ? 'text-amber-700 dark:text-amber-200'
                                            : 'text-muted-foreground'
                                        }`}
                                      >
                                        {accountDetailLabel}
                                      </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                      <span>
                                        Cliente{' '}
                                        <span className="font-semibold text-foreground">
                                          {account.clienteNombre || `Cliente ${account.clienteid}`}
                                        </span>
                                      </span>

                                      {arrivalAtLabel && (
                                        <>
                                          <span aria-hidden="true" className="text-muted-foreground/70">
                                            ·
                                          </span>
                                          <span>Llegada {arrivalAtLabel}</span>
                                        </>
                                      )}
                                      <span aria-hidden="true" className="text-muted-foreground/70">
                                        ·
                                      </span>
                                      <span>
                                        Total{' '}
                                        <span className="font-semibold text-foreground">
                                          {currencyFormat(account.total_cuentaventa)} €
                                        </span>
                                      </span>
                                    </div>
                                  </CardContent>
                                </Card>
                              );

                              return (
                                <Dialog
                                  key={account.id}
                                  open={detailsOpen && selectedAccountId === account.id}
                                  onOpenChange={(open) => {
                                    if (!open) closeAccountDetails();
                                  }}
                                >
                                  {isAdmin ? (
                                    <TooltipProvider delayDuration={150}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>{cardContent}</TooltipTrigger>
                                        <TooltipContent side="top" align="start" className="max-w-xs">
                                          <div className="space-y-1 text-xs">
                                            <p>
                                              <span className="font-semibold">Enviado por:</span>{' '}
                                              {senderUserLabel ?? 'No disponible'}
                                            </p>
                                            <p>
                                              <span className="font-semibold">Enviado a Orizon:</span>{' '}
                                              {orizonStatusLabel}
                                            </p>
                                            <p>
                                              <span className="font-semibold">Registrado en sistema:</span>{' '}
                                              {registeredAtLabel ?? 'No disponible'}
                                            </p>
                                            <p>
                                              <span className="font-semibold">Llegada al correo:</span>{' '}
                                              {emailArrivalAtLabel ?? 'No disponible'}
                                            </p>
                                            {sentAtLabel && (
                                              <p>
                                                <span className="font-semibold">Enviado en:</span>{' '}
                                                {sentAtLabel}
                                              </p>
                                            )}
                                          </div>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  ) : (
                                    cardContent
                                  )}

                                  <DialogContent
                                    overlayClassName="bg-slate-900/45"
                                    className="flex h-[calc(100dvh-16px)] max-h-[calc(100dvh-16px)] w-[min(1600px,calc(100vw-16px))] max-w-[min(1600px,calc(100vw-16px))] flex-col gap-0 overflow-visible rounded-xl border border-border/70 bg-background px-0 py-0 shadow-2xl"
                                  >
                                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-background">
                                      <div className="shrink-0 border-b border-border/60 bg-background px-5 py-4 sm:px-6">
                                        <DialogHeader className="space-y-4">
                                          <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div className="flex-1 min-w-[260px]">
                                              <DialogTitle className="text-2xl font-bold flex items-center gap-3">
                                                <CircleDot className="h-6 w-6 text-primary" />
                                                Cuenta de venta {account.numero_cuentaventa || `#${account.id}`}
                                              </DialogTitle>
                                              <DialogDescription className="sr-only">
                                                Vista de detalle de la cuenta de venta
                                              </DialogDescription>
                                              <div className="mt-2 text-base text-muted-foreground">
                                                Cliente:{' '}
                                                <span className="font-semibold text-foreground">
                                                  {account.clienteNombre || account.clienteid}
                                                </span>
                                              </div>
                                              <div className="mt-1 text-sm text-muted-foreground">
                                                {getSerieLabel(account.serieid)} · Valoración {formatDate(account.fechavaloracion)}
                                              </div>
                                              {arrivalAtLabel && (
                                                <div className="mt-1 text-sm text-muted-foreground">
                                                  Llegada {arrivalAtLabel}
                                                </div>
                                              )}
                                              {registeredAtLabel && (
                                                <div className="mt-1 text-sm text-muted-foreground">
                                                  Registrada en sistema {registeredAtLabel}
                                                </div>
                                              )}
                                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                                {statusBadge(account)}
                                                {isEditing && (
                                                  <Badge variant="secondary" className="text-xs">
                                                    Modo edición
                                                  </Badge>
                                                )}
                                                {statusFromAccount(account) === 'pending' && account.detalles.length === 0 && (
                                                  <Badge
                                                    variant="outline"
                                                    className="bg-amber-50 text-amber-800 border-amber-200 text-xs dark:bg-amber-950/50 dark:text-amber-100 dark:border-amber-900/70"
                                                  >
                                                    Sin detalles
                                                  </Badge>
                                                )}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                              {account.idcuentaventa_orizon ? (
                                                <Badge
                                                  variant="outline"
                                                  className="bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/50 dark:text-sky-100 dark:border-sky-800/60"
                                                >
                                                  Enviado a Orizon...
                                                </Badge>
                                              ) : (
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  onClick={handleSendToOrizon}
                                                  disabled={
                                                    sendingOrizon ||
                                                    isEditing ||
                                                    !selectedAccount ||
                                                    (selectedAccount.detalles?.length ?? 0) === 0
                                                  }
                                                  className="shadow-sm hover:shadow transition-shadow"
                                                >
                                                  {sendingOrizon ? (
                                                    <span className="inline-flex items-center gap-2">
                                                      <Loader2 className="h-4 w-4 animate-spin" />
                                                      Enviando a Orizon
                                                    </span>
                                                  ) : (
                                                    'Enviar a Orizon'
                                                  )}
                                                </Button>
                                              )}
                                              {!account.idcuentaventa_orizon && isEditing ? (
                                                <>
                                                  <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                      setIsEditing(false);
                                                      setEditForm({});
                                                      setEditingDetalleId(null);
                                                      setEditedDetalleValues({});
                                                      setShowNewDetalleForm(false);
                                                      setNewDetalle({
                                                        salidadetalleid: null,
                                                        total_kilosbrutos: 0,
                                                        total_kiloscliente: 0,
                                                        total_kilosnetos: 0,
                                                        total_piezas: 0,
                                                        total_bultos: 0,
                                                        nro_palets: 0,
                                                        divisaid: 0,
                                                        precio: 0,
                                                        tipo_precio: 'K',
                                                      });
                                                    }}
                                                    className="shadow-sm hover:shadow transition-shadow"
                                                  >
                                                    <X className="h-4 w-4 mr-2" />
                                                    Cancelar
                                                  </Button>
                                                  <Button
                                                    variant="default"
                                                    size="sm"
                                                    onClick={handleSave}
                                                    className="shadow-sm hover:shadow-md transition-shadow"
                                                    disabled={saving}
                                                  >
                                                    <Save className="h-4 w-4 mr-2" />
                                                    Guardar
                                                  </Button>
                                                </>
                                              ) : !account.idcuentaventa_orizon ? (
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() => {
                                                    startEditingAccount();
                                                  }}
                                                  className="shadow-sm hover:shadow transition-shadow"
                                                >
                                                  <Edit className="h-4 w-4 mr-2" />
                                                  Editar
                                                </Button>
                                              ) : null}
                                              {!account.idcuentaventa_orizon && (
                                                <AlertDialog>
                                                  <AlertDialogTrigger asChild>
                                                    <Button size="sm" variant="destructive" disabled={deleting}>
                                                      {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Eliminar'}
                                                    </Button>
                                                  </AlertDialogTrigger>
                                                  <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                      <AlertDialogTitle>Eliminar cuenta de venta</AlertDialogTitle>
                                                      <AlertDialogDescription>
                                                        Se eliminará la cuenta y sus datos asociados. Esta acción no se puede deshacer.
                                                      </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                      <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                                                        Confirmar eliminación
                                                      </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                  </AlertDialogContent>
                                                </AlertDialog>
                                              )}
                                            </div>
                                          </div>
                                        </DialogHeader>
                                      </div>
                                      <div
                                        className={`min-h-0 flex-1 px-5 sm:px-6 lg:px-8 ${
                                          showPdfPanel ? 'flex flex-col overflow-hidden pb-4' : 'overflow-y-auto pb-10 space-y-8'
                                        }`}
                                      >
                                        {account.archivo_pdf_id && (
                                          <section className="mt-4 shrink-0 border-b border-border/60 pb-4">
                                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/15 bg-primary/5 px-3 py-3">
                                              <div className="min-w-0">
                                                <h3 className="flex items-center gap-2 text-base font-semibold">
                                                  <FileText className="h-5 w-5 shrink-0 text-primary" />
                                                  Documento PDF
                                                </h3>
                                                <p className="mt-0.5 truncate text-sm font-medium text-muted-foreground">
                                                  {loadingPdf
                                                    ? 'Cargando PDF vinculado'
                                                    : pdfUrl
                                                      ? 'PDF vinculado a esta cuenta de venta'
                                                      : 'PDF no disponible'}
                                                </p>
                                              </div>
                                              <div className="flex flex-wrap items-center gap-2">
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() =>
                                                    openPdfInNewTab(
                                                      account.archivo_pdf_id!,
                                                      null,
                                                      accountPdfSearchCandidates,
                                                      accountPdfFallbackPage,
                                                    )
                                                  }
                                                  disabled={loadingPdf}
                                                >
                                                  <ExternalLink className="h-4 w-4 mr-2" />
                                                  Abrir
                                                </Button>
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() => setShowPdfPreview((prev) => !prev)}
                                                  disabled={loadingPdf || !pdfUrl}
                                                >
                                                  {showPdfPreview ? (
                                                    <>
                                                      <EyeOff className="h-4 w-4 mr-2" />
                                                      Ocultar PDF
                                                    </>
                                                  ) : (
                                                    <>
                                                      <Eye className="h-4 w-4 mr-2" />
                                                      Ver PDF
                                                    </>
                                                  )}
                                                </Button>
                                              </div>
                                            </div>
                                            <div className="mt-3 2xl:hidden">
                                              <SalesAccountPdfSharedInfo
                                                archivoPdfId={account.archivo_pdf_id}
                                                currentAccountId={account.id}
                                                currentClienteId={account.clienteid}
                                                onAccountClick={(accountId) => {
                                                  openAccountDetails(accountId);
                                                }}
                                              />
                                            </div>
                                          </section>
                                        )}
                                        <div
                                          className={`mt-4 grid gap-6 lg:grid-cols-1 ${
                                            showPdfPanel
                                              ? 'min-h-0 flex-1 overflow-y-auto xl:grid-cols-[minmax(520px,1.05fr)_minmax(420px,0.95fr)] xl:items-stretch xl:overflow-hidden'
                                              : 'xl:items-start'
                                          }`}
                                        >
                                          {showPdfPanel ? (
                                            <div className="min-h-[520px] min-w-0 xl:min-h-0 xl:overflow-hidden">
                                              <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/60 bg-background shadow-sm">
                                                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
                                                  <div className="flex min-w-0 items-center gap-2">
                                                    <FileText className="h-5 w-5 shrink-0 text-primary" />
                                                    <div className="min-w-0">
                                                      <h3 className="truncate text-base font-semibold">Vista del documento</h3>
                                                      <p className="truncate text-xs text-muted-foreground">
                                                        Revisa el PDF asociado directamente desde esta cuenta.
                                                      </p>
                                                    </div>
                                                  </div>
                                                  <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => setShowPdfPreview(false)}
                                                    className="h-8 w-8 shrink-0 p-0"
                                                  >
                                                    <X className="h-4 w-4" />
                                                  </Button>
                                                </div>
                                                <div className="min-h-0 flex-1 overflow-hidden">
                                                  {loadingPdf ? (
                                                    <div className="flex h-full min-h-[420px] items-center justify-center bg-muted/20">
                                                      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Cargando PDF...
                                                      </span>
                                                    </div>
                                                  ) : pdfUrl ? (
                                                    <PdfViewer
                                                      key={`${account.id}-${pdfPreviewPage ?? 0}`}
                                                      url={pdfUrl}
                                                      fileName={accountPdfFileName}
                                                      initialPage={pdfPreviewPage}
                                                      showControls
                                                      className="h-full min-h-0"
                                                    />
                                                  ) : (
                                                    <div className="flex h-full min-h-[420px] items-center justify-center bg-muted/20 px-6 text-center text-sm text-muted-foreground">
                                                      PDF no disponible.
                                                    </div>
                                                  )}
                                                </div>
                                              </section>
                                            </div>
                                          ) : null}
                                          <div
                                            className={
                                              showPdfPanel
                                                ? 'min-w-0 space-y-6 h-full min-h-0 overflow-y-scroll overscroll-contain pb-8 pr-2'
                                                : 'space-y-6 pr-1'
                                            }
                                          >
                                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                              {account.externo_id && <Badge variant="outline">Externo: {account.externo_id}</Badge>}
                                            </div>
                                            {sections}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                    {account.archivo_pdf_id && sharedAccountPdfRelatedCount > 0 && (
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
                                            <SalesAccountPdfSharedInfo
                                              archivoPdfId={account.archivo_pdf_id}
                                              currentAccountId={account.id}
                                              currentClienteId={account.clienteid}
                                              onAccountClick={(accountId) => {
                                                openAccountDetails(accountId);
                                              }}
                                              className="h-full"
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </DialogContent>
                                </Dialog>
                              );
                            }))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                    })}
                  </div>
                </div>
                {totalGroupCount > 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 mt-4 border-t">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Mostrar</span>
                      <select
                        value={itemsPerPage}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          setItemsPerPage(Number.isFinite(value) && value > 0 ? value : 10);
                          setCurrentPage(1);
                        }}
                        disabled={pageTransitionLoading}
                        className="h-8 rounded-md border bg-background px-2 text-sm"
                      >
                        <option value={10}>10</option>
                        <option value={15}>15</option>
                        <option value={30}>30</option>
                      </select>
                      <span className="text-muted-foreground">archivos de {totalGroupCount}</span>
                      <span className="text-xs text-muted-foreground/70">
                        ({totalFilteredAccountCount} cuentas en esta búsqueda)
                      </span>
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
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
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
    </div>
  );
};

export default SalesAccountsView;
