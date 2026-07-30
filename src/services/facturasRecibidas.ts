import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { normalizeFacturaERPReferenceStatus } from '@/lib/facturasErpStatus';
import { sanitizeUserFacingErrorMessage } from '@/lib/userFacingErrors';
import { FACTURA_RECIBIDA_NON_INBOX_SOURCE_KINDS } from '@/types/facturasRecibidas';
import type {
  FacturaRecibida,
  FacturaRecibidaAsiento,
  FacturaRecibidaAsientoApunte,
  FacturaRecibidaCtb,
  FacturaRecibidaEstado,
  FacturaRecibidaListFilters,
  FacturaRecibidaPage,
  FacturaRecibidaPunteo,
  FacturaValidationIssue,
} from '@/types/facturasRecibidas';

type RawCtb = Tables<'facturasrecibidas_ctb'>;
type RawPunteo = Tables<'facturasrecibidas_punteos'>;
type RawAsientoApunte = Tables<'facturasrecibidas_asiento_apuntes'>;
type RawAsiento = Tables<'facturasrecibidas_asientos'> & {
  facturasrecibidas_asiento_apuntes?: RawAsientoApunte[];
};
type RawFactura = Tables<'facturasrecibidas'> & {
  facturasrecibidas_ctb?: RawCtb[];
  facturasrecibidas_punteos?: RawPunteo[];
  ctb?: RawCtb[];
  punteos?: RawPunteo[];
  facturasrecibidas_asientos?: RawAsiento[];
};

export type FacturaRecibidaUpdatePayload = {
  factura_id: string;
  expected_version: number;
  estado?: FacturaRecibidaEstado;
  proveedor_nombre?: string | null;
  proveedor_nif?: string | null;
  factura: Record<string, unknown>;
  ctb: Array<Record<string, unknown>>;
  punteos?: Array<Record<string, unknown>>;
  provider_preflight_verified?: boolean;
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.replace(/^data:.*;base64,/i, ''));
    };
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el PDF.'));
    reader.readAsDataURL(blob);
  });

export type FacturaERPErrorCategory =
  | 'validation'
  | 'environment'
  | 'conflict'
  | 'transport'
  | 'accounting'
  | string;

type FacturaERPErrorData = {
  code: string;
  category: FacturaERPErrorCategory;
  userMessage: string;
  retryable: boolean;
  reconciliationRequired: boolean;
  requestId: string | null;
  targetId: string | null;
  datasetEpoch: string | null;
};

export class FacturaERPServiceError extends Error {
  readonly code: string;
  readonly category: FacturaERPErrorCategory;
  readonly userMessage: string;
  readonly retryable: boolean;
  readonly reconciliationRequired: boolean;
  readonly requestId: string | null;
  readonly targetId: string | null;
  readonly datasetEpoch: string | null;

  constructor(data: FacturaERPErrorData) {
    const visibleMessage = data.requestId
      ? `${data.userMessage} Solicitud: ${data.requestId}.`
      : data.userMessage;
    super(visibleMessage);
    this.name = 'FacturaERPServiceError';
    this.code = data.code;
    this.category = data.category;
    this.userMessage = data.userMessage;
    this.retryable = data.retryable;
    this.reconciliationRequired = data.reconciliationRequired;
    this.requestId = data.requestId;
    this.targetId = data.targetId;
    this.datasetEpoch = data.datasetEpoch;
  }
}

