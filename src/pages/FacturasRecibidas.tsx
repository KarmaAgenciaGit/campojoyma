import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
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
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { FilterSelect, type FilterSelectOption } from '../components/FilterSelect';
import { AcreedorCombobox } from '../components/AcreedorCombobox';
import { AsientoContableTable } from '../components/facturas/AsientoContableTable';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { PdfViewer } from '../components/PdfViewer';
import { facturaEstadoLabels } from '../lib/facturasSummary';
import {
  type LocalizarProveedorResponse,
  type FacturaEmpresaOption,
  type FacturaCuentaOption,
  type FacturaRegimenOption,
  type FacturaTipoOption,
  fetchFacturaCuentas,
  fetchFacturaEmpresas,
  fetchFacturaPunteables,
  fetchFacturaRecibidaById,
  fetchFacturaRecibidaERPPayloadPreview,
  fetchFacturaRegimenes,
  fetchFacturaTipos,
  fetchFacturasRecibidasPage,
  getFacturaPdfSignedUrl,
  extractFacturaWithN8n,
  isERPReferenceFactura,
  isERPReadOnlyFactura,
  localizarProveedorERP,
  saveFacturaRecibida,
  sendFacturaRecibidaToERP,
} from '../services/facturas';
import type {
  FacturaRecibida,
  FacturaRecibidaIvaTramo,
  FacturaRecibidaLinea,
  FacturaRecibidaPunteo,
  FacturaRecibidaVencimiento,
} from '../services/apiContracts';
import type { AgroIrisAcreedor } from '../services/agroirisAcreedores';

type FacturaDraft = Partial<FacturaRecibida>;
type FacturaFlowFilter = 'todos' | 'enviada_erp' | 'no_enviada_erp';

type FacturaFilters = {
  proveedor: string;
  numero: string;
  estado: FacturaFlowFilter;
  fechaDesde: string;
  fechaHasta: string;
};

type ModalMessage = {
  type: 'success' | 'error' | 'info';
  text: string;
};

type FacturaSortOrder = 'created_desc' | 'created_asc' | 'fecha_desc' | 'fecha_asc' | 'total_desc' | 'total_asc';
type FacturaERPListState = 'registered' | 'reference' | 'unregistered' | 'checking' | 'unknown';
type FacturaUploadStep = 'idle' | 'uploading' | 'analyzing' | 'done';

declare global {
  interface Window {
    bodyenviar?: () => Promise<Record<string, unknown>>;
    bodyEnviar?: () => Promise<Record<string, unknown>>;
    bodyenviarjson?: () => Promise<string>;
  }
}

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

const estadoOptions: { value: FacturaFlowFilter; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'enviada_erp', label: 'Enviado' },
  { value: 'no_enviada_erp', label: 'No enviado' },
];

const estadoLabels = facturaEstadoLabels;

const yesNoOptions: FilterSelectOption[] = [
  { value: 'S', label: 'Sí' },
  { value: 'N', label: 'No' },
];

const emptyFilters: FacturaFilters = {
  proveedor: '',
  numero: '',
  estado: 'todos',
  fechaDesde: '',
  fechaHasta: '',
};

const createEmptyDraft = (): FacturaDraft => ({
  estado: 'borrador',
  proveedor_nombre: '',
  proveedor_nif: '',
  proveedor_codigo: '',
  proveedor_cuenta: '',
  numero_factura: '',
  referencia: '',
  ejercicio: null,
  fecha_ctb: '',
  tipo_iva_codigo: '',
  asiento: null,
  asiento_tecnico: null,
  asiento_numero: null,
  asiento_fecha: null,
  asiento_estado: 'not_requested',
  asiento_lineas: [],
  fr_alm: '',
  fr_sufa: '',
  fecha_factura: '',
  iva_tramos: [1, 2, 3, 4, 5].map((posicion) => ({
    posicion: posicion as FacturaRecibidaIvaTramo['posicion'],
    base: null,
    porcentaje: null,
    cuota: null,
  })),
  base_imponible: null,
  iva_porcentaje: null,
  iva_importe: null,
  base_retencion: 0,
  retencion_porcentaje: 0,
  retencion_importe: 0,
  clave_irpf: '',
  total: null,
  asunto_email: '',
  concepto_asiento: '',
  obs_aeat: '',
  observaciones: '',
  contabilizar: 'S',
  genera_cartera: 'N',
  cta_cartera: '',
  banco: '',
  forma_pago: '',
  tipo_doc: '',
  fecha_vto: '',
  importe_vto: null,
  vencimientos: [1, 2, 3, 4].map((posicion) => ({
    posicion: posicion as FacturaRecibidaVencimiento['posicion'],
    fecha: null,
    importe: null,
  })),
  pdf_path: null,
  pdf_nombre: null,
  pdf_mime_type: null,
  pdf_size: null,
  validation_errors: [],
});

const createEmptyLinea = (posicion = 1): FacturaRecibidaLinea => ({
  posicion,
  descripcion: '',
  importe: 0,
});

const createEmptyGastos = () => [1, 2, 3, 4].map(createEmptyLinea);

const createEmptyCtbLinea = (posicion = 1): FacturaRecibidaLinea => ({
  ...createEmptyLinea(posicion),
  FRC_id: null,
  FRC_idfacturarecibida: null,
  FRC_IdActividad: null,
  FRC_Idseccion: null,
  FRC_Iddepartamento: null,
  FRC_Idsubdepartamento: null,
  FRC_IdUsuarioLog: null,
  FRC_FechaLog: null,
  FRC_HoraLog: null,
});

const ACCOUNTING_AMOUNT_TOLERANCE = 0.01;

const inputClass =
  'h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-border dark:bg-background dark:text-foreground dark:placeholder:text-muted-foreground dark:focus:border-primary dark:focus:ring-primary/20 dark:disabled:bg-slate-900/60';

const toolbarButtonBaseClass =
  'inline-flex h-10 w-[176px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const toolbarOutlineButtonClass =
  `${toolbarButtonBaseClass} border-border bg-background text-foreground hover:bg-muted/70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900`;

const toolbarPrimaryButtonClass =
  `${toolbarButtonBaseClass} border-primary bg-primary text-primary-foreground hover:bg-primary/90`;

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

const numberInputValue = (value: number | null | undefined) =>
  value === null || value === undefined || Number.isNaN(Number(value)) ? '' : String(value);

const parseNumber = (value: string) => {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const cleanOptionalString = (value: string | null | undefined) => {
  const cleaned = (value ?? '').trim();
  return cleaned || null;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && cleanOptionalString(error.message)) {
    return error.message;
  }
  if (typeof error === 'string' && cleanOptionalString(error)) {
    return error;
  }
  if (error && typeof error === 'object') {
    const source = error as Record<string, unknown>;
    const parts = [source.message, source.details, source.hint]
      .map((value) => (typeof value === 'string' ? cleanOptionalString(value) : null))
      .filter((value): value is string => Boolean(value));
    if (parts.length > 0) {
      return parts.join(' ');
    }
  }
  return fallback;
};

const hasAccountingLineData = (linea: FacturaRecibidaLinea) =>
  Boolean(cleanOptionalString(linea.descripcion)) || Math.abs(Number(linea.importe) || 0) > ACCOUNTING_AMOUNT_TOLERANCE;

const shouldOpenAccountingBreakdownFor = (
  factura: FacturaDraft | null | undefined,
  lineas: FacturaRecibidaLinea[],
) => {
  const lineCount = lineas.filter(hasAccountingLineData).length;
  const lineTotal = lineas.reduce((sum, linea) => sum + (Number(linea.importe) || 0), 0);
  const base = Number(factura?.base_imponible ?? 0);

  return lineCount === 0 || lineCount > 1 || Math.abs(lineTotal - base) > ACCOUNTING_AMOUNT_TOLERANCE;
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
  cuenta: string | null;
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
  const datos = response.erp_response?.datos;
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
    cuenta: readLookupString(record, ['cuenta', 'CUENTA', 'ACR_Cuenta', 'FRR_idcuenta']),
  };
};

