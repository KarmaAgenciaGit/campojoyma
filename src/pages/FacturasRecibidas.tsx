import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Database,
  Edit,
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
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { FilterSelect, type FilterSelectOption } from '../components/FilterSelect';
import { AcreedorCombobox } from '../components/AcreedorCombobox';
import { CuentaContableCombobox } from '../components/CuentaContableCombobox';
import { FacturaAsientoViewer } from '../components/facturas/FacturaAsientoViewer';
import { FacturaIssuesOverlay } from '../components/facturas/FacturaIssuesOverlay';
import { FacturaPunteosTable } from '../components/facturas/FacturaPunteosTable';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { PdfViewer } from '../components/PdfViewer';
import {
  getFacturaERPAlreadyRegisteredNotice,
  getFacturaERPListPresentation,
  isFacturaERPDuplicateIssue,
} from '../lib/facturasDuplicate';
import { calculateFacturaIvaCuota, isFacturaIvaCuotaOutdated } from '../lib/facturasIva';
import {
  facturaERPRegistrationLabels,
  getFacturaERPRegistrationState,
  invalidateFacturaERPValidation,
  isFacturaERPLegacyUnscopedError,
  requireFacturaERPCommitRequestId,
  type FacturaERPRegistrationState,
} from '../lib/facturasErpStatus';
import { sanitizeUserFacingErrorMessage } from '../lib/userFacingErrors';
import {
  type LocalizarProveedorResponse,
  type FacturaERPDuplicateCandidate,
  type FacturaProveedorERPDetail,
  type FacturaRegimenOption,
  type FacturaTipoIvaOption,
  accountFacturaRecibidaERP,
  fetchAlbaranEntradaLineas,
  fetchAlbaranMaterialLineas,
  fetchFacturaPunteables,
  fetchFacturaPunteosLive,
  fetchFacturaProveedorERPDetail,
  fetchFacturaRecibidaById,
  fetchFacturaRegimenes,
  fetchFacturaTiposIva,
  fetchFacturasRecibidasERPRuntime,
  fetchFacturasRecibidasPage,
  facturaProveedorERPKind,
  getFacturaAccountingActionRequestId,
  getFacturaERPReconciliationRequestId,
  getFacturaERPSendConfirmation,
  getVerifiedERPDuplicateId,
  getFacturaPdfSignedUrl,
  getPunteoImporte,
  extractFacturaFromPdf,
  isERPReadOnlyFactura,
  isFacturaAccountingActionable,
  isRetryableFacturaERPReadError,
  localizarProveedorERP,
  normalizeFacturaValidationIssues,
  partitionFacturaValidationIssues,
  preflightFacturaRecibidaERP,
  saveFacturaRecibida,
  sendFacturaRecibidaToERP,
  shouldStartFacturaAccountingAfterManagement,
  validateFacturaRecibidaERP,
  tipoFacturaRadioValue,
  type FacturasRecibidasERPRuntime,
} from '../services/facturas';
import type {
  FacturaRecibida,
  FacturaRecibidaIvaTramo,
  FacturaRecibidaLinea,
  FacturaRecibidaPunteo,
  FacturaValidationIssue,
  FacturaRecibidaVencimiento,
} from '../services/apiContracts';
import type { AgroIrisAcreedor } from '../services/agroirisAcreedores';
import { useConfirmacion } from '../hooks/useConfirmacion';
import { useToast } from '../hooks/use-toast';
import { useFacturaCuentasGastoHistoricas } from '../hooks/useFacturaCuentasGastoHistoricas';
import {
  buildFacturaRecibidaDetailPath,
  ROUTE_BASES,
} from '../utils/entityRoutes';
import {
  aplicarPlantillaIvaHistorica,
  calcularSugerencias,
  construirConceptoFactura,
  describirSugerencia,
  obtenerHistorialProveedor,
  obtenerPerfilesIvaRegimen,
  type FacturaHistorica,
  type Sugerencia,
} from '../services/facturasRecibidasHistorial';
import {
  facturasRecibidasErpRules,
  type FacturaPunteoDifferencePolicy,
} from '../services/facturasRecibidasErpRules';

type FacturaDraft = Partial<FacturaRecibida>;
type FacturaEditorBaseline = {
  draft: FacturaDraft;
  lineas: FacturaRecibidaLinea[];
  snapshot: string;
};
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
type FacturaUploadStep = 'idle' | 'uploading' | 'analyzing' | 'done';
type FacturaCatalogKey = 'regimenes' | 'tipos_iva';
type FacturaCatalogErrors = Partial<Record<FacturaCatalogKey, string>>;

const PAGE_SIZE_OPTIONS = ['25', '50', '100'];
const DEFAULT_PAGE_SIZE = 25;
const MAX_FACTURA_PDF_BYTES = 20 * 1024 * 1024;
const FACTURA_CATALOG_KEYS: FacturaCatalogKey[] = ['regimenes', 'tipos_iva'];
const FACTURA_CATALOG_LABELS: Record<FacturaCatalogKey, string> = {
  regimenes: 'Regímenes de IVA',
  tipos_iva: 'Tipos de IVA',
};
const FACTURA_CATALOG_UNAVAILABLE_MESSAGE =
  'No se ha podido conectar con el ERP. Algunas opciones pueden no estar disponibles temporalmente. Vuelve a intentarlo.';
const FACTURA_CATALOG_RETRY_DELAY_MS = 350;
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
  { value: 'enviada_erp', label: 'Confirmado' },
  { value: 'no_enviada_erp', label: 'No confirmado' },
];

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
  fecha_ctb_source: 'invoice_date',
  tipo_iva_codigo: '',
  asiento: null,
  asiento_tecnico: null,
  asiento_numero: null,
  asiento_fecha: null,
  asiento_estado: 'not_requested',
  asiento_lineas: [],
  fr_alm: '',
  fr_sufa: 'OT',
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
  cuota_no_deducible: 0,
  cuenta_suplido: '',
  importe_suplido: 0,
  total: null,
  asunto_email: '',
  concepto_asiento: '',
  obs_aeat: '',
  observaciones: '',
  contabilizar: 'N',
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

const hasMeaningfulERPValue = (value: string | null | undefined) => {
  const cleaned = cleanOptionalString(value);
  return cleaned !== null && cleaned !== '0';
};

const isERPPlaceholderDate = (value: string | null | undefined) => {
  const cleaned = cleanOptionalString(value);
  return cleaned === '1900-01-01' || cleaned === '0000-00-00';
};

const punteoERPIdentity = (punteo: FacturaRecibidaPunteo) =>
  `${punteo.source_table ?? ''}:${punteo.source_id ?? punteo.remote_id ?? punteo.id ?? punteo.posicion}`;

const getErrorMessage = (error: unknown, fallback: string) => {
  let message: string | null = null;
  if (error instanceof Error && cleanOptionalString(error.message)) {
    message = error.message;
  } else if (typeof error === 'string' && cleanOptionalString(error)) {
    message = error;
  } else if (error && typeof error === 'object') {
    const source = error as Record<string, unknown>;
    const parts = [source.message, source.details, source.hint]
      .map((value) => (typeof value === 'string' ? cleanOptionalString(value) : null))
      .filter((value): value is string => Boolean(value));
    if (parts.length > 0) {
      message = parts.join(' ');
    }
  }
  return sanitizeUserFacingErrorMessage(message ?? fallback);
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

  const response = await localizarProveedorERP({
    nif,
    nombre,
    tipoFactura: factura.fr_sufa,
    matchEvidence: factura.match_evidence,
    expectedProviderId: factura.proveedor_codigo,
  });
  const match = extractProveedorLookupMatch(response);
  const datos = response.erp_response?.datos;

  return {
    factura: match ? applyProveedorLookupMatch(factura, match) : factura,
    match,
    message: typeof datos === 'string' ? datos : match ? 'Proveedor localizado.' : 'Proveedor no localizado.',
    response,
  };
};

