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
  field: string;
  message: string;
  severity: 'error' | 'warning';
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

export type FacturaRecibida = {
  id: string;
  archivo_pdf_id: number | null;
  estado: FacturaRecibidaEstado;
  proveedor_nombre: string | null;
  proveedor_nif: string | null;
  source_pdf_name: string | null;
  confidence: number | null;
  extraction: unknown;
  validation_errors: FacturaValidationIssue[];
  duplicada_de: string | null;
  erp_sent_at: string | null;
  erp_response: unknown;
  erp_error: string | null;
  created_at: string;
  updated_at: string;
  FRR_id: number | null;
  FRR_numero: number | null;
  FRR_ejercicio: number | null;
  FRR_idcentro: number | null;
  FRR_idproveedor: number | null;
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
  FRR_totalfac: number | null;
  FRR_tipofactura: string | null;
  FRR_Concepto: string | null;
  FRR_Observaciones: string | null;
  FRR_ObservacionesAEAT: string | null;
  FRR_ImpSuplido: number | null;
  FRR_CuotaNoDeducible: number | null;
  ctb: FacturaRecibidaCtb[];
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
};

export type FacturaRecibidaPage = {
  items: FacturaRecibida[];
  total: number;
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