const applyProveedorLookupMatch = (factura: FacturaDraft, match: ProveedorLookupMatch): FacturaDraft => ({
  ...factura,
  proveedor_codigo: match.codigo,
  proveedor_nombre: match.nombre ?? factura.proveedor_nombre ?? null,
  proveedor_nif: match.nif ?? factura.proveedor_nif ?? null,
  proveedor_cuenta: match.cuenta ?? factura.proveedor_cuenta ?? null,
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

  const response = await localizarProveedorERP({ nif, nombre });
  const match = extractProveedorLookupMatch(response);
  const datos = response.erp_response?.datos;

  return {
    factura: match ? applyProveedorLookupMatch(factura, match) : factura,
    match,
    message: typeof datos === 'string' ? datos : match ? 'Proveedor localizado.' : 'Proveedor no localizado.',
    response,
  };
};

const acreedorIdFromDraft = (factura: FacturaDraft | null | undefined) => {
  const parsed = Number(factura?.proveedor_codigo ?? '');
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const proveedorDraftFromAcreedor = (acreedor: AgroIrisAcreedor | null): Pick<
  FacturaDraft,
  'proveedor_codigo' | 'proveedor_nombre' | 'proveedor_nif' | 'proveedor_cuenta'
> => {
  if (!acreedor) {
    return {
      proveedor_codigo: '',
      proveedor_nombre: '',
      proveedor_nif: '',
      proveedor_cuenta: '',
    };
  }

  return {
    proveedor_codigo: String(acreedor.acreedorid),
    proveedor_nombre: cleanOptionalString(acreedor.nombre_comercial) ?? cleanOptionalString(acreedor.nombre_sujeto) ?? null,
    proveedor_nif: cleanOptionalString(acreedor.identificador_fiscal),
    proveedor_cuenta: cleanOptionalString(acreedor.cuenta_contable ?? acreedor.referencia),
  };
};

const erpStateForInvoice = (
  factura: FacturaRecibida,
  externalState?: FacturaERPListState,
): FacturaERPListState => {
  if (isERPReferenceFactura(factura)) return 'reference';
  if (externalState) return externalState;
  if (factura.estado === 'enviada_erp' || factura.erp_sent_at) return 'registered';
  if (factura.estado === 'error_erp') return 'unregistered';
  if (factura.estado === 'validada' || factura.erp_payload) return 'unregistered';
  return 'unknown';
};

const erpStatusMeta = (state: FacturaERPListState) => {
  if (state === 'registered') {
    return {
      text: 'Enviado',
      className: 'text-emerald-700 dark:text-emerald-300',
    };
  }

  if (state === 'reference') {
    return {
      text: 'Referencia ERP',
      className: 'text-slate-700 dark:text-slate-200',
    };
  }

  if (state === 'unregistered') {
    return {
      text: 'No enviado a ERP',
      className: 'text-amber-700 dark:text-amber-300',
    };
  }

  if (state === 'checking') {
    return {
      text: 'Comprobando ERP',
      className: 'text-slate-500 dark:text-slate-300',
    };
  }

  return {
    text: 'No enviado a ERP',
    className: 'text-amber-700 dark:text-amber-300',
  };
};

const buildEmpresaOptions = (
  empresas: FacturaEmpresaOption[],
  currentValue?: string | null,
): FilterSelectOption[] => {
  const options = empresas.map((empresa) => ({
    value: empresa.id,
    label: empresa.label,
  }));
  const current = cleanOptionalString(currentValue);
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({ value: current, label: current });
  }
  return options;
};

const buildTipoFacturaOptions = (
  tipos: FacturaTipoOption[],
  currentValue?: string | null,
): FilterSelectOption[] => {
  const options: FilterSelectOption[] = [...tipos];
  const current = cleanOptionalString(currentValue);
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({ value: current, label: current });
  }
  if (!current) {
    options.unshift({ value: '', label: 'Sin tipo' });
  }
  return options;
};

const buildRegimenOptions = (
  regimenes: FacturaRegimenOption[],
  currentValue?: string | null,
): FilterSelectOption[] => {
  const options: FilterSelectOption[] = regimenes.map((regimen) => ({ ...regimen }));
  const current = cleanOptionalString(currentValue);
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({ value: current, label: current });
  }
  if (!current) options.unshift({ value: '', label: 'Sin régimen' });
  return options;
};

const getLineas = (factura?: FacturaRecibida | null) =>
  [1, 2, 3, 4].map((posicion) => {
    const linea = factura?.facturas_recibidas_lineas?.find((item) => item.posicion === posicion);
    return linea ? { ...linea, posicion } : createEmptyLinea(posicion);
  });

const createEditorSnapshot = (factura: FacturaDraft | null, lineas: FacturaRecibidaLinea[]) =>
  JSON.stringify({
    factura: {
      proveedor_nombre: factura?.proveedor_nombre ?? null,
      proveedor_nif: factura?.proveedor_nif ?? null,
      proveedor_codigo: factura?.proveedor_codigo ?? null,
      proveedor_cuenta: factura?.proveedor_cuenta ?? null,
      numero_factura: factura?.numero_factura ?? null,
      referencia: factura?.referencia ?? null,
      ejercicio: factura?.ejercicio ?? null,
      fecha_ctb: factura?.fecha_ctb ?? null,
      tipo_iva_codigo: factura?.tipo_iva_codigo ?? null,
      asiento_tecnico: factura?.asiento_tecnico ?? factura?.asiento ?? null,
      asiento_numero: factura?.asiento_numero ?? null,
      asiento_fecha: factura?.asiento_fecha ?? null,
      asiento_estado: factura?.asiento_estado ?? null,
      fecha_factura: factura?.fecha_factura ?? null,
      documento_codigo: factura?.documento_codigo ?? null,
      fr_alm: factura?.fr_alm ?? null,
      fr_sufa: factura?.fr_sufa ?? null,
      asunto_email: factura?.asunto_email ?? null,
      concepto_asiento: factura?.concepto_asiento ?? null,
      obs_aeat: factura?.obs_aeat ?? null,
      observaciones: factura?.observaciones ?? null,
      contabilizar: factura?.contabilizar ?? null,
      genera_cartera: factura?.genera_cartera ?? null,
      cta_cartera: factura?.cta_cartera ?? null,
      banco: factura?.banco ?? null,
      forma_pago: factura?.forma_pago ?? null,
      tipo_doc: factura?.tipo_doc ?? null,
      fecha_vto: factura?.fecha_vto ?? null,
      importe_vto: factura?.importe_vto ?? null,
      base_imponible: factura?.base_imponible ?? null,
      iva_porcentaje: factura?.iva_porcentaje ?? null,
      iva_importe: factura?.iva_importe ?? null,
      iva_tramos: factura?.iva_tramos?.map((tramo) => ({ ...tramo })) ?? [],
      base_retencion: factura?.base_retencion ?? null,
      retencion_porcentaje: factura?.retencion_porcentaje ?? null,
      retencion_importe: factura?.retencion_importe ?? null,
      clave_irpf: factura?.clave_irpf ?? null,
      total: factura?.total ?? null,
      vencimientos: factura?.vencimientos?.map((vencimiento) => ({ ...vencimiento })) ?? [],
      ctb_lineas:
        factura?.ctb_lineas?.map((linea) => ({
          id: linea.id ?? null,
          posicion: linea.posicion,
          descripcion: linea.descripcion,
          importe: linea.importe,
          FRC_id: linea.FRC_id ?? null,
          FRC_idfacturarecibida: linea.FRC_idfacturarecibida ?? null,
          FRC_IdActividad: linea.FRC_IdActividad ?? null,
          FRC_Idseccion: linea.FRC_Idseccion ?? null,
          FRC_Iddepartamento: linea.FRC_Iddepartamento ?? null,
          FRC_Idsubdepartamento: linea.FRC_Idsubdepartamento ?? null,
        })) ?? [],
      punteos:
        factura?.punteos?.map((punteo) => ({
          posicion: punteo.posicion,
          source_table: punteo.source_table ?? null,
          source_id: punteo.source_id ?? null,
          importe_factura: punteo.importe_factura ?? null,
          seleccionado: punteo.seleccionado,
        })) ?? [],
    },
    lineas: lineas.map((linea, index) => ({
      id: linea.id ?? null,
      posicion: linea.posicion ?? index + 1,
      descripcion: linea.descripcion ?? '',
      importe: linea.importe ?? null,
    })),
  });

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
  erpRegistrationState?: FacturaERPListState;
  loadingFacturaId?: string | null;
  onOpen: (factura: FacturaRecibida) => Promise<void> | void;
  onDelete: (factura: FacturaRecibida) => Promise<void> | void;
};

