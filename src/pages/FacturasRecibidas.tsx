import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { FilterSelect } from '../components/FilterSelect';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import CustomSelect from '../components/ui/custom-select';
import { PdfViewer } from '../components/PdfViewer';
import {
  facturaEstadoLabels,
  facturaGsbaseStatusLabels,
  isFacturaInGys,
  isFacturaUnprocessedUploadDraft,
  type FacturaGsbaseStatus,
} from '../lib/facturasSummary';
import {
  cleanupFacturaRecibidaUpload,
  type FacturaIaExtraccion,
  type LocalizarProveedorResponse,
  fetchFacturaRecibidaById,
  fetchFacturaRecibidaGsBasePayloadPreview,
  fetchFacturasRecibidas,
  getFacturaPdfSignedUrl,
  extractFacturaWithN8n,
  isNetagroReadOnlyFactura,
  localizarProveedorGsBase,
  saveFacturaRecibida,
  sendFacturaRecibidaToGsBase,
  uploadFacturaPdf,
} from '../services/facturas';
import type { FacturaRecibida, FacturaRecibidaEstado, FacturaRecibidaLinea } from '../services/apiContracts';

type FacturaDraft = Partial<FacturaRecibida>;

type FacturaFilters = {
  proveedor: string;
  nif: string;
  numero: string;
  documento: string;
  estado: 'todos' | FacturaRecibidaEstado;
  fechaDesde: string;
  fechaHasta: string;
  importeMin: string;
  importeMax: string;
};

type ModalMessage = {
  type: 'success' | 'error' | 'info';
  text: string;
};

type FacturaSortOrder = 'created_desc' | 'created_asc' | 'fecha_desc' | 'fecha_asc' | 'total_desc' | 'total_asc';
type FacturaGsbaseListState = 'registered' | 'unregistered' | 'checking' | 'unknown';
type FacturaUploadStep = 'idle' | 'uploading' | 'analyzing' | 'done';
type ProviderLookupState = 'idle' | 'available' | 'searching';

const PAGE_SIZE_OPTIONS = ['25', '50', '100'];
const DEFAULT_PAGE_SIZE = 25;
const MAX_FACTURA_PDF_BYTES = 20 * 1024 * 1024;
const PDF_UPLOAD_ANIMATION_MS = 1850;

const sortOptions: { value: FacturaSortOrder; label: string }[] = [
  { value: 'created_desc', label: 'Mas recientes primero' },
  { value: 'created_asc', label: 'Mas antiguas primero' },
  { value: 'fecha_desc', label: 'Fecha factura desc.' },
  { value: 'fecha_asc', label: 'Fecha factura asc.' },
  { value: 'total_desc', label: 'Importe mayor primero' },
  { value: 'total_asc', label: 'Importe menor primero' },
];

const estadoOptions: { value: 'todos' | FacturaRecibidaEstado; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'borrador', label: 'Borrador' },
  { value: 'pendiente_revision', label: 'Pendiente revision' },
  { value: 'validada', label: 'Validada' },
  { value: 'enviada_gsbase', label: 'Enviada' },
  { value: 'error_gsbase', label: 'Error de envio' },
  { value: 'descartada', label: 'Descartada' },
];

const ivaOptions = [
  { value: '21', label: '21%' },
  { value: '10', label: '10%' },
  { value: '4', label: '4%' },
];

const estadoLabels = facturaEstadoLabels;

const emptyFilters: FacturaFilters = {
  proveedor: '',
  nif: '',
  numero: '',
  documento: '',
  estado: 'todos',
  fechaDesde: '',
  fechaHasta: '',
  importeMin: '',
  importeMax: '',
};

const createEmptyDraft = (): FacturaDraft => ({
  estado: 'borrador',
  proveedor_nombre: '',
  proveedor_nif: '',
  proveedor_codigo: '',
  numero_factura: '',
  referencia: '',
  fr_alm: '00',
  fr_sufa: 'A',
  fecha_factura: '',
  base_imponible: null,
  iva_importe: null,
  retencion_porcentaje: 0,
  retencion_importe: 0,
  descuento_general: 0,
  descuento_pronto_pago: 0,
  total: null,
  pendiente_pago: 0,
  albaranes: '',
  email_remitente: '',
  asunto_email: '',
  pdf_path: null,
  pdf_nombre: null,
  pdf_mime_type: null,
  pdf_size: null,
  validation_errors: [],
});

const createEmptyLinea = (posicion = 1): FacturaRecibidaLinea => ({
  posicion,
  descripcion: '',
  iva: 21,
  importe: 0,
});

const inputClass =
  'h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-border dark:bg-background dark:text-foreground dark:placeholder:text-muted-foreground dark:focus:border-primary dark:focus:ring-primary/20 dark:disabled:bg-slate-900/60';

const toolbarButtonBaseClass =
  'inline-flex h-9 w-[144px] items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const toolbarOutlineButtonClass =
  `${toolbarButtonBaseClass} border-border bg-background text-foreground hover:bg-muted/70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900`;

const toolbarFilterButtonClass = (active: boolean) =>
  active
    ? `${toolbarButtonBaseClass} border-transparent bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-blue-500 dark:text-slate-50 dark:hover:bg-blue-500/90`
    : `${toolbarButtonBaseClass} border-primary/50 bg-background text-primary hover:bg-primary/10 hover:text-primary dark:border-blue-400/70 dark:bg-slate-950 dark:text-blue-200 dark:hover:bg-blue-400/10`;

const detailInputClass =
  'h-10 w-full rounded-md border border-slate-200 bg-slate-100 px-3 text-sm font-semibold text-slate-950 outline-none transition-colors placeholder:text-slate-400 hover:bg-slate-50 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:focus:border-primary dark:focus:bg-slate-900 dark:focus:ring-primary/20';

const detailTextareaClass =
  'min-h-[74px] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-950 outline-none transition-colors placeholder:text-slate-400 hover:bg-slate-50 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:placeholder:text-slate-500 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:focus:border-primary dark:focus:bg-slate-900 dark:focus:ring-primary/20';

const detailTableInputClass =
  'h-9 w-full min-w-0 rounded-md border border-slate-200 bg-slate-100 px-2 text-sm font-semibold text-slate-950 outline-none transition-colors hover:bg-slate-50 focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:focus:border-primary dark:focus:bg-slate-900 dark:focus:ring-primary/20';

const formatDate = (value?: string | null) => {
  if (!value) {
    return '-';
  }

  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const formatMoney = (value?: number | null) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value ?? 0));

const formatInteger = (value: number) =>
  Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const normalizeText = (value?: string | null) => (value ?? '').trim().toLocaleLowerCase('es-ES');

const numberInputValue = (value: number | null | undefined) =>
  value === null || value === undefined || Number.isNaN(Number(value)) ? '' : String(value);

const parseNumber = (value: string) => {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseMaybeNumber = (value: number | string | null | undefined) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    return parseNumber(value);
  }

  return null;
};

const cleanOptionalString = (value: string | null | undefined) => {
  const cleaned = (value ?? '').trim();
  return cleaned || null;
};

const normalizeExtractedDate = (value: string | null | undefined) => {
  const cleaned = cleanOptionalString(value);
  if (!cleaned) {
    return null;
  }

  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const spanishMatch = cleaned.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (spanishMatch) {
    return `${spanishMatch[3]}-${spanishMatch[2].padStart(2, '0')}-${spanishMatch[1].padStart(2, '0')}`;
  }

  return cleaned;
};

const invoiceNumber = (factura: Partial<FacturaRecibida>) =>
  cleanOptionalString(factura.numero_factura) ||
  cleanOptionalString(factura.referencia) ||
  cleanOptionalString(factura.documento_codigo) ||
  (factura.id ? factura.id.slice(0, 8) : 'Sin numero');

const invoiceProvider = (factura: Partial<FacturaRecibida>) =>
  cleanOptionalString(factura.proveedor_nombre) || cleanOptionalString(factura.proveedor_nif) || 'Proveedor sin identificar';

type ProveedorLookupMatch = {
  codigo: string;
  nombre: string | null;
  nif: string | null;
};

const readLookupString = (record: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const cleaned = cleanOptionalString(String(value));
      if (cleaned) {
        return cleaned;
      }
    }
  }

  return null;
};

const extractProveedorLookupMatch = (response: LocalizarProveedorResponse): ProveedorLookupMatch | null => {
  const datos = response.gsbase_response?.datos;
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) {
    return null;
  }

  const record = datos as Record<string, unknown>;
  const codigo = readLookupString(record, ['codigo', 'CODIGO', 'cod', 'COD', 'FR_CPR', 'CPR']);
  if (!codigo) {
    return null;
  }

  return {
    codigo,
    nombre: readLookupString(record, ['nombre', 'NOMBRE', 'razon_social', 'RAZON_SOCIAL']),
    nif: readLookupString(record, ['cif', 'CIF', 'nif', 'NIF']),
  };
};

