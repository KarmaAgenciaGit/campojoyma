export type FacturaRecibidaEstado =
  | 'pendiente_revision'
  | 'error_ocr'
  | 'validada'
  | 'preparada_erp'
  | 'enviada_erp'
  | 'error_erp'
  | 'duplicada'
  | 'descartada';

export type FacturaValidationIssue = {
  code?: string | null;
  field: string;
  message: string;
  severity: 'error' | 'warning';
  details?: Record<string, unknown> | null;
};

export type FacturaRecibidaCtb = {
  id: string;
  factura_id: string;
  posicion: number;
  FRC_id: number | null;
  FRC_idfacturarecibida: number | null;
  FRC_Cuenta: string | null;
  FRC_Importe: number | null;
  FRC_IdActividad: number | null;
  FRC_Idseccion: number | null;
  FRC_Iddepartamento: number | null;
  FRC_Idsubdepartamento: number | null;
  FRC_IdUsuarioLog: number | null;
  FRC_FechaLog: string | null;
  FRC_HoraLog: string | null;
  created_at: string;
  updated_at: string;
};

export type FacturaRecibidaPunteo = {
  id: string;
  factura_id: string;
  posicion: number;
  remote_id: string | null;
  source_table: string | null;
  source_id: number | null;
  importe_factura: number | null;
  Origen: string | null;
  Serie: string | null;
  Albaran: number | null;
  Ref: string | null;
  Fecha: string | null;
  'Importe P': number | null;
  Importe: number | null;
  S: boolean;
  Ver: boolean;
  empresa_id: number | null;
  proveedor_id: number | null;
  cuenta_gasto: string | null;
  line_count: number;
  source_lines: unknown;
  raw: unknown;
  created_at: string;
  updated_at: string;
};

export type FacturaRecibidaAsientoApunte = {
  id: string;
  asiento_id: string;
  posicion: number;
  cuenta: string | null;
  descripcion: string | null;
  debe: number;
  haber: number;
  analytic: unknown;
  raw: unknown;
};

export type FacturaRecibidaAsiento = {
  id: string;
  factura_id: string;
  request_id: string;
  technical_id: number | null;
  visible_number: string | null;
  accounting_date: string | null;
  concept: string | null;
  status: string;
  total_debit: number;
  total_credit: number;
  balanced: boolean;
  raw: unknown;
  captured_at: string;
  apuntes: FacturaRecibidaAsientoApunte[];
};

export type FacturaRecibida = {
  id: string;
  archivo_pdf_id: number | null;
  estado: FacturaRecibidaEstado;
  source_kind: string | null;
  remote_frr_id: number | null;
  is_readonly_reference: boolean;
  match_status: string | null;
  match_evidence: unknown;
  proveedor_nombre: string | null;
  proveedor_nif: string | null;
  source_pdf_name: string | null;
  source_page_number: number | null;
  source_page_count: number | null;
  email_from: string | null;
  email_subject: string | null;
  email_received_at: string | null;
  confidence: number | null;
  extraction: unknown;
  validation_errors: FacturaValidationIssue[];
  duplicada_de: string | null;
  erp_sent_at: string | null;
  erp_response: unknown;
  erp_error: string | null;
  row_version: number;
  sync_status: string | null;
  accounting_status: string | null;
  accounting_visible_number: string | null;
  accounting_date: string | null;
  erp_last_read_at: string | null;
  erp_last_read_payload: unknown;
  last_request_id: string | null;
  created_at: string;
  updated_at: string;
  FRR_id: number | null;
  FRR_numero: number | null;
  FRR_ejercicio: number | null;
  FRR_idcentro: number | null;
  FRR_idproveedor: number | null;
  FRR_idregimen: number | null;
  FRR_idcuenta: string | null;
  FRR_numerofactura: string | null;
  FRR_fechafactura: string | null;
  FRR_fechactb: string | null;
  FRR_Idempresa: number | null;
  FRR_base1: number | null;
  FRR_iva1: number | null;
  FRR_cuota1: number | null;
  FRR_base2: number | null;
  FRR_iva2: number | null;
  FRR_cuota2: number | null;
  FRR_base3: number | null;
  FRR_iva3: number | null;
  FRR_cuota3: number | null;
  FRR_base4: number | null;
  FRR_iva4: number | null;
  FRR_cuota4: number | null;
  FRR_base5: number | null;
  FRR_iva5: number | null;
  FRR_cuota5: number | null;
  FRR_baseret: number | null;
  FRR_ret: number | null;
  FRR_cuotaret: number | null;
  FRR_igasto1: number | null;
  FRR_ctagasto1: string | null;
  FRR_igasto2: number | null;
  FRR_ctagasto2: string | null;
  FRR_igasto3: number | null;
  FRR_ctagasto3: string | null;
  FRR_igasto4: number | null;
  FRR_ctagasto4: string | null;
  FRR_totalfac: number | null;
  FRR_tipofactura: string | null;
  FRR_idpuntoventa: number | null;
  FRR_ClaveIRPF: string | null;
  FRR_IdAsientoNet: number | null;
  FRR_CtaCartera: string | null;
  FRR_IdBanco: number | null;
  FRR_IdFormaPago: number | null;
  FechaVto: string | null;
  ImporteVto: number | null;
  FRR_Modificable: string | null;
  FRR_idpago: number | null;
  FRR_IdUsuarioLog: number | null;
  FRR_FechaLog: string | null;
  FRR_HoraLog: string | null;
  FRR_GeneraCartera: string | null;
  FRR_FechaVto1: string | null;
  FRR_ImporteVto1: number | null;
  FRR_FechaVto2: string | null;
  FRR_ImporteVto2: number | null;
  FRR_FechaVto3: string | null;
  FRR_ImporteVto3: number | null;
  FRR_IdTipoDoc: number | null;
  FRR_IdAgricultorDto: number | null;
  FRR_CtaSuplido: string | null;
  FRR_Concepto: string | null;
  FRR_Observaciones: string | null;
  FRR_ObservacionesAEAT: string | null;
  FRR_ImpSuplido: number | null;
  FRR_CuotaNoDeducible: number | null;
  FRR_FechaPrevPago: string | null;
  FRR_BancoPrevPago: number | null;
  FRR_IdSeccion: number | null;
  FRR_IdActividad: number | null;
  FRR_CancelarporCtb: string | null;
  FRR_Contabilizar: string | null;
  FRR_IdfacturaRec: number | null;
  erp_sent_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  ctb: FacturaRecibidaCtb[];
  punteos: FacturaRecibidaPunteo[];
  asientos: FacturaRecibidaAsiento[];
};