const cleanErrorText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const extractERPErrorData = (
  data: unknown,
  fallback: Partial<FacturaERPErrorData> = {},
): FacturaERPErrorData | null => {
  if (!data || typeof data !== 'object') return null;
  const source = data as Record<string, unknown>;
  const nestedCandidates = [source.detail, source.error, source.data];
  const nested =
    nestedCandidates
      .map((candidate) => extractERPErrorData(candidate, fallback))
      .find(Boolean) ?? null;
  const rawUserMessage =
    cleanErrorText(source.user_message) ??
    cleanErrorText(source.message) ??
    cleanErrorText(source.error) ??
    nested?.userMessage ??
    cleanErrorText(fallback.userMessage);
  if (!rawUserMessage) return null;

  return {
    code:
      cleanErrorText(source.code) ??
      nested?.code ??
      cleanErrorText(fallback.code) ??
      'upstream_unavailable',
    category:
      cleanErrorText(source.category) ??
      nested?.category ??
      fallback.category ??
      'transport',
    userMessage: sanitizeUserFacingErrorMessage(rawUserMessage),
    retryable:
      typeof source.retryable === 'boolean'
        ? source.retryable
        : nested?.retryable ?? fallback.retryable ?? false,
    reconciliationRequired:
      typeof source.reconciliation_required === 'boolean'
        ? source.reconciliation_required
        : nested?.reconciliationRequired ??
          fallback.reconciliationRequired ??
          false,
    requestId:
      cleanErrorText(source.request_id) ??
      nested?.requestId ??
      cleanErrorText(fallback.requestId),
    targetId:
      cleanErrorText(source.target_id) ??
      nested?.targetId ??
      cleanErrorText(fallback.targetId),
    datasetEpoch:
      cleanErrorText(source.dataset_epoch) ??
      nested?.datasetEpoch ??
      cleanErrorText(fallback.datasetEpoch),
  };
};

const getFunctionErrorMessage = (data: unknown): string | null =>
  extractERPErrorData(data)?.userMessage ?? null;

const genericERPErrorData = (
  requestId: string | null,
  userMessage = 'No se pudo completar la operación con el ERP.',
): FacturaERPErrorData => ({
  code: 'upstream_unavailable',
  category: 'transport',
  userMessage: sanitizeUserFacingErrorMessage(userMessage),
  retryable: true,
  reconciliationRequired: false,
  requestId,
  targetId: null,
  datasetEpoch: null,
});

const getFunctionInvokeERPError = async (
  error: unknown,
  data: unknown,
  requestId: string | null,
): Promise<FacturaERPServiceError> => {
  const fallback = genericERPErrorData(requestId);
  const dataError = extractERPErrorData(data, fallback);
  if (dataError) return new FacturaERPServiceError(dataError);

  const context =
    error && typeof error === 'object'
      ? (error as { context?: unknown }).context
      : null;
  if (
    context &&
    typeof context === 'object' &&
    typeof (context as { clone?: unknown }).clone === 'function'
  ) {
    try {
      const raw = (await (context as Response).clone().text()).trim();
      if (raw) {
        try {
          const parsedError = extractERPErrorData(JSON.parse(raw), fallback);
          if (parsedError) return new FacturaERPServiceError(parsedError);
        } catch {
          return new FacturaERPServiceError({
            ...fallback,
            userMessage: sanitizeUserFacingErrorMessage(raw),
          });
        }
      }
    } catch {
      // El SDK puede haber consumido ya el cuerpo.
    }
  }

  return new FacturaERPServiceError(fallback);
};

const getFunctionInvokeErrorMessage = async (
  error: unknown,
  data?: unknown,
): Promise<string> => {
  const parsed = await getFunctionInvokeERPError(error, data, null);
  return parsed.message;
};

const asValidationErrors = (value: unknown): FacturaValidationIssue[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item): FacturaValidationIssue => ({
      field: String(item.field ?? ''),
      message: sanitizeUserFacingErrorMessage(String(item.message ?? '')),
      severity: item.severity === 'warning' ? 'warning' : 'error',
    }))
    .filter((item) => item.field || item.message);
};