const applyProveedorLookupMatch = (factura: FacturaDraft, match: ProveedorLookupMatch): FacturaDraft => ({
  ...factura,
  proveedor_codigo: match.codigo,
  proveedor_nombre: match.nombre ?? factura.proveedor_nombre ?? null,
  proveedor_nif: match.nif ?? factura.proveedor_nif ?? null,
});

const locateProveedorForFactura = async (factura: FacturaDraft) => {
  const nif = cleanOptionalString(factura.proveedor_nif);
  const nombre = cleanOptionalString(factura.proveedor_nombre);

  if (!nif && !nombre) {
    return {
      factura,
      match: null,
      message: 'Indica NIF o nombre para buscar proveedor.',
      response: null,
    };
  }

  const response = await localizarProveedorGsBase({ nif, nombre });
  const match = extractProveedorLookupMatch(response);
  const datos = response.gsbase_response?.datos;

  return {
    factura: match ? applyProveedorLookupMatch(factura, match) : factura,
    match,
    message: typeof datos === 'string' ? datos : match ? 'Proveedor localizado.' : 'Proveedor no localizado.',
    response,
  };
};

const gsbaseStateForInvoice = (
  factura: FacturaRecibida,
  externalState?: FacturaGsbaseListState,
): FacturaGsbaseListState => {
  if (externalState) return externalState;
  if (factura.estado === 'enviada_gsbase' || factura.gsbase_sent_at) return 'registered';
  if (factura.estado === 'error_gsbase') return 'unregistered';
  if (factura.estado === 'validada' || factura.gsbase_payload) return 'unregistered';
  return 'unknown';
};

const gsbaseStatusMeta = (state: FacturaGsbaseListState) => {
  if (state === 'registered') {
    return {
      text: 'Enviado a Netagro',
      className: 'text-emerald-700 dark:text-emerald-300',
    };
  }

  if (state === 'unregistered') {
    return {
      text: 'No enviado a Netagro',
      className: 'text-amber-700 dark:text-amber-300',
    };
  }

  if (state === 'checking') {
    return {
      text: 'Comprobando Netagro',
      className: 'text-slate-500 dark:text-slate-300',
    };
  }

  return {
    text: 'No enviado a Netagro',
    className: 'text-amber-700 dark:text-amber-300',
  };
};

const buildFacturaFromExtraction = (base: FacturaDraft, extraction: FacturaIaExtraccion) => {
  const next: FacturaDraft = { ...base };
  const assignString = <TKey extends keyof FacturaDraft>(key: TKey, value: string | null | undefined) => {
    const cleaned = cleanOptionalString(value);
    if (cleaned) {
      next[key] = cleaned as FacturaDraft[TKey];
    }
  };
  const assignNumber = <TKey extends keyof FacturaDraft>(key: TKey, value: number | string | null | undefined) => {
    const parsed = parseMaybeNumber(value);
    if (parsed !== null) {
      next[key] = parsed as FacturaDraft[TKey];
    }
  };

  assignString('proveedor_nombre', extraction.proveedor_nombre);
  assignString('proveedor_nif', extraction.proveedor_nif);
  assignString('proveedor_codigo', extraction.proveedor_codigo);
  assignString('numero_factura', extraction.numero_factura);
  assignString('referencia', extraction.referencia);
  assignString('fr_alm', extraction.fr_alm);
  assignString('fr_sufa', extraction.fr_sufa);
  assignString('albaranes', extraction.albaranes);
  assignString('email_remitente', extraction.email_remitente);
  assignString('asunto_email', extraction.asunto_email);
  assignNumber('base_imponible', extraction.base_imponible);
  assignNumber('iva_importe', extraction.iva_importe);
  assignNumber('retencion_porcentaje', extraction.retencion_porcentaje);
  assignNumber('retencion_importe', extraction.retencion_importe);
  assignNumber('descuento_general', extraction.descuento_general);
  assignNumber('descuento_pronto_pago', extraction.descuento_pronto_pago);
  assignNumber('total', extraction.total);
  assignNumber('pendiente_pago', extraction.pendiente_pago);

  if (!next.estado || next.estado === 'borrador') {
    next.estado = 'pendiente_revision';
  }

  const normalizedDate = normalizeExtractedDate(extraction.fecha_factura);
  if (normalizedDate) {
    next.fecha_factura = normalizedDate;
  }

  const extractedLineas = extraction.lineas?.length
    ? extraction.lineas.map((linea, index) => ({
        posicion: index + 1,
        descripcion: cleanOptionalString(linea.descripcion) ?? '',
        iva: parseMaybeNumber(linea.iva) ?? 21,
        importe: parseMaybeNumber(linea.importe) ?? 0,
      }))
    : null;

  return { factura: next, lineas: extractedLineas };
};

const getLineas = (factura?: FacturaRecibida | null) =>
  factura?.facturas_recibidas_lineas?.length
    ? factura.facturas_recibidas_lineas.map((linea) => ({ ...linea }))
    : [createEmptyLinea()];

const createEditorSnapshot = (factura: FacturaDraft | null, lineas: FacturaRecibidaLinea[]) =>
  JSON.stringify({
    factura: {
      proveedor_nombre: factura?.proveedor_nombre ?? null,
      proveedor_nif: factura?.proveedor_nif ?? null,
      proveedor_codigo: factura?.proveedor_codigo ?? null,
      email_remitente: factura?.email_remitente ?? null,
      numero_factura: factura?.numero_factura ?? null,
      referencia: factura?.referencia ?? null,
      fecha_factura: factura?.fecha_factura ?? null,
      documento_codigo: factura?.documento_codigo ?? null,
      fr_alm: factura?.fr_alm ?? null,
      fr_sufa: factura?.fr_sufa ?? null,
      albaranes: factura?.albaranes ?? null,
      asunto_email: factura?.asunto_email ?? null,
      base_imponible: factura?.base_imponible ?? null,
      iva_importe: factura?.iva_importe ?? null,
      retencion_porcentaje: factura?.retencion_porcentaje ?? null,
      retencion_importe: factura?.retencion_importe ?? null,
      descuento_general: factura?.descuento_general ?? null,
      descuento_pronto_pago: factura?.descuento_pronto_pago ?? null,
      total: factura?.total ?? null,
      pendiente_pago: factura?.pendiente_pago ?? null,
    },
    lineas: lineas.map((linea, index) => ({
      id: linea.id ?? null,
      posicion: linea.posicion ?? index + 1,
      descripcion: linea.descripcion ?? '',
      iva: linea.iva ?? null,
      importe: linea.importe ?? null,
    })),
  });

const matchesFilter = (source: string | null | undefined, filter: string) =>
  !filter.trim() || normalizeText(source).includes(normalizeText(filter));

const getFacturaSearchText = (factura: FacturaRecibida) =>
  [
    factura.numero_factura,
    factura.referencia,
    factura.documento_codigo,
    factura.pdf_nombre,
    factura.pdf_path,
  ]
    .filter(Boolean)
    .join(' ');

const replaceFactura = (facturas: FacturaRecibida[], updated: FacturaRecibida) => {
  const exists = facturas.some((factura) => factura.id === updated.id);
  if (!exists) {
    return [updated, ...facturas];
  }

  return facturas.map((factura) => (factura.id === updated.id ? updated : factura));
};

type FacturaListItemProps = {
  factura: FacturaRecibida;
  isSelected: boolean;
  isReadOnly?: boolean;
  gsbaseRegistrationState?: FacturaGsbaseListState;
  loadingFacturaId?: string | null;
  onOpen: (factura: FacturaRecibida) => Promise<void> | void;
  onDelete: (factura: FacturaRecibida) => Promise<void> | void;
};