const proveedorIdFromDraft = (factura: FacturaDraft | null | undefined) => {
  const parsed = Number(factura?.proveedor_codigo ?? '');
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const proveedorDraftFromERPOption = (proveedor: AgroIrisAcreedor | null): Pick<
  FacturaDraft,
  'proveedor_codigo' | 'proveedor_nombre' | 'proveedor_nif' | 'proveedor_cuenta'
> => {
  if (!proveedor) {
    return {
      proveedor_codigo: '',
      proveedor_nombre: '',
      proveedor_nif: '',
      proveedor_cuenta: '',
    };
  }

  return {
    proveedor_codigo: String(proveedor.acreedorid),
    proveedor_nombre:
      cleanOptionalString(proveedor.nombre_comercial) ?? cleanOptionalString(proveedor.nombre_sujeto) ?? null,
    proveedor_nif: cleanOptionalString(proveedor.identificador_fiscal),
    proveedor_cuenta: cleanOptionalString(proveedor.cuenta_contable ?? proveedor.referencia),
  };
};

export const applyProveedorERPDetail = (
  factura: FacturaDraft,
  proveedor: FacturaProveedorERPDetail,
): FacturaDraft => {
  const generaCartera =
    (cleanOptionalString(factura.genera_cartera) ?? 'N').toUpperCase() === 'S';

  return {
    ...factura,
    proveedor_codigo: String(proveedor.codigo),
    proveedor_nombre: proveedor.nombre,
    proveedor_nif: proveedor.nif,
    proveedor_cuenta: proveedor.cuenta,
    // Los datos de pago del maestro solo forman parte de la factura cuando se
    // solicita cartera. Con Genera cartera = No deben permanecer vacios para
    // que el perfil contable TEST no reciba una cartera contradictoria.
    cta_cartera: generaCartera ? proveedor.cuentaCartera : null,
    forma_pago:
      generaCartera && proveedor.formaPagoId !== null
        ? String(proveedor.formaPagoId)
        : null,
    banco:
      generaCartera && proveedor.bancoId !== null
        ? String(proveedor.bancoId)
        : null,
  };
};

const facturaProviderScopeKey = (factura: FacturaDraft | null | undefined) =>
  [
    factura?.id ?? 'new',
    cleanOptionalString(factura?.fr_alm) ?? 'sin-empresa',
    facturaProveedorERPKind(
      factura?.fr_sufa,
      factura?.match_evidence,
      factura?.proveedor_codigo,
    ),
    cleanOptionalString(factura?.proveedor_codigo) ?? 'sin-proveedor',
  ].join(':');

const erpStatusMeta = (state: FacturaERPRegistrationState) => ({
  text: facturaERPRegistrationLabels[state],
  className:
    state === 'confirmed' || state === 'registered'
      ? 'text-emerald-700 dark:text-emerald-300'
      : state === 'error'
        ? 'text-red-700 dark:text-red-300'
        : state === 'stale_reference'
          ? 'text-orange-700 dark:text-orange-300'
          : state === 'sending' || state === 'uncertain'
            ? 'text-slate-600 dark:text-slate-300'
            : state === 'validated'
              ? 'text-blue-700 dark:text-blue-300'
              : 'text-amber-700 dark:text-amber-300',
});

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

const buildIvaOptions = (
  tipos: FacturaTipoIvaOption[],
  currentValue?: number | null,
): FilterSelectOption[] => {
  const options: FilterSelectOption[] = tipos.map(({ value, label }) => ({
    value,
    label,
  }));
  const current =
    currentValue === null ||
    currentValue === undefined ||
    !Number.isFinite(Number(currentValue))
      ? null
      : Number(currentValue);
  if (current !== null) {
    const value = String(current);
    if (!options.some((option) => Number(option.value) === current)) {
      options.unshift({
        value,
        label: `${current.toLocaleString('es-ES')} % — Valor histórico`,
      });
    }
  } else {
    options.unshift({ value: '', label: 'Sin indicar' });
  }
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
      fecha_ctb_source: factura?.fecha_ctb_source ?? null,
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
      cuota_no_deducible: factura?.cuota_no_deducible ?? null,
      cuenta_suplido: factura?.cuenta_suplido ?? null,
      importe_suplido: factura?.importe_suplido ?? null,
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
  onOpen: (factura: FacturaRecibida) => Promise<void> | void;
};

function FacturaListItem({
  factura,
  isSelected,
  onOpen,
}: FacturaListItemProps) {
  const lineCount = factura.facturas_recibidas_lineas?.length ?? 0;
  const validation = partitionFacturaValidationIssues(factura.validation_errors);
  const listPresentation = getFacturaERPListPresentation(
    getFacturaERPRegistrationState(factura),
    validation.issues,
  );
  const invoiceErpState = listPresentation.registrationState;
  const isDuplicateERP = Boolean(listPresentation.alreadyRegisteredNotice);
  const invoiceStatus = isDuplicateERP
    ? {
        text: 'Duplicada',
        className: 'text-amber-700 dark:text-amber-300',
      }
    : erpStatusMeta(invoiceErpState);
  const isSent =
    !isDuplicateERP &&
    (invoiceErpState === 'confirmed' || invoiceErpState === 'registered');
  const invoiceStatusDotClass =
    isDuplicateERP
      ? 'bg-amber-500'
      : invoiceErpState === 'confirmed' || invoiceErpState === 'registered'
      ? 'bg-emerald-500'
      : invoiceErpState === 'error'
        ? 'bg-red-500'
        : invoiceErpState === 'stale_reference'
          ? 'bg-orange-500'
          : invoiceErpState === 'validated'
            ? 'bg-blue-500'
            : invoiceErpState === 'sending' ||
                invoiceErpState === 'uncertain'
              ? 'bg-slate-400'
              : 'bg-amber-500';
  const hasErrors = Boolean(
    listPresentation.operationalIssues.some((issue) => issue.severity === 'error') ||
    (factura.erp_error && !isFacturaERPLegacyUnscopedError(factura)),
  );
  const hasWarnings = listPresentation.operationalIssues.some(
    (issue) => issue.severity === 'warning',
  );

  return (
    <article
      className={`group relative rounded-md border transition-colors ${
        isDuplicateERP
          ? isSelected
            ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-200 dark:border-amber-700 dark:bg-amber-950/30 dark:ring-amber-900'
            : 'border-amber-300 bg-amber-50/70 hover:border-amber-400 dark:border-amber-800 dark:bg-amber-950/20 dark:hover:border-amber-700'
          : isSent
          ? isSelected
            ? 'border-primary/50 bg-primary/10 ring-1 ring-primary/20 dark:border-primary/60 dark:bg-primary/15'
            : 'border-primary/25 bg-primary/[0.07] hover:border-primary/40 dark:border-primary/35 dark:bg-primary/10 dark:hover:border-primary/50'
          : isSelected
            ? 'border-primary/45 bg-background ring-1 ring-primary/15 dark:border-primary/60 dark:bg-slate-950/60'
            : 'border-slate-200 bg-background hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-slate-700'
      }`}
    >
      <button
        type="button"
        className={`grid w-full min-w-0 grid-cols-1 gap-4 rounded-md px-4 py-4 text-left outline-none transition-[background-color,padding] duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 md:grid-cols-[minmax(0,1fr)_7.5rem] md:items-center ${
          isDuplicateERP
            ? 'hover:bg-amber-100/60 dark:hover:bg-amber-950/35'
            : isSent
            ? 'hover:bg-primary/10 dark:hover:bg-primary/15'
            : 'hover:bg-slate-50/70 dark:hover:bg-slate-900/50'
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
                Con errores
              </span>
            ) : hasWarnings ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
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

        <div
          className={`min-w-0 md:border-l md:pl-5 md:text-right ${
            isDuplicateERP
              ? 'md:border-amber-200 dark:md:border-amber-800'
              : isSent
              ? 'md:border-primary/20 dark:md:border-primary/30'
              : 'md:border-slate-200 dark:md:border-slate-800'
          }`}
        >
          <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Total
          </span>
          <span className="mt-1 block whitespace-nowrap text-lg font-bold tabular-nums text-slate-950 dark:text-slate-50">
            {formatMoney(factura.total)}
          </span>
        </div>
      </button>
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

function SugerenciaHistorial({
  sugerencia,
  actual,
  disabled,
  onAplicar,
  formatValor = (valor) => String(valor),
}: {
  sugerencia: Sugerencia<string | number>;
  actual: string | null | undefined;
  disabled?: boolean;
  onAplicar: (valor: string) => void;
  formatValor?: (valor: string | number) => string;
}) {
  // Solo evidencia medida: sin historico no se muestra nada, y nunca se auto-aplica.
  if (sugerencia.valor === null || sugerencia.criterio === 'sin_historial') return null;
  const valorSugerido = String(sugerencia.valor);
  if (cleanOptionalString(actual) === valorSugerido) return null;
  const descripcion = describirSugerencia(sugerencia);

  return (
    <p
      className={`mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium ${
        sugerencia.ambigua ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'
      }`}
    >
      <span>
        Histórico ERP: <span className="font-semibold">{formatValor(sugerencia.valor)}</span>
        {descripcion ? ` — ${descripcion}` : ''}
      </span>
      {disabled ? null : (
        <button
          type="button"
          className="font-semibold text-primary underline-offset-2 hover:underline"
          onClick={() => onAplicar(valorSugerido)}
        >
          Aplicar
        </button>
      )}
    </p>
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
  const [regimenes, setRegimenes] = useState<FacturaRegimenOption[]>([]);
  const [tiposIva, setTiposIva] = useState<FacturaTipoIvaOption[]>([
    {
      value: '0',
      porcentaje: 0,
      label: '0 % — Sin IVA',
      nombre: 'Sin IVA',
    },
  ]);
  const [historialProveedor, setHistorialProveedor] = useState<FacturaHistorica[]>([]);
  const historialRunRef = useRef(0);
  const regimenIvaRunRef = useRef(0);
  const { confirmar, dialogo: dialogoConfirmacion } = useConfirmacion();
  const { toast } = useToast();
  const [catalogErrors, setCatalogErrors] = useState<FacturaCatalogErrors>({});
  const [catalogLoading, setCatalogLoading] = useState(false);
  const catalogLoadRunRef = useRef(0);
  const failedCatalogKeys = useMemo(
    () => FACTURA_CATALOG_KEYS.filter((key) => Boolean(catalogErrors[key])),
    [catalogErrors],
  );
  const catalogError = failedCatalogKeys.length > 0
    ? FACTURA_CATALOG_UNAVAILABLE_MESSAGE
    : null;
  const catalogErrorTitle = 'Conexión con el ERP';
  const [punteoDifferencePolicy, setPunteoDifferencePolicy] =
    useState<FacturaPunteoDifferencePolicy>('warning');
  const [punteosLoading, setPunteosLoading] = useState(false);
  const [punteoReferencesLoading, setPunteoReferencesLoading] = useState(false);
  const [punteosLoadError, setPunteosLoadError] = useState<string | null>(null);
  const [preflightIssues, setPreflightIssues] = useState<FacturaValidationIssue[]>([]);
  const [duplicateCandidate, setDuplicateCandidate] = useState<FacturaERPDuplicateCandidate | null>(null);
  const [lastSavedEditorSnapshot, setLastSavedEditorSnapshot] = useState<string | null>(null);
  const [isEditingDetail, setIsEditingDetail] = useState(false);
  const detailEditBaselineRef = useRef<FacturaEditorBaseline | null>(null);
  const [loadedDetailId, setLoadedDetailId] = useState<string | null>(null);
  const providerDetailRunRef = useRef(0);
  const punteablesRunRef = useRef(0);
  const punteoReferencesRunRef = useRef(0);
  const activeProviderScopeRef = useRef('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [accountingERP, setAccountingERP] = useState(false);
  const [extractingIa, setExtractingIa] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [facturaUploadStep, setFacturaUploadStep] = useState<FacturaUploadStep>('idle');
  const [modalMessage, setModalMessage] = useState<ModalMessage | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showAccountingBreakdown, setShowAccountingBreakdown] = useState(false);
  const [revealedEmptyGastoIndexes, setRevealedEmptyGastoIndexes] = useState<number[]>([]);
  const [erpRuntime, setErpRuntime] =
    useState<FacturasRecibidasERPRuntime | null>(null);
  const [erpRuntimeChecked, setErpRuntimeChecked] = useState(false);
  const canValidateWithERP =
    erpRuntime?.capabilities.validate === true;
  const canCommitManagement =
    erpRuntime?.write_mode === 'management' &&
    erpRuntime.ready_for_commit === true &&
    erpRuntime.capabilities.management_commit === true;
  const canCommitAccounting =
    erpRuntime?.accounting_ready_for_commit === true &&
    erpRuntime.capabilities.accounting_commit === true;

  const isNewFacturaDraft = Boolean(draft && !draft.id);
  const isDetailMode = Boolean(draft?.id && !modalOpen);
  const providerKind = facturaProveedorERPKind(
    draft?.fr_sufa,
    draft?.match_evidence,
    draft?.proveedor_codigo,
  );
  const resolvedTipoFactura = tipoFacturaRadioValue(
    draft?.fr_sufa,
    draft?.match_evidence,
    draft?.proveedor_codigo,
  );
  const historicalProviderKind =
    resolvedTipoFactura === 'GE'
      ? 'agricultor'
      : resolvedTipoFactura === 'OT'
        ? 'acreedor'
        : null;
  const activeDraftId = draft?.id ?? null;
  const accountingBreakdownScope = draft?.id ?? (draft ? 'new' : 'none');
  const activeRemoteFacturaId = (() => {
    const parsed = Number(draft?.remote_frr_id ?? draft?.erp_factura_id ?? 0);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  })();
  const activePdfPath = draft?.pdf_path ?? null;
  const currentEditorSnapshot = useMemo(() => createEditorSnapshot(draft, lineas), [draft, lineas]);
  const hasUnsavedDetailChanges = Boolean(
    isEditingDetail &&
      isDetailMode &&
      lastSavedEditorSnapshot &&
      currentEditorSnapshot !== lastSavedEditorSnapshot,
  );
  const visibleIssues = useMemo(
    () => normalizeFacturaValidationIssues([...(draft?.validation_errors ?? []), ...preflightIssues]),
    [draft?.validation_errors, preflightIssues],
  );
  const duplicateNoticeIssues = hasUnsavedDetailChanges
    ? preflightIssues
    : visibleIssues;
  const erpAlreadyRegisteredNotice = getFacturaERPAlreadyRegisteredNotice(
    duplicateNoticeIssues,
    duplicateCandidate,
  );
  const visibleOperationalIssues = visibleIssues.filter(
    (issue) => !isFacturaERPDuplicateIssue(issue),
  );
  const visibleErrors = visibleOperationalIssues.filter((issue) => issue.severity === 'error');
  const visibleWarnings = visibleOperationalIssues.filter((issue) => issue.severity === 'warning');
  const pageSizeOptions = PAGE_SIZE_OPTIONS.map((option) => ({ value: option, label: `${option} por pagina` }));
  const regimenOptions = useMemo(
    () => buildRegimenOptions(regimenes, draft?.tipo_iva_codigo),
    [draft?.tipo_iva_codigo, regimenes],
  );

  // Historico ERP del proveedor para sugerir tipo y regimen con confianza medida.
  // Se carga una vez por proveedor; el calculo por IVA es local y no vuelve a llamar.
  const proveedorErpId = useMemo(() => {
    const parsed = Number.parseInt(cleanOptionalString(draft?.proveedor_codigo) ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [draft?.proveedor_codigo]);
  const detailIsReadOnly = isERPReadOnlyFactura(draft);
  const canEditDraft = !detailIsReadOnly && (!isDetailMode || isEditingDetail);
  const pendingEntryReferenceIdentities = useMemo(
    () =>
      (draft?.punteos ?? [])
        .filter((punteo) => {
          const sourceTable = punteo.source_table?.trim().toLowerCase();
          return (
            ['albentrada', 'albentrada_his', 'albentrada_hisgastos'].includes(sourceTable ?? '') &&
            !punteo.albaran_id
          );
        })
        .map(punteoERPIdentity),
    [draft?.punteos],
  );
  const empresaId = useMemo(() => {
    const parsed = Number(draft?.fr_alm ?? '');
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [draft?.fr_alm]);
  const { items: cuentasGastoHistoricas } =
    useFacturaCuentasGastoHistoricas({
      empresaId,
      proveedorId: proveedorErpId,
      proveedorTipo: historicalProviderKind,
      enabled:
        Boolean(draft) &&
        canEditDraft &&
        historicalProviderKind !== null,
    });

  useEffect(() => {
    const runId = historialRunRef.current + 1;
    historialRunRef.current = runId;
    setHistorialProveedor([]);
    if (!proveedorErpId || !canEditDraft) return;
    obtenerHistorialProveedor(proveedorErpId)
      .then((historial) => {
        if (historialRunRef.current !== runId) return;
        setHistorialProveedor(historial);
      })
      .catch(() => {
        // Sin historico no hay sugerencias; la edicion manual sigue disponible.
        if (historialRunRef.current !== runId) return;
        setHistorialProveedor([]);
      });
  }, [proveedorErpId, canEditDraft]);

  const sugerenciasHistorial = useMemo(
    () => calcularSugerencias(historialProveedor, { iva1: draft?.iva_porcentaje ?? null }),
    [historialProveedor, draft?.iva_porcentaje],
  );

  // Cambiar de factura invalida cualquier sugerencia asíncrona anterior.
  useEffect(() => {
    regimenIvaRunRef.current += 1;
  }, [draft?.id]);

  const currentProviderScopeKey = facturaProviderScopeKey(draft);

  useEffect(() => {
    if (
      activeProviderScopeRef.current &&
      activeProviderScopeRef.current !== currentProviderScopeKey
    ) {
      providerDetailRunRef.current += 1;
      punteablesRunRef.current += 1;
      setPunteosLoading(false);
    }
    activeProviderScopeRef.current = currentProviderScopeKey;
  }, [currentProviderScopeKey]);

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
      setPreflightIssues([]);
      setDuplicateCandidate(null);
      setDraft((current) =>
        current ? invalidateFacturaERPValidation(current) : current,
      );
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
    setRevealedEmptyGastoIndexes([]);
  }, [accountingBreakdownScope]);

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
    } catch (error) {
      setLoadError(getErrorMessage(error, 'No se pudieron cargar las facturas.'));
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
    setErpRuntimeChecked(false);
    void fetchFacturasRecibidasERPRuntime()
      .then((runtime) => {
        if (active) setErpRuntime(runtime);
      })
      .catch(() => {
        if (active) setErpRuntime(null);
      })
      .finally(() => {
        if (active) setErpRuntimeChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const loadCatalogs = useCallback(async (
    requestedCatalogs: FacturaCatalogKey[] = FACTURA_CATALOG_KEYS,
  ) => {
    if (requestedCatalogs.length === 0) return;
    const runId = ++catalogLoadRunRef.current;
    setCatalogLoading(true);
    setCatalogErrors((current) => {
      const next = { ...current };
      requestedCatalogs.forEach((key) => delete next[key]);
      return next;
    });

    const results = await Promise.allSettled(
      requestedCatalogs.map(async (key) => {
        const request = () =>
          key === 'regimenes' ? fetchFacturaRegimenes() : fetchFacturaTiposIva();
        try {
          return await request();
        } catch (error) {
          if (!isRetryableFacturaERPReadError(error)) throw error;
          await new Promise((resolve) => window.setTimeout(resolve, FACTURA_CATALOG_RETRY_DELAY_MS));
          return request();
        }
      }),
    );
    if (catalogLoadRunRef.current !== runId) return;

    const failures: FacturaCatalogErrors = {};
    results.forEach((result, index) => {
      const key = requestedCatalogs[index];
      if (result.status === 'rejected') {
        failures[key] = `${FACTURA_CATALOG_LABELS[key]}: ${getErrorMessage(
          result.reason,
          'catálogo no disponible.',
        )}`;
        return;
      }
      if (key === 'regimenes') {
        setRegimenes(result.value as FacturaRegimenOption[]);
      } else {
        setTiposIva(result.value as FacturaTipoIvaOption[]);
      }
    });
    setCatalogErrors((current) => ({ ...current, ...failures }));
    setCatalogLoading(false);
  }, []);

  useEffect(() => {
    void loadCatalogs();
    return () => {
      catalogLoadRunRef.current += 1;
    };
  }, [loadCatalogs]);

  useEffect(() => {
    let active = true;
    setPunteoDifferencePolicy('warning');
    if (!empresaId || detailIsReadOnly) return;
    void facturasRecibidasErpRules
      .resolve(empresaId, proveedorErpId)
      .then((rule) => {
        if (active) {
          setPunteoDifferencePolicy(rule.punteo_difference_policy);
        }
      })
      .catch(() => {
        if (active) setPunteoDifferencePolicy('warning');
      });
    return () => {
      active = false;
    };
  }, [detailIsReadOnly, empresaId, proveedorErpId]);

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
        setIsEditingDetail(false);
        detailEditBaselineRef.current = null;
        setLoadedDetailId(null);
        setPdfFile(null);
        setPdfUrl(null);
        setFacturaUploadStep('idle');
        setModalMessage(null);
        setPreflightIssues([]);
        setDuplicateCandidate(null);
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
      setIsEditingDetail(false);
      detailEditBaselineRef.current = null;
      setLoadedDetailId(facturaToOpen.id);
      setPdfFile(null);
      setPdfUrl(null);
      setFacturaUploadStep('idle');
      setModalMessage(null);
      setPreflightIssues([]);
      setDuplicateCandidate(null);
      setModalOpen(false);
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    };

    const factura = facturas.find((item) => item.id === facturaId);
    if (draft?.id === facturaId && loadedDetailId === facturaId) {
      return;
    }

    setLoadError(null);

    if (!factura || isERPReadOnlyFactura(factura)) {
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
            setLoadError(getErrorMessage(error, 'No se pudo abrir la factura.'));
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

  const loadPunteoReferences = useCallback(async () => {
    if (!activeDraftId || !activeRemoteFacturaId || pendingEntryReferenceIdentities.length === 0) {
      return;
    }
    const runId = punteoReferencesRunRef.current + 1;
    punteoReferencesRunRef.current = runId;
    const facturaId = activeDraftId;
    const pendingIdentities = new Set(pendingEntryReferenceIdentities);
    setPunteoReferencesLoading(true);
    setPunteosLoadError(null);

    try {
      const livePunteos = await fetchFacturaPunteosLive(activeRemoteFacturaId);
      if (punteoReferencesRunRef.current !== runId) return;
      const liveByIdentity = new Map(
        livePunteos.map((punteo) => [punteoERPIdentity(punteo), punteo]),
      );
      const hasResolvedReference = [...pendingIdentities].some((identity) => {
        const albaranId = Number(liveByIdentity.get(identity)?.albaran_id);
        return Number.isInteger(albaranId) && albaranId > 0;
      });
      if (!hasResolvedReference) {
        throw new Error('El ERP no devolvió la referencia técnica de los albaranes vinculados.');
      }

      setDraft((current) => {
        if (!current || current.id !== facturaId) return current;
        return {
          ...current,
          punteos: (current.punteos ?? []).map((punteo) => {
            const identity = punteoERPIdentity(punteo);
            if (!pendingIdentities.has(identity)) return punteo;
            const live = liveByIdentity.get(identity);
            const albaranId = Number(live?.albaran_id);
            if (!Number.isInteger(albaranId) || albaranId < 1) return punteo;
            return {
              ...punteo,
              albaran_id: albaranId,
            };
          }),
        };
      });
    } catch (error) {
      if (punteoReferencesRunRef.current !== runId) return;
      setPunteosLoadError(
        getErrorMessage(error, 'No se pudieron recuperar las referencias ERP de los albaranes.'),
      );
    } finally {
      if (punteoReferencesRunRef.current === runId) {
        setPunteoReferencesLoading(false);
      }
    }
  }, [activeDraftId, activeRemoteFacturaId, pendingEntryReferenceIdentities]);

  useEffect(() => {
    if (!detailIsReadOnly || pendingEntryReferenceIdentities.length === 0) return;
    void loadPunteoReferences();
    return () => {
      punteoReferencesRunRef.current += 1;
      setPunteoReferencesLoading(false);
    };
  }, [detailIsReadOnly, loadPunteoReferences, pendingEntryReferenceIdentities.length]);

  useEffect(() => {
    document.body.classList.add('facturas-iberica-shell');

    return () => {
      document.body.classList.remove('facturas-iberica-shell');
    };
  }, []);

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
          setModalMessage({ type: 'error', text: getErrorMessage(error, 'No se pudo abrir el PDF.') });
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
  const detailActionMessage = isDetailMode ? modalMessage : null;
  const detailActionError = detailActionMessage?.type === 'error' ? detailActionMessage.text : null;
  const showSaveFeedback = Boolean(
    isDetailMode &&
      saveFeedback &&
      !hasUnsavedDetailChanges &&
      !saving &&
      !sending,
  );
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

  const beginDetailEditing = () => {
    if (!draft || !isDetailMode || detailIsReadOnly || saving || sending || accountingERP) {
      return;
    }

    detailEditBaselineRef.current = {
      draft: structuredClone(draft),
      lineas: structuredClone(lineas),
      snapshot: currentEditorSnapshot,
    };
    setLastSavedEditorSnapshot(currentEditorSnapshot);
    setIsEditingDetail(true);
    setSaveFeedback(null);
    setModalMessage(null);
    setPreflightIssues([]);
    setDuplicateCandidate(null);
    setPunteosLoadError(null);
  };

  const cancelDetailEditing = () => {
    if (!isEditingDetail || saving || sending || accountingERP) return;

    const baseline = detailEditBaselineRef.current;
    if (baseline) {
      setDraft(structuredClone(baseline.draft));
      setLineas(structuredClone(baseline.lineas));
      setLastSavedEditorSnapshot(baseline.snapshot);
    }
    setIsEditingDetail(false);
    detailEditBaselineRef.current = null;
    setSaveFeedback(null);
    setModalMessage(null);
    setPreflightIssues([]);
    setDuplicateCandidate(null);
    setPunteosLoadError(null);
    setRevealedEmptyGastoIndexes([]);
  };

  const openNewFactura = () => {
    setDraft(createEmptyDraft());
    setLineas(createEmptyGastos());
    setShowAccountingBreakdown(true);
    setLastSavedEditorSnapshot(null);
    setIsEditingDetail(false);
    detailEditBaselineRef.current = null;
    setLoadedDetailId(null);
    setPdfFile(null);
    setPdfUrl(null);
    setFacturaUploadStep('idle');
    setModalMessage(null);
    setPreflightIssues([]);
    setDuplicateCandidate(null);
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
    setIsEditingDetail(false);
    detailEditBaselineRef.current = null;
    setLoadedDetailId(null);
    setPdfFile(null);
    setPdfUrl(null);
    setFacturaUploadStep('idle');
    setModalMessage(null);
    setPreflightIssues([]);
    setDuplicateCandidate(null);
  };

  const openFactura = async (factura: FacturaRecibida) => {
    setLoadError(null);

    try {
      const detailedFactura = await fetchFacturaRecibidaById(factura.id);
      const facturaToOpen = detailedFactura ?? factura;
      const facturaLineas = getLineas(facturaToOpen);
      setDraft({ ...facturaToOpen });
      setLineas(facturaLineas);
      setLastSavedEditorSnapshot(createEditorSnapshot(facturaToOpen, facturaLineas));
      setIsEditingDetail(false);
      detailEditBaselineRef.current = null;
      setLoadedDetailId(facturaToOpen.id);
      setPdfFile(null);
      setPdfUrl(null);
      setModalMessage(null);
      setPreflightIssues([]);
      setDuplicateCandidate(null);
      setModalOpen(false);
      navigate(buildFacturaRecibidaDetailPath(encodeURIComponent(facturaToOpen.id)));
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    } catch (error) {
      setLoadError(getErrorMessage(error, 'No se pudo abrir la factura.'));
    }
  };

  const closeDetail = async () => {
    if (hasUnsavedDetailChanges && !saving) {
      const confirmed = await confirmar({
        titulo: 'Salir sin guardar',
        descripcion: 'Hay cambios sin guardar en esta factura. Si sales ahora se descartarán.',
        aceptar: 'Salir y descartar',
        cancelar: 'Seguir editando',
        destructivo: true,
      });
      if (!confirmed) return;
    }
    setDraft(null);
    setLineas(createEmptyGastos());
    setShowAccountingBreakdown(false);
    setLastSavedEditorSnapshot(null);
    setIsEditingDetail(false);
    detailEditBaselineRef.current = null;
    setLoadedDetailId(null);
    setPdfFile(null);
    setPdfUrl(null);
    setFacturaUploadStep('idle');
    setModalMessage(null);
    setPreflightIssues([]);
    setDuplicateCandidate(null);
    setModalOpen(false);
    navigate(ROUTE_BASES.facturasRecibidas);
  };

  const updateDraft = async <TKey extends keyof FacturaDraft>(key: TKey, value: FacturaDraft[TKey]) => {
    if (!canEditDraft) return;
    setPreflightIssues([]);
    setDuplicateCandidate(null);
    let clearPunteos = false;
    if (
      key === 'fr_alm' &&
      cleanOptionalString(String(draft?.fr_alm ?? '')) !== cleanOptionalString(String(value ?? '')) &&
      (draft?.punteos?.length ?? 0) > 0
    ) {
      const confirmed = await confirmar({
        titulo: 'Cambiar de empresa',
        descripcion: `Los ${draft?.punteos?.length ?? 0} punteos actuales pertenecen al ámbito de la empresa anterior. Si continúas se eliminarán y tendrás que cargar y seleccionar manualmente los del nuevo ámbito.`,
        aceptar: 'Cambiar y eliminar punteos',
        cancelar: 'Mantener la empresa',
        destructivo: true,
      });
      if (!confirmed) {
        toast({
          title: 'Cambio de empresa cancelado',
          description: 'Los punteos actuales se han conservado.',
        });
        return;
      }
      clearPunteos = true;
      toast({
        title: 'Punteos eliminados',
        description: 'Carga y selecciona los punteos correspondientes a la nueva empresa.',
      });
    }

    if (key === 'fr_alm' || key === 'proveedor_codigo') {
      const nextDraft = draft ? { ...draft, [key]: value } : null;
      providerDetailRunRef.current += 1;
      punteablesRunRef.current += 1;
      activeProviderScopeRef.current = facturaProviderScopeKey(nextDraft);
      setPunteosLoading(false);
      setPunteosLoadError(null);
    }

    setDraft((current) => {
      if (!current) return current;
      const next: FacturaDraft = {
        ...current,
        [key]: value,
        ...(clearPunteos ? { punteos: [] } : {}),
      };
      if (key === 'fecha_factura' && current.fecha_ctb_source !== 'manual') {
        next.fecha_ctb = String(value ?? '');
        next.fecha_ctb_source = 'invoice_date';
      }
      if (key === 'fecha_ctb') {
        next.fecha_ctb_source = 'manual';
      }
      return next;
    });
  };

  const changeRegimenIva = async (value: string) => {
    if (!canEditDraft) return;
    const runId = regimenIvaRunRef.current + 1;
    regimenIvaRunRef.current = runId;
    await updateDraft('tipo_iva_codigo', value);

    const regimenId = Number.parseInt(value, 10);
    if (!Number.isInteger(regimenId) || regimenId <= 0) {
      return;
    }

    try {
      const perfiles = await obtenerPerfilesIvaRegimen({ regimenId });
      if (regimenIvaRunRef.current !== runId) return;

      const perfilAplicable = perfiles.plantilla_sugerida ?? perfiles.perfil_mas_usado;
      if (perfilAplicable) {
        setDraft((current) => {
          if (!current || cleanOptionalString(current.tipo_iva_codigo) !== value) return current;
          const source = current.iva_tramos?.length
            ? current.iva_tramos
            : createEmptyDraft().iva_tramos ?? [];
          const resultado = aplicarPlantillaIvaHistorica(source, perfiles, {
            allowMostUsedProfile: true,
            replaceExistingPercentages: true,
          });
          return resultado.aplicada ? { ...current, iva_tramos: resultado.tramos } : current;
        });
      }
    } catch {
      // Si el histórico no está disponible, se conservan los valores actuales.
    }
  };

  const changeTipoFactura = async (nextTipo: 'GE' | 'OT') => {
    if (!canEditDraft) return;
    if (
      !draft ||
      tipoFacturaRadioValue(
        draft.fr_sufa,
        draft.match_evidence,
        draft.proveedor_codigo,
      ) === nextTipo
    ) {
      return;
    }

    const hasProviderIdentity = Boolean(
      cleanOptionalString(draft.proveedor_codigo) ||
      cleanOptionalString(draft.proveedor_nombre) ||
      cleanOptionalString(draft.proveedor_nif) ||
      cleanOptionalString(draft.proveedor_cuenta),
    );
    const hasDependentGastos = lineas.some(hasAccountingLineData);
    const dependentPunteos = draft.punteos?.length ?? 0;
    if (hasProviderIdentity || hasDependentGastos || dependentPunteos > 0) {
      const confirmed = await confirmar({
        titulo: 'Cambiar tipo de factura',
        descripcion:
          'Compras de Género usa el maestro de agricultores y Acreedores usa el maestro de acreedores. Para evitar mezclar dos registros con el mismo ID, se limpiarán el proveedor, sus datos contables, los gastos y los punteos actuales.',
        aceptar: 'Cambiar y limpiar datos',
        cancelar: 'Mantener el tipo actual',
        destructivo: true,
      });
      if (!confirmed) return;
    }

    providerDetailRunRef.current += 1;
    punteablesRunRef.current += 1;
    setPunteosLoading(false);
    setPunteosLoadError(null);
    setPreflightIssues([]);
    setDuplicateCandidate(null);
    setModalMessage(null);
    if (hasDependentGastos) setLineas(createEmptyGastos());
    setRevealedEmptyGastoIndexes([]);
    setDraft((current) => {
      if (!current) return current;
      const nextDraft = {
        ...current,
        fr_sufa: nextTipo,
        proveedor_codigo: '',
        proveedor_nombre: '',
        proveedor_nif: '',
        proveedor_cuenta: '',
        cta_cartera: null,
        forma_pago: null,
        banco: null,
        punteos: [],
        match_evidence: null,
      };
      activeProviderScopeRef.current = facturaProviderScopeKey(nextDraft);
      return nextDraft;
    });
  };

  const selectProveedorERP = async (proveedor: AgroIrisAcreedor | null) => {
    if (!canEditDraft) return;
    const providerLabel = providerKind === 'agricultor' ? 'proveedor' : 'acreedor';
    const previousProveedorId = proveedorIdFromDraft(draft);
    const nextProveedorId = proveedor?.acreedorid ?? null;
    const providerChanged = previousProveedorId !== nextProveedorId;
    const hasDependentGastos = lineas.some(hasAccountingLineData);
    const dependentPunteos = draft?.punteos?.length ?? 0;
    const hasDependentData = providerChanged && (hasDependentGastos || dependentPunteos > 0);

    if (hasDependentData) {
      const changeDescription =
        hasDependentGastos && dependentPunteos > 0
          ? `El desglose de gastos y los ${dependentPunteos} punteos seleccionados pertenecen al ${providerLabel} actual. Si cambias de ${providerLabel}, se eliminarán para evitar contabilizar la factura con información incorrecta. Después tendrás que seleccionar de nuevo los gastos y punteos correspondientes al nuevo ${providerLabel}.`
          : hasDependentGastos
            ? `El desglose de gastos pertenece al ${providerLabel} actual. Si cambias de ${providerLabel}, se eliminará junto con la cuenta de gasto asociada para evitar contabilizar la factura en una cuenta incorrecta. Después tendrás que seleccionar de nuevo los gastos correspondientes al nuevo ${providerLabel}.`
            : `${dependentPunteos === 1 ? 'El punteo seleccionado pertenece' : `Los ${dependentPunteos} punteos seleccionados pertenecen`} al ${providerLabel} actual. Si cambias de ${providerLabel}, se ${dependentPunteos === 1 ? 'eliminará' : 'eliminarán'} para evitar contabilizar la factura con información incorrecta. Después tendrás que seleccionar de nuevo los punteos correspondientes al nuevo ${providerLabel}.`;
      const confirmLabel =
        hasDependentGastos && dependentPunteos > 0
          ? 'Cambiar y borrar gastos y punteos'
          : hasDependentGastos
            ? 'Cambiar y borrar gastos'
            : 'Cambiar y borrar punteos';
      const confirmed = await confirmar({
        titulo: `Cambiar de ${providerLabel}`,
        descripcion: changeDescription,
        aceptar: confirmLabel,
        cancelar: `Mantener el ${providerLabel}`,
        destructivo: true,
      });
      if (!confirmed) {
        toast({
          title: `Cambio de ${providerLabel} cancelado`,
          description: 'Los gastos y punteos actuales se han conservado.',
        });
        return;
      }
    }

    setPreflightIssues([]);
    setDuplicateCandidate(null);
    const providerFields = {
      ...proveedorDraftFromERPOption(proveedor),
      cta_cartera: null,
      forma_pago: null,
      banco: null,
      ...(providerChanged ? { match_evidence: null } : {}),
    } satisfies FacturaDraft;
    const nextDraft = draft
      ? {
          ...draft,
          ...providerFields,
          ...(hasDependentData ? { punteos: [] } : {}),
        }
      : null;
    const scope = facturaProviderScopeKey(nextDraft);
    const runId = providerDetailRunRef.current + 1;
    providerDetailRunRef.current = runId;
    punteablesRunRef.current += 1;
    activeProviderScopeRef.current = scope;
    setPunteosLoading(false);
    setPunteosLoadError(null);
    setModalMessage(null);
    if (providerChanged) setRevealedEmptyGastoIndexes([]);
    setDraft((current) =>
      current
        ? {
            ...current,
            ...providerFields,
            ...(hasDependentData ? { punteos: [] } : {}),
          }
        : current,
    );

    if (hasDependentData) {
      if (hasDependentGastos) setLineas(createEmptyGastos());
      toast({
        title: `Datos del ${providerLabel} anterior eliminados`,
        description:
          hasDependentGastos && dependentPunteos > 0
            ? `Selecciona los gastos y punteos correspondientes al nuevo ${providerLabel}.`
            : hasDependentGastos
              ? `Selecciona los gastos correspondientes al nuevo ${providerLabel}.`
              : `Selecciona los punteos correspondientes al nuevo ${providerLabel}.`,
      });
    }

    if (!proveedor) return;

    try {
      const detail = await fetchFacturaProveedorERPDetail(
        proveedor.acreedorid,
        draft?.fr_sufa,
        draft?.match_evidence,
      );
      if (providerDetailRunRef.current !== runId || activeProviderScopeRef.current !== scope) return;
      if (!detail) {
        setModalMessage({
          type: 'error',
          text: `El ${providerLabel} ${proveedor.acreedorid} no existe en la API del ERP.`,
        });
        return;
      }
      if (detail.codigo !== proveedor.acreedorid) {
        setModalMessage({
          type: 'error',
          text: `La API devolvió el proveedor ${detail.codigo} al consultar ${proveedor.acreedorid}. Selecciona el ${providerLabel} de nuevo.`,
        });
        return;
      }

      setDraft((current) => {
        if (!current || facturaProviderScopeKey(current) !== scope || providerDetailRunRef.current !== runId) return current;
        return applyProveedorERPDetail(current, detail);
      });
      if (detail.cuentaGasto && (!hasDependentGastos || hasDependentData)) {
        setLineas((current) => {
          if (providerDetailRunRef.current !== runId || activeProviderScopeRef.current !== scope) return current;
          if (current.some(hasAccountingLineData)) return current;
          const targetIndex = current.findIndex((linea) => !cleanOptionalString(linea.descripcion));
          if (targetIndex < 0) return current;
          return current.map((linea, index) =>
            index === targetIndex ? { ...linea, descripcion: detail.cuentaGasto ?? '' } : linea,
          );
        });
      }
    } catch (error) {
      if (providerDetailRunRef.current !== runId || activeProviderScopeRef.current !== scope) return;
      setModalMessage({
        type: 'error',
        text: `No se pudo cargar el detalle del proveedor porque la API del ERP no esta disponible. ${getErrorMessage(error, '')}`.trim(),
      });
    }
  };

  const updateLinea = <TKey extends keyof FacturaRecibidaLinea>(
    index: number,
    key: TKey,
    value: FacturaRecibidaLinea[TKey],
  ) => {
    if (!canEditDraft) return;
    setLineas((current) =>
      current.map((linea, currentIndex) => (currentIndex === index ? { ...linea, [key]: value } : linea)),
    );
  };

  const updateIvaTramo = (
    posicion: FacturaRecibidaIvaTramo['posicion'],
    key: 'base' | 'porcentaje' | 'cuota',
    value: number | null,
  ) => {
    if (!canEditDraft) return;
    regimenIvaRunRef.current += 1;
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

  const calculateIvaCuota = (tramo: FacturaRecibidaIvaTramo) => {
    if (!canEditDraft) return;
    const cuota = calculateFacturaIvaCuota(tramo.base, tramo.porcentaje);
    if (cuota === null) return;
    updateIvaTramo(tramo.posicion, 'cuota', cuota);
  };

  const updateVencimiento = (
    posicion: FacturaRecibidaVencimiento['posicion'],
    key: 'fecha' | 'importe',
    value: string | number | null,
  ) => {
    if (!canEditDraft) return;
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
    if (!canEditDraft) return;
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
    if (!canEditDraft) return;
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
    if (!canEditDraft) return;
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

  const updatePunteoSelected = (identity: string, selected: boolean) => {
    if (!canEditDraft) return;
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        punteos: (current.punteos ?? []).map((punteo) =>
          punteoERPIdentity(punteo) === identity ? { ...punteo, seleccionado: selected } : punteo,
        ),
      };
    });
  };

  const loadPunteables = async () => {
    if (!canEditDraft) return;
    if (getVerifiedERPDuplicateId(draft) !== null) {
      setPunteosLoadError(null);
      return;
    }

    const empresaId = Number(draft?.fr_alm ?? '');
    const proveedorId = Number(draft?.proveedor_codigo ?? '');
    if (!Number.isFinite(empresaId) || empresaId < 1 || !Number.isFinite(proveedorId) || proveedorId < 1) {
      setPunteosLoadError('Selecciona empresa y acreedor antes de consultar punteables.');
      return;
    }

    const scope = facturaProviderScopeKey(draft);
    const runId = punteablesRunRef.current + 1;
    punteablesRunRef.current = runId;
    activeProviderScopeRef.current = scope;
    setPunteosLoading(true);
    setPunteosLoadError(null);
    try {
      const candidates = await fetchFacturaPunteables({
        empresaId: Math.trunc(empresaId),
        proveedorId: Math.trunc(proveedorId),
      });
      if (punteablesRunRef.current !== runId || activeProviderScopeRef.current !== scope) return;
      setDraft((current) => {
        if (!current || facturaProviderScopeKey(current) !== scope || punteablesRunRef.current !== runId) return current;
        const currentBySource = new Map(
          (current.punteos ?? []).map((punteo) => [
            punteoERPIdentity(punteo),
            punteo,
          ]),
        );
        return {
          ...current,
          punteos: candidates.map((candidate) => {
            const previous = currentBySource.get(punteoERPIdentity(candidate));
            return previous
              ? { ...candidate, seleccionado: previous.seleccionado }
              : candidate;
          }),
        };
      });
      if (candidates.length === 0 && punteablesRunRef.current === runId) {
        setPunteosLoadError('La API no devolvió albaranes o gastos punteables para esta factura.');
      }
    } catch (error) {
      if (punteablesRunRef.current !== runId || activeProviderScopeRef.current !== scope) return;
      setPunteosLoadError(getErrorMessage(error, 'No se pudieron cargar los punteables del ERP.'));
    } finally {
      if (punteablesRunRef.current === runId && activeProviderScopeRef.current === scope) {
        setPunteosLoading(false);
      }
    }
  };

  const removeLinea = (index: number) => {
    if (!canEditDraft) return;
    setLineas((current) =>
      current.map((linea, currentIndex) =>
        currentIndex === index ? createEmptyLinea(linea.posicion ?? currentIndex + 1) : linea,
      ),
    );
    setRevealedEmptyGastoIndexes((current) => current.filter((revealedIndex) => revealedIndex !== index));
  };

  const persistFactura = async (
    validar: boolean,
    facturaOverride?: FacturaDraft,
    providerPreflightVerified = false,
  ) => {
    const baseDraft = facturaOverride ?? draft;
    if (!baseDraft) {
      return null;
    }

    setSaving(true);
    setModalMessage(null);
    setSaveFeedback(null);

    try {
      const payload = {
        ...baseDraft,
        fr_sufa:
          tipoFacturaRadioValue(
            baseDraft.fr_sufa,
            baseDraft.match_evidence,
            baseDraft.proveedor_codigo,
          ) || null,
      };

      if (pdfFile) throw new Error('El PDF no puede cambiarse después de crear la factura.');

      const saved = await saveFacturaRecibida(
        payload,
        lineas.map((linea, index) => ({ ...linea, posicion: index + 1 })),
        validar,
        { providerPreflightVerified },
      );

      setFacturas((current) => replaceFactura(current, saved));
      const savedLineas = getLineas(saved);
      setDraft(saved);
      setLineas(savedLineas);
      setPreflightIssues([]);
      setDuplicateCandidate(null);
      setLastSavedEditorSnapshot(createEditorSnapshot(saved, savedLineas));
      setIsEditingDetail(false);
      detailEditBaselineRef.current = null;
      setLoadedDetailId(saved.id);
      setPdfFile(null);
      const savedIssues = normalizeFacturaValidationIssues(saved.validation_errors);
      const savedOperationalIssues = savedIssues.filter(
        (issue) => !isFacturaERPDuplicateIssue(issue),
      );
      const savedHasErrors = savedOperationalIssues.some((issue) => issue.severity === 'error');
      const savedHasWarnings = savedOperationalIssues.some((issue) => issue.severity === 'warning');
      const savedDuplicateNotice = getFacturaERPAlreadyRegisteredNotice(savedIssues);
      const successMessage: ModalMessage = {
        type: savedHasErrors || savedHasWarnings || savedDuplicateNotice ? 'info' : 'success',
        text: savedHasErrors
          ? 'Factura guardada con errores que debes revisar.'
          : savedHasWarnings
            ? 'Factura guardada con avisos de revisión.'
            : savedDuplicateNotice
              ? 'Factura guardada. Ya está registrada en el ERP.'
            : validar
              ? 'Factura preparada para enviar.'
              : 'Factura guardada.',
      };

      if (isDetailMode) {
        setModalMessage(null);
        setSaveFeedback(
          savedHasErrors
            ? 'Guardada con errores'
            : savedHasWarnings
              ? 'Guardada con avisos'
              : 'Guardada',
        );
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

  const applyFacturaToDetail = (factura: FacturaRecibida) => {
    setFacturas((current) => replaceFactura(current, factura));
    const facturaLineas = getLineas(factura);
    setDraft(factura);
    setLineas(facturaLineas);
    setLastSavedEditorSnapshot(createEditorSnapshot(factura, facturaLineas));
    setIsEditingDetail(false);
    detailEditBaselineRef.current = null;
    setLoadedDetailId(factura.id);
  };

  const commitValidatedFacturaToERP = async (
    validated: FacturaRecibida,
    expectedRequestId: string,
  ) => {
    const commitRequestId = requireFacturaERPCommitRequestId(
      validated,
      expectedRequestId,
    );

    const accountingRequestedOnCommit = validated.contabilizar === 'S';
    const sent = await sendFacturaRecibidaToERP(
      validated.id,
      validated.version,
      commitRequestId,
      'commit',
    );
    const sendConfirmation = getFacturaERPSendConfirmation(sent);
    applyFacturaToDetail(sent);
    setPreflightIssues([]);
    setDuplicateCandidate(null);

    let completed = sent;
    if (
      sendConfirmation === 'confirmed' &&
      shouldStartFacturaAccountingAfterManagement(
        sent,
        accountingRequestedOnCommit,
      )
    ) {
      const accountingRequestId = getFacturaAccountingActionRequestId(sent);
      try {
        completed = await accountFacturaRecibidaERP(
          sent.id,
          sent.version,
          accountingRequestId,
        );
      } catch (accountingError) {
        try {
          completed = (await fetchFacturaRecibidaById(sent.id)) ?? sent;
        } catch {
          completed = sent;
        }
        applyFacturaToDetail(completed);
        setModalMessage({
          type: 'error',
          text: `Factura registrada en el ERP. No se pudo completar la contabilización: ${getErrorMessage(
            accountingError,
            'Revisa el estado contable antes de volver a intentarlo.',
          )}`,
        });
        return;
      }
      applyFacturaToDetail(completed);
    }

    setModalMessage(
      sendConfirmation === 'confirmed'
        ? completed.accounting_status === 'created'
          ? {
              type: 'success',
              text: 'Factura registrada y contabilizada.',
            }
          : completed.accounting_status === 'error'
            ? {
                type: 'info',
                text: 'Factura registrada. No se pudo completar la contabilización.',
              }
            : completed.accounting_status === 'pending'
              ? {
                  type: 'info',
                  text: 'Factura registrada. La contabilización está en curso.',
                }
              : completed.accounting_status === 'unknown'
                ? {
                    type: 'info',
                    text: 'Factura registrada. El resultado de la contabilización está pendiente de comprobar.',
                  }
                : {
                    type: 'success',
                    text: 'Factura registrada en el ERP.',
                  }
        : {
            type: 'info',
            text: 'El resultado del alta no es concluyente. Queda pendiente de reconciliación y no se repetirá el envío.',
          },
    );
  };

  const handleSendERP = async () => {
    if (isEditingDetail) {
      setModalMessage({
        type: 'info',
        text: 'Guarda o cancela la edición antes de enviar la factura al ERP.',
      });
      return;
    }
    setSending(true);
    setModalMessage(null);
    setSaveFeedback(null);
    setPreflightIssues([]);
    setDuplicateCandidate(null);

    try {
      if (!draft) {
        setModalMessage({ type: 'error', text: 'No hay factura seleccionada.' });
        return;
      }

      const reconciliationRequestId = getFacturaERPReconciliationRequestId(draft);
      if (reconciliationRequestId) {
        const reconciled = await sendFacturaRecibidaToERP(
          draft.id,
          draft.version,
          reconciliationRequestId,
          'reconcile',
        );
        const reconciliationConfirmation = getFacturaERPSendConfirmation(reconciled);
        applyFacturaToDetail(reconciled);
        setModalMessage(reconciliationConfirmation === 'confirmed'
          ? { type: 'success', text: 'El ERP ha confirmado el envío.' }
          : {
              type: 'info',
              text: 'El ERP todavía no puede confirmar el envío. No se ha enviado de nuevo.',
            });
        return;
      }

      const hasCurrentERPValidation =
        draft.erp_validation_status === 'valid' &&
        Boolean(draft.erp_validation_request_id) &&
        !hasUnsavedDetailChanges;

      if (!hasCurrentERPValidation && !canValidateWithERP) {
        setModalMessage({
          type: 'info',
          text: erpRuntimeChecked
            ? 'El envío al ERP no está disponible en este momento. Guarda la factura y vuelve a intentarlo más tarde.'
            : 'Espera mientras se comprueba la conexión con el ERP.',
        });
        return;
      }

      if (!canCommitManagement) {
        setModalMessage({
          type: 'info',
          text: erpRuntimeChecked
            ? 'El envío al ERP no está disponible en este momento. Guarda la factura y vuelve a intentarlo más tarde.'
            : 'Espera mientras se comprueba la conexión con el ERP.',
        });
        return;
      }

      if (draft.contabilizar === 'S' && !canCommitAccounting) {
        setModalMessage({
          type: 'info',
          text: 'La contabilización no está disponible en este momento. Puedes guardar la factura y enviarla más tarde.',
        });
        return;
      }

      if (hasCurrentERPValidation) {
        await commitValidatedFacturaToERP(
          draft as FacturaRecibida,
          draft.erp_validation_request_id as string,
        );
        return;
      }

      let facturaForSend = draft;
      const needsProviderMatch =
        !cleanOptionalString(facturaForSend.proveedor_codigo) &&
        Boolean(cleanOptionalString(facturaForSend.proveedor_nif) || cleanOptionalString(facturaForSend.proveedor_nombre));

      if (needsProviderMatch) {
        const lookup = await locateProveedorForFactura(facturaForSend);
        if (lookup.response && !lookup.response.ok) {
          const issue: FacturaValidationIssue = {
            code: 'proveedor_api_no_disponible',
            field: 'FRR_idproveedor',
            message: lookup.message,
            severity: 'error',
          };
          setPreflightIssues([issue]);
          setModalMessage({
            type: 'error',
            text: sanitizeUserFacingErrorMessage(lookup.message),
          });
          return;
        }
        if (!lookup.match) {
          const manualSelection = lookup.response?.erp_response?.resultado === 'manual_selection_required';
          const issue: FacturaValidationIssue = {
            code: manualSelection ? 'proveedor_seleccion_manual_requerida' : 'proveedor_no_encontrado',
            field: 'FRR_idproveedor',
            message: lookup.message,
            severity: 'error',
          };
          setPreflightIssues([issue]);
          setModalMessage({ type: 'error', text: lookup.message });
          return;
        }
        if (lookup.match) {
          facturaForSend = lookup.factura;
          setDraft((current) => (current ? applyProveedorLookupMatch(current, lookup.match) : current));
        }
      }

      const preflight = await preflightFacturaRecibidaERP(facturaForSend, {
        gastos: lineas,
      });
      const selectedPunteos = (facturaForSend.punteos ?? []).filter(
        (punteo) => punteo.seleccionado,
      );
      const selectedPunteosTotal = selectedPunteos.reduce(
        (sum, punteo) => sum + getPunteoImporte(punteo),
        0,
      );
      const firstIvaBase = Number(
        facturaForSend.iva_tramos?.find((tramo) => tramo.posicion === 1)?.base ??
          facturaForSend.base_imponible ??
          0,
      );
      const gastosTotal = lineas.reduce(
        (sum, linea) => sum + Number(linea.importe ?? 0),
        0,
      );
      const punteoHasDifference =
        selectedPunteos.length > 0 &&
        (Math.abs(selectedPunteosTotal - firstIvaBase) >
          ACCOUNTING_AMOUNT_TOLERANCE ||
          Math.abs(selectedPunteosTotal - gastosTotal) >
            ACCOUNTING_AMOUNT_TOLERANCE);
      const punteoIssues: FacturaValidationIssue[] = punteoHasDifference
        ? [
            {
              code: 'punteos_importe_no_cuadra',
              field: 'punteos',
              message: `Los punteos seleccionados suman ${formatMoney(selectedPunteosTotal)}; la primera base IVA es ${formatMoney(firstIvaBase)} y los gastos suman ${formatMoney(gastosTotal)}.`,
              severity:
                punteoDifferencePolicy === 'block' ? 'error' : 'warning',
            },
          ]
        : [];
      const allPreflightIssues = normalizeFacturaValidationIssues([
        ...preflight.issues,
        ...punteoIssues,
      ]);
      setPreflightIssues(allPreflightIssues);
      setDuplicateCandidate(preflight.duplicate);
      const preflightErrors = allPreflightIssues.filter(
        (issue) => issue.severity === 'error',
      );
      const preflightOperationalErrors = preflightErrors.filter(
        (issue) => !isFacturaERPDuplicateIssue(issue),
      );
      if (preflightErrors.length > 0) {
        setModalMessage(
          preflightOperationalErrors.length > 0
            ? {
                type: 'error',
                text: sanitizeUserFacingErrorMessage(
                  preflightOperationalErrors.map((issue) => issue.message).join(' '),
                ),
              }
            : null,
        );
        return;
      }

      if (preflight.provider) {
        facturaForSend = applyProveedorERPDetail(facturaForSend, preflight.provider);
        setDraft((current) => (current ? applyProveedorERPDetail(current, preflight.provider as FacturaProveedorERPDetail) : current));
      }

      const saved = await persistFactura(false, facturaForSend, true);
      const savedIssues = normalizeFacturaValidationIssues(saved?.validation_errors);
      const savedErrors = savedIssues.filter(
        (issue) => issue.severity === 'error',
      );
      const savedOperationalErrors = savedErrors.filter(
        (issue) => !isFacturaERPDuplicateIssue(issue),
      );
      const savedDuplicateNotice = getFacturaERPAlreadyRegisteredNotice(
        savedIssues,
        preflight.duplicate,
      );
      if (!saved || savedOperationalErrors.length > 0) {
        setModalMessage({
          type: 'error',
          text: sanitizeUserFacingErrorMessage(
            savedOperationalErrors.map((issue) => issue.message).join(' ') ||
              'No se pudo preparar la factura para envio.',
          ),
        });
        return;
      }
      if (savedDuplicateNotice) {
        setDuplicateCandidate(preflight.duplicate);
        setModalMessage(null);
        return;
      }

      const validationRequestId = crypto.randomUUID();
      const validated = await validateFacturaRecibidaERP(
        saved.id,
        saved.version,
        validationRequestId,
      );
      setFacturas((current) => replaceFactura(current, validated));
      const validatedLineas = getLineas(validated);
      setDraft(validated);
      setLineas(validatedLineas);
      setPreflightIssues(allPreflightIssues);
      setDuplicateCandidate(null);
      setLastSavedEditorSnapshot(
        createEditorSnapshot(validated, validatedLineas),
      );
      setIsEditingDetail(false);
      detailEditBaselineRef.current = null;
      setLoadedDetailId(validated.id);
      await commitValidatedFacturaToERP(validated, validationRequestId);
    } catch (error) {
      setModalMessage({ type: 'error', text: getErrorMessage(error, 'No se pudo enviar la factura.') });
    } finally {
      setSending(false);
    }
  };

  const handleAccountERP = async () => {
    if (!draft?.id) {
      setModalMessage({ type: 'error', text: 'No hay factura seleccionada.' });
      return;
    }
    if (!canCommitAccounting) {
      setModalMessage({
        type: 'info',
        text: erpRuntimeChecked
          ? 'La contabilización no está disponible en este momento.'
          : 'Espera mientras se comprueba la conexión con el ERP.',
      });
      return;
    }

    setAccountingERP(true);
    setModalMessage(null);
    setSaveFeedback(null);
    try {
      const accountingRequestId = getFacturaAccountingActionRequestId(draft);
      const accounted = await accountFacturaRecibidaERP(
        draft.id,
        draft.version,
        accountingRequestId,
      );
      setFacturas((current) => replaceFactura(current, accounted));
      const accountedLineas = getLineas(accounted);
      setDraft(accounted);
      setLineas(accountedLineas);
      setLastSavedEditorSnapshot(
        createEditorSnapshot(accounted, accountedLineas),
      );
      setIsEditingDetail(false);
      detailEditBaselineRef.current = null;
      setLoadedDetailId(accounted.id);
      setModalMessage(
        accounted.accounting_status === 'created'
          ? { type: 'success', text: 'Factura contabilizada.' }
          : accounted.accounting_status === 'unknown'
            ? {
                type: 'info',
                text: 'El resultado no está confirmado. No se repetirá el alta de la factura.',
              }
            : {
                type: 'info',
                text: 'No se pudo completar la contabilización.',
              },
      );
    } catch (error) {
      setModalMessage({
        type: 'error',
        text: getErrorMessage(error, 'No se pudo contabilizar la factura.'),
      });
    } finally {
      setAccountingERP(false);
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
      const saved = await extractFacturaFromPdf(selectedPdf, createEmptyDraft());
      const savedLineas = getLineas(saved);

      setFacturas((current) => replaceFactura(current, saved));
      setFacturasTotal((current) => current + 1);
      setDraft(saved);
      setLineas(savedLineas);
      setShowAccountingBreakdown(shouldOpenAccountingBreakdownFor(saved, savedLineas));
      setLastSavedEditorSnapshot(createEditorSnapshot(saved, savedLineas));
      setIsEditingDetail(false);
      detailEditBaselineRef.current = null;
      setLoadedDetailId(saved.id);
      setPdfFile(null);
      setFacturaUploadStep('done');
      setModalOpen(false);
      navigate(buildFacturaRecibidaDetailPath(encodeURIComponent(saved.id)), { replace: true });
      setModalMessage({
        type: 'success',
        text: 'Factura registrada. Revisa los datos antes de enviarla al ERP.',
      });
    } catch (error) {
      window.clearTimeout(analyzingTimer);
      setDraft(createEmptyDraft());
      setLineas(createEmptyGastos());
      setShowAccountingBreakdown(true);
      setLastSavedEditorSnapshot(null);
      setIsEditingDetail(false);
      detailEditBaselineRef.current = null;
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

  const detailERPState = getFacturaERPRegistrationState(draft);
  const hasLegacyUnscopedERPError = isFacturaERPLegacyUnscopedError(draft);
  const visibleERPError = hasLegacyUnscopedERPError
    ? draft?.accounting_error ?? null
    : draft?.erp_error ?? draft?.accounting_error ?? null;
  const reconciliationRequestId = getFacturaERPReconciliationRequestId(draft);
  const isPermanentReadOnlyDetail = detailIsReadOnly;
  const isReadOnlyDetail = isPermanentReadOnlyDetail || (isDetailMode && !isEditingDetail);
  const accountingDetailStatus = String(
    draft?.accounting_status ?? 'not_requested',
  )
    .trim()
    .toLowerCase();
  const accountingPending = Boolean(
    draft?.accounting_requested === true &&
      accountingDetailStatus === 'pending',
  );
  const accountingUnknown = Boolean(
    draft?.accounting_requested === true &&
      accountingDetailStatus === 'unknown',
  );
  const accountingAwaitingCheck = accountingPending || accountingUnknown;
  const canContinueAccounting = Boolean(
    draft?.id &&
      detailERPState === 'confirmed' &&
      draft.accounting_requested === true &&
      isFacturaAccountingActionable(draft),
  );
  const verifiedDuplicateERPId = getVerifiedERPDuplicateId(draft);
  const duplicateERPPunteosReadOnly = verifiedDuplicateERPId !== null;
  const punteosReadOnly = isReadOnlyDetail || duplicateERPPunteosReadOnly;
  const providerLabel = providerKind === 'agricultor' ? 'Proveedor' : 'Acreedor';
  const isERPValidationCurrent =
    draft?.erp_validation_status === 'valid' &&
    Boolean(draft.erp_validation_request_id) &&
    !hasUnsavedDetailChanges;
  const requiresERPValidation = !isERPValidationCurrent;
  const shouldShowERPPrimaryAction = Boolean(
    !isPermanentReadOnlyDetail || reconciliationRequestId || canContinueAccounting,
  );
  const erpPrimaryActionDisabled = Boolean(
    saving ||
      sending ||
      accountingERP ||
      extractingIa ||
      isEditingDetail ||
      Boolean(erpAlreadyRegisteredNotice) ||
      draft?.estado === 'descartada' ||
      (canContinueAccounting
        ? !erpRuntimeChecked || !canCommitAccounting
        : reconciliationRequestId
          ? false
          : !erpRuntimeChecked ||
            !canCommitManagement ||
            (requiresERPValidation && !canValidateWithERP) ||
            detailERPState === 'confirmed' ||
            detailERPState === 'sending' ||
            detailERPState === 'uncertain' ||
            (draft?.contabilizar === 'S' && !canCommitAccounting)),
  );
  const erpPrimaryActionLabel = erpAlreadyRegisteredNotice
    ? 'Ya registrada en ERP'
    : accountingERP
      ? 'Completando…'
      : sending
        ? reconciliationRequestId
          ? 'Comprobando…'
          : 'Enviando…'
        : canContinueAccounting
          ? 'Completar contabilización'
          : reconciliationRequestId
            ? 'Comprobar envío'
            : 'Enviar a ERP';
  const erpPrimaryActionClass = erpAlreadyRegisteredNotice
    ? 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-900 shadow-sm disabled:cursor-not-allowed disabled:opacity-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
    : 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70';
  const erpCapabilityMessage = (() => {
    if (erpAlreadyRegisteredNotice) {
      return null;
    }
    if (!erpRuntimeChecked) {
      return 'Comprobando la conexión con el ERP…';
    }
    if (accountingPending) {
      return 'La contabilización está en curso. No vuelvas a enviarla.';
    }
    if (accountingUnknown) {
      return 'El resultado de la contabilización está pendiente de comprobar. No vuelvas a intentarlo.';
    }
    if (canContinueAccounting) {
      return canCommitAccounting
        ? null
        : 'No se puede completar la contabilización ahora. Inténtalo más tarde.';
    }
    if (reconciliationRequestId) {
      return 'Hay un envío pendiente de confirmar. Pulsa «Comprobar envío» para consultar su estado.';
    }
    if (
      !erpRuntime ||
      !canCommitManagement ||
      (requiresERPValidation && !canValidateWithERP)
    ) {
      return 'El ERP no está disponible. Puedes seguir editando y guardar; envía la factura cuando vuelva la conexión.';
    }
    if (draft?.contabilizar === 'S' && !canCommitAccounting) {
      return 'La contabilización no está disponible. Puedes guardar la factura y enviarla más tarde.';
    }
    return null;
  })();
  const lineasBaseTotal = lineas.reduce((sum, linea) => sum + (Number(linea.importe) || 0), 0);
  const accountingLinesWithData = lineas.filter(hasAccountingLineData);
  const revealedEmptyGastoIndexSet = new Set(revealedEmptyGastoIndexes);
  const visibleAccountingLines = lineas
    .map((linea, sourceIndex) => ({ linea, sourceIndex }))
    .filter(
      ({ linea, sourceIndex }) =>
        hasAccountingLineData(linea) ||
        (!isReadOnlyDetail && revealedEmptyGastoIndexSet.has(sourceIndex)),
    );
  if (!isReadOnlyDetail && visibleAccountingLines.length === 0) {
    const firstEmptyIndex = lineas.findIndex((linea) => !hasAccountingLineData(linea));
    if (firstEmptyIndex >= 0) {
      visibleAccountingLines.push({ linea: lineas[firstEmptyIndex], sourceIndex: firstEmptyIndex });
    }
  }
  const visibleAccountingLineIndexSet = new Set(
    visibleAccountingLines.map(({ sourceIndex }) => sourceIndex),
  );
  const nextHiddenAccountingLineIndex = isReadOnlyDetail
    ? -1
    : lineas.findIndex(
        (linea, sourceIndex) =>
          !hasAccountingLineData(linea) &&
          !visibleAccountingLineIndexSet.has(sourceIndex),
      );
  const accountingLineCount = accountingLinesWithData.length;
  const accountingBase = Number(draft?.base_imponible ?? 0);
  const accountingDifference = lineasBaseTotal - accountingBase;
  const hasAccountingDifference = Math.abs(accountingDifference) > ACCOUNTING_AMOUNT_TOLERANCE;
  const ctbLineas = draft?.ctb_lineas ?? [];
  const ctbTotal = ctbLineas.reduce((sum, linea) => sum + (Number(linea.importe) || 0), 0);
  const punteos = draft?.punteos ?? [];
  const getPunteoSelected = (punteo: FacturaRecibidaPunteo) => punteo.seleccionado === true;
  const selectedPunteos = punteos.filter(getPunteoSelected);
  const summarizedPunteos = duplicateERPPunteosReadOnly ? punteos : selectedPunteos;
  const punteosTotal = summarizedPunteos
    .reduce((sum, punteo) => sum + getPunteoImporte(punteo), 0);
  const punteosSeleccionados = summarizedPunteos.length;
  const punteosBaseDifference = punteosTotal - accountingBase;
  const punteosGastosDifference = punteosTotal - lineasBaseTotal;
  const ivaTramos = draft?.iva_tramos?.length
    ? draft.iva_tramos
    : createEmptyDraft().iva_tramos ?? [];
  const ivaBaseTotal = ivaTramos.reduce((sum, tramo) => sum + Number(tramo.base ?? 0), 0);
  const ivaCuotaTotal = ivaTramos.reduce((sum, tramo) => sum + Number(tramo.cuota ?? 0), 0);
  // Netagro dispone de cinco huecos fijos (FRR_base1..5). Se muestran siempre
  // para que el usuario pueda revisar todo el desglose sin revelar filas manualmente.
  const calculatedInvoiceTotal =
    ivaBaseTotal +
    ivaCuotaTotal -
    Number(draft?.retencion_importe ?? 0) +
    Number(draft?.importe_suplido ?? 0);
  const invoiceTotalDifference = Number(draft?.total ?? 0) - calculatedInvoiceTotal;
  const vencimientos = draft?.vencimientos?.length
    ? draft.vencimientos
    : createEmptyDraft().vencimientos ?? [];
  const visibleVencimientos = isReadOnlyDetail
    ? vencimientos.filter((vencimiento) => {
        const fecha = cleanOptionalString(vencimiento.fecha);
        const hasVisibleDate = fecha !== null && !isERPPlaceholderDate(fecha);
        const hasAmount =
          Math.abs(Number(vencimiento.importe ?? 0)) > ACCOUNTING_AMOUNT_TOLERANCE;
        return hasVisibleDate || hasAmount;
      })
    : vencimientos;
  const vencimientosTotal = visibleVencimientos.reduce(
    (sum, vencimiento) => sum + Number(vencimiento.importe ?? 0),
    0,
  );
  const vencimientosDifference = Number(draft?.total ?? 0) - vencimientosTotal;
  const assignTotalToFirstVencimiento = async () => {
    if (!canEditDraft) return;
    const hasOtherAmounts = vencimientos
      .slice(1)
      .some((vencimiento) => Math.abs(Number(vencimiento.importe ?? 0)) > ACCOUNTING_AMOUNT_TOLERANCE);
    if (hasOtherAmounts) {
      const confirmed = await confirmar({
        titulo: 'Asignar el total al primer vencimiento',
        descripcion:
          'Se asignará el total al primer vencimiento y se limpiarán los importes de los vencimientos 2 a 4.',
        aceptar: 'Asignar y limpiar',
        cancelar: 'Cancelar',
        destructivo: true,
      });
      if (!confirmed) return;
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
  const accountingSummary =
    accountingLineCount === 0
      ? 'Sin desglose de gastos'
      : accountingLineCount === 1
        ? `${cleanOptionalString(accountingLinesWithData[0]?.descripcion) ?? 'Cuenta sin indicar'} - ${formatMoney(lineasBaseTotal)}`
        : `${accountingLineCount} gastos - ${formatMoney(lineasBaseTotal)}`;

  const addAccountingLine = () => {
    if (!canEditDraft) return;
    if (nextHiddenAccountingLineIndex < 0) return;
    setRevealedEmptyGastoIndexes((current) =>
      Array.from(new Set([...current, nextHiddenAccountingLineIndex])).sort((left, right) => left - right),
    );
  };

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
            Subir factura
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              {catalogError}
            </span>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900 shadow-sm transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              disabled={catalogLoading}
              onClick={() => void loadCatalogs(failedCatalogKeys)}
            >
              {catalogLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {catalogLoading ? 'Reintentando...' : 'Reintentar'}
            </button>
          </div>
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
                onOpen={openFactura}
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
            className="-ml-2 inline-flex h-8 w-fit items-center justify-center gap-2 rounded-md px-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50"
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
            {detailActionMessage && detailActionMessage.type !== 'error' ? (
              <p
                className="min-w-0 text-sm font-semibold text-primary dark:text-blue-300"
              >
                {detailActionMessage.text}
              </p>
            ) : null}
            <FacturaAsientoViewer factura={draft} gastos={lineas} />
            {!isPermanentReadOnlyDetail ? (
              <>
                {isEditingDetail ? (
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800"
                    disabled={saving || sending || accountingERP}
                    onClick={cancelDetailEditing}
                  >
                    <X size={15} />
                    Cancelar
                  </button>
                ) : (
                  <button
                    type="button"
                    className={showSaveFeedback
                      ? saveButtonClass
                      : 'inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50 dark:hover:bg-slate-800'}
                    disabled={saving || sending || accountingERP || showSaveFeedback}
                    onClick={beginDetailEditing}
                  >
                    {showSaveFeedback ? <CheckCircle2 size={15} /> : <Edit size={15} />}
                    {showSaveFeedback ? (saveFeedback ?? 'Guardada') : 'Editar'}
                  </button>
                )}
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 shadow-sm transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-400/30 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-500/10"
                  disabled={saving || sending || accountingERP}
                  onClick={() => void handleDiscard()}
                >
                  <Trash2 size={15} />
                  Eliminar
                </button>
                {isEditingDetail ? (
                  <button
                    type="button"
                    className={saveButtonClass}
                    disabled={saving || sending || accountingERP || !hasUnsavedDetailChanges}
                    onClick={() => void persistFactura(false)}
                  >
                    {saving ? <Loader2 className="animate-spin" size={15} /> : showSaveFeedback ? <CheckCircle2 size={15} /> : <Save size={15} />}
                    {saveButtonLabel}
                  </button>
                ) : null}
              </>
            ) : null}
            {shouldShowERPPrimaryAction ? (
              <>
                <button
                  type="button"
                  className={erpPrimaryActionClass}
                  disabled={erpPrimaryActionDisabled}
                  title={
                    isEditingDetail
                      ? 'Guarda o cancela la edición antes de enviar al ERP.'
                      : erpAlreadyRegisteredNotice?.text
                  }
                  aria-describedby={
                    erpAlreadyRegisteredNotice
                      ? 'factura-erp-registration-note'
                      : undefined
                  }
                  onClick={() =>
                    void (canContinueAccounting
                      ? handleAccountERP()
                      : handleSendERP())
                  }
                >
                  {sending || accountingERP ? (
                    <Loader2 className="animate-spin" size={15} />
                  ) : erpAlreadyRegisteredNotice ? (
                    <Database aria-hidden="true" size={15} />
                  ) : (
                    <CheckCircle2 size={15} />
                  )}
                  {erpPrimaryActionLabel}
                </button>
                {erpAlreadyRegisteredNotice ? (
                  <span
                    id="factura-erp-registration-note"
                    role="status"
                    className="sr-only"
                  >
                    {erpAlreadyRegisteredNotice.text}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-2">
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
        </div>
        {erpCapabilityMessage &&
        (!isPermanentReadOnlyDetail ||
          Boolean(reconciliationRequestId) ||
          canContinueAccounting ||
          accountingAwaitingCheck) ? (
          <p
            role="status"
            className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300"
          >
            {erpCapabilityMessage}
          </p>
        ) : null}
      </header>

      <FacturaIssuesOverlay
        actionError={detailActionError}
        erpError={visibleERPError}
        errors={visibleErrors}
        warnings={visibleWarnings}
        catalogError={erpAlreadyRegisteredNotice ? null : catalogError}
        catalogErrorTitle={catalogErrorTitle}
        catalogLoading={catalogLoading}
        onRetryCatalog={() => void loadCatalogs(failedCatalogKeys)}
      />

      <div className="purchase-invoice-detail-main grid flex-1 items-start gap-6 px-5 py-6 md:px-6 xl:grid-cols-[minmax(420px,0.92fr)_minmax(0,1.08fr)]">
        <section className="purchase-invoice-detail-pdf-panel flex min-w-0 flex-col bg-white dark:bg-transparent xl:sticky xl:top-4">
          <DetailSection title="Documento PDF" className="flex min-h-0 flex-1 flex-col">
            <div className="purchase-invoice-pdf-shell flex flex-col overflow-hidden rounded-sm bg-slate-100 dark:bg-slate-950">
              {pdfLoading ? (
                <div className="grid min-h-0 flex-1 place-items-center bg-neutral-900 text-sm font-semibold text-slate-300">
                  <div className="text-center">
                    <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
                    Abriendo PDF...
                  </div>
                </div>
              ) : pdfUrl ? (
                <PdfViewer
                  url={pdfUrl}
                  showControls
                  appearance="purchase-invoice"
                  fileName={draft.pdf_nombre ?? undefined}
                  className="purchase-invoice-pdf-viewer min-h-0 flex-1"
                />
              ) : (
                <div className="grid min-h-0 flex-1 place-items-center bg-slate-100 px-6 text-center text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-400">
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
              <FieldGroup title="Tipo factura">
                <RadioGroup
                  value={tipoFacturaRadioValue(
                    draft.fr_sufa,
                    draft.match_evidence,
                    draft.proveedor_codigo,
                  )}
                  onValueChange={(value) => {
                    if (value === 'GE' || value === 'OT') void changeTipoFactura(value);
                  }}
                  disabled={isReadOnlyDetail}
                  aria-label="Tipo factura"
                  className="flex flex-wrap gap-x-8 gap-y-3"
                >
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-100">
                    <RadioGroupItem value="GE" aria-label="Compras de Género" />
                    <span>Compras de Género</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-950 dark:text-slate-100">
                    <RadioGroupItem value="OT" aria-label="Acreedores" />
                    <span>Acreedores</span>
                  </label>
                </RadioGroup>
              </FieldGroup>

              <FieldGroup title={providerLabel}>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Field label={providerLabel} className="sm:col-span-2 xl:col-span-2">
                    <AcreedorCombobox
                      key={providerKind}
                      value={proveedorIdFromDraft(draft)}
                      onChange={() => undefined}
                      onSelect={(proveedor) => void selectProveedorERP(proveedor)}
                      disabled={isReadOnlyDetail}
                      placeholder={`Buscar ${providerLabel.toLowerCase()} por nombre o NIF`}
                      className={detailInputClass}
                      source="erp"
                      entityType={providerKind}
                      minSearchLength={2}
                      searchLimit={25}
                    />
                  </Field>
                  <Field label="NIF">
                    <Input
                      className={detailInputClass}
                      value={draft.proveedor_nif ?? ''}
                      disabled
                    />
                  </Field>
                  <Field label={`Código ${providerLabel.toLowerCase()} ERP`}>
                    <Input className={detailInputClass} value={draft.proveedor_codigo ?? ''} disabled />
                  </Field>
                  <Field label="Cta. Proveedor">
                    <Input className={detailInputClass} value={draft.proveedor_cuenta ?? ''} disabled />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Factura">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <Field label="Entrada ERP">
                    <Input
                      className={detailInputClass}
                      value={draft.referencia ?? ''}
                      placeholder="Se asigna al enviar"
                      disabled
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
                    {!isReadOnlyDetail ? (
                      <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                        {draft.fecha_ctb_source === 'manual'
                          ? 'Fecha revisada manualmente.'
                          : 'Se actualiza con la fecha de factura hasta que la edites.'}
                      </p>
                    ) : null}
                  </Field>
                  <Field label="Ejercicio ERP">
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
                  <Field label="Régimen IVA">
                    <FilterSelect
                      value={draft.tipo_iva_codigo ?? ''}
                      options={regimenOptions}
                      onChange={(value) => void changeRegimenIva(value)}
                      ariaLabel="Seleccionar régimen de IVA"
                      disabled={isReadOnlyDetail}
                      triggerClassName={detailInputClass}
                    />
                    <SugerenciaHistorial
                      sugerencia={sugerenciasHistorial.regimen_id}
                      actual={draft.tipo_iva_codigo}
                      disabled={isReadOnlyDetail}
                      onAplicar={(valor) => void changeRegimenIva(valor)}
                    />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Desglose de IVA">
                <div className="mb-3">
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                    Base {formatMoney(ivaBaseTotal)} · Cuota {formatMoney(ivaCuotaTotal)}
                  </p>
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
                            <FilterSelect
                              value={
                                tramo.porcentaje === null ||
                                tramo.porcentaje === undefined
                                  ? ''
                                  : String(Number(tramo.porcentaje))
                              }
                              options={buildIvaOptions(
                                tiposIva,
                                tramo.porcentaje,
                              )}
                              onChange={(value) =>
                                updateIvaTramo(
                                  tramo.posicion,
                                  'porcentaje',
                                  value === '' ? null : Number(value),
                                )
                              }
                              ariaLabel={`IVA del tramo ${tramo.posicion}`}
                              disabled={isReadOnlyDetail}
                              triggerClassName={detailTableInputClass}
                            />
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <Input className={detailTableInputClass} inputMode="decimal" value={numberInputValue(tramo.cuota)} disabled={isReadOnlyDetail} onChange={(event) => updateIvaTramo(tramo.posicion, 'cuota', parseNumber(event.target.value))} />
                              <button
                                type="button"
                                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-blue-300 bg-blue-50 text-blue-700 shadow-sm transition-colors hover:border-blue-400 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-default disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-300 disabled:shadow-none dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60 dark:disabled:border-slate-800 dark:disabled:bg-slate-900 dark:disabled:text-slate-700"
                                disabled={
                                  isReadOnlyDetail ||
                                  !isFacturaIvaCuotaOutdated(
                                    tramo.base,
                                    tramo.porcentaje,
                                    tramo.cuota,
                                  )
                                }
                                aria-label={`Calcular cuota del tramo ${tramo.posicion}`}
                                title="Calcular cuota"
                                onClick={() => calculateIvaCuota(tramo)}
                              >
                                <Calculator className="size-4" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <Field label="Cuota no deducible">
                    <Input className={detailInputClass} inputMode="decimal" value={numberInputValue(draft.cuota_no_deducible)} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('cuota_no_deducible', parseNumber(event.target.value) ?? 0)} />
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
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                        Suma gastos: {formatMoney(lineasBaseTotal)} / Base: {formatMoney(draft.base_imponible)}
                      </p>
                      {!isReadOnlyDetail && nextHiddenAccountingLineIndex >= 0 ? (
                        <button
                          type="button"
                          className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                          onClick={addAccountingLine}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Añadir gasto
                        </button>
                      ) : null}
                    </div>
                    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                      <table className="purchase-invoice-lines-table w-full min-w-[760px] text-left text-sm">
                        <thead>
                          <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                            <th className="w-12 px-3 py-3">#</th>
                            <th className="px-3 py-3">Cuenta gasto</th>
                            <th className="w-36 px-3 py-3">Importe gasto</th>
                            {!isReadOnlyDetail ? <th className="w-16 px-3 py-3" /> : null}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {visibleAccountingLines.map(({ linea, sourceIndex }) => (
                            <tr key={`${linea.id ?? 'linea'}-${sourceIndex}`} className="bg-white align-middle dark:bg-slate-950">
                              <td className="px-3 py-3 font-bold text-slate-500 dark:text-slate-400">
                                {linea.posicion ?? sourceIndex + 1}
                              </td>
                              <td className="px-3 py-3">
                                <CuentaContableCombobox
                                  empresaId={empresaId}
                                  value={linea.descripcion}
                                  previouslyUsed={cuentasGastoHistoricas}
                                  disabled={isReadOnlyDetail}
                                  className={detailTableInputClass}
                                  onChange={(value) =>
                                    updateLinea(
                                      sourceIndex,
                                      'descripcion',
                                      value ?? '',
                                    )
                                  }
                                />
                              </td>
                              <td className="px-3 py-3">
                                <Input className={detailTableInputClass} inputMode="decimal" value={numberInputValue(linea.importe)} disabled={isReadOnlyDetail} onChange={(event) => updateLinea(sourceIndex, 'importe', parseNumber(event.target.value) ?? 0)} />
                              </td>
                              {!isReadOnlyDetail ? (
                                <td className="px-3 py-3 text-right">
                                  <button
                                    type="button"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition-colors hover:bg-rose-50 dark:border-rose-400/30 dark:bg-slate-900 dark:text-rose-300 dark:hover:bg-rose-500/10"
                                    onClick={() => removeLinea(sourceIndex)}
                                    aria-label="Eliminar gasto"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </td>
                              ) : null}
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-200 bg-slate-50 text-sm font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
                            <td className="px-3 py-3" colSpan={2}>Totales</td>
                            <td className="px-3 py-3">{formatMoney(lineasBaseTotal)}</td>
                            {!isReadOnlyDetail ? <td /> : null}
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-800">
                  <Field label="Concepto asiento">
                    <textarea
                      className={detailTextareaClass}
                      value={draft.concepto_asiento ?? ''}
                      disabled={isReadOnlyDetail}
                      maxLength={50}
                      onChange={(event) => updateDraft('concepto_asiento', event.target.value)}
                      placeholder="Concepto asiento"
                    />
                    {(() => {
                      const conceptoSugerido = construirConceptoFactura(draft.proveedor_nombre);
                      if (
                        isReadOnlyDetail ||
                        !conceptoSugerido ||
                        cleanOptionalString(draft.concepto_asiento) === conceptoSugerido
                      ) {
                        return null;
                      }
                      return (
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                          <span>
                            Convención ERP: <span className="font-semibold">{conceptoSugerido}</span>
                          </span>
                          <button
                            type="button"
                            className="font-semibold text-primary underline-offset-2 hover:underline"
                            onClick={() => updateDraft('concepto_asiento', conceptoSugerido)}
                          >
                            Aplicar
                          </button>
                        </p>
                      );
                    })()}
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Retención">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
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
                </div>
              </FieldGroup>

              <FieldGroup title="Observaciones">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Obs. AEAT">
                    <Input
                      className={detailInputClass}
                      value={draft.obs_aeat ?? ''}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('obs_aeat', event.target.value)}
                    />
                    {!isReadOnlyDetail &&
                    cleanOptionalString(draft.concepto_asiento) &&
                    !cleanOptionalString(draft.obs_aeat) ? (
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span>El ERP replica aquí el concepto del asiento.</span>
                        <button
                          type="button"
                          className="font-semibold text-primary underline-offset-2 hover:underline"
                          onClick={() => updateDraft('obs_aeat', draft.concepto_asiento ?? '')}
                        >
                          Copiar concepto
                        </button>
                      </p>
                    ) : null}
                  </Field>
                  <Field label="Obs.">
                    <Input
                      className={detailInputClass}
                      value={draft.observaciones ?? ''}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('observaciones', event.target.value)}
                    />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Suplidos">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Cuenta">
                    <Input
                      className={detailInputClass}
                      value={draft.cuenta_suplido ?? ''}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('cuenta_suplido', event.target.value)}
                    />
                  </Field>
                  <Field label="Importe">
                    <Input
                      className={detailInputClass}
                      inputMode="decimal"
                      value={numberInputValue(draft.importe_suplido)}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('importe_suplido', parseNumber(event.target.value) ?? 0)}
                    />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup title="Totales">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Total factura">
                    <Input
                      className={detailInputClass}
                      inputMode="decimal"
                      value={numberInputValue(draft.total)}
                      disabled={isReadOnlyDetail}
                      onChange={(event) => updateDraft('total', parseNumber(event.target.value))}
                    />
                  </Field>
                  <Field label="Diferencia">
                    <Input className={detailInputClass} value={formatMoney(invoiceTotalDifference)} disabled />
                  </Field>
                </div>
              </FieldGroup>

              <FieldGroup
                title={
                  duplicateERPPunteosReadOnly
                    ? 'Albaranes/gastos vinculados en ERP'
                    : 'Albaranes/Gtos para puntear'
                }
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                    {duplicateERPPunteosReadOnly
                      ? `Esta factura ya existe en el ERP (entrada ${verifiedDuplicateERPId}). Se muestran sus vínculos actuales en modo consulta; no se modificarán desde este borrador.`
                      : isReadOnlyDetail
                      ? 'Albaranes y gastos vinculados en el ERP.'
                      : 'Selecciona los albaranes o gastos que deben vincularse a la factura.'}
                  </p>
                  {!punteosReadOnly ? (
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
                    {!duplicateERPPunteosReadOnly ? (
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-amber-200 bg-white px-3 text-xs font-bold hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900/60 dark:bg-amber-950/40"
                        disabled={isPermanentReadOnlyDetail ? punteoReferencesLoading : punteosLoading}
                        onClick={() =>
                          void (isPermanentReadOnlyDetail ? loadPunteoReferences() : loadPunteables())
                        }
                      >
                        {(isPermanentReadOnlyDetail ? punteoReferencesLoading : punteosLoading) ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        {(isPermanentReadOnlyDetail ? punteoReferencesLoading : punteosLoading)
                          ? 'Recuperando...'
                          : 'Reintentar'}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <FacturaPunteosTable
                  punteos={punteos}
                  readOnly={punteosReadOnly}
                  existingERPLinks={duplicateERPPunteosReadOnly}
                  selectedCount={punteosSeleccionados}
                  selectedTotal={punteosTotal}
                  baseDifference={punteosBaseDifference}
                  expensesDifference={punteosGastosDifference}
                  onSelectionChange={(punteo, selected) =>
                    updatePunteoSelected(punteoERPIdentity(punteo), selected)
                  }
                  loadEntryLines={fetchAlbaranEntradaLineas}
                  loadMaterialLines={(materialId) =>
                    fetchAlbaranMaterialLineas(materialId, activeRemoteFacturaId)
                  }
                  formatMoney={formatMoney}
                  formatDate={formatDate}
                />
                {!punteosReadOnly && punteosSeleccionados > 0 ? (
                  <p
                    className={`mt-3 text-xs font-semibold ${
                      Math.abs(punteosBaseDifference) >
                        ACCOUNTING_AMOUNT_TOLERANCE ||
                      Math.abs(punteosGastosDifference) >
                        ACCOUNTING_AMOUNT_TOLERANCE
                        ? punteoDifferencePolicy === 'block'
                          ? 'text-red-700 dark:text-red-300'
                          : 'text-amber-700 dark:text-amber-300'
                        : 'text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {Math.abs(punteosBaseDifference) >
                      ACCOUNTING_AMOUNT_TOLERANCE ||
                    Math.abs(punteosGastosDifference) >
                      ACCOUNTING_AMOUNT_TOLERANCE
                      ? punteoDifferencePolicy === 'block'
                        ? 'La regla de esta factura bloquea el envío mientras existan diferencias de punteos.'
                        : 'Las diferencias de punteos se mostrarán como aviso y no modificarán la selección.'
                      : 'Los punteos seleccionados cuadran con los importes de referencia.'}
                  </p>
                ) : null}
              </FieldGroup>

              {!isReadOnlyDetail || ctbLineas.length > 0 ? (
                <FieldGroup title="Distribución analítica (CTB)">
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
                    <table className="w-full min-w-[1180px] table-fixed text-left text-sm">
                      <colgroup>
                        <col className="w-12" />
                        <col className="w-[300px]" />
                        <col className="w-[140px]" />
                        <col className="w-[140px]" />
                        <col className="w-[140px]" />
                        <col className="w-[170px]" />
                        <col className="w-[180px]" />
                        <col className="w-14" />
                      </colgroup>
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
                              <CuentaContableCombobox
                                empresaId={empresaId}
                                value={linea.descripcion}
                                disabled={isReadOnlyDetail}
                                className={detailTableInputClass}
                                onChange={(value) =>
                                  updateCtbLinea(
                                    index,
                                    'descripcion',
                                    value ?? '',
                                  )
                                }
                              />
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
              ) : null}

              <FieldGroup title="Pagos">
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  {!isReadOnlyDetail || hasMeaningfulERPValue(draft.forma_pago) ? (
                    <Field label="Forma de pago">
                      <Input className={detailInputClass} value={draft.forma_pago ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('forma_pago', event.target.value)} />
                    </Field>
                  ) : null}
                  {!isReadOnlyDetail || cleanOptionalString(draft.cta_cartera) ? (
                    <Field label="Cta. Cartera">
                      <Input className={detailInputClass} value={draft.cta_cartera ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('cta_cartera', event.target.value)} />
                    </Field>
                  ) : null}
                  {!isReadOnlyDetail || hasMeaningfulERPValue(draft.banco) ? (
                    <Field label="Banco">
                      <Input className={detailInputClass} value={draft.banco ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('banco', event.target.value)} />
                    </Field>
                  ) : null}
                  {!isReadOnlyDetail || hasMeaningfulERPValue(draft.tipo_doc) ? (
                    <Field label="Tipo doc">
                      <Input className={detailInputClass} value={draft.tipo_doc ?? ''} disabled={isReadOnlyDetail} onChange={(event) => updateDraft('tipo_doc', event.target.value)} />
                    </Field>
                  ) : null}
                  {!isReadOnlyDetail || hasMeaningfulERPValue(draft.contabilizar) ? (
                    <Field label="Contabilizar">
                      <FilterSelect
                        value={draft.contabilizar === 'S' ? 'S' : 'N'}
                        options={yesNoOptions}
                        onChange={(value) => updateDraft('contabilizar', value)}
                        ariaLabel="Contabilizar"
                        disabled={isReadOnlyDetail}
                        triggerClassName={detailInputClass}
                      />
                      {!isReadOnlyDetail && draft.contabilizar === 'S' ? (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {canCommitAccounting
                            ? 'Se creará el asiento después de registrar la factura.'
                            : 'La contabilización no está disponible en este momento.'}
                        </p>
                      ) : null}
                    </Field>
                  ) : null}
                  {!isReadOnlyDetail || hasMeaningfulERPValue(draft.genera_cartera) ? (
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
                  ) : null}
                </div>
                {!isReadOnlyDetail ? (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                      Diferencia de vencimientos: {formatMoney(vencimientosDifference)}
                    </p>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
                      onClick={assignTotalToFirstVencimiento}
                    >
                      Asignar total al primer vencimiento
                    </button>
                  </div>
                ) : null}
                {visibleVencimientos.length > 0 ? (
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
                      {visibleVencimientos.map((vencimiento) => (
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
                ) : (
                  <p className="mt-4 rounded-md border border-dashed border-slate-200 px-3 py-3 text-sm font-semibold text-slate-500 dark:border-slate-800">
                    Sin vencimientos informados en ERP.
                  </p>
                )}
              </FieldGroup>

            </div>
          </DetailSection>
        </section>
      </div>
    </div>
  ) : null;

  return (
    <>
      {dialogoConfirmacion}
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