const mapCtb = (row: RawCtb): FacturaRecibidaCtb => ({
  id: String(row.id),
  factura_id: String(row.factura_id),
  posicion: Number(row.posicion ?? 0),
  FRC_id: row.FRC_id ?? null,
  FRC_idfacturarecibida: row.FRC_idfacturarecibida ?? null,
  FRC_Cuenta: row.FRC_Cuenta ?? null,
  FRC_Importe: row.FRC_Importe ?? null,
  FRC_IdActividad: row.FRC_IdActividad ?? null,
  FRC_Idseccion: row.FRC_Idseccion ?? null,
  FRC_Iddepartamento: row.FRC_Iddepartamento ?? null,
  FRC_Idsubdepartamento: row.FRC_Idsubdepartamento ?? null,
  FRC_IdUsuarioLog: row.FRC_IdUsuarioLog ?? null,
  FRC_FechaLog: row.FRC_FechaLog ?? null,
  FRC_HoraLog: row.FRC_HoraLog ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export const mapPunteo = (row: RawPunteo): FacturaRecibidaPunteo => ({
  id: String(row.id),
  factura_id: String(row.factura_id),
  posicion: Number(row.posicion ?? 0),
  remote_id: row.remote_id ?? null,
  source_table: row.source_table ?? null,
  source_id: row.source_id ?? null,
  importe_factura: row.importe_factura ?? null,
  Origen: row.Origen ?? null,
  Serie: row.Serie ?? null,
  Albaran: row.Albaran ?? null,
  Ref: row.Ref ?? null,
  Fecha: row.Fecha ?? null,
  'Importe P': row['Importe P'] ?? null,
  Importe: row.Importe ?? null,
  S: row.S ?? false,
  Ver: row.Ver ?? false,
  empresa_id: row.empresa_id ?? null,
  proveedor_id: row.proveedor_id ?? null,
  cuenta_gasto: row.cuenta_gasto ?? null,
  line_count: row.line_count ?? 0,
  source_lines: row.source_lines ?? [],
  raw: row.raw ?? {},
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const mapAsientoApunte = (row: RawAsientoApunte): FacturaRecibidaAsientoApunte => ({
  id: row.id,
  asiento_id: row.asiento_id,
  posicion: row.posicion,
  cuenta: row.cuenta,
  descripcion: row.descripcion,
  debe: row.debe,
  haber: row.haber,
  analytic: row.analytic,
  raw: row.raw,
});

const mapAsiento = (row: RawAsiento): FacturaRecibidaAsiento => ({
  id: row.id,
  factura_id: row.factura_id,
  request_id: row.request_id,
  technical_id: row.technical_id,
  visible_number: row.visible_number,
  accounting_date: row.accounting_date,
  concept: row.concept,
  status: row.status,
  total_debit: row.total_debit,
  total_credit: row.total_credit,
  balanced: row.balanced,
  raw: row.raw,
  captured_at: row.captured_at,
  apuntes: (row.facturasrecibidas_asiento_apuntes ?? [])
    .map(mapAsientoApunte)
    .sort((left, right) => left.posicion - right.posicion),
});

const mapFactura = (row: RawFactura): FacturaRecibida => {
  const raw = row as unknown as Record<string, unknown>;
  const erpTargetId = String(raw.erp_target_id ?? '').trim() || null;
  const erpDatasetEpoch =
    String(raw.erp_dataset_epoch ?? '').trim() || null;
  const remoteFrrId = row.remote_frr_id ?? null;

  return {
  id: String(row.id),
  archivo_pdf_id: row.archivo_pdf_id ?? null,
  estado: (row.estado ?? 'pendiente_revision') as FacturaRecibidaEstado,
  source_kind: row.source_kind ?? null,
  remote_frr_id: remoteFrrId,
  is_readonly_reference: row.is_readonly_reference ?? false,
  match_status: row.match_status ?? null,
  match_evidence: row.match_evidence ?? null,
  proveedor_nombre: row.proveedor_nombre ?? null,
  proveedor_nif: row.proveedor_nif ?? null,
  source_pdf_name: row.source_pdf_name ?? null,
  source_page_number: row.source_page_number ?? null,
  source_page_count: row.source_page_count ?? null,
  email_from: row.email_from ?? null,
  email_subject: row.email_subject ?? null,
  email_received_at: row.email_received_at ?? null,
  confidence: row.confidence ?? null,
  extraction: row.extraction ?? null,
  validation_errors: asValidationErrors(row.validation_errors),
  duplicada_de: row.duplicada_de ?? null,
  erp_sent_at: row.erp_sent_at ?? null,
  erp_response: row.erp_response ?? null,
  erp_error: row.erp_error
    ? sanitizeUserFacingErrorMessage(row.erp_error)
    : null,
  row_version: row.row_version ?? 1,
  sync_status: row.sync_status ?? null,
  erp_validation_status:
    String(
      raw.erp_validation_status ?? '',
    ).trim() || null,
  erp_validation_request_id:
    String(
      raw.erp_validation_request_id ?? '',
    ).trim() || null,
  erp_validated_at:
    String(
      raw.erp_validated_at ?? '',
    ).trim() || null,
  erp_payload_hash:
    String(
      raw.erp_payload_hash ?? '',
    ).trim() || null,
  erp_business_fingerprint:
    String(raw.erp_business_fingerprint ?? '').trim() || null,
  erp_reference_status: normalizeFacturaERPReferenceStatus(
    raw.erp_reference_status,
    {
      targetId: erpTargetId,
      datasetEpoch: erpDatasetEpoch,
      hasRemoteIdentity: Boolean(remoteFrrId),
    },
  ),
  erp_target_id: erpTargetId,
  erp_dataset_epoch: erpDatasetEpoch,
  erp_verified_at:
    String(raw.erp_verified_at ?? '').trim() || null,
  accounting_status: row.accounting_status ?? null,
  accounting_visible_number: row.accounting_visible_number ?? null,
  accounting_date: row.accounting_date ?? null,
  erp_last_read_at: row.erp_last_read_at ?? null,
  erp_last_read_payload: row.erp_last_read_payload ?? null,
  last_request_id: row.last_request_id ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  FRR_id: row.FRR_id ?? null,
  FRR_numero: row.FRR_numero ?? null,
  FRR_ejercicio: row.FRR_ejercicio ?? null,
  FRR_idcentro: row.FRR_idcentro ?? null,
  FRR_idproveedor: row.FRR_idproveedor ?? null,
  FRR_idregimen: row.FRR_idregimen ?? null,
  FRR_idcuenta: row.FRR_idcuenta ?? null,
  FRR_numerofactura: row.FRR_numerofactura ?? null,
  FRR_fechafactura: row.FRR_fechafactura ?? null,
  FRR_fechactb: row.FRR_fechactb ?? null,
  fecha_ctb_source:
    raw.fecha_ctb_source === 'manual'
      ? 'manual'
      : raw.fecha_ctb_source === 'invoice_date'
        ? 'invoice_date'
        : null,
  FRR_Idempresa: row.FRR_Idempresa ?? null,
  FRR_base1: row.FRR_base1 ?? null,
  FRR_iva1: row.FRR_iva1 ?? null,
  FRR_cuota1: row.FRR_cuota1 ?? null,
  FRR_base2: row.FRR_base2 ?? null,
  FRR_iva2: row.FRR_iva2 ?? null,
  FRR_cuota2: row.FRR_cuota2 ?? null,
  FRR_base3: row.FRR_base3 ?? null,
  FRR_iva3: row.FRR_iva3 ?? null,
  FRR_cuota3: row.FRR_cuota3 ?? null,
  FRR_base4: row.FRR_base4 ?? null,
  FRR_iva4: row.FRR_iva4 ?? null,
  FRR_cuota4: row.FRR_cuota4 ?? null,
  FRR_base5: row.FRR_base5 ?? null,
  FRR_iva5: row.FRR_iva5 ?? null,
  FRR_cuota5: row.FRR_cuota5 ?? null,
  FRR_baseret: row.FRR_baseret ?? null,
  FRR_ret: row.FRR_ret ?? null,
  FRR_cuotaret: row.FRR_cuotaret ?? null,
  FRR_igasto1: row.FRR_igasto1 ?? null,
  FRR_ctagasto1: row.FRR_ctagasto1 ?? null,
  FRR_igasto2: row.FRR_igasto2 ?? null,
  FRR_ctagasto2: row.FRR_ctagasto2 ?? null,
  FRR_igasto3: row.FRR_igasto3 ?? null,
  FRR_ctagasto3: row.FRR_ctagasto3 ?? null,
  FRR_igasto4: row.FRR_igasto4 ?? null,
  FRR_ctagasto4: row.FRR_ctagasto4 ?? null,
  FRR_totalfac: row.FRR_totalfac ?? null,
  FRR_tipofactura: row.FRR_tipofactura ?? null,
  FRR_idpuntoventa: row.FRR_idpuntoventa ?? null,
  FRR_ClaveIRPF: row.FRR_ClaveIRPF ?? null,
  FRR_IdAsientoNet: row.FRR_IdAsientoNet ?? null,
  FRR_CtaCartera: row.FRR_CtaCartera ?? null,
  FRR_IdBanco: row.FRR_IdBanco ?? null,
  FRR_IdFormaPago: row.FRR_IdFormaPago ?? null,
  FechaVto: row.FechaVto ?? null,
  ImporteVto: row.ImporteVto ?? null,
  FRR_Modificable: row.FRR_Modificable ?? null,
  FRR_idpago: row.FRR_idpago ?? null,
  FRR_IdUsuarioLog: row.FRR_IdUsuarioLog ?? null,
  FRR_FechaLog: row.FRR_FechaLog ?? null,
  FRR_HoraLog: row.FRR_HoraLog ?? null,
  FRR_GeneraCartera: row.FRR_GeneraCartera ?? null,
  FRR_FechaVto1: row.FRR_FechaVto1 ?? null,
  FRR_ImporteVto1: row.FRR_ImporteVto1 ?? null,
  FRR_FechaVto2: row.FRR_FechaVto2 ?? null,
  FRR_ImporteVto2: row.FRR_ImporteVto2 ?? null,
  FRR_FechaVto3: row.FRR_FechaVto3 ?? null,
  FRR_ImporteVto3: row.FRR_ImporteVto3 ?? null,
  FRR_IdTipoDoc: row.FRR_IdTipoDoc ?? null,
  FRR_IdAgricultorDto: row.FRR_IdAgricultorDto ?? null,
  FRR_CtaSuplido: row.FRR_CtaSuplido ?? null,
  FRR_Concepto: row.FRR_Concepto ?? null,
  FRR_Observaciones: row.FRR_Observaciones ?? null,
  FRR_ObservacionesAEAT: row.FRR_ObservacionesAEAT ?? null,
  FRR_ImpSuplido: row.FRR_ImpSuplido ?? null,
  FRR_CuotaNoDeducible: row.FRR_CuotaNoDeducible ?? null,
  FRR_FechaPrevPago: row.FRR_FechaPrevPago ?? null,
  FRR_BancoPrevPago: row.FRR_BancoPrevPago ?? null,
  FRR_IdSeccion: row.FRR_IdSeccion ?? null,
  FRR_IdActividad: row.FRR_IdActividad ?? null,
  FRR_CancelarporCtb: row.FRR_CancelarporCtb ?? null,
  FRR_Contabilizar: row.FRR_Contabilizar ?? null,
  FRR_IdfacturaRec: row.FRR_IdfacturaRec ?? null,
  erp_sent_by: row.erp_sent_by ?? null,
  created_by: row.created_by ?? null,
  updated_by: row.updated_by ?? null,
  ctb: ((row.facturasrecibidas_ctb ?? row.ctb ?? []) as RawCtb[])
    .map(mapCtb)
    .sort((left, right) => left.posicion - right.posicion),
  punteos: ((row.facturasrecibidas_punteos ?? row.punteos ?? []) as RawPunteo[])
    .map(mapPunteo)
    .sort((left, right) => left.posicion - right.posicion),
  asientos: (row.facturasrecibidas_asientos ?? [])
    .map(mapAsiento)
    .sort((left, right) => right.captured_at.localeCompare(left.captured_at)),
  };
};

class FacturasRecibidasService {
  async list(filters: FacturaRecibidaListFilters): Promise<FacturaRecibidaPage> {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.max(1, Math.min(filters.pageSize || 20, 100));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('facturasrecibidas')
      .select('*, facturasrecibidas_ctb(*), facturasrecibidas_punteos(*)', { count: 'exact' })
      .not(
        'source_kind',
        'in',
        `(${FACTURA_RECIBIDA_NON_INBOX_SOURCE_KINDS.join(',')})`,
      );

    if (filters.estado && filters.estado !== 'all') {
      query = query.eq('estado', filters.estado);
    }

    if (filters.proveedor?.trim()) {
      const value = filters.proveedor.trim().replace(/[%,]/g, '');
      query = query.or(`proveedor_nombre.ilike.%${value}%,FRR_idproveedor.eq.${Number(value) || -1}`);
    }

    if (filters.nif?.trim()) {
      const value = filters.nif.trim().replace(/[%,]/g, '');
      query = query.ilike('proveedor_nif', `%${value}%`);
    }

    if (filters.numero?.trim()) {
      const value = filters.numero.trim().replace(/[%,]/g, '');
      const numeric = Number(value);
      query = Number.isFinite(numeric)
        ? query.or(`FRR_numerofactura.ilike.%${value}%,FRR_numero.eq.${Math.trunc(numeric)}`)
        : query.ilike('FRR_numerofactura', `%${value}%`);
    }

    if (filters.fechaFrom) query = query.gte('FRR_fechafactura', filters.fechaFrom);
    if (filters.fechaTo) query = query.lte('FRR_fechafactura', filters.fechaTo);
    if (typeof filters.totalFrom === 'number') query = query.gte('FRR_totalfac', filters.totalFrom);
    if (typeof filters.totalTo === 'number') query = query.lte('FRR_totalfac', filters.totalTo);

    if (filters.erpStatus === 'sent') {
      query = query
        .filter('erp_reference_status', 'eq', 'valid')
        .eq('sync_status', 'sent')
        .not('erp_target_id', 'is', null)
        .not('erp_dataset_epoch', 'is', null)
        .not('remote_frr_id', 'is', null)
        .not('erp_verified_at', 'is', null);
    } else if (filters.erpStatus === 'not_sent') {
      query = query.or(
        'sync_status.neq.sent,sync_status.is.null,erp_reference_status.neq.valid,erp_reference_status.is.null,erp_target_id.is.null,erp_dataset_epoch.is.null,remote_frr_id.is.null,erp_verified_at.is.null',
      );
    }

    if (!filters.includeDiscarded) {
      query = query.neq('estado', 'descartada');
    }

    const sortConfig = {
      created_desc: { column: 'created_at', ascending: false },
      created_asc: { column: 'created_at', ascending: true },
      fecha_desc: { column: 'FRR_fechafactura', ascending: false },
      fecha_asc: { column: 'FRR_fechafactura', ascending: true },
      total_desc: { column: 'FRR_totalfac', ascending: false },
      total_asc: { column: 'FRR_totalfac', ascending: true },
    }[filters.sortOrder ?? 'created_desc'];

    const { data, count, error } = await query
      .order(sortConfig.column, { ascending: sortConfig.ascending, nullsFirst: false })
      .order('posicion', { referencedTable: 'facturasrecibidas_ctb', ascending: true })
      .order('posicion', { referencedTable: 'facturasrecibidas_punteos', ascending: true })
      .range(from, to);

    if (error) throw error;
    return {
      items: ((data ?? []) as RawFactura[]).map(mapFactura),
      total: count ?? 0,
    };
  }

  async getById(id: string): Promise<FacturaRecibida | null> {
    const { data, error } = await supabase
      .from('facturasrecibidas')
      .select(
        '*, facturasrecibidas_ctb(*), facturasrecibidas_punteos(*), facturasrecibidas_asientos(*, facturasrecibidas_asiento_apuntes(*))',
      )
      .eq('id', id)
      .order('posicion', { referencedTable: 'facturasrecibidas_ctb', ascending: true })
      .order('posicion', { referencedTable: 'facturasrecibidas_punteos', ascending: true })
      .maybeSingle();

    if (error) throw error;
    return data ? mapFactura(data) : null;
  }

  async getPdfBase64(archivoPdfId: number): Promise<{ base64: string; fileName: string | null }> {
    const { data, error } = await supabase
      .from('archivos_pdf')
      .select('b64_contenido, storage_bucket, storage_path, nombre_archivo')
      .eq('id', archivoPdfId)
      .single();

    if (error) throw error;
    if (data?.b64_contenido) {
      return {
        base64: data.b64_contenido,
        fileName: data?.nombre_archivo ?? null,
      };
    }

    if (data?.storage_bucket && data?.storage_path) {
      const { data: blob, error: downloadError } = await supabase.storage
        .from(data.storage_bucket)
        .download(data.storage_path);
      if (downloadError) throw downloadError;
      if (blob) {
        return {
          base64: await blobToBase64(blob),
          fileName: data?.nombre_archivo ?? null,
        };
      }
    }

    return {
      base64: '',
      fileName: data?.nombre_archivo ?? null,
    };
  }

  async update(payload: FacturaRecibidaUpdatePayload): Promise<FacturaRecibida> {
    const { data, error } = await supabase.functions.invoke('factura-recibida-update', {
      body: {
        contract_version: 2,
        request_id: crypto.randomUUID(),
        ...payload,
      },
    });
    if (error) throw error;
    const message = getFunctionErrorMessage(data);
    if (message) throw new Error(message);
    const updated = await this.getById(payload.factura_id);
    if (!updated) throw new Error('Factura no encontrada tras guardar.');
    return updated;
  }

  private async executeERPOperation(
    operation: 'validate' | 'commit' | 'reconcile',
    facturaId: string,
    version?: number | null,
    requestId?: string | null,
  ): Promise<FacturaRecibida> {
    const expectedVersion = version ?? (await this.getById(facturaId))?.row_version ?? null;
    if (!expectedVersion) throw new Error('No se pudo determinar la versión de la factura antes del envío.');
    const operationRequestId = requestId ?? crypto.randomUUID();
    const { data, error } = await supabase.functions.invoke('factura-recibida-send-erp', {
      body: {
        contract_version: 3,
        operation,
        request_id: operationRequestId,
        factura_id: facturaId,
        expected_version: expectedVersion,
      },
    });
    const structuredError = extractERPErrorData(data, {
      requestId: operationRequestId,
    });
    if (error && !structuredError?.reconciliationRequired) {
      throw await getFunctionInvokeERPError(
        error,
        data,
        operationRequestId,
      );
    }
    if (structuredError && !structuredError.reconciliationRequired) {
      throw new FacturaERPServiceError(structuredError);
    }
    const updated = await this.getById(facturaId);
    if (!updated) throw new Error('Factura no encontrada tras operar con el ERP.');
    return updated;
  }

  async validateERP(
    facturaId: string,
    version?: number | null,
    requestId?: string | null,
  ): Promise<FacturaRecibida> {
    return this.executeERPOperation('validate', facturaId, version, requestId);
  }

  async commitERP(
    facturaId: string,
    version?: number | null,
    requestId?: string | null,
  ): Promise<FacturaRecibida> {
    return this.executeERPOperation('commit', facturaId, version, requestId);
  }

  async reconcileERP(
    facturaId: string,
    version?: number | null,
    requestId?: string | null,
  ): Promise<FacturaRecibida> {
    return this.executeERPOperation('reconcile', facturaId, version, requestId);
  }

  async delete(facturaId: string, version?: number | null): Promise<void> {
    const expectedVersion = version ?? (await this.getById(facturaId))?.row_version ?? null;
    if (!expectedVersion) throw new Error('No se pudo determinar la versión de la factura antes de borrarla.');
    const { data, error } = await supabase.functions.invoke('factura-recibida-delete', {
      body: {
        contract_version: 2,
        request_id: crypto.randomUUID(),
        factura_id: facturaId,
        expected_version: expectedVersion,
      },
    });
    if (error) throw error;
    const message = getFunctionErrorMessage(data);
    if (message) throw new Error(message);
  }
}

export const facturasRecibidas = new FacturasRecibidasService();