function FacturaListItem({
  factura,
  isSelected,
  isReadOnly = false,
  gsbaseRegistrationState,
  loadingFacturaId = null,
  onOpen,
  onDelete,
}: FacturaListItemProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const lineCount = factura.facturas_recibidas_lineas?.length ?? 0;
  const invoiceStatus = gsbaseStatusMeta(gsbaseStateForInvoice(factura, gsbaseRegistrationState));
  const gsbaseStatus: FacturaGsbaseStatus = isFacturaInGys(factura) ? 'en_gys' : 'fuera_gys';
  const hasErrors = Boolean(factura.validation_errors?.length || factura.gsbase_error);
  const isBusy = loadingFacturaId === factura.id;

  const handleDeleteClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    await onDelete(factura);
    setConfirmingDelete(false);
  };

  return (
    <article
      className={`group relative rounded-md border bg-background transition-colors dark:bg-slate-950/60 ${
        isSelected
          ? 'border-primary/45 ring-1 ring-primary/15 dark:border-primary/60'
          : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
      }`}
    >
      <button
        type="button"
        className={`grid w-full min-w-0 grid-cols-1 gap-4 rounded-md px-4 py-4 text-left outline-none transition-[background-color,padding] duration-150 hover:bg-slate-50/70 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:hover:bg-slate-900/50 md:grid-cols-[minmax(0,1fr)_minmax(180px,auto)] md:items-center ${
          isReadOnly ? '' : confirmingDelete ? 'pr-32 md:pr-36' : 'pr-14 md:pr-16'
        }`}
        onClick={() => void onOpen(factura)}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="min-w-0 truncate text-sm font-bold text-slate-950 dark:text-slate-50">
              Factura {invoiceNumber(factura)}
            </h3>
            <span className={`text-xs font-semibold ${invoiceStatus.className}`}>
              {facturaGsbaseStatusLabels[gsbaseStatus]}
            </span>
            {hasErrors ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                Con avisos
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
            {invoiceProvider(factura)}
          </p>
          <div className="mt-2 grid gap-x-5 gap-y-1 text-xs font-semibold text-slate-500 dark:text-slate-400 sm:grid-cols-2 lg:flex lg:flex-wrap">
            <span>
              Fecha <span className="ml-1 text-slate-700 dark:text-slate-200">{formatDate(factura.fecha_factura)}</span>
            </span>
            <span>
              Lineas <span className="ml-1 text-slate-700 dark:text-slate-200">{lineCount}</span>
            </span>
            <span>
              Flujo <span className="ml-1 text-slate-700 dark:text-slate-200">{estadoLabels[factura.estado]}</span>
            </span>
          </div>
        </div>

        <div className="text-left md:text-right">
          <p className="text-lg font-bold text-slate-950 dark:text-slate-50">{formatMoney(factura.total)}</p>
        </div>
      </button>

      {!isReadOnly ? (
        <button
          type="button"
          className={`absolute right-3 top-3 z-10 inline-flex h-9 items-center justify-center gap-2 rounded-md px-2.5 text-xs font-semibold transition-all duration-150 md:top-1/2 md:-translate-y-1/2 ${
            confirmingDelete
              ? 'min-w-[104px] bg-red-600 text-white hover:bg-red-700'
              : 'min-w-9 text-slate-500 hover:bg-red-50 hover:text-red-700 dark:text-slate-400 dark:hover:bg-red-950/35 dark:hover:text-red-200'
          }`}
          disabled={isBusy}
          onClick={(event) => void handleDeleteClick(event)}
          aria-label={confirmingDelete ? 'Confirmar eliminacion' : 'Eliminar factura'}
          title={confirmingDelete ? 'Confirmar' : 'Eliminar'}
        >
          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {confirmingDelete ? <span>Confirmar</span> : null}
        </button>
      ) : null}
    </article>
  );
}