function FacturaListItem({
  factura,
  isSelected,
  isReadOnly = false,
  erpRegistrationState,
  loadingFacturaId = null,
  onOpen,
  onDelete,
}: FacturaListItemProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const lineCount = factura.facturas_recibidas_lineas?.length ?? 0;
  const invoiceErpState = erpStateForInvoice(factura, erpRegistrationState);
  const invoiceStatus = erpStatusMeta(invoiceErpState);
  const invoiceStatusDotClass =
    invoiceErpState === 'registered'
      ? 'bg-emerald-500'
      : invoiceErpState === 'reference'
        ? 'bg-slate-500'
        : invoiceErpState === 'checking'
        ? 'bg-slate-400'
        : 'bg-amber-500';
  const hasErrors = Boolean(factura.validation_errors?.length || factura.erp_error);
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
        className={`grid w-full min-w-0 grid-cols-1 gap-4 rounded-md px-4 py-4 text-left outline-none transition-[background-color,padding] duration-150 hover:bg-slate-50/70 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:hover:bg-slate-900/50 md:grid-cols-[minmax(0,1fr)_minmax(7.5rem,auto)] md:items-center ${
          isReadOnly ? '' : confirmingDelete ? 'pr-32 md:pr-36' : 'pr-14 md:pr-16'
        }`}
        onClick={() => void onOpen(factura)}
      >
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="min-w-0 truncate text-sm font-bold text-slate-950 dark:text-slate-50">
              Factura {invoiceNumber(factura)}
            </h3>
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${invoiceStatus.className}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${invoiceStatusDotClass}`} aria-hidden />
              {invoiceStatus.text}
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
          </div>
        </div>

        <div className="min-w-0 md:border-l md:border-slate-200 md:pl-5 md:text-right dark:md:border-slate-800">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Total
          </span>
          <span className="mt-1 block whitespace-nowrap text-lg font-bold tabular-nums text-slate-950 dark:text-slate-50">
            {formatMoney(factura.total)}
          </span>
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

function DateRangeFilter({
  desde,
  hasta,
  onChange,
}: {
  desde: string;
  hasta: string;
  onChange: (value: { desde: string; hasta: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const label =
    desde || hasta
      ? `${desde ? formatDate(desde) : 'Inicio'} - ${hasta ? formatDate(hasta) : 'Fin'}`
      : 'Cualquier fecha';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="flex h-10 w-full items-center justify-between gap-3 rounded-md border border-slate-300 bg-white px-3 text-left text-sm font-semibold text-slate-950 outline-none transition-colors hover:bg-slate-50 focus:border-primary focus:ring-2 focus:ring-primary/15 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-slate-900 dark:focus:border-primary dark:focus:ring-primary/20"
        onClick={() => setOpen((visible) => !visible)}
        aria-expanded={open}
        aria-label="Filtrar por fecha"
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          <CalendarDays className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
          <span className="truncate">{label}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+0.35rem)] z-50 w-[min(26rem,calc(100vw-2rem))] rounded-md border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/12 dark:border-slate-700 dark:bg-slate-950">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-semibold text-slate-950 dark:text-slate-100">
              <span>Desde</span>
              <Input
                className={inputClass}
                type="date"
                value={desde}
                onChange={(event) => onChange({ desde: event.target.value, hasta })}
              />
            </label>
            <label className="space-y-2 text-sm font-semibold text-slate-950 dark:text-slate-100">
              <span>Hasta</span>
              <Input
                className={inputClass}
                type="date"
                value={hasta}
                onChange={(event) => onChange({ desde, hasta: event.target.value })}
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              disabled={!desde && !hasta}
              onClick={() => onChange({ desde: '', hasta: '' })}
            >
              Limpiar fecha
            </button>
          </div>
        </div>
      ) : null}
    </div>
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
  const [facturasTotal, setFacturasTotal] = useState(0);
  const [filters, setFilters] = useState<FacturaFilters>(emptyFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortOrder, setSortOrder] = useState<FacturaSortOrder>('created_desc');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<FacturaDraft | null>(null);
  const [lineas, setLineas] = useState<FacturaRecibidaLinea[]>(createEmptyGastos());
  const [empresas, setEmpresas] = useState<FacturaEmpresaOption[]>([]);
  const [tiposFactura, setTiposFactura] = useState<FacturaTipoOption[]>([]);
  const [regimenes, setRegimenes] = useState<FacturaRegimenOption[]>([]);
  const [cuentas, setCuentas] = useState<FacturaCuentaOption[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [punteosLoading, setPunteosLoading] = useState(false);
  const [punteosLoadError, setPunteosLoadError] = useState<string | null>(null);
  const [lastSavedEditorSnapshot, setLastSavedEditorSnapshot] = useState<string | null>(null);
  const [loadedDetailId, setLoadedDetailId] = useState<string | null>(null);
  const erpPayloadPreviewRunRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [extractingIa, setExtractingIa] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [facturaUploadStep, setFacturaUploadStep] = useState<FacturaUploadStep>('idle');
  const [modalMessage, setModalMessage] = useState<ModalMessage | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showAccountingBreakdown, setShowAccountingBreakdown] = useState(false);
  const [busyFacturaId, setBusyFacturaId] = useState<string | null>(null);
  const [erpRegistrationByFacturaId, setERPRegistrationByFacturaId] = useState<Record<string, FacturaERPListState>>({});

  const isNewFacturaDraft = Boolean(draft && !draft.id);
  const isDetailMode = Boolean(draft?.id && !modalOpen);
  const activeDraftId = draft?.id ?? null;
  const activePdfPath = draft?.pdf_path ?? null;
  const currentEditorSnapshot = useMemo(() => createEditorSnapshot(draft, lineas), [draft, lineas]);
  const hasUnsavedDetailChanges = Boolean(
    isDetailMode && lastSavedEditorSnapshot && currentEditorSnapshot !== lastSavedEditorSnapshot,
  );
  const visibleErrors = draft?.validation_errors ?? [];
  const pageSizeOptions = PAGE_SIZE_OPTIONS.map((option) => ({ value: option, label: `${option} por pagina` }));
  const empresaOptions = useMemo(
    () => buildEmpresaOptions(empresas, draft?.fr_alm),
    [draft?.fr_alm, empresas],
  );
  const tipoFacturaOptions = useMemo(
    () => buildTipoFacturaOptions(tiposFactura, draft?.fr_sufa),
    [draft?.fr_sufa, tiposFactura],
  );
  const regimenOptions = useMemo(
    () => buildRegimenOptions(regimenes, draft?.tipo_iva_codigo),
    [draft?.tipo_iva_codigo, regimenes],
  );

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
    if (!hasUnsavedDetailChanges) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedDetailChanges]);

  useEffect(() => {
    setSaveFeedback(null);
  }, [activeDraftId]);

  useEffect(() => {
    if (draft && shouldOpenAccountingBreakdownFor(draft, lineas)) {
      setShowAccountingBreakdown(true);
    }
  }, [draft, lineas]);

  const loadFacturas = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const loaded = await fetchFacturasRecibidasPage({
        page,
        pageSize,
        proveedor: filters.proveedor,
        numero: filters.numero,
        fechaDesde: filters.fechaDesde,
        fechaHasta: filters.fechaHasta,
        erpStatus:
          filters.estado === 'enviada_erp'
            ? 'sent'
            : filters.estado === 'no_enviada_erp'
              ? 'not_sent'
              : 'all',
        sortOrder,
      });
      setFacturas(loaded.items);
      setFacturasTotal(loaded.total);
      setERPRegistrationByFacturaId(
        loaded.items.reduce<Record<string, FacturaERPListState>>((acc, factura) => {
          if (factura.estado === 'enviada_erp' || factura.erp_sent_at) {
            acc[factura.id] = 'registered';
          } else if (factura.estado === 'validada' || factura.estado === 'error_erp' || factura.erp_payload) {
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
  }, [
    filters.estado,
    filters.fechaDesde,
    filters.fechaHasta,
    filters.numero,
    filters.proveedor,
    page,
    pageSize,
    sortOrder,
  ]);

  useEffect(() => {
    void loadFacturas();
  }, [loadFacturas]);

  useEffect(() => {
    let active = true;
    setCatalogError(null);

    void Promise.allSettled([
      fetchFacturaEmpresas(),
      fetchFacturaTipos(),
      fetchFacturaRegimenes(),
      fetchFacturaCuentas(),
    ])
      .then(([loadedEmpresas, loadedTipos, loadedRegimenes, loadedCuentas]) => {
        if (!active) return;
        if (loadedEmpresas.status === 'fulfilled') setEmpresas(loadedEmpresas.value);
        if (loadedTipos.status === 'fulfilled') setTiposFactura(loadedTipos.value);
        if (loadedRegimenes.status === 'fulfilled') setRegimenes(loadedRegimenes.value);
        if (loadedCuentas.status === 'fulfilled') setCuentas(loadedCuentas.value);

        const failures = [loadedEmpresas, loadedTipos, loadedRegimenes, loadedCuentas]
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => getErrorMessage(result.reason, 'Catálogo ERP no disponible.'));
        if (failures.length > 0) setCatalogError(Array.from(new Set(failures)).join(' '));
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (modalOpen) {
      return;
    }

    if (!facturaId) {
      if (draft?.id) {
        setDraft(null);
        setLineas(createEmptyGastos());
        setShowAccountingBreakdown(false);
        setLastSavedEditorSnapshot(null);
        setLoadedDetailId(null);
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

    let cancelled = false;
    const applyFacturaDetail = (facturaToOpen: FacturaRecibida) => {
      const facturaLineas = getLineas(facturaToOpen);
      setDraft({ ...facturaToOpen });
      setLineas(facturaLineas);
      setShowAccountingBreakdown(shouldOpenAccountingBreakdownFor(facturaToOpen, facturaLineas));
      setLastSavedEditorSnapshot(createEditorSnapshot(facturaToOpen, facturaLineas));
      setLoadedDetailId(facturaToOpen.id);
      setPdfFile(null);
      setPdfUrl(null);
      setFacturaUploadStep('idle');
      setModalMessage(null);
      setModalOpen(false);
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    };

    const factura = facturas.find((item) => item.id === facturaId);
    if (draft?.id === facturaId && loadedDetailId === facturaId) {
      return;
    }

    setLoadError(null);

    if (!factura || isERPReadOnlyFactura(factura)) {
      setBusyFacturaId(facturaId);
      void fetchFacturaRecibidaById(facturaId)
        .then((detailedFactura) => {
          if (cancelled) return;
          if (!detailedFactura) {
            throw new Error('No se encontró la factura solicitada.');
          }
          applyFacturaDetail(detailedFactura);
        })
        .catch((error) => {
          if (!cancelled) {
            setLoadError(error instanceof Error ? error.message : 'No se pudo abrir la factura.');
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
  }, [
    draft?.id,
    facturaId,
    facturas,
    loadedDetailId,
    loading,
    modalOpen,
  ]);

  useEffect(() => {
    document.body.classList.add('facturas-iberica-shell');

    return () => {
      document.body.classList.remove('facturas-iberica-shell');
    };
  }, []);

  useEffect(() => {
    const readPayload = async () => {
      if (!activeDraftId || !isDetailMode) {
        throw new Error('Abre el detalle de una factura para calcular el body de envio.');
      }

      const preview = await fetchFacturaRecibidaERPPayloadPreview(activeDraftId);
      if (preview.validation_errors.length > 0) {
        console.warn(
          `[ERP] El envio real quedaria bloqueado por validacion para factura ${activeDraftId}:`,
          preview.validation_errors,
        );
      }
      console.log(`[ERP] Body de envio para factura ${activeDraftId}:`, preview.payload);
      return preview.payload;
    };

    const readPayloadJson = async () => {
      if (!activeDraftId || !isDetailMode) {
        throw new Error('Abre el detalle de una factura para calcular el body de envio.');
      }

      const preview = await fetchFacturaRecibidaERPPayloadPreview(activeDraftId);
      if (preview.validation_errors.length > 0) {
        console.warn(
          `[ERP] El envio real quedaria bloqueado por validacion para factura ${activeDraftId}:`,
          preview.validation_errors,
        );
      }
      console.log(preview.body_json);
      return preview.body_json;
    };

    window.bodyenviar = readPayload;
    window.bodyEnviar = readPayload;
    window.bodyenviarjson = readPayloadJson;

    return () => {
      if (window.bodyenviar === readPayload) delete window.bodyenviar;
      if (window.bodyEnviar === readPayload) delete window.bodyEnviar;
      if (window.bodyenviarjson === readPayloadJson) delete window.bodyenviarjson;
    };
  }, [activeDraftId, isDetailMode]);

  useEffect(() => {
    if (!activeDraftId || !isDetailMode) {
      return;
    }

    let active = true;
    const runId = erpPayloadPreviewRunRef.current + 1;
    erpPayloadPreviewRunRef.current = runId;

    void fetchFacturaRecibidaERPPayloadPreview(activeDraftId)
      .then((preview) => {
        if (!active || erpPayloadPreviewRunRef.current !== runId) {
          return;
        }

        if (preview.validation_errors.length > 0) {
          console.warn(
            `[ERP] Payload calculado para factura ${activeDraftId}. El envio real quedaria bloqueado por validacion:`,
            preview.body_json,
            preview.validation_errors,
          );
          return;
        }

        return;
      })
      .catch((error) => {
        if (!active || erpPayloadPreviewRunRef.current !== runId) {
          return;
        }

        console.warn(
          `[ERP] No se pudo calcular el payload que se enviaria al ERP para factura ${activeDraftId}:`,
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

  const activeFiltersCount = [
    filters.proveedor,
    filters.numero,
    filters.fechaDesde,
    filters.fechaHasta,
    filters.estado !== 'todos' ? filters.estado : '',
  ].filter(Boolean).length;

  const totalPages = Math.max(1, Math.ceil(facturasTotal / pageSize));
  const paginatedFacturas = facturas;
  const visibleStart = facturasTotal === 0 ? 0 : (page - 1) * pageSize + 1;
  const visibleEnd = Math.min(facturasTotal, (page - 1) * pageSize + facturas.length);
  const headerLabel =
    activeFiltersCount > 0
      ? `${formatInteger(facturasTotal)} facturas filtradas`
      : `${formatInteger(facturasTotal)} facturas entrantes`;
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

  const updateDateFilter = (value: { desde: string; hasta: string }) => {
    setFilters((current) => ({
      ...current,
      fechaDesde: value.desde,
      fechaHasta: value.hasta,
    }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setSortOrder('created_desc');
    setPage(1);
  };

  const openNewFactura = () => {
    setDraft(createEmptyDraft());
    setLineas(createEmptyGastos());
    setShowAccountingBreakdown(true);
    setLastSavedEditorSnapshot(null);
    setLoadedDetailId(null);
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
    setLineas(createEmptyGastos());
    setShowAccountingBreakdown(false);
    setLastSavedEditorSnapshot(null);
    setLoadedDetailId(null);
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
      setLoadedDetailId(facturaToOpen.id);
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
    if (
      hasUnsavedDetailChanges &&
      !saving &&
      !window.confirm('Hay cambios sin guardar. ¿Quieres salir y descartarlos?')
    ) {
      return;
    }
    setDraft(null);
    setLineas(createEmptyGastos());
    setShowAccountingBreakdown(false);
    setLastSavedEditorSnapshot(null);
    setLoadedDetailId(null);
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

  const selectProveedorAcreedor = (acreedor: AgroIrisAcreedor | null) => {
    setDraft((current) => (current ? { ...current, ...proveedorDraftFromAcreedor(acreedor) } : current));
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

  const updateIvaTramo = (
    posicion: FacturaRecibidaIvaTramo['posicion'],
    key: 'base' | 'porcentaje' | 'cuota',
    value: number | null,
  ) => {
    setDraft((current) => {
      if (!current) return current;
      const source = current.iva_tramos?.length
        ? current.iva_tramos
        : createEmptyDraft().iva_tramos ?? [];
      const ivaTramos = source.map((tramo) =>
        tramo.posicion === posicion ? { ...tramo, [key]: value } : tramo,
      );
      return {
        ...current,
        iva_tramos: ivaTramos,
        base_imponible: ivaTramos.reduce((sum, tramo) => sum + Number(tramo.base ?? 0), 0),
        iva_porcentaje: ivaTramos[0]?.porcentaje ?? null,
        iva_importe: ivaTramos.reduce((sum, tramo) => sum + Number(tramo.cuota ?? 0), 0),
      };
    });
  };

  const calculateIvaCuotas = () => {
    setDraft((current) => {
      if (!current) return current;
      const source = current.iva_tramos?.length
        ? current.iva_tramos
        : createEmptyDraft().iva_tramos ?? [];
      const ivaTramos = source.map((tramo) => ({
        ...tramo,
        cuota: Number(((Number(tramo.base ?? 0) * Number(tramo.porcentaje ?? 0)) / 100).toFixed(2)),
      }));
      return {
        ...current,
        iva_tramos: ivaTramos,
        iva_importe: ivaTramos.reduce((sum, tramo) => sum + Number(tramo.cuota ?? 0), 0),
      };
    });
  };

  const updateVencimiento = (
    posicion: FacturaRecibidaVencimiento['posicion'],
    key: 'fecha' | 'importe',
    value: string | number | null,
  ) => {
    setDraft((current) => {
      if (!current) return current;
      const source = current.vencimientos?.length
        ? current.vencimientos
        : createEmptyDraft().vencimientos ?? [];
      const vencimientos = source.map((vencimiento) =>
        vencimiento.posicion === posicion ? { ...vencimiento, [key]: value } : vencimiento,
      ) as FacturaRecibidaVencimiento[];
      return {
        ...current,
        vencimientos,
        fecha_vto: vencimientos[0]?.fecha ?? null,
        importe_vto: vencimientos[0]?.importe ?? null,
      };
    });
  };

  const updateCtbLinea = <TKey extends keyof FacturaRecibidaLinea>(
    index: number,
    key: TKey,
    value: FacturaRecibidaLinea[TKey],
  ) => {
    setDraft((current) => {
      if (!current) return current;
      const ctbLineas = current.ctb_lineas?.length
        ? current.ctb_lineas
        : [createEmptyCtbLinea()];
      return {
        ...current,
        ctb_lineas: ctbLineas.map((linea, currentIndex) =>
          currentIndex === index ? { ...linea, [key]: value } : linea,
        ),
      };
    });
  };

  const addCtbLinea = () => {
    setDraft((current) => {
      if (!current) return current;
      const ctbLineas = current.ctb_lineas ?? [];
      return {
        ...current,
        ctb_lineas: [...ctbLineas, createEmptyCtbLinea(ctbLineas.length + 1)],
      };
    });
  };

  const removeCtbLinea = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        ctb_lineas: (current.ctb_lineas ?? [])
          .filter((_, currentIndex) => currentIndex !== index)
          .map((linea, currentIndex) => ({ ...linea, posicion: currentIndex + 1 })),
      };
    });
  };

  const updatePunteoSelected = (index: number, selected: boolean) => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        punteos: (current.punteos ?? []).map((punteo, currentIndex) =>
          currentIndex === index ? { ...punteo, seleccionado: selected } : punteo,
        ),
      };
    });
  };

  const loadPunteables = async () => {
    const empresaId = Number(draft?.fr_alm ?? '');
    const proveedorId = Number(draft?.proveedor_codigo ?? '');
    if (!Number.isFinite(empresaId) || !Number.isFinite(proveedorId)) {
      setPunteosLoadError('Selecciona empresa y acreedor antes de consultar punteables.');
      return;
    }

    setPunteosLoading(true);
    setPunteosLoadError(null);
    try {
      const candidates = await fetchFacturaPunteables({
        empresaId: Math.trunc(empresaId),
        proveedorId: Math.trunc(proveedorId),
      });
      setDraft((current) => {
        if (!current) return current;
        const currentBySource = new Map(
          (current.punteos ?? []).map((punteo) => [
            `${punteo.source_table ?? ''}:${punteo.source_id ?? punteo.remote_id ?? ''}`,
            punteo,
          ]),
        );
        return {
          ...current,
          punteos: candidates.map((candidate) => {
            const previous = currentBySource.get(
              `${candidate.source_table ?? ''}:${candidate.source_id ?? candidate.remote_id ?? ''}`,
            );
            return previous
              ? { ...candidate, seleccionado: previous.seleccionado }
              : candidate;
          }),
        };
      });
      if (candidates.length === 0) {
        setPunteosLoadError('La API no devolvió albaranes o gastos punteables para esta factura.');
      }
    } catch (error) {
      setPunteosLoadError(getErrorMessage(error, 'No se pudieron cargar los punteables del ERP.'));
    } finally {
      setPunteosLoading(false);
    }
  };

  const removeLinea = (index: number) => {
    setLineas((current) =>
      current.map((linea, currentIndex) =>
        currentIndex === index ? createEmptyLinea(linea.posicion ?? currentIndex + 1) : linea,
      ),
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
      const payload = { ...baseDraft };

      if (pdfFile) throw new Error('El PDF no puede cambiarse después de crear la factura.');

      const saved = await saveFacturaRecibida(
        payload,
        lineas.map((linea, index) => ({ ...linea, posicion: index + 1 })),
        validar,
      );

      setFacturas((current) => replaceFactura(current, saved));
      setERPRegistrationByFacturaId((current) => ({
        ...current,
        [saved.id]: saved.estado === 'enviada_erp' || saved.erp_sent_at ? 'registered' : 'unregistered',
      }));
      const savedLineas = getLineas(saved);
      setDraft(saved);
      setLineas(savedLineas);
      setLastSavedEditorSnapshot(createEditorSnapshot(saved, savedLineas));
      setLoadedDetailId(saved.id);
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
      setModalMessage({ type: 'error', text: getErrorMessage(error, 'No se pudo guardar la factura.') });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSendERP = async () => {
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

      const sent = await sendFacturaRecibidaToERP(saved.id, saved.version);
      setFacturas((current) => replaceFactura(current, sent));
      setERPRegistrationByFacturaId((current) => ({ ...current, [sent.id]: 'registered' }));
      const sentLineas = getLineas(sent);
      setDraft(sent);
      setLineas(sentLineas);
      setLastSavedEditorSnapshot(createEditorSnapshot(sent, sentLineas));
      setLoadedDetailId(sent.id);
      setModalMessage({ type: 'success', text: 'Factura enviada correctamente.' });
    } catch (error) {
      setModalMessage({ type: 'error', text: getErrorMessage(error, 'No se pudo enviar la factura.') });
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
    setSaving(true);
    setExtractingIa(true);
    setFacturaUploadStep('uploading');
    setModalMessage(null);
    const analyzingTimer = window.setTimeout(() => setFacturaUploadStep('analyzing'), PDF_UPLOAD_ANIMATION_MS);

    try {
      const saved = await extractFacturaWithN8n(selectedPdf, createEmptyDraft());
      const savedLineas = getLineas(saved);

      setFacturas((current) => replaceFactura(current, saved));
      setFacturasTotal((current) => current + 1);
      setERPRegistrationByFacturaId((current) => ({ ...current, [saved.id]: 'unregistered' }));
      setDraft(saved);
      setLineas(savedLineas);
      setShowAccountingBreakdown(shouldOpenAccountingBreakdownFor(saved, savedLineas));
      setLastSavedEditorSnapshot(createEditorSnapshot(saved, savedLineas));
      setLoadedDetailId(saved.id);
      setPdfFile(null);
      setFacturaUploadStep('done');
      setModalOpen(false);
      navigate(`/facturas-recibidas/${encodeURIComponent(saved.id)}`, { replace: true });
      setModalMessage({
        type: 'success',
        text: 'Factura registrada. Revisa los datos antes de validar.',
      });
    } catch (error) {
      window.clearTimeout(analyzingTimer);
      setDraft(createEmptyDraft());
      setLineas(createEmptyGastos());
      setShowAccountingBreakdown(true);
      setLastSavedEditorSnapshot(null);
      setLoadedDetailId(null);
      setPdfFile(selectedPdf);
      setPdfUrl(null);
      setFacturaUploadStep('idle');
      setModalMessage({
        type: 'error',
        text: getErrorMessage(error, 'Ha fallado al añadir la factura.'),
      });
    } finally {
      window.clearTimeout(analyzingTimer);
      setSaving(false);
      setExtractingIa(false);
    }
  };

  const handleDiscard = async () => {
    if (isERPReadOnlyFactura(draft)) {
      setModalMessage({ type: 'info', text: 'Esta factura viene de ERP y se muestra en modo solo lectura.' });
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
      setFacturas((current) => current.filter((factura) => factura.id !== saved.id));
      setFacturasTotal((current) => Math.max(0, current - 1));
      closeDetail();
    } catch (error) {
      setModalMessage({ type: 'error', text: getErrorMessage(error, 'No se pudo descartar la factura.') });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardFromList = async (factura: FacturaRecibida) => {
    if (isERPReadOnlyFactura(factura)) {
      return;
    }

    setBusyFacturaId(factura.id);
    setLoadError(null);

    try {
      const saved = await saveFacturaRecibida({ ...factura, estado: 'descartada' }, getLineas(factura), false);
      setFacturas((current) => current.filter((item) => item.id !== saved.id));
      setFacturasTotal((current) => Math.max(0, current - 1));
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

  const detailERPStatus = draft?.id
    ? erpStatusMeta(erpStateForInvoice(draft as FacturaRecibida, erpRegistrationByFacturaId[draft.id]))
    : erpStatusMeta('unknown');
  const isReadOnlyDetail = isERPReadOnlyFactura(draft);
  const lineasBaseTotal = lineas.reduce((sum, linea) => sum + (Number(linea.importe) || 0), 0);
  const accountingLinesWithData = lineas.filter(hasAccountingLineData);
  const accountingLineCount = accountingLinesWithData.length;
  const accountingBase = Number(draft?.base_imponible ?? 0);
  const accountingDifference = lineasBaseTotal - accountingBase;
  const hasAccountingDifference = Math.abs(accountingDifference) > ACCOUNTING_AMOUNT_TOLERANCE;
  const ctbLineas = draft?.ctb_lineas ?? [];
  const ctbTotal = ctbLineas.reduce((sum, linea) => sum + (Number(linea.importe) || 0), 0);
  const punteos = draft?.punteos ?? [];
  const getPunteoImporte = (punteo: FacturaRecibidaPunteo) => Number(punteo.importe ?? 0) || 0;
  const getPunteoImporteP = (punteo: FacturaRecibidaPunteo) =>
    Number(punteo.importe_punteado ?? punteo.importe_factura ?? 0) || 0;
  const getPunteoSelected = (punteo: FacturaRecibidaPunteo) => Boolean(punteo.seleccionado);
  const punteosTotal = punteos.reduce((sum, punteo) => sum + getPunteoImporte(punteo), 0);
  const punteosSeleccionados = punteos.filter(getPunteoSelected).length;
  const ivaTramos = draft?.iva_tramos?.length
    ? draft.iva_tramos
    : createEmptyDraft().iva_tramos ?? [];
  const ivaBaseTotal = ivaTramos.reduce((sum, tramo) => sum + Number(tramo.base ?? 0), 0);
  const ivaCuotaTotal = ivaTramos.reduce((sum, tramo) => sum + Number(tramo.cuota ?? 0), 0);
  const calculatedInvoiceTotal =
    ivaBaseTotal +
    ivaCuotaTotal -
    Number(draft?.retencion_importe ?? 0) +
    Number(draft?.importe_suplido ?? 0);
  const invoiceTotalDifference = Number(draft?.total ?? 0) - calculatedInvoiceTotal;
  const vencimientos = draft?.vencimientos?.length
    ? draft.vencimientos
    : createEmptyDraft().vencimientos ?? [];
  const vencimientosTotal = vencimientos.reduce(
    (sum, vencimiento) => sum + Number(vencimiento.importe ?? 0),
    0,
  );
  const vencimientosDifference = Number(draft?.total ?? 0) - vencimientosTotal;
  const useCalculatedInvoiceTotal = () => {
    updateDraft('total', Number(calculatedInvoiceTotal.toFixed(2)));
  };
  const assignTotalToFirstVencimiento = () => {
    const hasOtherAmounts = vencimientos
      .slice(1)
      .some((vencimiento) => Math.abs(Number(vencimiento.importe ?? 0)) > ACCOUNTING_AMOUNT_TOLERANCE);
    if (
      hasOtherAmounts &&
      !window.confirm(
        'Esta acción asignará el total al primer vencimiento y limpiará los importes de los vencimientos 2 a 4. ¿Continuar?',
      )
    ) {
      return;
    }
    setDraft((current) => {
      if (!current) return current;
      const source = current.vencimientos?.length
        ? current.vencimientos
        : createEmptyDraft().vencimientos ?? [];
      const nextVencimientos = source.map((vencimiento) => ({
        ...vencimiento,
        importe: vencimiento.posicion === 1 ? Number(current.total ?? 0) : null,
      })) as FacturaRecibidaVencimiento[];
      return {
        ...current,
        vencimientos: nextVencimientos,
        importe_vto: nextVencimientos[0]?.importe ?? null,
      };
    });
  };
  const asientoLineas = draft?.asiento_lineas ?? draft?.accounting?.lines ?? [];
  const materialLines = punteos.flatMap((punteo) =>
    (punteo.lines ?? []).map((linea, index) => ({
      ...linea,
      key: `${punteo.source_id ?? punteo.remote_id ?? punteo.posicion}-${linea.id ?? index}`,
      albaran: punteo.albaran,
      sourceId: punteo.source_id,
    })),
  );
  const accountingSummary =
    accountingLineCount === 0
      ? 'Sin desglose de gastos'
      : accountingLineCount === 1
        ? `${cleanOptionalString(accountingLinesWithData[0]?.descripcion) ?? 'Cuenta sin indicar'} - ${formatMoney(lineasBaseTotal)}`
        : `${accountingLineCount} gastos - ${formatMoney(lineasBaseTotal)}`;

  const listView = (
    <div className="purchase-invoices-page flex min-h-[calc(100vh-9rem)] flex-col gap-5">
      <header className="docs-page-header" style={{ marginBottom: 0 }}>
        <div className="docs-page-copy">
          <div className="docs-page-copy-body">
            <p className="docs-page-eyebrow">Compras</p>
            <h2 className="docs-page-title">Facturas</h2>
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
            className={toolbarPrimaryButtonClass}
            onClick={openNewFactura}
          >
            <Plus className="h-4 w-4" />
            Subir PDF
          </button>
        </div>
      </div>

      {showFilters ? (
        <section className="purchase-invoices-filter-panel relative z-20 overflow-visible rounded-lg border border-border bg-card shadow-sm">
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

          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-[minmax(18rem,1.2fr)_minmax(15rem,1fr)_minmax(12rem,0.75fr)_minmax(16rem,1fr)_minmax(14rem,0.85fr)]">
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
              <Label>Factura/ref.</Label>
              <Input
                className={inputClass}
                value={filters.numero}
                onChange={(event) => updateFilter('numero', event.target.value)}
                placeholder="Número o referencia"
              />
            </div>

            <div className="space-y-2">
              <Label>ERP</Label>
              <FilterSelect
                value={filters.estado}
                options={estadoOptions}
                onChange={(value) => updateFilter('estado', value as FacturaFilters['estado'])}
                ariaLabel="Filtrar por ERP"
              />
            </div>

            <div className="space-y-2">
              <Label>Fecha</Label>
              <DateRangeFilter
                desde={filters.fechaDesde}
                hasta={filters.fechaHasta}
                onChange={updateDateFilter}
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

      {catalogError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
          {catalogError} Los valores guardados se conservan, pero no se ofrecen sustitutos inventados.
        </div>
      ) : null}

      <section className="purchase-invoices-list-panel flex min-h-[420px] flex-1 flex-col rounded-xl border border-border bg-background p-3 dark:border-slate-700 dark:bg-slate-950/60">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1 text-sm font-semibold text-muted-foreground">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
              Bandeja de entrada
            </p>
            <span>
              Mostrando {visibleStart}-{visibleEnd} de {facturasTotal}
            </span>
          </div>
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
                {activeFiltersCount > 0 ? 'Ajusta los filtros activos para ampliar el resultado.' : 'Cuando llegue un PDF y termine su análisis, la factura aparecerá aquí.'}
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
                isReadOnly={isERPReadOnlyFactura(factura)}
                erpRegistrationState={erpRegistrationByFacturaId[factura.id]}
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
          <div className="w-40">
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
            Factura recibida
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
            {isReadOnlyDetail ? (
              <p className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <CheckCircle2 size={15} />
                Bloqueada tras identidad o envío ERP
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-400/30 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-500/10"
                  disabled={saving || sending}
                  onClick={() => void handleDiscard()}
                >
                  <Trash2 size={15} />
                  Eliminar
                </button>
                <button
                  type="button"
                  className={saveButtonClass}
                  disabled={saving || sending || !hasUnsavedDetailChanges}
                  onClick={() => void persistFactura(false)}
                >
                  {saving ? <Loader2 className="animate-spin" size={15} /> : showSaveFeedback ? <CheckCircle2 size={15} /> : <Save size={15} />}
                  {saveButtonLabel}
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={saving || sending || extractingIa || draft.estado === 'enviada_erp' || draft.estado === 'descartada'}
                  onClick={() => void handleSendERP()}
                >
                  {sending ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />}
                  {draft.estado === 'enviada_erp' ? 'Enviado a ERP' : 'Enviar a ERP'}
                </button>
              </>
            )}
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
                {draft.estado ? estadoLabels[draft.estado] : detailERPStatus.text}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>ERP:</dt>
              <dd className="font-bold text-slate-950 dark:text-slate-100">
                {detailERPStatus.text}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      {draft.erp_error || visibleErrors.length > 0 || catalogError ? (
        <div className="mx-2 mt-4 space-y-3">
          {draft.erp_error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-200">
              <p className="font-bold">Error ERP</p>
              <p className="mt-1">{draft.erp_error}</p>
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
          {catalogError ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-200">
              <p className="font-bold">Catálogos ERP no disponibles</p>
              <p className="mt-1">{catalogError}</p>
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
              <FieldGroup title="Acreedor">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <Field label="Acreedor" className="sm:col-span-2 2xl:col-span-4">
                    <AcreedorCombobox
                      value={acreedorIdFromDraft(draft)}
                      onChange={() => undefined}
                      onSelect={selectProveedorAcreedor}
                      disabled={isReadOnlyDetail}
                      placeholder="Buscar acreedor por nombre o NIF"
                      className={detailInputClass}
                      source="erp"
                      minSearchLength={0}
                      searchLimit={2000}
                    />
                  </Field>
                  <Field label="Nombre" className="sm:col-span-2">
                    <Input className={detailInputClass} value={draft.proveedor_nombre ?? ''} disabled />
                  </Field>
                  <Field label="NIF">
                    <Input
                      className={detailInputClass}
                      value={draft.proveedor_nif ?? ''}
                      disabled
                    />
                  </Field>
                  <Field label="Acreedor">
                    <Input className={detailInputClass} value={draft.proveedor_codigo ?? ''} disabled />
                  </Field>
                  <Field label="Cta. Proveedor">
                    <Input className={detailInputClass} value={draft.proveedor_cuenta ?? ''} disabled />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Factura">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <Field label="Entrada">
                    <Input
                      className={detailInputClass}
                      value={draft.referencia ?? ''}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('referencia', event.target.value)}
                    />
                  </Field>
                  <Field label="Ejercicio">
                    <Input
                      className={detailInputClass}
                      inputMode="numeric"
                      value={numberInputValue(draft.ejercicio)}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('ejercicio', parseNumber(event.target.value))}
                    />
                  </Field>
                  <Field label="Nº Factura">
                    <Input
                      className={detailInputClass}
                      value={draft.numero_factura ?? ''}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('numero_factura', event.target.value)}
                    />
                  </Field>
                  <Field label="Fecha factura">
                    <Input
                      className={detailInputClass}
                      type="date"
                      value={draft.fecha_factura ?? ''}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('fecha_factura', event.target.value)}
                    />
                  </Field>
                  <Field label="Fecha CTB">
                    <Input
                      className={detailInputClass}
                      type="date"
                      value={draft.fecha_ctb ?? ''}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('fecha_ctb', event.target.value)}
                    />
                  </Field>
                  <Field label="Empresa">
                    {empresaOptions.length > 1 ? (
                      <FilterSelect
                        value={draft.fr_alm ?? ''}
                        options={empresaOptions}
                        onChange={(value) => updateDraft('fr_alm', value)}
                        ariaLabel="Seleccionar empresa"
                        disabled={isReadOnlyDetail}
                        triggerClassName={detailInputClass}
                      />
                    ) : (
                      <Input className={detailInputClass} value={empresaOptions[0]?.label ?? draft.fr_alm ?? ''} disabled />
                    )}
                  </Field>
                  <Field label="Tipo factura">
                    <FilterSelect
                      value={draft.fr_sufa ?? ''}
                      options={tipoFacturaOptions}
                      onChange={(value) => updateDraft('fr_sufa', value)}
                      ariaLabel="Seleccionar tipo de factura"
                      disabled={isReadOnlyDetail}
                      triggerClassName={detailInputClass}
                    />
                  </Field>
                  <Field label="Tipo IVA">
                    <FilterSelect
                      value={draft.tipo_iva_codigo ?? ''}
                      options={regimenOptions}
                      onChange={(value) => updateDraft('tipo_iva_codigo', value)}
                      ariaLabel="Seleccionar régimen de IVA"
                      disabled={isReadOnlyDetail}
                      triggerClassName={detailInputClass}
                    />
                  </Field>
                  <Field label="ID técnico asiento">
                    <Input
                      className={detailInputClass}
                      value={numberInputValue(draft.asiento_tecnico ?? draft.asiento)}
                      disabled
                    />
                  </Field>
                  <Field label="N.º de asiento">
                    <Input className={detailInputClass} value={draft.asiento_numero ?? ''} disabled />
                  </Field>
                  <Field label="Fecha asiento">
                    <Input className={detailInputClass} value={formatDate(draft.asiento_fecha)} disabled />
                  </Field>
                  <Field label="Estado asiento">
                    <Input className={detailInputClass} value={draft.asiento_estado ?? 'not_requested'} disabled />
                  </Field>
                  <Field label="Concepto asiento" className="sm:col-span-2 2xl:col-span-4">
                    <textarea
                      className={detailTextareaClass}
                      value={draft.concepto_asiento ?? ''}
                      disabled={isReadOnlyDetail}
                      maxLength={50}
                      onChange={(event) => updateDraft('concepto_asiento', event.target.value)}
                      placeholder="Concepto asiento"
                    />
                  </Field>
                  <Field label="Obs. AEAT" className="sm:col-span-2">
                    <Input
                      className={detailInputClass}
                      value={draft.obs_aeat ?? ''}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('obs_aeat', event.target.value)}
                    />
                  </Field>
                  <Field label="Obs." className="sm:col-span-2">
                    <Input
                      className={detailInputClass}
                      value={draft.observaciones ?? ''}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('observaciones', event.target.value)}
                    />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Desglose de IVA">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                    Base {formatMoney(ivaBaseTotal)} · Cuota {formatMoney(ivaCuotaTotal)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      disabled={isReadOnlyDetail}
                      onClick={calculateIvaCuotas}
                    >
                      Calcular cuotas
                    </button>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      disabled={isReadOnlyDetail}
                      onClick={useCalculatedInvoiceTotal}
                    >
                      Usar total calculado
                    </button>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                        <th className="w-14 px-3 py-3">#</th>
                        <th className="px-3 py-3">Base</th>
                        <th className="px-3 py-3">IVA %</th>
                        <th className="px-3 py-3">Cuota</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {ivaTramos.map((tramo) => (
                        <tr key={tramo.posicion} className="bg-white dark:bg-slate-950">
                          <td className="px-3 py-3 font-bold text-slate-500">{tramo.posicion}</td>
                          <td className="px-3 py-3">
                            <Input className={detailTableInputClass} inputMode="decimal" value={numberInputValue(tramo.base)} disabled={isReadOnlyDetail} onChange={(event) => updateIvaTramo(tramo.posicion, 'base', parseNumber(event.target.value))} />
                          </td>
                          <td className="px-3 py-3">
                            <Input className={detailTableInputClass} inputMode="decimal" value={numberInputValue(tramo.porcentaje)} disabled={isReadOnlyDetail} onChange={(event) => updateIvaTramo(tramo.posicion, 'porcentaje', parseNumber(event.target.value))} />
                          </td>
                          <td className="px-3 py-3">
                            <Input className={detailTableInputClass} inputMode="decimal" value={numberInputValue(tramo.cuota)} disabled={isReadOnlyDetail} onChange={(event) => updateIvaTramo(tramo.posicion, 'cuota', parseNumber(event.target.value))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <Field label="Base retención">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.base_retencion)} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('base_retencion', parseNumber(event.target.value))} />
                  </Field>
                  <Field label="% retención">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.retencion_porcentaje)} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('retencion_porcentaje', parseNumber(event.target.value) ?? 0)} />
                  </Field>
                  <Field label="Cuota retención">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.retencion_importe)} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('retencion_importe', parseNumber(event.target.value) ?? 0)} />
                  </Field>
                  <Field label="Clave IRPF">
                    <Input className={detailInputClass} value={draft.clave_irpf ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('clave_irpf', event.target.value)} />
                  </Field>
                  <Field label="Cuota no deducible">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.cuota_no_deducible)} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('cuota_no_deducible', parseNumber(event.target.value) ?? 0)} />
                  </Field>
                  <Field label="Importe suplido">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.importe_suplido)} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('importe_suplido', parseNumber(event.target.value) ?? 0)} />
                  </Field>
                  <Field label="Total factura">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.total)} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('total', parseNumber(event.target.value))} />
                  </Field>
                  <Field label="Diferencia">
                    <Input className={detailInputClass} value={formatMoney(invoiceTotalDifference)} disabled />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Desglose de Gastos">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-950 dark:text-slate-50">{accountingSummary}</p>
                    <p className={`text-xs font-semibold ${hasAccountingDifference ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                      {hasAccountingDifference
                        ? `La suma difiere de la base en ${formatMoney(Math.abs(accountingDifference))}.`
                        : `Base: ${formatMoney(draft.base_imponible)}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800"
                    onClick={() => setShowAccountingBreakdown((visible) => !visible)}
                  >
                    <ChevronsUpDown className="h-4 w-4" />
                    {showAccountingBreakdown ? 'Ocultar gastos' : isReadOnlyDetail ? 'Ver gastos' : 'Editar gastos'}
                  </button>
                </div>

                {showAccountingBreakdown ? (
                  <div className="mt-4">
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                      <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                        Suma gastos: {formatMoney(lineasBaseTotal)} / Base: {formatMoney(draft.base_imponible)}
                      </p>
                    </div>
                    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                      <table className="purchase-invoice-lines-table w-full min-w-[760px] text-left text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                            <th className="w-12 px-3 py-3">#</th>
                            <th className="px-3 py-3">Cuenta gasto</th>
                            <th className="w-36 px-3 py-3">Importe gasto</th>
                            <th className="w-16 px-3 py-3" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {lineas.map((linea, index) => (
                            <tr key={`${linea.id ?? 'linea'}-${index}`} className="bg-white align-middle dark:bg-slate-950">
                              <td className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">{index + 1}</td>
                              <td className="px-3 py-3">
                                <Input list="factura-cuentas-erp" className={detailTableInputClass} value={linea.descripcion} disabled={isReadOnlyDetail} onChange={(event) => updateLinea(index, 'descripcion', event.target.value)} />
                              </td>
                              <td className="px-3 py-3">
                                <Input className={detailTableInputClass} inputMode="decimal" value={numberInputValue(linea.importe)} disabled={isReadOnlyDetail} onChange={(event) => updateLinea(index, 'importe', parseNumber(event.target.value) ?? 0)} />
                              </td>
                              <td className="px-3 py-3 text-right">
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-400/30 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-500/10"
                                  disabled={isReadOnlyDetail}
                                  onClick={() => removeLinea(index)}
                                  aria-label="Eliminar gasto"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-200 bg-slate-50 text-sm font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                            <td className="px-3 py-3" colSpan={2}>Totales</td>
                            <td className="px-3 py-3">{formatMoney(lineasBaseTotal)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ) : null}
              </FieldGroup>

              <FieldGroup title="Albaranes/Gtos para puntear">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                    Se conservan la tabla e ID de origen y las líneas de material son de solo lectura.
                  </p>
                  {!isReadOnlyDetail ? (
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      disabled={punteosLoading}
                      onClick={() => void loadPunteables()}
                    >
                      {punteosLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {punteosLoading ? 'Consultando...' : 'Consultar punteables'}
                    </button>
                  ) : null}
                </div>

                {punteosLoadError ? (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
                    <span>{punteosLoadError}</span>
                    {!isReadOnlyDetail ? (
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-amber-200 bg-white px-3 text-xs font-bold hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/60 dark:bg-amber-950/40"
                        disabled={punteosLoading}
                        onClick={() => void loadPunteables()}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Reintentar
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {punteos.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                    <table className="w-full min-w-[860px] text-left text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                          <th className="px-3 py-3">Origen</th>
                          <th className="px-3 py-3">Id origen</th>
                          <th className="px-3 py-3">Serie</th>
                          <th className="px-3 py-3">Albaran</th>
                          <th className="px-3 py-3">Ref</th>
                          <th className="px-3 py-3">Fecha</th>
                          <th className="px-3 py-3 text-right">Importe P</th>
                          <th className="px-3 py-3 text-right">Importe</th>
                          <th className="px-3 py-3 text-center">Líneas</th>
                          <th className="px-3 py-3 text-center">S</th>
                          <th className="px-3 py-3 text-center">Ver</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {punteos.map((punteo, index) => (
                          <tr key={punteo.id ?? `${punteo.ref ?? 'punteo'}-${index}`} className="bg-white dark:bg-slate-950">
                            <td className="px-3 py-3">{punteo.origen ?? '-'}</td>
                            <td className="px-3 py-3">{punteo.source_table && punteo.source_id ? `${punteo.source_table}:${punteo.source_id}` : punteo.remote_id ?? '-'}</td>
                            <td className="px-3 py-3">{punteo.serie ?? '-'}</td>
                            <td className="px-3 py-3">{punteo.albaran ?? '-'}</td>
                            <td className="px-3 py-3">{punteo.ref ?? '-'}</td>
                            <td className="px-3 py-3">{formatDate(punteo.fecha)}</td>
                            <td className="px-3 py-3 text-right">{formatMoney(getPunteoImporteP(punteo))}</td>
                            <td className="px-3 py-3 text-right">{formatMoney(getPunteoImporte(punteo))}</td>
                            <td className="px-3 py-3 text-center">{punteo.line_count ?? punteo.lines?.length ?? 0}</td>
                            <td className="px-3 py-3 text-center">
                              {isReadOnlyDetail ? (
                                getPunteoSelected(punteo) ? 'Sí' : 'No'
                              ) : (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                                  checked={getPunteoSelected(punteo)}
                                  onChange={(event) => updatePunteoSelected(index, event.target.checked)}
                                  aria-label={`Seleccionar punteo ${punteo.albaran ?? punteo.source_id ?? index + 1}`}
                                />
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">{punteo.ver ? 'Si' : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 bg-slate-50 text-sm font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                          <td className="px-3 py-3" colSpan={7}>
                            Total seleccionado: {punteosSeleccionados}
                          </td>
                          <td className="px-3 py-3 text-right">{formatMoney(punteosTotal)}</td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                    Sin albaranes/gastos para puntear recibidos desde API.
                  </div>
                )}

                {materialLines.length > 0 ? (
                  <div className="mt-4 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                    <table className="w-full min-w-[780px] text-left text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                          <th className="px-3 py-3">Albarán</th>
                          <th className="px-3 py-3">Línea</th>
                          <th className="px-3 py-3">Descripción</th>
                          <th className="px-3 py-3 text-right">Cantidad</th>
                          <th className="px-3 py-3 text-right">Precio</th>
                          <th className="px-3 py-3 text-right">Importe</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {materialLines.map((linea) => (
                          <tr key={linea.key} className="bg-white dark:bg-slate-950">
                            <td className="px-3 py-3">{linea.albaran ?? linea.sourceId ?? '-'}</td>
                            <td className="px-3 py-3">{linea.posicion ?? '-'}</td>
                            <td className="px-3 py-3">{linea.descripcion ?? '-'}</td>
                            <td className="px-3 py-3 text-right">{linea.cantidad ?? '-'}</td>
                            <td className="px-3 py-3 text-right">{linea.precio == null ? '-' : formatMoney(linea.precio)}</td>
                            <td className="px-3 py-3 text-right">{linea.importe == null ? '-' : formatMoney(linea.importe)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </FieldGroup>

              <FieldGroup title="Distribución CTB">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                    Total CTB: {formatMoney(ctbTotal)}
                  </p>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    disabled={isReadOnlyDetail}
                    onClick={addCtbLinea}
                  >
                    <Plus size={15} />
                    Línea CTB
                  </button>
                </div>
                {ctbLineas.length > 0 ? (
                  <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                    <table className="w-full min-w-[1040px] text-left text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                          <th className="w-12 px-3 py-3">#</th>
                          <th className="px-3 py-3">Cuenta</th>
                          <th className="px-3 py-3">Importe</th>
                          <th className="px-3 py-3">Actividad</th>
                          <th className="px-3 py-3">Sección</th>
                          <th className="px-3 py-3">Departamento</th>
                          <th className="px-3 py-3">Subdepartamento</th>
                          <th className="w-14 px-3 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {ctbLineas.map((linea, index) => (
                          <tr key={linea.id ?? `${linea.descripcion}-${index}`} className="bg-white dark:bg-slate-950">
                            <td className="px-3 py-3 font-bold text-slate-500">{linea.posicion ?? index + 1}</td>
                            <td className="px-3 py-3">
                              <Input list="factura-cuentas-erp" className={detailTableInputClass} value={linea.descripcion ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateCtbLinea(index, 'descripcion', event.target.value)} />
                            </td>
                            <td className="px-3 py-3">
                              <Input className={detailTableInputClass} inputMode="decimal" value={numberInputValue(linea.importe)} disabled={isReadOnlyDetail} onChange={(event) => updateCtbLinea(index, 'importe', parseNumber(event.target.value) ?? 0)} />
                            </td>
                            {(['FRC_IdActividad', 'FRC_Idseccion', 'FRC_Iddepartamento', 'FRC_Idsubdepartamento'] as const).map((key) => (
                              <td className="px-3 py-3" key={key}>
                                <Input className={detailTableInputClass} inputMode="numeric" value={numberInputValue(linea[key])} disabled={isReadOnlyDetail} onChange={(event) => updateCtbLinea(index, key, parseNumber(event.target.value))} />
                              </td>
                            ))}
                            <td className="px-3 py-3 text-right">
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-700 disabled:opacity-40"
                                disabled={isReadOnlyDetail}
                                onClick={() => removeCtbLinea(index)}
                                aria-label="Eliminar línea CTB"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-md border border-dashed border-slate-200 px-3 py-3 text-sm font-semibold text-slate-500 dark:border-slate-800">
                    Sin distribución CTB. No se fabrican apuntes automáticamente.
                  </p>
                )}
              </FieldGroup>

              <FieldGroup title="Asiento contable (Debe / Haber)">
                <AsientoContableTable
                  lines={asientoLineas}
                  status={draft.asiento_estado}
                  error={draft.accounting?.error}
                />
              </FieldGroup>

              <FieldGroup title="Pagos">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <Field label="Forma de pago">
                    <Input className={detailInputClass} value={draft.forma_pago ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('forma_pago', event.target.value)} />
                  </Field>
                  <Field label="Cta. Cartera">
                    <Input className={detailInputClass} value={draft.cta_cartera ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('cta_cartera', event.target.value)} />
                  </Field>
                  <Field label="Banco">
                    <Input className={detailInputClass} value={draft.banco ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('banco', event.target.value)} />
                  </Field>
                  <Field label="Tipo doc">
                    <Input className={detailInputClass} value={draft.tipo_doc ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('tipo_doc', event.target.value)} />
                  </Field>
                  <Field label="Contabilizar">
                    <FilterSelect
                      value={draft.contabilizar === 'N' ? 'N' : 'S'}
                      options={yesNoOptions}
                      onChange={(value) => updateDraft('contabilizar', value)}
                      ariaLabel="Contabilizar"
                      disabled={isReadOnlyDetail}
                      triggerClassName={detailInputClass}
                    />
                  </Field>
                  <Field label="Genera cartera S/N">
                    <FilterSelect
                      value={draft.genera_cartera === 'S' ? 'S' : 'N'}
                      options={yesNoOptions}
                      onChange={(value) => updateDraft('genera_cartera', value)}
                      ariaLabel="Genera cartera"
                      disabled={isReadOnlyDetail}
                      triggerClassName={detailInputClass}
                    />
                  </Field>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                    Diferencia de vencimientos: {formatMoney(vencimientosDifference)}
                  </p>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                    disabled={isReadOnlyDetail}
                    onClick={assignTotalToFirstVencimiento}
                  >
                    Asignar total al primer vencimiento
                  </button>
                </div>
                <div className="mt-4 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                        <th className="w-14 px-3 py-3">#</th>
                        <th className="px-3 py-3">Fecha vencimiento</th>
                        <th className="px-3 py-3">Importe</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {vencimientos.map((vencimiento) => (
                        <tr key={vencimiento.posicion} className="bg-white dark:bg-slate-950">
                          <td className="px-3 py-3 font-bold text-slate-500">{vencimiento.posicion}</td>
                          <td className="px-3 py-3">
                            <Input className={detailTableInputClass} type="date" value={vencimiento.fecha ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateVencimiento(vencimiento.posicion, 'fecha', event.target.value || null)} />
                          </td>
                          <td className="px-3 py-3">
                            <Input className={detailTableInputClass} inputMode="decimal" value={numberInputValue(vencimiento.importe)} disabled={isReadOnlyDetail} onChange={(event) => updateVencimiento(vencimiento.posicion, 'importe', parseNumber(event.target.value))} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50 font-bold dark:border-slate-800 dark:bg-slate-900">
                        <td className="px-3 py-3" colSpan={2}>
                          Vencimientos {Math.abs(vencimientosDifference) <= ACCOUNTING_AMOUNT_TOLERANCE ? 'cuadrados' : `difieren en ${formatMoney(Math.abs(vencimientosDifference))}`}
                        </td>
                        <td className="px-3 py-3">{formatMoney(vencimientosTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </FieldGroup>

            </div>
            <datalist id="factura-cuentas-erp">
              {cuentas.map((cuenta) => (
                <option key={cuenta.value} value={cuenta.value}>
                  {cuenta.label}
                </option>
              ))}
            </datalist>
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