export type FacturaRecibidaListFilters = {
  page: number;
  pageSize: number;
  estado?: FacturaRecibidaEstado | 'all';
  proveedor?: string;
  nif?: string;
  numero?: string;
  fechaFrom?: string;
  fechaTo?: string;
  totalFrom?: number | null;
  totalTo?: number | null;
  erpStatus?: 'all' | 'sent' | 'not_sent';
  sortOrder?:
    | 'created_desc'
    | 'created_asc'
    | 'fecha_desc'
    | 'fecha_asc'
    | 'total_desc'
    | 'total_asc';
  includeDiscarded?: boolean;
};

export type FacturaRecibidaPage = {
  items: FacturaRecibida[];
  total: number;
};

export const FACTURA_RECIBIDA_NON_INBOX_SOURCE_KINDS = [
  'manual_draft',
  'erp_reference',
] as const;

export const isFacturaRecibidaInboxSourceKind = (value?: string | null) => {
  const sourceKind = value?.trim();
  return Boolean(
    sourceKind?.endsWith('_draft') &&
      !FACTURA_RECIBIDA_NON_INBOX_SOURCE_KINDS.includes(
        sourceKind as (typeof FACTURA_RECIBIDA_NON_INBOX_SOURCE_KINDS)[number],
      ),
  );
};

export const FACTURA_RECIBIDA_ESTADOS: FacturaRecibidaEstado[] = [
  'pendiente_revision',
  'error_ocr',
  'validada',
  'preparada_erp',
  'enviada_erp',
  'error_erp',
  'duplicada',
  'descartada',
];

export const FACTURA_ESTADO_META: Record<FacturaRecibidaEstado, { label: string; className: string }> = {
  pendiente_revision: {
    label: 'Pendiente',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  error_ocr: {
    label: 'Error OCR',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
  },
  validada: {
    label: 'Validada',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  preparada_erp: {
    label: 'Preparada',
    className: 'border-sky-200 bg-sky-50 text-sky-800',
  },
  enviada_erp: {
    label: 'Enviada',
    className: 'border-slate-200 bg-slate-100 text-slate-800',
  },
  error_erp: {
    label: 'Error ERP',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
  },
  duplicada: {
    label: 'Duplicada',
    className: 'border-violet-200 bg-violet-50 text-violet-800',
  },
  descartada: {
    label: 'Descartada',
    className: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  },
};

export const safeNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const normalized =
      trimmed.includes(',') && trimmed.includes('.')
        ? trimmed.replace(/\./g, '').replace(',', '.')
        : trimmed.replace(',', '.');
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

export const nullableNumber = (value: unknown): number | null => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = safeNumber(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
};

export const formatFacturaCurrency = (value: unknown) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(safeNumber(value));

export const formatFacturaDate = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-ES').format(date);
};