function DetailSection({
  title,
  actions,
  className = '',
  children,
}: {
  title: string;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`purchase-invoice-detail-section border-b border-slate-200 py-5 last:border-b-0 dark:border-border ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-slate-950 dark:text-slate-50">{title}</h3>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function FieldGroup({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="purchase-invoice-field-group border-t border-slate-200 pt-4 first:border-t-0 first:pt-0 dark:border-border">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">{title}</p>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block min-w-0 text-sm font-semibold text-slate-950 dark:text-slate-100 ${className}`}>
      <span>{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function FacturaAiProcessingAnimation({ step }: { step: FacturaUploadStep }) {
  const isUploading = step === 'uploading';
  const phase = isUploading ? 'uploading' : 'analyzing';
  const title = isUploading ? 'Subiendo PDF' : 'Analizando con xFuego';
  const detail = isUploading ? 'Enviando el archivo al procesador.' : 'Extrayendo datos de la factura.';

  return (
    <div className={`parte-ai-loader parte-ai-loader--${phase}`} role="status" aria-live="polite">
      <div className="parte-ai-loader__stage" aria-hidden>
        <div className="parte-ai-loader__path" />
        <div className="parte-ai-loader__document">
          <FileText className="h-6 w-6" />
          <span>PDF</span>
        </div>
        <div className="parte-ai-loader__x-shell">
          <span className="parte-ai-loader__halo parte-ai-loader__halo--outer" />
          <span className="parte-ai-loader__halo parte-ai-loader__halo--inner" />
          <img src="/agents-logo-comprimido.png" alt="" className="parte-ai-loader__logo" />
          <span className="parte-ai-loader__scan" />
        </div>
        <div className="parte-ai-loader__spark parte-ai-loader__spark--one" />
        <div className="parte-ai-loader__spark parte-ai-loader__spark--two" />
        <div className="parte-ai-loader__spark parte-ai-loader__spark--three" />
      </div>

      <div className="space-y-1 text-center">
        <p className="text-sm font-bold text-foreground">{title}</p>
        <p className="text-xs font-semibold text-muted-foreground">{detail}</p>
      </div>
      <div className="parte-ai-loader__progress" aria-hidden>
        <span />
      </div>
    </div>
  );
}

const Facturas = () => {
  const navigate = useNavigate();
  const { facturaId } = useParams<{ facturaId?: string }>();
  const [facturas, setFacturas] = useState<FacturaRecibida[]>([]);
  const [filters, setFilters] = useState<FacturaFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortOrder, setSortOrder] = useState<FacturaSortOrder>('created_desc');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<FacturaDraft | null>(null);
  const [lineas, setLineas] = useState<FacturaRecibidaLinea[]>([createEmptyLinea()]);
  const [lastSavedEditorSnapshot, setLastSavedEditorSnapshot] = useState<string | null>(null);
  const providerLookupRunRef = useRef(0);
  const gsbasePayloadPreviewRunRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [providerLookupState, setProviderLookupState] = useState<ProviderLookupState>('idle');
  const [extractingIa, setExtractingIa] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [facturaUploadStep, setFacturaUploadStep] = useState<FacturaUploadStep>('idle');
  const [modalMessage, setModalMessage] = useState<ModalMessage | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [busyFacturaId, setBusyFacturaId] = useState<string | null>(null);
  const [gsbaseRegistrationByFacturaId, setGsbaseRegistrationByFacturaId] = useState<Record<string, FacturaGsbaseListState>>({});

  const isNewFacturaDraft = Boolean(draft && !draft.id);
  const isDetailMode = Boolean(draft?.id && !modalOpen);
  const activeDraftId = draft?.id ?? null;
  const activePdfPath = draft?.pdf_path ?? null;
  const currentEditorSnapshot = useMemo(() => createEditorSnapshot(draft, lineas), [draft, lineas]);
  const hasUnsavedDetailChanges = Boolean(
    isDetailMode && lastSavedEditorSnapshot && currentEditorSnapshot !== lastSavedEditorSnapshot,
  );
  const visibleErrors = draft?.validation_errors ?? [];
  const ivaSummary = Array.from(new Set(lineas.map((linea) => Number(linea.iva || 0)).filter(Boolean))).join(', ');
  const pageSizeOptions = PAGE_SIZE_OPTIONS.map((option) => ({ value: option, label: `${option} por pagina` }));

  useEffect(() => {
    if (!saveFeedback) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSaveFeedback(null);
    }, 2600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [saveFeedback]);

  useEffect(() => {
    if (hasUnsavedDetailChanges) {
      setSaveFeedback(null);
    }
  }, [hasUnsavedDetailChanges]);

  useEffect(() => {
    setSaveFeedback(null);
  }, [activeDraftId]);

  const loadFacturas = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const loaded = await fetchFacturasRecibidas();
      setFacturas(loaded);
      setGsbaseRegistrationByFacturaId(
        loaded.reduce<Record<string, FacturaGsbaseListState>>((acc, factura) => {
          if (factura.estado === 'enviada_gsbase' || factura.gsbase_sent_at) {
            acc[factura.id] = 'registered';
          } else if (factura.estado === 'validada' || factura.estado === 'error_gsbase' || factura.gsbase_payload) {
            acc[factura.id] = 'unregistered';
          }
          return acc;
        }, {}),
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar las facturas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFacturas();
  }, [loadFacturas]);

  useEffect(() => {
    if (modalOpen) {
      return;
    }

    if (!facturaId) {
      if (draft?.id) {
        setDraft(null);
        setLineas([createEmptyLinea()]);
        setLastSavedEditorSnapshot(null);
        setProviderLookupState('idle');
        setPdfFile(null);
        setPdfUrl(null);
        setFacturaUploadStep('idle');
        setModalMessage(null);
      }
      return;
    }

    if (loading) {
      return;
    }

    const factura = facturas.find((item) => item.id === facturaId);
    if (!factura) {
      setDraft(null);
      setLineas([createEmptyLinea()]);
      setLastSavedEditorSnapshot(null);
      setProviderLookupState('idle');
      setPdfFile(null);
      setPdfUrl(null);
      setFacturaUploadStep('idle');
      setModalMessage(null);
      setLoadError('No se encontro la factura solicitada.');
      return;
    }

    if (
      draft?.id === factura.id &&
      (!isNetagroReadOnlyFactura(factura) || (draft.facturas_recibidas_lineas?.length ?? 0) > 0)
    ) {
      return;
    }

    let cancelled = false;
    const applyFacturaDetail = (facturaToOpen: FacturaRecibida) => {
      const facturaLineas = getLineas(facturaToOpen);
      setDraft({ ...facturaToOpen });
      setLineas(facturaLineas);
      setLastSavedEditorSnapshot(createEditorSnapshot(facturaToOpen, facturaLineas));
      setProviderLookupState('idle');
      setPdfFile(null);
      setPdfUrl(null);
      setFacturaUploadStep('idle');
      setModalMessage(null);
      setModalOpen(false);
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    };

    setLoadError(null);

    if (isNetagroReadOnlyFactura(factura)) {
      setBusyFacturaId(factura.id);
      void fetchFacturaRecibidaById(factura.id)
        .then((detailedFactura) => {
          if (!cancelled) {
            applyFacturaDetail(detailedFactura ?? factura);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setLoadError(error instanceof Error ? error.message : 'No se pudo abrir la factura.');
            applyFacturaDetail(factura);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setBusyFacturaId(null);
          }
        });

      return () => {
        cancelled = true;
      };
    }

    applyFacturaDetail(factura);
  }, [draft?.id, facturaId, facturas, loading, modalOpen]);

  useEffect(() => {
    document.body.classList.add('facturas-iberica-shell');

    return () => {
      document.body.classList.remove('facturas-iberica-shell');
    };
  }, []);

  useEffect(() => {
    if (!activeDraftId || !isDetailMode) {
      return;
    }

    let active = true;
    const runId = gsbasePayloadPreviewRunRef.current + 1;
    gsbasePayloadPreviewRunRef.current = runId;

    void fetchFacturaRecibidaGsBasePayloadPreview(activeDraftId)
      .then((preview) => {
        if (!active || gsbasePayloadPreviewRunRef.current !== runId) {
          return;
        }

        if (preview.validation_errors.length > 0) {
          console.warn(
            `[ERP] Body calculado para factura ${activeDraftId}. El envio real quedaria bloqueado por validacion:`,
            preview.body_json,
            preview.validation_errors,
          );
          return;
        }

        console.warn(`[ERP] Body exacto que se enviara al ERP para factura ${activeDraftId}:`, preview.body_json);
      })
      .catch((error) => {
        if (!active || gsbasePayloadPreviewRunRef.current !== runId) {
          return;
        }

        console.warn(
          `[ERP] No se pudo calcular el body que se enviaria al ERP para factura ${activeDraftId}:`,
          error instanceof Error ? error.message : error,
        );
      });

    return () => {
      active = false;
    };
  }, [activeDraftId, isDetailMode]);

  useEffect(() => {
    let active = true;

    if (!activeDraftId || !activePdfPath) {
      setPdfUrl(null);
      setPdfLoading(false);
      return () => {
        active = false;
      };
    }

    setPdfLoading(true);
    void getFacturaPdfSignedUrl(activePdfPath)
      .then((url) => {
        if (active) {
          setPdfUrl(url);
        }
      })
      .catch((error) => {
        if (active) {
          setModalMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo abrir el PDF.' });
        }
      })
      .finally(() => {
        if (active) {
          setPdfLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [activeDraftId, activePdfPath]);

  const filteredFacturas = useMemo(() => {
    const filtered = facturas.filter((factura) => {
      if (isFacturaUnprocessedUploadDraft(factura)) {
        return false;
      }

      if (filters.estado === 'todos' && factura.estado === 'descartada') {
        return false;
      }

      if (!matchesFilter(factura.proveedor_nombre, filters.proveedor)) {
        return false;
      }

      if (!matchesFilter(factura.proveedor_nif, filters.nif)) {
        return false;
      }

      if (!matchesFilter(getFacturaSearchText(factura), filters.numero)) {
        return false;
      }

      if (!matchesFilter(`${factura.documento_codigo ?? ''} ${factura.pdf_nombre ?? ''} ${factura.pdf_path ?? ''}`, filters.documento)) {
        return false;
      }

      if (filters.estado !== 'todos' && factura.estado !== filters.estado) {
        return false;
      }

      if (filters.fechaDesde && (!factura.fecha_factura || factura.fecha_factura < filters.fechaDesde)) {
        return false;
      }

      if (filters.fechaHasta && (!factura.fecha_factura || factura.fecha_factura > filters.fechaHasta)) {
        return false;
      }

      const total = Number(factura.total ?? 0);
      const importeMin = parseNumber(filters.importeMin);
      const importeMax = parseNumber(filters.importeMax);

      if (importeMin !== null && total < importeMin) {
        return false;
      }

      if (importeMax !== null && total > importeMax) {
        return false;
      }

      return true;
    });

    const getDateValue = (value?: string | null) => {
      if (!value) return 0;
      const parsed = new Date(value).getTime();
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    return [...filtered].sort((a, b) => {
      if (sortOrder === 'created_asc') {
        return getDateValue(a.created_at) - getDateValue(b.created_at);
      }

      if (sortOrder === 'fecha_desc') {
        return getDateValue(b.fecha_factura) - getDateValue(a.fecha_factura);
      }

      if (sortOrder === 'fecha_asc') {
        return getDateValue(a.fecha_factura) - getDateValue(b.fecha_factura);
      }

      if (sortOrder === 'total_desc') {
        return Number(b.total ?? 0) - Number(a.total ?? 0);
      }

      if (sortOrder === 'total_asc') {
        return Number(a.total ?? 0) - Number(b.total ?? 0);
      }

      return getDateValue(b.created_at) - getDateValue(a.created_at);
    });
  }, [facturas, filters, sortOrder]);

  const activeFiltersCount = [
    filters.proveedor,
    filters.nif,
    filters.numero,
    filters.documento,
    filters.fechaDesde,
    filters.fechaHasta,
    filters.importeMin,
    filters.importeMax,
    filters.estado !== 'todos' ? filters.estado : '',
  ].filter(Boolean).length;

  const visibleFacturas = filteredFacturas;
  const overallFacturasCount = useMemo(
    () => facturas.filter((factura) => !isFacturaUnprocessedUploadDraft(factura) && factura.estado !== 'descartada').length,
    [facturas],
  );
  const totalPages = Math.max(1, Math.ceil(visibleFacturas.length / pageSize));
  const paginatedFacturas = visibleFacturas.slice((page - 1) * pageSize, page * pageSize);
  const visibleStart = visibleFacturas.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const visibleEnd = Math.min(visibleFacturas.length, page * pageSize);
  const headerLabel =
    activeFiltersCount > 0
      ? `${formatInteger(visibleFacturas.length)} de ${formatInteger(overallFacturasCount)} facturas`
      : `${formatInteger(overallFacturasCount)} facturas entrantes`;
  const detailActionMessage = isDetailMode && modalMessage?.type === 'error' ? modalMessage : null;
  const showSaveFeedback = Boolean(isDetailMode && saveFeedback && !hasUnsavedDetailChanges && !saving && !sending);
  const saveButtonClass = showSaveFeedback
    ? 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 text-sm font-semibold text-primary shadow-sm transition-colors disabled:cursor-default disabled:opacity-100 dark:border-blue-400/40 dark:bg-blue-400/10 dark:text-blue-200'
    : 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800';
  const saveButtonLabel = saving ? 'Guardando' : showSaveFeedback ? (saveFeedback ?? 'Guardada') : 'Guardar';

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const updateFilter = <TKey extends keyof FacturaFilters>(key: TKey, value: FacturaFilters[TKey]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setSortOrder('created_desc');
    setPage(1);
  };

  const openNewFactura = () => {
    setDraft(createEmptyDraft());
    setLineas([createEmptyLinea()]);
    setLastSavedEditorSnapshot(null);
    setProviderLookupState('idle');
    setPdfFile(null);
    setPdfUrl(null);
    setFacturaUploadStep('idle');
    setModalMessage(null);
    setModalOpen(true);
  };

  const closeNewFacturaModal = () => {
    if (saving || extractingIa) {
      return;
    }

    setModalOpen(false);
    setDraft(null);
    setLineas([createEmptyLinea()]);
    setLastSavedEditorSnapshot(null);
    setProviderLookupState('idle');
    setPdfFile(null);
    setPdfUrl(null);
    setFacturaUploadStep('idle');
    setModalMessage(null);
  };

  const openFactura = async (factura: FacturaRecibida) => {
    setBusyFacturaId(factura.id);
    setLoadError(null);

    try {
      const detailedFactura = await fetchFacturaRecibidaById(factura.id);
      const facturaToOpen = detailedFactura ?? factura;
      const facturaLineas = getLineas(facturaToOpen);
      setDraft({ ...facturaToOpen });
      setLineas(facturaLineas);
      setLastSavedEditorSnapshot(createEditorSnapshot(facturaToOpen, facturaLineas));
      setProviderLookupState('idle');
      setPdfFile(null);
      setPdfUrl(null);
      setModalMessage(null);
      setModalOpen(false);
      navigate(`/facturas-recibidas/${encodeURIComponent(facturaToOpen.id)}`);
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo abrir la factura.');
    } finally {
      setBusyFacturaId(null);
    }
  };

  const closeDetail = () => {
    setDraft(null);
    setLineas([createEmptyLinea()]);
    setLastSavedEditorSnapshot(null);
    setProviderLookupState('idle');
    setPdfFile(null);
    setPdfUrl(null);
    setFacturaUploadStep('idle');
    setModalMessage(null);
    setModalOpen(false);
    navigate('/facturas-recibidas');
  };

  const updateDraft = <TKey extends keyof FacturaDraft>(key: TKey, value: FacturaDraft[TKey]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const updateProviderIdentity = (key: 'proveedor_nombre' | 'proveedor_nif', value: string) => {
    const nextNombre = key === 'proveedor_nombre' ? value : draft?.proveedor_nombre ?? '';
    const nextNif = key === 'proveedor_nif' ? value : draft?.proveedor_nif ?? '';

    providerLookupRunRef.current += 1;
    setDraft((current) => (current ? { ...current, [key]: value, proveedor_codigo: '' } : current));
    setProviderLookupState(cleanOptionalString(nextNombre) || cleanOptionalString(nextNif) ? 'available' : 'idle');
  };

  const runProviderLookup = async () => {
    if (!draft || modalOpen) {
      return;
    }

    const draftId = draft.id ?? null;
    const nombre = cleanOptionalString(draft.proveedor_nombre);
    const nif = cleanOptionalString(draft.proveedor_nif);

    if (!nombre && !nif) {
      setProviderLookupState('idle');
      return;
    }

    const runId = providerLookupRunRef.current + 1;
    providerLookupRunRef.current = runId;
    setProviderLookupState('searching');
    let nextLookupState: ProviderLookupState = 'idle';

    try {
      const lookup = await locateProveedorForFactura({ proveedor_nombre: nombre, proveedor_nif: nif });
      if (!lookup.match) {
        nextLookupState = 'available';
        return;
      }

      const match = lookup.match;
      setDraft((current) => {
        if (!current || (current.id ?? null) !== draftId) {
          return current;
        }

        if (cleanOptionalString(current.proveedor_nombre) !== nombre || cleanOptionalString(current.proveedor_nif) !== nif) {
          return current;
        }

        return applyProveedorLookupMatch(current, match);
      });
    } catch {
      // La busqueda de proveedor no debe bloquear la edicion manual de la factura.
      nextLookupState = 'available';
    } finally {
      if (providerLookupRunRef.current === runId) {
        setProviderLookupState(nextLookupState);
      }
    }
  };

  const handleProviderLookupKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void runProviderLookup();
  };

  const updateLinea = <TKey extends keyof FacturaRecibidaLinea>(
    index: number,
    key: TKey,
    value: FacturaRecibidaLinea[TKey],
  ) => {
    setLineas((current) =>
      current.map((linea, currentIndex) => (currentIndex === index ? { ...linea, [key]: value } : linea)),
    );
  };

  const addLinea = () => {
    setLineas((current) => [...current, createEmptyLinea(current.length + 1)]);
  };

  const removeLinea = (index: number) => {
    setLineas((current) =>
      current.length === 1
        ? [createEmptyLinea()]
        : current
            .filter((_, currentIndex) => currentIndex !== index)
            .map((linea, currentIndex) => ({ ...linea, posicion: currentIndex + 1 })),
    );
  };

  const persistFactura = async (validar: boolean, facturaOverride?: FacturaDraft) => {
    const baseDraft = facturaOverride ?? draft;
    if (!baseDraft) {
      return null;
    }

    setSaving(true);
    setModalMessage(null);
    setSaveFeedback(null);

    try {
      let payload = { ...baseDraft };

      if (pdfFile && baseDraft.id) {
        throw new Error('El PDF no puede cambiarse despues de crear la factura.');
      }

      if (pdfFile) {
        const pdfMetadata = await uploadFacturaPdf(pdfFile, baseDraft.id);
        payload = { ...payload, ...pdfMetadata };
      }

      const saved = await saveFacturaRecibida(
        payload,
        lineas.map((linea, index) => ({ ...linea, posicion: index + 1 })),
        validar,
      );

      setFacturas((current) => replaceFactura(current, saved));
      setGsbaseRegistrationByFacturaId((current) => ({
        ...current,
        [saved.id]: saved.estado === 'enviada_gsbase' || saved.gsbase_sent_at ? 'registered' : 'unregistered',
      }));
      const savedLineas = getLineas(saved);
      setDraft(saved);
      setLineas(savedLineas);
      setLastSavedEditorSnapshot(createEditorSnapshot(saved, savedLineas));
      setProviderLookupState('idle');
      setPdfFile(null);
      const successMessage: ModalMessage = {
        type: saved.validation_errors?.length ? 'info' : 'success',
        text: saved.validation_errors?.length
          ? 'Factura guardada con avisos de validacion.'
          : validar
            ? 'Factura validada y lista para envio manual.'
            : 'Factura guardada.',
      };

      if (isDetailMode) {
        setModalMessage(null);
        setSaveFeedback(saved.validation_errors?.length ? 'Guardada con avisos' : validar ? 'Validada' : 'Guardada');
      } else {
        setModalMessage(successMessage);
      }

      return saved;
    } catch (error) {
      setModalMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo guardar la factura.' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSendGsBase = async () => {
    setSending(true);
    setModalMessage(null);
    setSaveFeedback(null);

    try {
      if (!draft) {
        setModalMessage({ type: 'error', text: 'No hay factura seleccionada.' });
        return;
      }

      let facturaForSend = draft;
      const needsProviderMatch =
        !cleanOptionalString(facturaForSend.proveedor_codigo) &&
        Boolean(cleanOptionalString(facturaForSend.proveedor_nif) || cleanOptionalString(facturaForSend.proveedor_nombre));

      if (needsProviderMatch) {
        const lookup = await locateProveedorForFactura(facturaForSend);
        if (lookup.match) {
          facturaForSend = lookup.factura;
          setDraft((current) => (current ? applyProveedorLookupMatch(current, lookup.match) : current));
        }
      }

      const saved = await persistFactura(true, facturaForSend);
      if (!saved || saved.validation_errors?.length) {
        setModalMessage({
          type: 'error',
          text: saved?.validation_errors?.join(' ') || 'No se pudo preparar la factura para envio.',
        });
        return;
      }

      const sent = await sendFacturaRecibidaToGsBase(saved.id);
      setFacturas((current) => replaceFactura(current, sent));
      setGsbaseRegistrationByFacturaId((current) => ({ ...current, [sent.id]: 'registered' }));
      const sentLineas = getLineas(sent);
      setDraft(sent);
      setLineas(sentLineas);
      setLastSavedEditorSnapshot(createEditorSnapshot(sent, sentLineas));
      setProviderLookupState('idle');
      setModalMessage({ type: 'success', text: 'Factura enviada correctamente.' });
    } catch (error) {
      setModalMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo enviar la factura.' });
    } finally {
      setSending(false);
    }
  };

  const handleRegisterNewFactura = async () => {
    if (!pdfFile) {
      setModalMessage({ type: 'error', text: 'Selecciona un PDF para continuar.' });
      return;
    }

    const selectedPdf = pdfFile;
    let createdFactura: FacturaRecibida | null = null;
    let uploadedPdfPath: string | null = null;

    setSaving(true);
    setExtractingIa(true);
    setFacturaUploadStep('uploading');
    setModalMessage(null);
    const analyzingTimer = window.setTimeout(() => setFacturaUploadStep('analyzing'), PDF_UPLOAD_ANIMATION_MS);

    try {
      const pdfMetadata = await uploadFacturaPdf(selectedPdf);
      uploadedPdfPath = pdfMetadata.pdf_path;
      const initial = await saveFacturaRecibida({ ...createEmptyDraft(), ...pdfMetadata }, [], false);
      createdFactura = initial;

      const response = await extractFacturaWithN8n(initial);
      if (!response.extraction) {
        throw new Error('El analisis termino sin devolver datos de factura.');
      }

      const extracted = buildFacturaFromExtraction(initial, response.extraction);
      const saved = await saveFacturaRecibida(extracted.factura, extracted.lineas ?? [], false);
      const savedLineas = getLineas(saved);

      setFacturas((current) => replaceFactura(current, saved));
      setGsbaseRegistrationByFacturaId((current) => ({ ...current, [saved.id]: 'unregistered' }));
      setDraft(saved);
      setLineas(savedLineas);
      setLastSavedEditorSnapshot(createEditorSnapshot(saved, savedLineas));
      setProviderLookupState('idle');
      setPdfFile(null);
      setFacturaUploadStep('done');
      setModalOpen(false);
      navigate(`/facturas-recibidas/${encodeURIComponent(saved.id)}`, { replace: true });
      setModalMessage({
        type: 'success',
        text: 'Factura registrada. Revisa los datos antes de validar.',
      });
    } catch {
      window.clearTimeout(analyzingTimer);
      const cleanupFailed =
        uploadedPdfPath || createdFactura?.id
          ? await cleanupFacturaRecibidaUpload({
              id: createdFactura?.id ?? null,
              pdf_path: uploadedPdfPath,
            })
              .then(() => false)
              .catch(() => true)
          : false;

      if (cleanupFailed && createdFactura?.id) {
        await saveFacturaRecibida({ ...createdFactura, estado: 'descartada' }, [], false).catch(() => undefined);
      }

      setDraft(createEmptyDraft());
      setLineas([createEmptyLinea()]);
      setLastSavedEditorSnapshot(null);
      setProviderLookupState('idle');
      setPdfFile(selectedPdf);
      setPdfUrl(null);
      setFacturaUploadStep('idle');
      setModalMessage({
        type: 'error',
        text: 'Ha fallado al anadir la factura. Intentalo de nuevo.',
      });
    } finally {
      window.clearTimeout(analyzingTimer);
      setSaving(false);
      setExtractingIa(false);
    }
  };

  const handleDiscard = async () => {
    if (isNetagroReadOnlyFactura(draft)) {
      setModalMessage({ type: 'info', text: 'Esta factura viene de Netagro y se muestra en modo solo lectura.' });
      return;
    }

    if (!draft?.id) {
      closeDetail();
      return;
    }

    setSaving(true);
    setModalMessage(null);

    try {
      const saved = await saveFacturaRecibida({ ...draft, estado: 'descartada' }, lineas, false);
      setFacturas((current) => replaceFactura(current, saved));
      closeDetail();
    } catch (error) {
      setModalMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo descartar la factura.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardFromList = async (factura: FacturaRecibida) => {
    if (isNetagroReadOnlyFactura(factura)) {
      return;
    }

    setBusyFacturaId(factura.id);
    setLoadError(null);

    try {
      const saved = await saveFacturaRecibida({ ...factura, estado: 'descartada' }, getLineas(factura), false);
      setFacturas((current) => replaceFactura(current, saved));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudo descartar la factura.');
    } finally {
      setBusyFacturaId(null);
    }
  };

  const handlePdfChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setModalMessage(null);
    setFacturaUploadStep('idle');

    if (!modalOpen || !isNewFacturaDraft) {
      setPdfFile(null);
      setModalMessage({ type: 'error', text: 'El PDF no puede cambiarse despues de crear la factura.' });
      event.target.value = '';
      return;
    }

    if (!file) {
      setPdfFile(null);
      return;
    }

    const looksPdf = file.type.toLowerCase().includes('pdf') || /\.pdf$/i.test(file.name);
    if (!looksPdf) {
      setPdfFile(null);
      setModalMessage({ type: 'error', text: 'Selecciona un archivo PDF.' });
      event.target.value = '';
      return;
    }

    if (file.size > MAX_FACTURA_PDF_BYTES) {
      setPdfFile(null);
      setModalMessage({ type: 'error', text: 'El PDF supera el tamano maximo permitido de 20 MB.' });
      event.target.value = '';
      return;
    }

    setPdfFile(file);
  };

  const detailGsbaseStatus = draft?.id
    ? gsbaseStatusMeta(gsbaseStateForInvoice(draft as FacturaRecibida, gsbaseRegistrationByFacturaId[draft.id]))
    : gsbaseStatusMeta('unknown');
  const isReadOnlyDetail = isNetagroReadOnlyFactura(draft);
  const lineasBaseTotal = lineas.reduce((sum, linea) => sum + (Number(linea.importe) || 0), 0);
  const lineasIvaTotal = lineas.reduce((sum, linea) => sum + ((Number(linea.importe) || 0) * (Number(linea.iva) || 0)) / 100, 0);

  const listView = (
    <div className="purchase-invoices-page flex min-h-[calc(100vh-9rem)] flex-col gap-5">
      <header className="docs-page-header" style={{ marginBottom: 0 }}>
        <div className="docs-page-copy">
          <div className="docs-page-copy-body">
            <p className="docs-page-eyebrow">Compras</p>
            <h2 className="docs-page-title">Facturas de compra</h2>
            <p className="docs-page-subtitle">{headerLabel}</p>
          </div>
        </div>
        <div className="mt-5 h-px bg-slate-200 dark:bg-border" aria-hidden="true" />
      </header>

      <div className="purchase-invoices-toolbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={toolbarOutlineButtonClass}
            disabled={loading}
            onClick={() => void loadFacturas()}
            title="Refrescar datos"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {loading ? 'Actualizando...' : 'Refrescar'}
          </button>
          <button
            type="button"
            className={toolbarFilterButtonClass(showFilters)}
            onClick={() => setShowFilters((visible) => !visible)}
          >
            <Filter className="h-4 w-4" />
            Filtros
            {activeFiltersCount > 0 ? (
              <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                {activeFiltersCount}
              </span>
            ) : null}
          </button>
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            onClick={openNewFactura}
          >
            <Plus className="h-4 w-4" />
            Nueva factura
          </button>
        </div>
      </div>

      {showFilters ? (
        <section className="purchase-invoices-filter-panel overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="flex flex-row items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground">Filtros de busqueda</h2>
            {activeFiltersCount > 0 ? (
              <button
                type="button"
                className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={resetFilters}
              >
                <X className="h-4 w-4" />
                Limpiar filtros
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Proveedor</Label>
              <Input
                className={inputClass}
                value={filters.proveedor}
                onChange={(event) => updateFilter('proveedor', event.target.value)}
                placeholder="Nombre proveedor"
              />
            </div>

            <div className="space-y-2">
              <Label>NIF/CIF</Label>
              <Input
                className={inputClass}
                value={filters.nif}
                onChange={(event) => updateFilter('nif', event.target.value)}
                placeholder="B12345678"
              />
            </div>

            <div className="space-y-2">
              <Label>Factura/ref.</Label>
              <Input
                className={inputClass}
                value={filters.numero}
                onChange={(event) => updateFilter('numero', event.target.value)}
                placeholder="Numero o referencia"
              />
            </div>

            <div className="space-y-2">
              <Label>Documento</Label>
              <Input
                className={inputClass}
                value={filters.documento}
                onChange={(event) => updateFilter('documento', event.target.value)}
                placeholder="FR-000001 o PDF"
              />
            </div>

            <div className="space-y-2">
              <Label>Flujo</Label>
              <FilterSelect
                value={filters.estado}
                options={estadoOptions}
                onChange={(value) => updateFilter('estado', value as FacturaFilters['estado'])}
                ariaLabel="Filtrar por flujo"
              />
            </div>

            <div className="space-y-2">
              <Label>Desde</Label>
              <Input
                className={inputClass}
                type="date"
                value={filters.fechaDesde}
                onChange={(event) => updateFilter('fechaDesde', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Hasta</Label>
              <Input
                className={inputClass}
                type="date"
                value={filters.fechaHasta}
                onChange={(event) => updateFilter('fechaHasta', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Min.</Label>
              <Input
                className={inputClass}
                inputMode="decimal"
                value={filters.importeMin}
                onChange={(event) => updateFilter('importeMin', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Max.</Label>
              <Input
                className={inputClass}
                inputMode="decimal"
                value={filters.importeMax}
                onChange={(event) => updateFilter('importeMax', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Orden</Label>
              <FilterSelect
                value={sortOrder}
                options={sortOptions}
                onChange={(value) => {
                  setSortOrder(value as FacturaSortOrder);
                  setPage(1);
                }}
                ariaLabel="Ordenar facturas"
              />
            </div>

            <div className="space-y-2">
              <Label>Pagina</Label>
              <FilterSelect
                value={String(pageSize)}
                options={pageSizeOptions}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
                ariaLabel="Facturas por pagina"
              />
            </div>
          </div>
        </section>
      ) : null}

      {loadError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{loadError}</span>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 bg-white px-3 text-xs font-bold text-amber-800 shadow-sm transition-colors hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
              onClick={() => void loadFacturas()}
            >
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </button>
          </div>
        </div>
      ) : null}

      <section className="purchase-invoices-list-panel flex min-h-[420px] flex-1 flex-col rounded-xl border border-border bg-background p-3 dark:border-slate-700 dark:bg-slate-950/60">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1 text-sm font-semibold text-muted-foreground">
          <span>
            Mostrando {visibleStart}-{visibleEnd} de {visibleFacturas.length}
          </span>
        </header>

        {loading ? (
          <div className="grid min-h-[360px] flex-1 place-items-center rounded-xl border border-dashed border-border bg-muted/20 text-center text-sm font-semibold text-muted-foreground dark:border-slate-700">
            <div>
              <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
              Cargando facturas...
            </div>
          </div>
        ) : paginatedFacturas.length === 0 ? (
          <div className="grid min-h-[360px] flex-1 place-items-center rounded-xl border border-dashed border-border bg-muted/20 px-4 text-center dark:border-slate-700">
            <div className="max-w-sm">
              <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <h3 className="text-base font-bold text-foreground">
                {activeFiltersCount > 0 ? 'No hay facturas con estos filtros' : 'No hay facturas pendientes.'}
              </h3>
              <p className="mt-2 text-sm font-medium text-muted-foreground">
                {activeFiltersCount > 0 ? 'Ajusta los filtros activos para ampliar el resultado.' : 'Cuando haya facturas registradas apareceran aqui.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {paginatedFacturas.map((factura) => (
              <FacturaListItem
                key={factura.id}
                factura={factura}
                isSelected={draft?.id === factura.id}
                isReadOnly={isNetagroReadOnlyFactura(factura)}
                gsbaseRegistrationState={gsbaseRegistrationByFacturaId[factura.id]}
                loadingFacturaId={busyFacturaId}
                onOpen={openFactura}
                onDelete={handleDiscardFromList}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-muted-foreground">
        <span>Pagina {page} de {totalPages}</span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-bold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </button>
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-bold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Siguiente
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </footer>
    </div>
  );

  const detailView = draft ? (
    <div className="purchase-invoice-detail flex min-h-[calc(100dvh-109px)] w-full flex-col bg-white text-slate-950 dark:bg-background dark:text-slate-50">
      <header className="purchase-invoice-detail-header shrink-0 border-b border-slate-200 bg-slate-50 px-5 py-5 shadow-[0_1px_0_rgba(15,23,42,0.03)] dark:border-border dark:bg-card md:px-6">
        <div className="mb-3">
          <button
            type="button"
            className="-ml-2 inline-flex h-8 w-fit items-center justify-center gap-2 rounded-md px-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50"
            onClick={closeDetail}
          >
            <ArrowLeft size={16} />
            Volver
          </button>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <h1 className="text-2xl font-bold leading-tight text-slate-950 dark:text-slate-50">
            Factura de compra
          </h1>

          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 lg:justify-end">
            {detailActionMessage ? (
              <p
                className={`min-w-0 text-sm font-semibold ${
                  detailActionMessage.type === 'error'
                    ? 'text-red-700 dark:text-red-300'
                    : 'text-primary dark:text-blue-300'
                }`}
              >
                {detailActionMessage.text}
              </p>
            ) : null}
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-400/30 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-500/10"
              disabled={isReadOnlyDetail || saving || sending}
              onClick={() => void handleDiscard()}
            >
              <Trash2 size={15} />
              Eliminar
            </button>
            <button
              type="button"
              className={saveButtonClass}
              disabled={isReadOnlyDetail || saving || sending || !hasUnsavedDetailChanges}
              onClick={() => void persistFactura(false)}
            >
              {saving ? <Loader2 className="animate-spin" size={15} /> : showSaveFeedback ? <CheckCircle2 size={15} /> : <Save size={15} />}
              {saveButtonLabel}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isReadOnlyDetail || saving || sending || extractingIa || draft.estado === 'enviada_gsbase' || draft.estado === 'descartada'}
              onClick={() => void handleSendGsBase()}
            >
              {sending ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
              {draft.estado === 'enviada_gsbase' ? 'Enviado a Netagro' : 'Enviar a Netagro'}
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-slate-500 dark:text-slate-400">
            <span>
              Proveedor:{' '}
              <strong className="font-bold text-slate-950 dark:text-slate-100">{invoiceProvider(draft)}</strong>
            </span>
            <span>
              Factura:{' '}
              <strong className="font-bold text-slate-950 dark:text-slate-100">{invoiceNumber(draft)}</strong>
            </span>
          </p>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium text-slate-500 dark:text-slate-400 lg:justify-end">
            <div className="flex gap-1">
              <dt>Estado:</dt>
              <dd className="font-bold text-slate-950 dark:text-slate-100">
                {draft.estado ? estadoLabels[draft.estado] : detailGsbaseStatus.text}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Netagro:</dt>
              <dd className="font-bold text-slate-950 dark:text-slate-100">
                {detailGsbaseStatus.text}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      {draft.gsbase_error || visibleErrors.length > 0 ? (
        <div className="mx-2 mt-4 space-y-3">
          {draft.gsbase_error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-200">
              <p className="font-bold">Error Netagro</p>
              <p className="mt-1">{draft.gsbase_error}</p>
            </div>
          ) : null}
          {visibleErrors.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-200">
              <p className="font-bold">Validacion pendiente</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {visibleErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="purchase-invoice-detail-main grid flex-1 items-start gap-6 px-5 py-6 md:px-6 xl:grid-cols-[minmax(420px,0.92fr)_minmax(0,1.08fr)]">
        <section className="purchase-invoice-detail-pdf-panel flex min-w-0 flex-col bg-white dark:bg-transparent xl:sticky xl:top-4">
          <DetailSection title="Documento PDF" className="flex min-h-0 flex-1 flex-col">
            <div className="purchase-invoice-pdf-shell flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-950 xl:min-h-[520px]">
              {pdfLoading ? (
                <div className="grid min-h-[520px] flex-1 place-items-center bg-neutral-900 text-sm font-semibold text-slate-300">
                  <div className="text-center">
                    <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
                    Abriendo PDF...
                  </div>
                </div>
              ) : pdfUrl ? (
                <PdfViewer
                  url={pdfUrl}
                  showControls
                  fileName={draft.pdf_nombre ?? undefined}
                  className="min-h-[720px] flex-1 xl:min-h-[520px]"
                />
              ) : (
                <div className="grid min-h-[360px] flex-1 place-items-center bg-slate-100 px-6 text-center text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                  <div>
                    <FileText className="mx-auto mb-3 h-8 w-8" />
                    El visor aparecera cuando exista un PDF guardado.
                  </div>
                </div>
              )}
            </div>
          </DetailSection>
        </section>

        <section className="purchase-invoice-detail-info min-w-0 bg-white dark:bg-transparent xl:pl-2">
          <DetailSection title="Informacion General">
            <div className="space-y-5">
              <FieldGroup title="Proveedor">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <Field label="Nombre" className="sm:col-span-2 2xl:col-span-3">
                    <Input
                      className={detailInputClass}
                      value={draft.proveedor_nombre ?? ''}
                      onChange={(event) => updateProviderIdentity('proveedor_nombre', event.target.value)}
                      onKeyDown={handleProviderLookupKeyDown}
                    />
                  </Field>
                  <Field label="NIF">
                    <Input
                      className={detailInputClass}
                      value={draft.proveedor_nif ?? ''}
                      onChange={(event) => updateProviderIdentity('proveedor_nif', event.target.value.toUpperCase())}
                      onKeyDown={handleProviderLookupKeyDown}
                    />
                  </Field>
                  <Field label="Codigo proveedor">
                    <Input className={detailInputClass} value={draft.proveedor_codigo ?? ''} onChange={(event) => updateDraft('proveedor_codigo', event.target.value)} />
                  </Field>
                  <Field label="Forma de pago / email remitente" className="sm:col-span-2 2xl:col-span-3">
                    <Input className={detailInputClass} type="email" value={draft.email_remitente ?? ''} onChange={(event) => updateDraft('email_remitente', event.target.value)} />
                  </Field>
                </div>
                {providerLookupState !== 'idle' ? (
                  <p className="provider-lookup-status mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400" aria-live="polite">
                    {providerLookupState === 'searching' ? (
                      <>
                        Buscando proveedor
                        <span className="provider-lookup-status__dots" aria-hidden="true">
                          <span>.</span>
                          <span>.</span>
                          <span>.</span>
                        </span>
                      </>
                    ) : (
                      'Pulsa Enter para buscar proveedor'
                    )}
                  </p>
                ) : null}
              </FieldGroup>

              <FieldGroup title="Factura">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <Field label="Numero proveedor">
                    <Input className={detailInputClass} value={draft.numero_factura ?? ''} onChange={(event) => updateDraft('numero_factura', event.target.value)} />
                  </Field>
                  <Field label="Referencia">
                    <Input className={detailInputClass} value={draft.referencia ?? ''} onChange={(event) => updateDraft('referencia', event.target.value)} />
                  </Field>
                  <Field label="Fecha factura">
                    <Input className={detailInputClass} type="date" value={draft.fecha_factura ?? ''} onChange={(event) => updateDraft('fecha_factura', event.target.value)} />
                  </Field>
                  <Field label="Almacen">
                    <Input className={detailInputClass} value={draft.fr_alm ?? '00'} onChange={(event) => updateDraft('fr_alm', event.target.value)} />
                  </Field>
                  <Field label="Serie">
                    <Input className={detailInputClass} value={draft.fr_sufa ?? 'A'} onChange={(event) => updateDraft('fr_sufa', event.target.value)} />
                  </Field>
                  <Field label="Albaranes" className="sm:col-span-2">
                    <Input className={detailInputClass} value={draft.albaranes ?? ''} onChange={(event) => updateDraft('albaranes', event.target.value)} placeholder="0001;0002" />
                  </Field>
                  <Field label="Concepto" className="sm:col-span-2 2xl:col-span-4">
                    <textarea
                      className={detailTextareaClass}
                      value={draft.asunto_email ?? ''}
                      onChange={(event) => updateDraft('asunto_email', event.target.value)}
                      placeholder="Concepto o asunto de origen"
                    />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Importes">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                  <Field label="Base imponible">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.base_imponible)} onChange={(event) => updateDraft('base_imponible', parseNumber(event.target.value))} />
                  </Field>
                  <Field label="Total">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.total)} onChange={(event) => updateDraft('total', parseNumber(event.target.value))} />
                  </Field>
                  <Field label="% IVA">
                    <Input className={detailInputClass} value={ivaSummary || '-'} readOnly />
                  </Field>
                  <Field label="Importe IVA">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.iva_importe)} onChange={(event) => updateDraft('iva_importe', parseNumber(event.target.value))} />
                  </Field>
                  <Field label="% retencion">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.retencion_porcentaje)} onChange={(event) => updateDraft('retencion_porcentaje', parseNumber(event.target.value) ?? 0)} />
                  </Field>
                  <Field label="Importe retencion">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.retencion_importe)} onChange={(event) => updateDraft('retencion_importe', parseNumber(event.target.value) ?? 0)} />
                  </Field>
                  <Field label="Dto. general">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.descuento_general)} onChange={(event) => updateDraft('descuento_general', parseNumber(event.target.value) ?? 0)} />
                  </Field>
                  <Field label="Dto. pronto pago">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.descuento_pronto_pago)} onChange={(event) => updateDraft('descuento_pronto_pago', parseNumber(event.target.value) ?? 0)} />
                  </Field>
                  <Field label="Pendiente pago">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.pendiente_pago)} onChange={(event) => updateDraft('pendiente_pago', parseNumber(event.target.value) ?? 0)} />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Detalle de factura">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                    Suma lineas: {formatMoney(lineasBaseTotal)} / Base: {formatMoney(draft.base_imponible)}
                  </p>
                  <Button className="gap-2 border border-slate-200 bg-white text-slate-950 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800" onClick={addLinea}>
                    <Plus size={15} />
                    Linea
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                  <table className="purchase-invoice-lines-table w-full min-w-[760px] text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                        <th className="w-12 px-3 py-3">#</th>
                        <th className="px-3 py-3">Descripcion</th>
                        <th className="w-24 px-3 py-3">IVA</th>
                        <th className="w-32 px-3 py-3">Importe</th>
                        <th className="w-32 px-3 py-3">IVA imp.</th>
                        <th className="w-16 px-3 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {lineas.map((linea, index) => (
                        <tr key={`${linea.id ?? 'linea'}-${index}`} className="bg-white align-middle dark:bg-slate-950">
                          <td className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">{index + 1}</td>
                          <td className="px-3 py-3">
                            <Input className={detailTableInputClass} value={linea.descripcion} onChange={(event) => updateLinea(index, 'descripcion', event.target.value)} />
                          </td>
                          <td className="px-3 py-3">
                            <CustomSelect value={String(linea.iva)} options={ivaOptions} onChange={(value) => updateLinea(index, 'iva', Number(value))} />
                          </td>
                          <td className="px-3 py-3">
                            <Input className={detailTableInputClass} inputMode="decimal" value={numberInputValue(linea.importe)} onChange={(event) => updateLinea(index, 'importe', parseNumber(event.target.value) ?? 0)} />
                          </td>
                          <td className="px-3 py-3 align-middle font-semibold text-slate-700 dark:text-slate-200">
                            {formatMoney(((Number(linea.importe) || 0) * (Number(linea.iva) || 0)) / 100)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-400/30 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-500/10"
                              onClick={() => removeLinea(index)}
                              aria-label="Eliminar linea"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50 text-sm font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                        <td className="px-3 py-3" colSpan={3}>Totales</td>
                        <td className="px-3 py-3">{formatMoney(lineasBaseTotal)}</td>
                        <td className="px-3 py-3">{formatMoney(lineasIvaTotal)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </FieldGroup>

            </div>
          </DetailSection>
        </section>
      </div>
    </div>
  ) : null;

  return (
    <>
      {isDetailMode ? (
        <div className="h-full w-full">
          {detailView}
        </div>
      ) : (
        <div
          className="xfuego-module"
          style={{ display: 'flex', minHeight: '100%', width: '100%' }}
        >
          <div className="main-area" style={{ marginLeft: 0, flex: 1, minHeight: '100%' }}>
            <div className="main-content dashboard-shell">
              {listView}
            </div>
          </div>
        </div>
      )}

      {modalOpen && isNewFacturaDraft ? (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4 md:p-8">
          <section className="mx-auto flex max-h-[96vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xl">
            <header className="flex shrink-0 items-center justify-between border-b border-border bg-muted/40 px-6 py-5">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold tracking-tight text-foreground">Crear factura mediante xFuego</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Selecciona el PDF de la factura; se analizara con xFuego y quedara pendiente de revision.
                </p>
              </div>
              <button
                type="button"
                className="ml-auto shrink-0 rounded-xl p-2 text-muted-foreground transition-colors duration-150 hover:bg-muted/80 hover:text-foreground focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={saving || extractingIa}
                onClick={closeNewFacturaModal}
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
              <div className="space-y-5">
                {saving || extractingIa ? (
                  <FacturaAiProcessingAnimation step={facturaUploadStep} />
                ) : (
                  <>
                    <div className="space-y-2">
                      <label htmlFor="factura-pdf-upload" className="block text-sm font-semibold text-foreground">
                        PDF de la factura
                      </label>
                      <input
                        id="factura-pdf-upload"
                        type="file"
                        accept="application/pdf,.pdf"
                        disabled={saving || extractingIa}
                        onChange={handlePdfChange}
                        className={`${inputClass} h-auto w-full cursor-pointer py-2 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-foreground hover:file:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-60`}
                      />
                      <p className="text-xs font-semibold text-muted-foreground">Maximo 20 MB.</p>
                    </div>

                    {pdfFile ? (
                      <div className="rounded-md border border-border bg-muted/35 px-3 py-2 text-sm">
                        <p className="truncate font-semibold text-foreground">{pdfFile.name}</p>
                        <p className="text-xs font-medium text-muted-foreground">
                          {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    ) : null}
                  </>
                )}

                {modalMessage ? (
                  <div
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                      modalMessage.type === 'error'
                        ? 'border-destructive/30 bg-destructive/10 text-destructive'
                        : modalMessage.type === 'success'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-200'
                          : 'border-primary/20 bg-primary/10 text-primary'
                    }`}
                  >
                    {modalMessage.type === 'error' ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    )}
                    <span>{modalMessage.text}</span>
                  </div>
                ) : null}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={closeNewFacturaModal}
                    disabled={saving || extractingIa}
                    className="h-9 rounded-md border border-border bg-background px-4 text-sm font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleRegisterNewFactura();
                    }}
                    disabled={saving || extractingIa || !pdfFile}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving || extractingIa ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Upload className="h-4 w-4" aria-hidden />
                    )}
                    {saving || extractingIa
                      ? facturaUploadStep === 'uploading'
                        ? 'Subiendo...'
                        : 'Analizando...'
                      : 'Analizar con xFuego'}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
};

export default Facturas;
