import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/integrations/supabase/client';
import {
  getFacturaERPRegistrationState,
  normalizeFacturaERPReferenceStatus,
} from '@/lib/facturasErpStatus';
import { sanitizeUserFacingErrorMessage } from '@/lib/userFacingErrors';
import { facturasRecibidas } from '@/services/facturasRecibidas';
import type {
  AlbaranEntradaLineaERP,
  FacturaRecibida as UiFacturaRecibida,
  FacturaRecibidaAccounting,
  FacturaRecibidaAsientoLinea,
  FacturaRecibidaEstado as UiFacturaEstado,
  FacturaRecibidaIvaTramo,
  FacturaRecibidaLinea,
  FacturaRecibidaPunteo,
  FacturaRecibidaPunteoLinea,
  FacturaValidationIssue,
  FacturaRecibidaVencimiento,
} from '@/services/apiContracts';
import type {
  FacturaRecibida as ERPFacturaRecibida,
  FacturaRecibidaEstado as ERPFacturaEstado,
} from '@/types/facturasRecibidas';
import { nullableNumber } from '@/types/facturasRecibidas';

const PDF_PATH_PREFIX = 'archivo_pdf_id:';
const MAX_FACTURA_PDF_BYTES = 20 * 1024 * 1024;
const ERP_READ_FUNCTION = 'facturas-recibidas-erp-read';
const ERP_READ_SOURCE = 'erp-read';
const ERP_REMOTE_ID_PREFIX = 'erp:';

type ERPReadListResponse<T> = {
  items?: T[];
  limit?: number;
  offset?: number;
  total?: number;
};

type ERPReadFacturaRow = Record<string, unknown>;
type ERPReadCtbRow = Record<string, unknown>;
type ERPReadPunteoRow = Record<string, unknown>;
type ERPReadGenericRow = Record<string, unknown>;
type ERPReadAccountingResponse = {
  factura_id?: number | null;
  accounting?: Record<string, unknown>;
  entries?: Array<Record<string, unknown>>;
  warnings?: string[];
};

export type FacturaEmpresaOption = {
  id: string;
  nombre: string | null;
  cif: string | null;
  label: string;
};

export type FacturaTipoOption = {
  value: string;
  label: string;
};

export type FacturaRegimenOption = {
  value: string;
  label: string;
};

export type FacturaCuentaOption = {
  value: string;
  label: string;
  description: string | null;
  nif: string | null;
};

export type FacturaTipoIvaOption = {
  value: string;
  porcentaje: number;
  label: string;
  nombre: string | null;
};

export type FacturaERPMatch = {
  frrId: number;
  numero: number | null;
  numeroFactura: string | null;
  proveedor: string | null;
  fecha: string | null;
  total: number | null;
};

export type FacturaRecibidaPageOptions = {
  page: number;
  pageSize: number;
  proveedor?: string;
  numero?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  erpStatus?: 'all' | 'sent' | 'not_sent';
  sortOrder?:
    | 'created_desc'
    | 'created_asc'
    | 'fecha_desc'
    | 'fecha_asc'
    | 'total_desc'
    | 'total_asc';
};

export type FacturaRecibidaUiPage = {
  items: UiFacturaRecibida[];
  total: number;
  page: number;
  pageSize: number;
};

export type FacturasRecibidasERPRuntime = {
  target_id: string | null;
  dataset_epoch: string | null;
  snapshot_at: string | null;
  write_mode: 'disabled' | 'blocked' | 'management';
  accounting_mode: 'unavailable' | 'official';
  ready_for_commit: boolean;
  capabilities: {
    validate: boolean;
    management_commit: boolean;
    accounting_commit: boolean;
  };
};

export type AlbaranEntrada = {
  id: number;
  localId: string | null;
  estado: string | null;
  campa: number | null;
  serie: string | null;
  numero: number | null;
  fecha: string | null;
  agricultorId: number | null;
  agricultorNombre: string | null;
  puntoVentaId: number | null;
  centroId: number | null;
  referencia: string | null;
  empresaAgricultorId: number | null;
  syncStatus: string | null;
  sourceKind: string | null;
  sourcePdfName: string | null;
  confidence: number | null;
  erpSentAt: string | null;
  erpLastReadAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AlbaranEntradaPageOptions = {
  page: number;
  pageSize: number;
  agricultorId?: number | null;
  serie?: string;
  numero?: number | null;
  fechaDesde?: string;
  fechaHasta?: string;
};

export type AlbaranEntradaPage = {
  items: AlbaranEntrada[];
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

const cleanText = (value: unknown) => {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
};

const numberValue = (value: unknown, fallback: number | null = null) => {
  const parsed = nullableNumber(value);
  return parsed ?? fallback;
};

const hasOwnValue = (source: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(source, key);

const suppliedTextOrCurrent = (
  factura: Partial<UiFacturaRecibida>,
  key: keyof UiFacturaRecibida,
  current: string | null | undefined,
) => hasOwnValue(factura, key) ? cleanText(factura[key]) : current ?? null;

const suppliedNumberOrCurrent = (
  factura: Partial<UiFacturaRecibida>,
  key: keyof UiFacturaRecibida,
  current: number | null | undefined,
) => hasOwnValue(factura, key) ? numberValue(factura[key], null) : current ?? null;

const firstValue = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && String(source[key]).trim() !== '') {
      return source[key];
    }
  }
  return null;
};

const readNumber = (source: Record<string, unknown>, keys: string[], fallback: number | null = null) =>
  numberValue(firstValue(source, keys), fallback);

const readText = (source: Record<string, unknown>, keys: string[], fallback: string | null = null) =>
  cleanText(firstValue(source, keys)) ?? fallback;

const readBoolean = (
  source: Record<string, unknown>,
  keys: string[],
  fallback: boolean | null = null,
) => {
  const value = firstValue(source, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 's', 'si', 'sí', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'n', 'no'].includes(normalized)) return false;
  }
  return fallback;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asRecordArray = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];

const buildIvaTramos = (source: Record<string, unknown>): FacturaRecibidaIvaTramo[] =>
  [1, 2, 3, 4, 5].map((posicion) => ({
    posicion: posicion as FacturaRecibidaIvaTramo['posicion'],
    base: readNumber(source, [`FRR_base${posicion}`, `base${posicion}`], null),
    porcentaje: readNumber(source, [`FRR_iva${posicion}`, `iva${posicion}`], null),
    cuota: readNumber(source, [`FRR_cuota${posicion}`, `cuota${posicion}`], null),
  }));

const buildVencimientos = (source: Record<string, unknown>): FacturaRecibidaVencimiento[] => [
  {
    posicion: 1,
    fecha: readText(source, ['FechaVto', 'fecha_vto'], null),
    importe: readNumber(source, ['ImporteVto', 'importe_vto'], null),
  },
  ...[1, 2, 3].map((slot, index) => ({
    posicion: (index + 2) as FacturaRecibidaVencimiento['posicion'],
    fecha: readText(source, [`FRR_FechaVto${slot}`, `fecha_vto${slot}`], null),
    importe: readNumber(source, [`FRR_ImporteVto${slot}`, `importe_vto${slot}`], null),
  })),
];

const totalIvaBase = (tramos: FacturaRecibidaIvaTramo[]) =>
  tramos.reduce((sum, tramo) => sum + (tramo.base ?? 0), 0);

const totalIvaCuota = (tramos: FacturaRecibidaIvaTramo[]) =>
  tramos.reduce((sum, tramo) => sum + (tramo.cuota ?? 0), 0);

const mapPunteoLinea = (linea: Record<string, unknown>, index: number): FacturaRecibidaPunteoLinea => ({
  id: firstValue(linea, ['line_id', 'id', 'AML_id', 'ID']) as string | number | null,
  posicion: readNumber(linea, ['position', 'posicion', 'linea'], index + 1),
  articulo_id: firstValue(linea, ['article_id', 'articulo_id', 'id_articulo']) as string | number | null,
  descripcion: readText(linea, ['description', 'descripcion', 'articulo', 'nombre'], null),
  referencia: readText(linea, ['reference', 'referencia'], null),
  cantidad: readNumber(linea, ['quantity', 'cantidad', 'unidades'], null),
  precio: readNumber(linea, ['unit_price', 'purchase_price', 'price', 'precio'], null),
  importe: readNumber(linea, ['amount', 'importe', 'total'], null),
  observaciones: readText(linea, ['observations', 'observaciones'], null),
  unidad_id: firstValue(linea, ['unit_id', 'unidad_id']) as string | number | null,
  raw: Object.keys(asRecord(linea.raw)).length > 0 ? asRecord(linea.raw) : linea,
});

const mapAccountingEntry = (
  entry: Record<string, unknown>,
  index: number,
): FacturaRecibidaAsientoLinea => ({
  id: firstValue(entry, ['id', 'entry_id', 'apunte_id']) as string | number | null,
  posicion: readNumber(entry, ['position', 'posicion'], index + 1) ?? index + 1,
  cuenta: readText(entry, ['account', 'cuenta'], null),
  descripcion: readText(entry, ['description', 'descripcion', 'concept'], null),
  debe: readNumber(entry, ['debit', 'debe'], 0) ?? 0,
  haber: readNumber(entry, ['credit', 'haber'], 0) ?? 0,
  actividad_id: readNumber(entry, ['activity_id', 'actividad_id', 'FRC_IdActividad'], null),
  seccion_id: readNumber(entry, ['section_id', 'seccion_id', 'FRC_Idseccion'], null),
  departamento_id: readNumber(entry, ['department_id', 'departamento_id', 'FRC_Iddepartamento'], null),
  subdepartamento_id: readNumber(entry, ['subdepartment_id', 'subdepartamento_id', 'FRC_Idsubdepartamento'], null),
  raw: asRecord(entry.raw),
});

const mapAccounting = (
  factura: Record<string, unknown>,
  response?: ERPReadAccountingResponse | null,
): FacturaRecibidaAccounting => {
  const accounting = asRecord(response?.accounting ?? factura.accounting);
  const entries = response?.entries ?? asRecordArray(factura.accounting_entries ?? factura.asiento_lineas);
  const technicalId =
    readNumber(accounting, ['technical_id'], null) ??
    readNumber(factura, ['accounting_technical_id', 'FRR_IdAsientoNet'], null);
  const visibleNumber =
    readText(accounting, ['visible_number'], null) ??
    readText(factura, ['accounting_visible_number', 'asiento_numero'], null);
  const status =
    readText(accounting, ['status'], null) ??
    readText(factura, ['accounting_status', 'asiento_estado'], null) ??
    (technicalId ? 'pending' : 'not_requested');
  const lines = entries.map(mapAccountingEntry);
  const calculatedDebit = lines.reduce((sum, line) => sum + line.debe, 0);
  const calculatedCredit = lines.reduce((sum, line) => sum + line.haber, 0);

  return {
    requested: readBoolean(accounting, ['requested'], Boolean(technicalId)) ?? false,
    created: readBoolean(accounting, ['created'], status === 'created') ?? false,
    status,
    technical_id: technicalId,
    visible_number: visibleNumber,
    fecha:
      readText(accounting, ['date', 'fecha'], null) ??
      readText(factura, ['accounting_date', 'asiento_fecha'], null),
    concepto:
      readText(accounting, ['concept', 'concepto'], null) ??
      readText(factura, ['FRR_Concepto', 'concepto'], null),
    balanced:
      readBoolean(accounting, ['balanced', 'cuadrado'], null) ??
      (lines.length ? Math.abs(calculatedDebit - calculatedCredit) <= 0.01 : null),
    total_debe: readNumber(accounting, ['total_debit', 'total_debe'], lines.length ? calculatedDebit : null),
    total_haber: readNumber(accounting, ['total_credit', 'total_haber'], lines.length ? calculatedCredit : null),
    lines,
    error: (() => {
      const message = readText(accounting, ['error'], null);
      return message ? sanitizeUserFacingErrorMessage(message) : null;
    })(),
  };
};

const responseItems = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.datos)) return record.datos;
  return [];
};

const erpRemoteId = (id: unknown) => `${ERP_REMOTE_ID_PREFIX}${String(id ?? '').trim()}`;

const erpIdFromUiId = (id?: string | null) => {
  if (!id?.startsWith(ERP_REMOTE_ID_PREFIX)) return null;
  const parsed = Number(id.slice(ERP_REMOTE_ID_PREFIX.length));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

export const isERPReadOnlyFactura = (factura: Partial<UiFacturaRecibida> | null | undefined) =>
  factura?.erp_payload?.source === ERP_READ_SOURCE ||
  factura?.is_readonly_reference === true ||
  factura?.source_kind === 'erp_reference' ||
  Boolean(cleanText(factura?.erp_factura_id)) ||
  Boolean(factura?.remote_frr_id) ||
  factura?.accounting?.created === true ||
  factura?.asiento_estado === 'created' ||
  ['sending', 'unknown', 'reconciling', 'sent'].includes(factura?.sync_status ?? '') ||
  Boolean(erpIdFromUiId(factura?.id ?? null));

export const isERPReferenceFactura = (factura: Partial<UiFacturaRecibida> | null | undefined) =>
  factura?.erp_payload?.source === ERP_READ_SOURCE ||
  factura?.is_readonly_reference === true ||
  factura?.source_kind === 'erp_reference' ||
  Boolean(erpIdFromUiId(factura?.id ?? null));

const erpRead = async <T>(consulta: string): Promise<T> => {
  const { data, error } = await supabase.functions.invoke(ERP_READ_FUNCTION, {
    body: {
      contract_version: 2,
      request_id: crypto.randomUUID(),
      consulta,
    },
  });
  if (error) {
    throw new Error(
      (await getFunctionInvokeErrorMessage(error, data)) ??
        'No se pudo consultar la informacion de facturas en el ERP.',
    );
  }
  const message = getFunctionErrorMessage(data);
  if (message) throw new Error(message);
  if (
    data &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).contract_version === 2
  ) {
    const envelope = data as { ok?: boolean; data?: unknown };
    if (envelope.ok === false) throw new Error('El ERP no pudo completar la consulta.');
    return envelope.data as T;
  }
  return data as T;
};

export const fetchFacturasRecibidasERPRuntime =
  async (): Promise<FacturasRecibidasERPRuntime> => {
    const requestId = crypto.randomUUID();
    const { data, error } = await supabase.functions.invoke(
      'facturas-recibidas-erp-runtime',
      {
        body: {
          contract_version: 3,
          request_id: requestId,
        },
      },
    );
    if (error) {
      throw new Error(
        (await getFunctionInvokeErrorMessage(error, data)) ??
          'No se pudo comprobar la capacidad actual del ERP.',
      );
    }
    const message = getFunctionErrorMessage(data);
    if (message) throw new Error(message);

    const envelope = asRecord(data);
    const runtime = asRecord(envelope.runtime);
    const capabilities = asRecord(runtime.capabilities);
    const writeMode = cleanText(runtime.write_mode);
    const accountingMode = cleanText(runtime.accounting_mode);
    if (
      envelope.ok !== true ||
      !['disabled', 'blocked', 'management'].includes(writeMode ?? '') ||
      !['unavailable', 'official'].includes(accountingMode ?? '') ||
      typeof runtime.ready_for_commit !== 'boolean' ||
      typeof capabilities.validate !== 'boolean' ||
      typeof capabilities.management_commit !== 'boolean' ||
      typeof capabilities.accounting_commit !== 'boolean'
    ) {
      throw new Error(
        'El ERP no devolvió una descripción válida de sus capacidades.',
      );
    }

    return {
      target_id: cleanText(runtime.target_id),
      dataset_epoch: cleanText(runtime.dataset_epoch),
      snapshot_at: cleanText(runtime.snapshot_at),
      write_mode: writeMode as FacturasRecibidasERPRuntime['write_mode'],
      accounting_mode:
        accountingMode as FacturasRecibidasERPRuntime['accounting_mode'],
      ready_for_commit: runtime.ready_for_commit,
      capabilities: {
        validate: capabilities.validate,
        management_commit: capabilities.management_commit,
        accounting_commit: capabilities.accounting_commit,
      },
    };
  };

const mapEstadoToUi = (estado: ERPFacturaEstado): UiFacturaEstado => {
  if (estado === 'enviada_erp') return 'enviada_erp';
  if (estado === 'error_erp') return 'error_erp';
  if (estado === 'descartada') return 'descartada';
  if (estado === 'validada' || estado === 'preparada_erp') return 'validada';
  return 'pendiente_revision';
};

const mapEstadoToERP = (estado?: UiFacturaEstado): ERPFacturaEstado | undefined => {
  if (!estado) return undefined;
  if (estado === 'enviada_erp') return 'enviada_erp';
  if (estado === 'error_erp') return 'error_erp';
  if (estado === 'descartada') return 'descartada';
  if (estado === 'validada') return 'validada';
  return 'pendiente_revision';
};

const pdfPathFromId = (archivoPdfId?: number | null) =>
  archivoPdfId ? `${PDF_PATH_PREFIX}${archivoPdfId}` : null;

const pdfIdFromPath = (pdfPath?: string | null) => {
  if (!pdfPath?.startsWith(PDF_PATH_PREFIX)) return null;
  const id = Number(pdfPath.slice(PDF_PATH_PREFIX.length));
  return Number.isFinite(id) ? id : null;
};

const normalizeIssueToken = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

export const normalizeFacturaValidationIssues = (value: unknown): FacturaValidationIssue[] => {
  const issues = Array.isArray(value) ? value : [];
  const deduplicated = new Map<string, FacturaValidationIssue>();

  for (const rawIssue of issues) {
    const record = typeof rawIssue === 'object' && rawIssue !== null && !Array.isArray(rawIssue)
      ? (rawIssue as Record<string, unknown>)
      : null;
    const rawMessage = cleanText(record?.message ?? rawIssue);
    if (!rawMessage) continue;
    const message = sanitizeUserFacingErrorMessage(rawMessage);

    const code = cleanText(record?.code);
    const field = cleanText(record?.field) ?? '_global';
    const severity = normalizeIssueToken(record?.severity) === 'warning' ? 'warning' : 'error';
    const details = record?.details && typeof record.details === 'object' && !Array.isArray(record.details)
      ? (record.details as Record<string, unknown>)
      : null;
    const issue: FacturaValidationIssue = { code, field, message, severity, details };
    const normalizedField = normalizeIssueToken(field);
    const isGlobalIssue = normalizedField === '_global' || normalizedField === 'metadata.warnings';
    const key = isGlobalIssue
      ? `message:${normalizeIssueToken(message)}`
      : `field:${normalizedField}`;
    const previous = deduplicated.get(key);

    if (!previous || (previous.severity === 'warning' && severity === 'error')) {
      deduplicated.set(key, issue);
    }
  }

  return Array.from(deduplicated.values());
};

export const partitionFacturaValidationIssues = (value: unknown) => {
  const issues = normalizeFacturaValidationIssues(value);
  return {
    issues,
    errors: issues.filter((issue) => issue.severity === 'error'),
    warnings: issues.filter((issue) => issue.severity === 'warning'),
  };
};

export type FacturaERPSendConfirmation = 'confirmed' | 'reference_only' | 'reconciling' | 'unconfirmed';

export const getFacturaERPReconciliationRequestId = (
  factura: Partial<UiFacturaRecibida> | null | undefined,
) => {
  if (!factura || !['unknown', 'reconciling'].includes(normalizeIssueToken(factura.sync_status))) {
    return null;
  }
  const requestId = cleanText(factura.last_request_id);
  return requestId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
    ? requestId
    : null;
};

export const getFacturaERPSendConfirmation = (
  factura: Partial<UiFacturaRecibida> | null | undefined,
): FacturaERPSendConfirmation => {
  if (!factura) return 'unconfirmed';
  const registrationState = getFacturaERPRegistrationState(factura);
  if (registrationState === 'confirmed') return 'confirmed';
  if (
    registrationState === 'sending' ||
    registrationState === 'uncertain'
  ) {
    return 'reconciling';
  }

  const response = asRecord(factura.erp_response);
  const responseData = asRecord(response.data ?? response.result);
  const responseAccounting = asRecord(
    response.accounting ?? responseData.accounting ?? response.readback ?? responseData.readback,
  );
  const readbackStatus = normalizeIssueToken(
    factura.accounting?.status ??
      factura.asiento_estado ??
      factura.accounting_status ??
      firstValue(responseAccounting, ['status', 'accounting_status']) ??
      firstValue(responseData, ['accounting_status', 'status']) ??
      firstValue(response, ['accounting_status', 'status']),
  );
  const referenceOnly =
    readbackStatus === 'reference_only' ||
    readBoolean(responseAccounting, ['reference_only'], false) === true ||
    readBoolean(responseData, ['reference_only'], false) === true ||
    readBoolean(response, ['reference_only'], false) === true;
  if (referenceOnly || isERPReferenceFactura(factura)) {
    return 'reference_only';
  }
  if (readbackStatus === 'unknown') {
    return 'reconciling';
  }
  return 'unconfirmed';
};

const validationIssues = (factura: ERPFacturaRecibida) =>
  normalizeFacturaValidationIssues(factura.validation_errors);

const mapLineToUi = (linea: ERPFacturaRecibida['ctb'][number], index: number): FacturaRecibidaLinea => ({
  id: linea.id,
  factura_recibida_id: linea.factura_id,
  posicion: linea.posicion ?? index + 1,
  descripcion: linea.FRC_Cuenta ?? '',
  importe: linea.FRC_Importe ?? 0,
  FRC_id: linea.FRC_id,
  FRC_idfacturarecibida: linea.FRC_idfacturarecibida,
  FRC_IdActividad: linea.FRC_IdActividad,
  FRC_Idseccion: linea.FRC_Idseccion,
  FRC_Iddepartamento: linea.FRC_Iddepartamento,
  FRC_Idsubdepartamento: linea.FRC_Idsubdepartamento,
  FRC_IdUsuarioLog: linea.FRC_IdUsuarioLog,
  FRC_FechaLog: linea.FRC_FechaLog,
  FRC_HoraLog: linea.FRC_HoraLog,
  created_at: linea.created_at,
  updated_at: linea.updated_at,
});

const mapGastosToUi = (factura: ERPFacturaRecibida): FacturaRecibidaLinea[] =>
  [1, 2, 3, 4]
    .map((slot): FacturaRecibidaLinea | null => {
      const importe = Number((factura as unknown as Record<string, unknown>)[`FRR_igasto${slot}`] ?? 0);
      const cuenta = cleanText((factura as unknown as Record<string, unknown>)[`FRR_ctagasto${slot}`]);
      if (!cuenta && Math.abs(importe) <= 0.01) return null;
      return {
        posicion: slot,
        descripcion: cuenta ?? '',
        importe: Number.isFinite(importe) ? importe : 0,
      } satisfies FacturaRecibidaLinea;
    })
    .filter((linea): linea is FacturaRecibidaLinea => Boolean(linea));

const mapPunteoToUi = (punteo: ERPFacturaRecibida['punteos'][number]): FacturaRecibidaPunteo => ({
  id: punteo.id,
  posicion: punteo.posicion,
  remote_id: punteo.remote_id,
  source_table: punteo.source_table,
  source_id: punteo.source_id,
  albaran_id:
    readNumber(punteo as unknown as Record<string, unknown>, ['albaran_id'], null) ??
    readNumber(asRecord(punteo.raw), ['albaran_id'], null),
  importe_factura: punteo.importe_factura,
  origen: punteo.Origen,
  serie: punteo.Serie,
  albaran: punteo.Albaran,
  ref: punteo.Ref,
  fecha: punteo.Fecha,
  importe_punteado: punteo['Importe P'],
  importe: punteo.Importe,
  seleccionado: punteo.S,
  ver: punteo.Ver,
  empresa_id: punteo.empresa_id,
  proveedor_id: punteo.proveedor_id,
  cuenta_gasto: punteo.cuenta_gasto,
  line_count: punteo.line_count,
  lines_loaded: false,
  lines: asRecordArray(punteo.source_lines).map(mapPunteoLinea),
  raw: asRecord(punteo.raw),
});

export const mapFacturaToUi = (factura: ERPFacturaRecibida): UiFacturaRecibida => {
  const source = factura as unknown as Record<string, unknown>;
  const ivaTramos = buildIvaTramos(source);
  const vencimientos = buildVencimientos(source);
  const latestAsiento = factura.asientos[0] ?? null;
  const accounting = mapAccounting(
    source,
    latestAsiento
      ? {
          accounting: {
            requested: true,
            created: latestAsiento.status === 'created',
            status: latestAsiento.status,
            technical_id: latestAsiento.technical_id,
            visible_number: latestAsiento.visible_number,
            date: latestAsiento.accounting_date,
            concept: latestAsiento.concept,
            balanced: latestAsiento.balanced,
            total_debit: latestAsiento.total_debit,
            total_credit: latestAsiento.total_credit,
          },
          entries: latestAsiento.apuntes.map((linea) => ({
            id: linea.id,
            position: linea.posicion,
            account: linea.cuenta,
            description: linea.descripcion,
            debit: linea.debe,
            credit: linea.haber,
            raw: linea.raw,
          })),
        }
      : null,
  );

  return {
  id: factura.id,
  documento_codigo:
    cleanText(factura.FRR_id) ??
    cleanText(factura.FRR_numero) ??
    cleanText(factura.source_pdf_name) ??
    null,
  estado: mapEstadoToUi(factura.estado),
  proveedor_nombre: factura.proveedor_nombre,
  proveedor_nif: factura.proveedor_nif,
  proveedor_codigo: cleanText(factura.FRR_idproveedor),
  proveedor_cuenta: cleanText(factura.FRR_idcuenta),
  numero_factura: factura.FRR_numerofactura,
  referencia: cleanText(factura.FRR_numero),
  ejercicio: factura.FRR_ejercicio,
  fecha_ctb: factura.FRR_fechactb,
  fecha_ctb_source:
    factura.fecha_ctb_source ??
    (factura.FRR_fechactb &&
    factura.FRR_fechactb === factura.FRR_fechafactura
      ? 'invoice_date'
      : 'manual'),
  tipo_iva_codigo: cleanText(factura.FRR_idregimen),
  asiento: factura.FRR_IdAsientoNet,
  asiento_tecnico: accounting.technical_id,
  asiento_numero: accounting.visible_number,
  asiento_fecha: accounting.fecha,
  asiento_estado: accounting.status,
  asiento_cuadrado: accounting.balanced,
  asiento_total_debe: accounting.total_debe,
  asiento_total_haber: accounting.total_haber,
  asiento_lineas: accounting.lines,
  accounting,
  fr_alm: cleanText(factura.FRR_Idempresa),
  fr_sufa: factura.FRR_tipofactura,
  fecha_factura: factura.FRR_fechafactura,
  iva_tramos: ivaTramos,
  base_imponible: totalIvaBase(ivaTramos),
  iva_porcentaje: ivaTramos[0]?.porcentaje ?? null,
  iva_importe: totalIvaCuota(ivaTramos),
  base_retencion: factura.FRR_baseret,
  retencion_porcentaje: factura.FRR_ret,
  retencion_importe: factura.FRR_cuotaret,
  clave_irpf: factura.FRR_ClaveIRPF,
  total: factura.FRR_totalfac,
  asunto_email: factura.email_subject,
  pdf_path: pdfPathFromId(factura.archivo_pdf_id),
  pdf_nombre: factura.source_pdf_name,
  pdf_mime_type: 'application/pdf',
  pdf_size: null,
  validation_errors: validationIssues(factura),
  erp_last_attempt_at: null,
  erp_sent_at: factura.erp_sent_at,
  erp_response: factura.erp_response as Record<string, unknown> | null,
  erp_error: factura.erp_error
    ? sanitizeUserFacingErrorMessage(factura.erp_error)
    : null,
  erp_payload: null,
  erp_factura_id: factura.FRR_id ? String(factura.FRR_id) : null,
  source_kind: factura.source_kind,
  // Las primeras versiones del finalizador persistian la identidad ERP solo en
  // FRR_id. Mantener ese readback como compatibilidad evita dejar una escritura
  // ya confirmada en estado visual "sin confirmar"; las referencias de solo
  // lectura siguen clasificandose antes mediante source_kind.
  remote_frr_id: factura.remote_frr_id ?? numberValue(factura.FRR_id, null),
  is_readonly_reference: factura.is_readonly_reference,
  match_status: factura.match_status,
  match_evidence: factura.match_evidence as Record<string, unknown> | null,
  concepto_asiento: factura.FRR_Concepto,
  obs_aeat: factura.FRR_ObservacionesAEAT,
  observaciones: factura.FRR_Observaciones,
  cuota_no_deducible: factura.FRR_CuotaNoDeducible,
  cuenta_suplido: factura.FRR_CtaSuplido,
  importe_suplido: factura.FRR_ImpSuplido,
  contabilizar: factura.FRR_Contabilizar,
  genera_cartera: factura.FRR_GeneraCartera,
  forma_pago: cleanText(factura.FRR_IdFormaPago),
  cta_cartera: factura.FRR_CtaCartera,
  banco: cleanText(factura.FRR_IdBanco),
  tipo_doc: cleanText(factura.FRR_IdTipoDoc),
  fecha_vto: vencimientos[0]?.fecha ?? null,
  importe_vto: vencimientos[0]?.importe ?? null,
  vencimientos,
  version: readNumber(source, ['row_version', 'version'], null),
  sync_status: readText(source, ['sync_status'], null),
  last_request_id: cleanText(factura.last_request_id),
  erp_validation_status: readText(
    source,
    ['erp_validation_status'],
    'not_validated',
  ) as UiFacturaRecibida['erp_validation_status'],
  erp_validation_request_id: cleanText(factura.erp_validation_request_id),
  erp_validated_at: cleanText(factura.erp_validated_at),
  erp_payload_hash: cleanText(factura.erp_payload_hash),
  erp_business_fingerprint: cleanText(
    factura.erp_business_fingerprint,
  ),
  erp_reference_status: normalizeFacturaERPReferenceStatus(
    factura.erp_reference_status,
    {
      targetId: factura.erp_target_id,
      datasetEpoch: factura.erp_dataset_epoch,
      hasRemoteIdentity:
        (numberValue(
          factura.remote_frr_id ?? factura.FRR_id,
          null,
        ) ?? 0) > 0,
    },
  ),
  erp_target_id: cleanText(factura.erp_target_id),
  erp_dataset_epoch: cleanText(factura.erp_dataset_epoch),
  erp_verified_at: cleanText(factura.erp_verified_at),
  accounting_status: readText(source, ['accounting_status'], accounting.status),
  erp_last_read_at: readText(source, ['erp_last_read_at'], null),
  created_at: factura.created_at,
  updated_at: factura.updated_at,
  ctb_lineas: factura.ctb.map(mapLineToUi),
  punteos: factura.punteos.map(mapPunteoToUi),
  facturas_recibidas_lineas: mapGastosToUi(factura),
  };
};

const mapRemoteCtbToUi = (
  linea: ERPReadCtbRow,
  index: number,
  facturaId: number | string,
): FacturaRecibidaLinea => {
  const id = readText(linea, ['id', 'frc_id', 'FRC_id'], `${facturaId}-${index + 1}`);
  const fechaLog = readText(linea, ['fecha_log', 'FRC_FechaLog'], null);
  const horaLog = readText(linea, ['hora_log', 'FRC_HoraLog'], null);
  const timestamp = fechaLog ? `${fechaLog}${horaLog ? `T${horaLog}` : ''}` : new Date().toISOString();

  return {
    id: `${ERP_REMOTE_ID_PREFIX}ctb:${id}`,
    factura_recibida_id: erpRemoteId(facturaId),
    posicion: index + 1,
    descripcion: readText(linea, ['cuenta', 'FRC_Cuenta'], '') ?? '',
    importe: readNumber(linea, ['importe', 'FRC_Importe'], 0) ?? 0,
    FRC_id: readNumber(linea, ['frc_id', 'FRC_id'], null),
    FRC_idfacturarecibida: readNumber(linea, ['factura_id', 'FRC_idfacturarecibida'], null),
    FRC_IdActividad: readNumber(linea, ['actividad_id', 'FRC_IdActividad'], null),
    FRC_Idseccion: readNumber(linea, ['seccion_id', 'FRC_Idseccion'], null),
    FRC_Iddepartamento: readNumber(linea, ['departamento_id', 'FRC_Iddepartamento'], null),
    FRC_Idsubdepartamento: readNumber(linea, ['subdepartamento_id', 'FRC_Idsubdepartamento'], null),
    FRC_IdUsuarioLog: readNumber(linea, ['usuario_log_id', 'FRC_IdUsuarioLog'], null),
    FRC_FechaLog: fechaLog,
    FRC_HoraLog: horaLog,
    created_at: timestamp,
    updated_at: timestamp,
  };
};

const mapRemoteGastosToUi = (factura: ERPReadFacturaRow): FacturaRecibidaLinea[] =>
  [1, 2, 3, 4]
    .map((slot): FacturaRecibidaLinea | null => {
      const importe = readNumber(factura, [`FRR_igasto${slot}`, `igasto${slot}`], 0) ?? 0;
      const cuenta = readText(factura, [`FRR_ctagasto${slot}`, `ctagasto${slot}`], null);
      if (!cuenta && Math.abs(importe) <= 0.01) return null;
      return {
        id: `${ERP_REMOTE_ID_PREFIX}gasto:${slot}`,
        posicion: slot,
        descripcion: cuenta ?? '',
        importe,
      } satisfies FacturaRecibidaLinea;
    })
    .filter((linea): linea is FacturaRecibidaLinea => Boolean(linea));

const mapRemotePunteoToUi = (
  punteo: ERPReadPunteoRow,
  index: number,
  facturaId: number | string,
): FacturaRecibidaPunteo => ({
  id: `${ERP_REMOTE_ID_PREFIX}punteo:${readText(
    punteo,
    ['id_interno_estable', 'remote_id', 'id', 'ID'],
    `${facturaId}-${index + 1}`,
  )}`,
  posicion: index + 1,
  remote_id: readText(punteo, ['id_interno_estable', 'remote_id', 'id', 'ID'], null),
  source_table: readText(punteo, ['source_table'], null),
  source_id: readNumber(punteo, ['source_id'], null),
  albaran_id: readNumber(punteo, ['albaran_id'], null),
  importe_factura: readNumber(punteo, ['importe_factura'], null),
  origen: readText(punteo, ['Origen', 'origen'], null),
  serie: readText(punteo, ['Serie', 'serie'], null),
  albaran: readNumber(punteo, ['Albaran', 'albaran'], null),
  ref: readText(punteo, ['Ref', 'ref', 'referencia'], null),
  fecha: readText(punteo, ['Fecha', 'fecha'], null),
  importe_punteado: readNumber(punteo, ['Importe P', 'importe_p', 'importe_punteado'], null),
  importe: readNumber(punteo, ['Importe', 'importe'], null),
  seleccionado: readBoolean(punteo, ['S', 'seleccionado'], false) ?? false,
  ver: readBoolean(punteo, ['Ver', 'ver'], false) ?? false,
  empresa_id: readNumber(punteo, ['empresa_id', 'FRR_Idempresa'], null),
  proveedor_id: readNumber(punteo, ['proveedor_id', 'FRR_idproveedor'], null),
  cuenta_gasto: readText(punteo, ['cuenta_gasto', 'FRR_ctagasto'], null),
  line_count: readNumber(punteo, ['line_count'], 0),
  lines_loaded: Array.isArray(punteo.lines),
  lines: asRecordArray(punteo.lines).map(mapPunteoLinea),
  raw: Object.keys(asRecord(punteo.raw)).length > 0 ? asRecord(punteo.raw) : punteo,
});

export const mapRemoteFacturaToUi = (
  factura: ERPReadFacturaRow,
  lineas: ERPReadCtbRow[] = [],
  punteos: ERPReadPunteoRow[] = [],
  accountingResponse?: ERPReadAccountingResponse | null,
): UiFacturaRecibida => {
  const frrId = readNumber(factura, ['FRR_id', 'frr_id', 'id'], 0) ?? 0;
  const fechaFactura = readText(factura, ['FRR_fechafactura', 'fecha_factura'], null);
  const fechaContable = readText(factura, ['FRR_fechactb', 'fecha_contable'], null);
  const fechaLog = readText(factura, ['FRR_FechaLog', 'fecha_log'], fechaContable);
  const timestamp = fechaLog ? `${fechaLog}T00:00:00` : new Date().toISOString();
  const ivaTramos = buildIvaTramos(factura);
  const vencimientos = buildVencimientos(factura);
  const accounting = mapAccounting(factura, accountingResponse);
  const erpTargetId = readText(
    factura,
    ['erp_target_id', 'target_id'],
    null,
  );
  const erpDatasetEpoch = readText(
    factura,
    ['erp_dataset_epoch', 'dataset_epoch'],
    null,
  );
  const erpReferenceStatus = normalizeFacturaERPReferenceStatus(
    readText(factura, ['erp_reference_status'], null),
    {
      targetId: erpTargetId,
      datasetEpoch: erpDatasetEpoch,
      hasRemoteIdentity: frrId > 0,
      verifiedByCurrentReadback: true,
    },
  );

  return {
    id: erpRemoteId(frrId),
    documento_codigo: cleanText(frrId),
    estado: 'enviada_erp',
    proveedor_nombre: readText(factura, ['proveedor_nombre', 'acreedor_nombre', 'ACR_Nombre'], null),
    proveedor_nif: readText(factura, ['proveedor_nif', 'acreedor_nif', 'ACR_Nif'], null),
    proveedor_codigo: cleanText(readNumber(factura, ['FRR_idproveedor', 'proveedor_id', 'acreedor_codigo'], null)),
    proveedor_cuenta: readText(factura, ['FRR_idcuenta', 'cuenta_proveedor', 'ACR_Cuenta'], null),
    numero_factura: readText(factura, ['FRR_numerofactura', 'numero_factura'], null),
    referencia: cleanText(readNumber(factura, ['FRR_numero', 'numero'], null)),
    ejercicio: readNumber(factura, ['FRR_ejercicio', 'ejercicio'], null),
    fecha_ctb: fechaContable,
    fecha_ctb_source:
      fechaContable && fechaContable === fechaFactura
        ? 'invoice_date'
        : 'manual',
    tipo_iva_codigo: cleanText(readNumber(factura, ['FRR_idregimen', 'idregimen', 'tipo_iva_id'], null)),
    asiento: readNumber(factura, ['FRR_IdAsientoNet', 'asiento'], null),
    asiento_tecnico: accounting.technical_id,
    asiento_numero: accounting.visible_number,
    asiento_fecha: accounting.fecha,
    asiento_estado: accounting.status,
    asiento_cuadrado: accounting.balanced,
    asiento_total_debe: accounting.total_debe,
    asiento_total_haber: accounting.total_haber,
    asiento_lineas: accounting.lines,
    accounting,
    fr_alm: cleanText(readNumber(factura, ['FRR_Idempresa', 'empresa_id'], null)),
    fr_sufa: readText(factura, ['FRR_tipofactura', 'tipo_factura'], null),
    fecha_factura: fechaFactura,
    iva_tramos: ivaTramos,
    base_imponible: totalIvaBase(ivaTramos),
    iva_porcentaje: ivaTramos[0]?.porcentaje ?? null,
    iva_importe: totalIvaCuota(ivaTramos),
    base_retencion: readNumber(factura, ['FRR_baseret', 'base_retencion'], null),
    retencion_porcentaje: readNumber(factura, ['FRR_ret', 'retencion_porcentaje'], null),
    retencion_importe: readNumber(factura, ['FRR_cuotaret', 'retencion_importe'], null),
    clave_irpf: readText(factura, ['FRR_ClaveIRPF', 'clave_irpf'], null),
    total: readNumber(factura, ['FRR_totalfac', 'total_factura'], null),
    asunto_email: null,
    pdf_path: null,
    pdf_nombre: null,
    pdf_mime_type: null,
    pdf_size: null,
    validation_errors: null,
    erp_last_attempt_at: null,
    erp_sent_at: fechaContable,
    erp_response: factura,
    erp_error: null,
    erp_payload: { source: ERP_READ_SOURCE },
    erp_factura_id: frrId ? String(frrId) : null,
    source_kind: 'erp_reference',
    remote_frr_id: frrId || null,
    is_readonly_reference: true,
    match_status: 'reference',
    match_evidence: { source: ERP_READ_SOURCE, remote_frr_id: frrId },
    concepto_asiento: readText(factura, ['FRR_Concepto', 'concepto'], null),
    obs_aeat: readText(factura, ['FRR_ObservacionesAEAT', 'observaciones_aeat'], null),
    observaciones: readText(factura, ['FRR_Observaciones', 'observaciones'], null),
    cuota_no_deducible: readNumber(factura, ['FRR_CuotaNoDeducible'], null),
    cuenta_suplido: readText(factura, ['FRR_CtaSuplido'], null),
    importe_suplido: readNumber(factura, ['FRR_ImpSuplido'], null),
    contabilizar: readText(factura, ['FRR_Contabilizar'], null),
    genera_cartera: readText(factura, ['FRR_GeneraCartera'], null),
    forma_pago: cleanText(readNumber(factura, ['FRR_IdFormaPago'], null)),
    cta_cartera: readText(factura, ['FRR_CtaCartera'], null),
    banco: cleanText(readNumber(factura, ['FRR_IdBanco'], null)),
    tipo_doc: cleanText(readNumber(factura, ['FRR_IdTipoDoc'], null)),
    fecha_vto: vencimientos[0]?.fecha ?? null,
    importe_vto: vencimientos[0]?.importe ?? null,
    vencimientos,
    version: readNumber(factura, ['version'], null),
    sync_status: readText(factura, ['sync_status'], null),
    erp_validation_status:
      erpReferenceStatus === 'valid' ? 'valid' : 'not_validated',
    erp_validation_request_id: null,
    erp_validated_at: readText(factura, ['erp_last_read_at'], null),
    erp_payload_hash: null,
    erp_business_fingerprint: readText(
      factura,
      ['erp_business_fingerprint', 'business_fingerprint'],
      null,
    ),
    erp_reference_status: erpReferenceStatus,
    erp_target_id: erpTargetId,
    erp_dataset_epoch: erpDatasetEpoch,
    erp_verified_at: readText(factura, ['erp_verified_at'], null),
    accounting_status: readText(factura, ['accounting_status'], accounting.status),
    erp_last_read_at: readText(factura, ['erp_last_read_at'], null),
    created_at: timestamp,
    updated_at: timestamp,
    ctb_lineas: lineas.map((linea, index) => mapRemoteCtbToUi(linea, index, frrId)),
    punteos: punteos.map((punteo, index) => mapRemotePunteoToUi(punteo, index, frrId)),
    facturas_recibidas_lineas: mapRemoteGastosToUi(factura),
  };
};

const normalizeSn = (value: unknown, fallback: 'S' | 'N'): 'S' | 'N' => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'S' || normalized === 'N' ? normalized : fallback;
};

const normalizedIvaTramos = (
  factura: Partial<UiFacturaRecibida>,
  current?: ERPFacturaRecibida | null,
): FacturaRecibidaIvaTramo[] => {
  const currentTramos = current
    ? buildIvaTramos(current as unknown as Record<string, unknown>)
    : buildIvaTramos({});
  const supplied = factura.iva_tramos?.length
    ? factura.iva_tramos
    : [{
        posicion: 1 as const,
        base: factura.base_imponible,
        porcentaje: factura.iva_porcentaje,
        cuota: factura.iva_importe,
      }];

  return [1, 2, 3, 4, 5].map((slot) => {
    const suppliedSlot = supplied.find((tramo) => tramo.posicion === slot);
    const currentSlot = currentTramos[slot - 1];
    return {
      posicion: slot as FacturaRecibidaIvaTramo['posicion'],
      base: numberValue(suppliedSlot?.base, currentSlot?.base ?? 0) ?? 0,
      porcentaje: numberValue(suppliedSlot?.porcentaje, currentSlot?.porcentaje ?? 0) ?? 0,
      cuota: numberValue(suppliedSlot?.cuota, currentSlot?.cuota ?? 0) ?? 0,
    };
  });
};

const normalizedVencimientos = (
  factura: Partial<UiFacturaRecibida>,
  current?: ERPFacturaRecibida | null,
): FacturaRecibidaVencimiento[] => {
  const currentVencimientos = current
    ? buildVencimientos(current as unknown as Record<string, unknown>)
    : buildVencimientos({});
  const hasVencimientos = hasOwnValue(factura, 'vencimientos');
  const supplied = hasVencimientos ? factura.vencimientos ?? [] : [];

  return [1, 2, 3, 4].map((slot) => {
    const suppliedSlot = supplied.find((vencimiento) => vencimiento.posicion === slot);
    const currentSlot = currentVencimientos[slot - 1];
    if (hasVencimientos) {
      return {
        posicion: slot as FacturaRecibidaVencimiento['posicion'],
        fecha: suppliedSlot ? cleanText(suppliedSlot.fecha) : null,
        importe: suppliedSlot ? numberValue(suppliedSlot.importe, null) : null,
      };
    }

    if (slot === 1) {
      return {
        posicion: 1,
        fecha: hasOwnValue(factura, 'fecha_vto') ? cleanText(factura.fecha_vto) : currentSlot?.fecha ?? null,
        importe: hasOwnValue(factura, 'importe_vto')
          ? numberValue(factura.importe_vto, null)
          : currentSlot?.importe ?? null,
      };
    }

    return {
      posicion: slot as FacturaRecibidaVencimiento['posicion'],
      fecha: currentSlot?.fecha ?? null,
      importe: currentSlot?.importe ?? null,
    };
  });
};

export const buildFacturaPayload = (
  factura: Partial<UiFacturaRecibida>,
  current?: ERPFacturaRecibida | null,
  gastos: FacturaRecibidaLinea[] = [],
) => {
  const ivaTramos = normalizedIvaTramos(factura, current);
  const vencimientos = normalizedVencimientos(factura, current);
  const payload: Record<string, unknown> = {
    FRR_numero: suppliedNumberOrCurrent(factura, 'referencia', current?.FRR_numero),
    FRR_ejercicio: suppliedNumberOrCurrent(factura, 'ejercicio', current?.FRR_ejercicio),
    FRR_idproveedor: suppliedNumberOrCurrent(factura, 'proveedor_codigo', current?.FRR_idproveedor),
    FRR_idregimen: suppliedNumberOrCurrent(factura, 'tipo_iva_codigo', current?.FRR_idregimen),
    FRR_idcuenta: suppliedTextOrCurrent(factura, 'proveedor_cuenta', current?.FRR_idcuenta),
    FRR_numerofactura: suppliedTextOrCurrent(factura, 'numero_factura', current?.FRR_numerofactura),
    FRR_fechafactura: suppliedTextOrCurrent(factura, 'fecha_factura', current?.FRR_fechafactura),
    FRR_fechactb: suppliedTextOrCurrent(factura, 'fecha_ctb', current?.FRR_fechactb),
    fecha_ctb_source:
      factura.fecha_ctb_source === 'manual' ? 'manual' : 'invoice_date',
    FRR_Idempresa: suppliedNumberOrCurrent(factura, 'fr_alm', current?.FRR_Idempresa),
    FRR_tipofactura: suppliedTextOrCurrent(factura, 'fr_sufa', current?.FRR_tipofactura),
    FRR_baseret: suppliedNumberOrCurrent(factura, 'base_retencion', current?.FRR_baseret) ?? 0,
    FRR_ret: suppliedNumberOrCurrent(factura, 'retencion_porcentaje', current?.FRR_ret) ?? 0,
    FRR_cuotaret: suppliedNumberOrCurrent(factura, 'retencion_importe', current?.FRR_cuotaret) ?? 0,
    FRR_ClaveIRPF: suppliedTextOrCurrent(factura, 'clave_irpf', current?.FRR_ClaveIRPF),
    FRR_totalfac: suppliedNumberOrCurrent(factura, 'total', current?.FRR_totalfac),
    FRR_ImpSuplido: suppliedNumberOrCurrent(factura, 'importe_suplido', current?.FRR_ImpSuplido) ?? 0,
    FRR_CuotaNoDeducible:
      suppliedNumberOrCurrent(factura, 'cuota_no_deducible', current?.FRR_CuotaNoDeducible) ?? 0,
    FRR_Concepto: suppliedTextOrCurrent(factura, 'concepto_asiento', current?.FRR_Concepto)?.slice(0, 50) ?? null,
    FRR_ObservacionesAEAT: suppliedTextOrCurrent(factura, 'obs_aeat', current?.FRR_ObservacionesAEAT),
    FRR_Observaciones: suppliedTextOrCurrent(factura, 'observaciones', current?.FRR_Observaciones),
    // La copia TEST no dispone del servicio oficial de contabilización de
    // Netagro. Toda alta nueva se envía explícitamente sin contabilizar.
    FRR_Contabilizar: 'N',
    FRR_GeneraCartera: normalizeSn(
      hasOwnValue(factura, 'genera_cartera') ? factura.genera_cartera : current?.FRR_GeneraCartera,
      'N',
    ),
    FRR_CtaCartera: suppliedTextOrCurrent(factura, 'cta_cartera', current?.FRR_CtaCartera),
    FRR_IdBanco: suppliedNumberOrCurrent(factura, 'banco', current?.FRR_IdBanco),
    FRR_IdFormaPago: suppliedNumberOrCurrent(factura, 'forma_pago', current?.FRR_IdFormaPago),
    FRR_IdTipoDoc: suppliedNumberOrCurrent(factura, 'tipo_doc', current?.FRR_IdTipoDoc),
    FechaVto: vencimientos[0]?.fecha ?? null,
    ImporteVto: vencimientos[0]?.importe ?? null,
    FRR_FechaVto1: vencimientos[1]?.fecha ?? null,
    FRR_ImporteVto1: vencimientos[1]?.importe ?? null,
    FRR_FechaVto2: vencimientos[2]?.fecha ?? null,
    FRR_ImporteVto2: vencimientos[2]?.importe ?? null,
    FRR_FechaVto3: vencimientos[3]?.fecha ?? null,
    FRR_ImporteVto3: vencimientos[3]?.importe ?? null,
    FRR_CtaSuplido: suppliedTextOrCurrent(factura, 'cuenta_suplido', current?.FRR_CtaSuplido),
  };

  for (const tramo of ivaTramos) {
    payload[`FRR_base${tramo.posicion}`] = tramo.base ?? 0;
    payload[`FRR_iva${tramo.posicion}`] = tramo.porcentaje ?? 0;
    payload[`FRR_cuota${tramo.posicion}`] = tramo.cuota ?? 0;
  }

  for (let index = 0; index < 4; index += 1) {
    const slot = index + 1;
    const gasto = gastos.find((linea) => linea.posicion === slot) ?? gastos[index];
    payload[`FRR_igasto${slot}`] = numberValue(gasto?.importe, 0) ?? 0;
    payload[`FRR_ctagasto${slot}`] = cleanText(gasto?.descripcion);
  }

  return payload;
};

export const isFacturaCtbLineaEmpty = (linea: FacturaRecibidaLinea) =>
  !cleanText(linea.descripcion) &&
  Math.abs(numberValue(linea.importe, 0) ?? 0) <= 0.01 &&
  [
    linea.FRC_IdActividad,
    linea.FRC_Idseccion,
    linea.FRC_Iddepartamento,
    linea.FRC_Idsubdepartamento,
  ].every((value) => numberValue(value, null) === null);

export const buildCtbPayload = (lineas: FacturaRecibidaLinea[]) =>
  lineas.filter((linea) => !isFacturaCtbLineaEmpty(linea)).map((linea, index) => ({
    posicion: index + 1,
    FRC_id: numberValue(linea.FRC_id, null),
    FRC_idfacturarecibida: numberValue(linea.FRC_idfacturarecibida, null),
    FRC_Cuenta: cleanText(linea.descripcion),
    FRC_Importe: numberValue(linea.importe, 0) ?? 0,
    FRC_IdActividad: numberValue(linea.FRC_IdActividad, null),
    FRC_Idseccion: numberValue(linea.FRC_Idseccion, null),
    FRC_Iddepartamento: numberValue(linea.FRC_Iddepartamento, null),
    FRC_Idsubdepartamento: numberValue(linea.FRC_Idsubdepartamento, null),
    FRC_IdUsuarioLog: numberValue(linea.FRC_IdUsuarioLog, null),
    FRC_FechaLog: cleanText(linea.FRC_FechaLog),
    FRC_HoraLog: cleanText(linea.FRC_HoraLog),
  }));

export const buildPunteosPayload = (punteos: FacturaRecibidaPunteo[] = []) =>
  punteos.filter((punteo) => punteo.seleccionado).map((punteo, index) => ({
    posicion: index + 1,
    remote_id: cleanText(punteo.remote_id),
    source_table: cleanText(punteo.source_table),
    source_id: numberValue(punteo.source_id, null),
    albaran_id: numberValue(punteo.albaran_id, null),
    importe_factura: numberValue(punteo.importe_factura, null),
    Origen: cleanText(punteo.origen),
    Serie: cleanText(punteo.serie),
    Albaran: numberValue(punteo.albaran, null),
    Ref: cleanText(punteo.ref),
    Fecha: cleanText(punteo.fecha),
    'Importe P': numberValue(punteo.importe_punteado, 0) ?? 0,
    Importe: numberValue(punteo.importe, 0) ?? 0,
    S: punteo.seleccionado,
    Ver: punteo.ver,
    empresa_id: numberValue(punteo.empresa_id, null),
    proveedor_id: numberValue(punteo.proveedor_id, null),
    cuenta_gasto: cleanText(punteo.cuenta_gasto),
    line_count: numberValue(punteo.line_count, punteo.lines?.length ?? 0) ?? 0,
  }));

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').replace(/^data:.*;base64,/i, ''));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el PDF.'));
    reader.readAsDataURL(blob);
  });

const getFunctionErrorMessage = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null;
  const source = data as Record<string, unknown>;
  for (const value of [source.error, source.message, source.detail]) {
    if (typeof value === 'string' && value.trim()) {
      return sanitizeUserFacingErrorMessage(value);
    }
  }
  return getFunctionErrorMessage(source.details);
};

const getFunctionInvokeResponsePayload = async (
  error: unknown,
  data?: unknown,
): Promise<Record<string, unknown>> => {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }

  if (!(error instanceof FunctionsHttpError)) return {};
  const context = error.context as { clone?: () => Response; text?: () => Promise<string> } | null;
  try {
    const response = context && typeof context.clone === 'function' ? context.clone() : context;
    if (!response || typeof response.text !== 'function') return {};
    const raw = (await response.text()).trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

export const getFunctionInvokeErrorMessage = async (error: unknown, data?: unknown) => {
  const dataMessage = getFunctionErrorMessage(data);
  if (dataMessage) return dataMessage;

  if (error instanceof FunctionsHttpError) {
    const context = error.context as { clone?: () => Response; text?: () => Promise<string> } | null;
    try {
      const response = context && typeof context.clone === 'function' ? context.clone() : context;
      if (response && typeof response.text === 'function') {
        const raw = (await response.text()).trim();
        if (raw) {
          try {
            return getFunctionErrorMessage(JSON.parse(raw)) ??
              sanitizeUserFacingErrorMessage(raw);
          } catch {
            return sanitizeUserFacingErrorMessage(raw);
          }
        }
      }
    } catch {
      // Si el cuerpo ya fue consumido, se conserva el error original del SDK.
    }
  }

  return error instanceof Error && error.message.trim()
    ? sanitizeUserFacingErrorMessage(error.message)
    : null;
};

export const fetchFacturasRecibidas = async (): Promise<UiFacturaRecibida[]> => {
  const page = await facturasRecibidas.list({ page: 1, pageSize: 500 });
  return page.items.map(mapFacturaToUi);
};

export const fetchFacturasRecibidasPage = async (
  options: FacturaRecibidaPageOptions,
): Promise<FacturaRecibidaUiPage> => {
  const page = await facturasRecibidas.list({
    page: options.page,
    pageSize: options.pageSize,
    proveedor: options.proveedor,
    numero: options.numero,
    fechaFrom: options.fechaDesde,
    fechaTo: options.fechaHasta,
    erpStatus: options.erpStatus,
    sortOrder: options.sortOrder,
    includeDiscarded: false,
  });

  return {
    items: page.items.map(mapFacturaToUi),
    total: page.total,
    page: options.page,
    pageSize: options.pageSize,
  };
};

const mapAlbaranEntrada = (row: ERPReadGenericRow): AlbaranEntrada => {
  const id = readNumber(row, ['AEN_idalbaran', 'id'], null);
  if (id === null || !Number.isInteger(id) || id < 1) {
    throw new Error('Se recibió un albarán con una identidad no válida.');
  }

  return {
    id,
    localId:
      readText(row, ['local_id'], null) ??
      (typeof row.id === 'string' ? cleanText(row.id) : null),
    estado: readText(row, ['estado'], null),
    campa: readNumber(row, ['campa', 'AEN_campa'], null),
    serie: readText(row, ['serie', 'AEN_serie'], null),
    numero: readNumber(row, ['numero', 'AEN_albaran'], null),
    fecha: readText(row, ['fecha', 'AEN_fecha'], null),
    agricultorId: readNumber(row, ['agricultor_id', 'AEN_idagricultor'], null),
    agricultorNombre: readText(row, ['agricultor_nombre'], null),
    puntoVentaId: readNumber(row, ['punto_venta_id', 'AEN_idpuntoventa'], null),
    centroId: readNumber(row, ['centro_id', 'AEN_idcentro'], null),
    referencia: readText(row, ['referencia', 'AEN_referencia'], null),
    empresaAgricultorId: readNumber(
      row,
      ['empresa_agricultor_id', 'AEN_IdEmpresaAgricultor'],
      null,
    ),
    syncStatus: readText(row, ['sync_status'], null),
    sourceKind: readText(row, ['source_kind'], null),
    sourcePdfName: readText(row, ['source_pdf_name'], null),
    confidence: readNumber(row, ['confidence'], null),
    erpSentAt: readText(row, ['erp_sent_at'], null),
    erpLastReadAt: readText(row, ['erp_last_read_at'], null),
    createdAt: readText(row, ['created_at'], null),
    updatedAt: readText(row, ['updated_at'], null),
  };
};

const fetchLocalAlbaranesEntradaPage = async (
  options: AlbaranEntradaPageOptions,
  page: number,
  pageSize: number,
  offset: number,
): Promise<AlbaranEntradaPage> => {
  let query = supabase
    .from('albaranesentrada')
    .select('*', { count: 'exact' })
    .neq('estado', 'descartado')
    .order('AEN_fecha', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (options.fechaDesde) query = query.gte('AEN_fecha', options.fechaDesde);
  if (options.fechaHasta) query = query.lte('AEN_fecha', options.fechaHasta);
  if (options.agricultorId && options.agricultorId > 0) {
    query = query.eq('AEN_idagricultor', Math.trunc(options.agricultorId));
  }
  if (options.serie?.trim()) {
    query = query.ilike('AEN_serie', options.serie.trim());
  }
  if (options.numero && options.numero > 0) {
    query = query.eq('AEN_albaran', Math.trunc(options.numero));
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(
      sanitizeUserFacingErrorMessage(error.message) ||
        'No se pudieron cargar los albaranes guardados.',
    );
  }

  const items = (data ?? []).map((row) =>
    mapAlbaranEntrada(row as unknown as ERPReadGenericRow),
  );
  const total = Math.max(0, count ?? items.length);

  return {
    items,
    total,
    page,
    pageSize,
    hasMore: offset + items.length < total,
  };
};

export const fetchAlbaranesEntradaPage = async (
  options: AlbaranEntradaPageOptions,
): Promise<AlbaranEntradaPage> => {
  const page = Math.max(1, Math.trunc(options.page));
  const pageSize = Math.max(1, Math.min(Math.trunc(options.pageSize), 200));
  const offset = (page - 1) * pageSize;

  return fetchLocalAlbaranesEntradaPage(options, page, pageSize, offset);
};

export const fetchAlbaranEntradaById = async (
  albaranId: number,
): Promise<AlbaranEntrada | null> => {
  if (!Number.isInteger(albaranId) || albaranId < 1) {
    throw new Error('El albarán no tiene una identidad válida.');
  }

  const { data, error } = await supabase
    .from('albaranesentrada')
    .select('*')
    .eq('AEN_idalbaran', albaranId)
    .neq('estado', 'descartado')
    .maybeSingle();

  if (error) {
    throw new Error(
      sanitizeUserFacingErrorMessage(error.message) ||
        'No se pudo cargar el albarán guardado.',
    );
  }

  return data
    ? mapAlbaranEntrada(data as unknown as ERPReadGenericRow)
    : null;
};

export const fetchFacturaRecibidaById = async (id: string): Promise<UiFacturaRecibida | null> => {
  const remoteId = erpIdFromUiId(id);
  if (remoteId) {
    const [factura, ctb, punteos, accounting] = await Promise.all([
      erpRead<ERPReadFacturaRow>(`facturasrecibidas/${remoteId}`),
      erpRead<{ items?: ERPReadCtbRow[] }>(`facturasrecibidas/${remoteId}/ctb`),
      erpRead<{ items?: ERPReadPunteoRow[] }>(
        `facturasrecibidas/${remoteId}/punteos?include_lines=false`,
      ),
      erpRead<ERPReadAccountingResponse>(`facturasrecibidas/${remoteId}/asiento`),
    ]);
    return mapRemoteFacturaToUi(factura, ctb.items ?? [], punteos.items ?? [], accounting);
  }

  const factura = await facturasRecibidas.getById(id);
  return factura ? mapFacturaToUi(factura) : null;
};

export const saveFacturaRecibida = async (
  factura: Partial<UiFacturaRecibida>,
  lineas: FacturaRecibidaLinea[],
  validar = false,
  options: { providerPreflightVerified?: boolean } = {},
): Promise<UiFacturaRecibida> => {
  if (isERPReadOnlyFactura(factura)) {
    throw new Error('Las facturas reales de ERP son de solo lectura desde esta pantalla.');
  }

  if (factura.id) {
    const current = await facturasRecibidas.getById(factura.id);
    if (!current) throw new Error('Factura no encontrada antes de guardar.');
    const updated = await facturasRecibidas.update({
      factura_id: factura.id,
      expected_version: factura.version ?? current.row_version,
      estado: validar ? 'validada' : mapEstadoToERP(factura.estado),
      proveedor_nombre: cleanText(factura.proveedor_nombre),
      proveedor_nif: cleanText(factura.proveedor_nif),
      factura: buildFacturaPayload(factura, current, lineas),
      ctb: buildCtbPayload(factura.ctb_lineas ?? []),
      punteos: buildPunteosPayload(factura.punteos ?? []),
      provider_preflight_verified: options.providerPreflightVerified === true,
    });
    return mapFacturaToUi(updated);
  }

  throw new Error(
    'La factura debe crearse mediante el flujo de PDF/OCR antes de editarse. No se realizan altas parciales desde el navegador.',
  );
};

export const sendFacturaRecibidaToERP = async (
  id: string,
  version?: number | null,
  requestId?: string | null,
  operation: 'commit' | 'reconcile' = 'commit',
): Promise<UiFacturaRecibida> => {
  if (erpIdFromUiId(id)) {
    throw new Error('Esta factura ya existe en ERP y se muestra en modo solo lectura.');
  }

  const sent =
    operation === 'reconcile'
      ? await facturasRecibidas.reconcileERP(id, version, requestId)
      : await facturasRecibidas.commitERP(id, version, requestId);
  return mapFacturaToUi(sent);
};

export const validateFacturaRecibidaERP = async (
  id: string,
  version?: number | null,
  requestId?: string | null,
): Promise<UiFacturaRecibida> => {
  if (erpIdFromUiId(id)) {
    throw new Error('Esta factura ya existe en ERP y se muestra en modo solo lectura.');
  }

  const validated = await facturasRecibidas.validateERP(
    id,
    version,
    requestId,
  );
  return mapFacturaToUi(validated);
};

export type LocalizarProveedorResponse = {
  ok: boolean;
  erp_response?: {
    resultado?: string;
    datos?: Record<string, unknown> | string;
    [key: string]: unknown;
  };
};

const normalizeProveedorNif = (value: unknown) =>
  normalizeIssueToken(value).replace(/[^a-z0-9]/g, '');

const normalizeProveedorNombre = (value: unknown) =>
  normalizeIssueToken(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

export type FacturaProveedorERPKind = 'acreedor' | 'agricultor';

const positiveProviderEvidenceId = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const facturaProveedorERPKindFromMatchEvidence = (
  matchEvidence: unknown,
  expectedProviderId: unknown = null,
): FacturaProveedorERPKind | null => {
  const evidence = asRecord(matchEvidence);
  const proveedor = asRecord(evidence.proveedor);
  if (proveedor.matched !== true) return null;
  const providerId = positiveProviderEvidenceId(proveedor.provider_id);
  const expectedId = positiveProviderEvidenceId(expectedProviderId);
  if (!providerId || (expectedId && providerId !== expectedId)) return null;

  for (const alias of ['id', 'entity_id']) {
    if (!Object.prototype.hasOwnProperty.call(proveedor, alias)) continue;
    if (positiveProviderEvidenceId(proveedor[alias]) !== providerId) return null;
  }

  const typeAliases = ['entity_type', 'proveedor_tipo']
    .filter((alias) => Object.prototype.hasOwnProperty.call(proveedor, alias))
    .map((alias) => cleanText(proveedor[alias])?.toLowerCase() ?? null);
  if (
    typeAliases.length === 0 ||
    typeAliases.some((value) => value !== 'agricultor' && value !== 'acreedor')
  ) {
    return null;
  }
  const uniqueTypes = Array.from(new Set(typeAliases));
  if (uniqueTypes.length !== 1) return null;
  const entityType = uniqueTypes[0] as FacturaProveedorERPKind;

  // El match del extractor solo es una pista. El frontend únicamente lo usa
  // cuando Edge dejó constancia de que el detalle del mismo maestro ERP,
  // proveedor y cuenta fue reconfirmado de forma satisfactoria.
  const accountingEvidence = asRecord(evidence.erp_accounting);
  const confirmation = asRecord(accountingEvidence.proveedor_tipo);
  const confirmedProviderId = positiveProviderEvidenceId(confirmation.provider_id);
  const confirmedType = cleanText(confirmation.provider_type)?.toLowerCase();
  if (
    confirmation.source !== 'erp_provider_detail' ||
    confirmation.status !== 'confirmed' ||
    confirmedProviderId !== providerId ||
    confirmedType !== entityType
  ) {
    return null;
  }
  return entityType;
};

export const facturaProveedorERPKind = (
  tipoFactura: unknown,
  matchEvidence: unknown = null,
  expectedProviderId: unknown = null,
): FacturaProveedorERPKind => {
  const explicitType = cleanText(tipoFactura)?.toUpperCase();
  if (explicitType) return explicitType === 'GE' ? 'agricultor' : 'acreedor';
  return facturaProveedorERPKindFromMatchEvidence(matchEvidence, expectedProviderId) ?? 'acreedor';
};

const facturaProveedorERPResource = (
  tipoFactura: unknown,
  matchEvidence: unknown = null,
  expectedProviderId: unknown = null,
) =>
  facturaProveedorERPKind(tipoFactura, matchEvidence, expectedProviderId) === 'agricultor'
    ? 'agricultores'
    : 'acreedores';

const isProveedorERPOperativo = (row: Record<string, unknown>) => {
  const activo = readBoolean(row, ['activo', 'operativo', 'ACR_Activo'], true);
  const bloqueado = readBoolean(row, ['bloqueado', 'ACR_Bloqueado'], false);
  const inactivoRgpd = readBoolean(row, ['inactivo_rgpd', 'ACR_InactivoRGPD'], false);
  return activo !== false && bloqueado !== true && inactivoRgpd !== true;
};

export const localizarProveedorERP = async (payload: {
  nif?: string | null;
  nombre?: string | null;
  tipoFactura?: string | null;
  matchEvidence?: unknown;
  expectedProviderId?: unknown;
}): Promise<LocalizarProveedorResponse> => {
  const nif = cleanText(payload.nif);
  const nombre = cleanText(payload.nombre);
  const resource = facturaProveedorERPResource(
    payload.tipoFactura,
    payload.matchEvidence,
    payload.expectedProviderId,
  );
  const consulta = nif
    ? `${resource}?nif=${encodeURIComponent(nif)}&activo=true&limit=25`
    : nombre
      ? `${resource}?nombre=${encodeURIComponent(nombre)}&activo=true&limit=25`
      : null;

  if (!consulta) {
    return { ok: false, erp_response: { datos: 'Indica NIF o nombre para buscar proveedor.' } };
  }

  try {
    const page = await erpRead<ERPReadListResponse<Record<string, unknown>> | Record<string, unknown>[]>(consulta);
    const rows = responseItems(page)
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    const exactMatches = rows.filter((row) => {
      if (!isProveedorERPOperativo(row)) return false;
      if (nif) {
        return normalizeProveedorNif(readText(row, ['nif', 'cif', 'ACR_Nif'], null)) === normalizeProveedorNif(nif);
      }
      return normalizeProveedorNombre(readText(row, ['nombre', 'ACR_Nombre', 'razon_social'], null)) ===
        normalizeProveedorNombre(nombre);
    });
    const uniqueMatches = Array.from(
      new Map(
        exactMatches
          .map((row) => [readNumber(row, ['codigo', 'id', 'ACR_Codigo'], null), row] as const)
          .filter((entry): entry is readonly [number, Record<string, unknown>] => entry[0] !== null),
      ).values(),
    );
    const responseRecord = asRecord(page);
    const total = numberValue(responseRecord.total, rows.length);
    const resultSetComplete = Array.isArray(page) || total === null || total <= rows.length;

    if (uniqueMatches.length !== 1 || !resultSetComplete) {
      const reason = uniqueMatches.length > 1 || !resultSetComplete
        ? 'La API devolvio varias coincidencias posibles.'
        : 'La API no devolvio una coincidencia exacta.';
      return {
        ok: true,
        erp_response: {
          resultado: 'manual_selection_required',
          datos: `${reason} Selecciona el proveedor manualmente.`,
        },
      };
    }
    const data = uniqueMatches[0];

    return {
      ok: true,
      erp_response: {
        resultado: 'ok',
        datos: {
          codigo: readNumber(data, ['codigo', 'id', 'ACR_Codigo'], null),
          nombre: readText(data, ['nombre', 'ACR_Nombre'], null),
          cif: readText(data, ['nif', 'ACR_Nif'], null),
          cuenta: readText(data, ['cuenta_id', 'cuenta', 'ACR_IdCuenta', 'ACR_Cuenta'], null),
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido al consultar el ERP.';
    return {
      ok: false,
      erp_response: { datos: `La API del ERP no esta disponible para buscar proveedores. ${message}` },
    };
  }
};

export type FacturaProveedorERPDetail = {
  codigo: number;
  nombre: string | null;
  nif: string | null;
  cuenta: string | null;
  cuentaGasto: string | null;
  cuentaCartera: string | null;
  porcentajeIva: number | null;
  formaPagoId: number | null;
  bancoId: number | null;
  raw: Record<string, unknown>;
};

export type FacturaERPDuplicateCandidate = {
  frrId: number;
  empresaId: number | null;
  ejercicio: number | null;
  proveedorId: number | null;
  numeroFactura: string | null;
  numero: number | null;
  proveedor: string | null;
  fecha: string | null;
  total: number | null;
};

export type FacturaERPPreflightResult = {
  provider: FacturaProveedorERPDetail | null;
  duplicate: FacturaERPDuplicateCandidate | null;
  issues: FacturaValidationIssue[];
};

const findNestedERPRecord = (
  value: unknown,
  signatureKeys: string[],
  depth = 0,
): Record<string, unknown> | null => {
  if (depth > 4) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedERPRecord(item, signatureKeys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  if (signatureKeys.some((key) => key in record)) return record;
  for (const key of ['item', 'items', 'data', 'datos', 'result', 'results', 'acreedor', 'agricultor', 'factura', 'resultado']) {
    const found = findNestedERPRecord(record[key], signatureKeys, depth + 1);
    if (found) return found;
  }
  return null;
};

export const mapProveedorERPDetail = (value: unknown): FacturaProveedorERPDetail | null => {
  const row = findNestedERPRecord(
    value,
    ['ACR_Codigo', 'AGR_Idagricultor', 'codigo', 'acreedor_id', 'agricultor_id', 'cuenta_id', 'ACR_Nombre', 'id'],
  );
  if (!row) return null;
  const codigo = readNumber(row, ['ACR_Codigo', 'AGR_Idagricultor', 'codigo', 'id', 'acreedor_id', 'agricultor_id'], null);
  if (!codigo) return null;

  return {
    codigo,
    nombre: readText(row, ['nombre', 'ACR_Nombre', 'AGR_Nombre', 'razon_social'], null),
    nif: readText(row, ['nif', 'cif', 'ACR_Nif', 'AGR_Nif'], null),
    cuenta: readText(
      row,
      ['cuenta_id', 'cuenta', 'cuenta_contable', 'ACR_IdCuenta', 'ACR_Cuenta', 'AGR_Cuenta'],
      null,
    ),
    cuentaGasto: readText(row, ['cuenta_gasto', 'ACR_CuentaGasto', 'ACR_Cuentagasto'], null),
    cuentaCartera: readText(row, ['cuenta_cartera', 'ACR_IdCuentaCartera', 'ACR_CuentaCartera'], null),
    porcentajeIva: readNumber(row, ['porcentaje_iva', 'ACR_PorcentajeIVA', 'ACR_PorcentajeIva'], null),
    formaPagoId: readNumber(row, ['forma_pago_id', 'ACR_IdFormaPago', 'formacobropagoid'], null),
    bancoId: readNumber(row, ['banco_id', 'ACR_IdBanco', 'empresabancoid'], null),
    raw: row,
  };
};

export const fetchFacturaProveedorERPDetail = async (
  proveedorId: number,
  tipoFactura?: string | null,
  matchEvidence: unknown = null,
): Promise<FacturaProveedorERPDetail | null> => {
  const resource = facturaProveedorERPResource(tipoFactura, matchEvidence, proveedorId);
  const response = await erpRead<unknown>(`${resource}/${encodeURIComponent(String(proveedorId))}`);
  return mapProveedorERPDetail(response);
};

export const buildFacturaDuplicateConsulta = (params: {
  empresaId: number;
  ejercicio: number;
  proveedorId: number;
  numeroFactura: string;
  tipoFactura: string;
}) =>
  `facturasrecibidas/buscar?empresa_id=${encodeURIComponent(String(params.empresaId))}` +
  `&ejercicio=${encodeURIComponent(String(params.ejercicio))}` +
  `&proveedor_id=${encodeURIComponent(String(params.proveedorId))}` +
  `&numero_factura=${encodeURIComponent(params.numeroFactura.trim())}` +
  `&tipo_factura=${encodeURIComponent(params.tipoFactura.trim().toUpperCase())}`;

export const getPunteoImporte = (
  punteo: Partial<
    Pick<FacturaRecibidaPunteo, 'importe_factura' | 'importe' | 'importe_punteado'>
  >,
) =>
  Number(
    punteo.importe_factura ??
      punteo.importe ??
      punteo.importe_punteado ??
      0,
  ) || 0;

const mapDuplicateCandidate = (value: unknown): FacturaERPDuplicateCandidate | null => {
  const row = findNestedERPRecord(value, ['FRR_id', 'frr_id']);
  if (!row) return null;
  const frrId = readNumber(row, ['FRR_id', 'frr_id', 'id'], null);
  if (!frrId) return null;

  return {
    frrId,
    empresaId: readNumber(row, ['FRR_Idempresa', 'empresa_id'], null),
    ejercicio: readNumber(row, ['FRR_ejercicio', 'ejercicio'], null),
    proveedorId: readNumber(row, ['FRR_idproveedor', 'proveedor_id'], null),
    numeroFactura: readText(row, ['FRR_numerofactura', 'numero_factura'], null),
    numero: readNumber(row, ['FRR_numero', 'numero'], null),
    proveedor: readText(row, ['acreedor_nombre', 'proveedor_nombre', 'ACR_Nombre'], null),
    fecha: readText(row, ['FRR_fechafactura', 'fecha_factura'], null),
    total: readNumber(row, ['FRR_totalfac', 'total_factura', 'total'], null),
  };
};

const validationIssue = (
  code: string,
  field: string,
  message: string,
  details?: Record<string, unknown>,
): FacturaValidationIssue => ({ code, field, message, severity: 'error', details: details ?? null });

const looksLikeProveedorNotFoundError = (error: unknown) => {
  const message = normalizeIssueToken(error instanceof Error ? error.message : error);
  return (
    !message.includes('function not found') &&
    !message.includes('funcion no encontrada') &&
    (message.includes('acreedor no encontrado') ||
      message.includes('agricultor no encontrado') ||
      message.includes('proveedor no encontrado') ||
      message.includes('acreedor not found') ||
      message.includes('agricultor not found'))
  );
};

export const preflightFacturaRecibidaERP = async (
  factura: Partial<UiFacturaRecibida>,
  options: { gastos?: FacturaRecibidaLinea[] } = {},
): Promise<FacturaERPPreflightResult> => {
  const proveedorId = numberValue(factura.proveedor_codigo, null);
  const empresaId = numberValue(factura.fr_alm, null);
  const ejercicio = numberValue(factura.ejercicio, null);
  const numeroFactura = cleanText(factura.numero_factura);
  const tipoFactura =
    tipoFacturaRadioValue(
      factura.fr_sufa,
      factura.match_evidence,
      factura.proveedor_codigo,
    ) || null;
  const cuentaFactura = cleanText(factura.proveedor_cuenta);
  const issues: FacturaValidationIssue[] = [];

  if (!proveedorId) {
    issues.push(validationIssue('proveedor_id_requerido', 'FRR_idproveedor', 'Selecciona un proveedor ERP.'));
  }
  if (!cuentaFactura) {
    issues.push(validationIssue('cuenta_proveedor_requerida', 'FRR_idcuenta', 'Falta la cuenta del proveedor ERP.'));
  }
  if (!empresaId) {
    issues.push(validationIssue('empresa_erp_requerida', 'FRR_Idempresa', 'Selecciona la empresa ERP.'));
  }
  if (ejercicio === null) {
    issues.push(validationIssue('ejercicio_erp_requerido', 'FRR_ejercicio', 'Indica el ejercicio ERP.'));
  }
  if (!numeroFactura) {
    issues.push(validationIssue('numero_factura_requerido', 'FRR_numerofactura', 'Indica el numero de factura.'));
  }

  const accountingLines = [
    ...(options.gastos ?? []).map((linea, index) => ({
      ...linea,
      kind: 'gasto' as const,
      index,
    })),
    ...(factura.ctb_lineas ?? []).map((linea, index) => ({
      ...linea,
      kind: 'ctb' as const,
      index,
    })),
  ];
  const accountPairIssues = validateFacturaAccountPairs({
    gastos: options.gastos ?? [],
    ctb: factura.ctb_lineas ?? [],
  });
  issues.push(...accountPairIssues);

  if (
    empresaId &&
    !accountPairIssues.some((issue) => issue.severity === 'error')
  ) {
    const accounts = Array.from(
      new Set(
        accountingLines
          .map((linea) => cleanText(linea.descripcion))
          .filter((account): account is string => Boolean(account)),
      ),
    );
    const accountResults = await Promise.allSettled(
      accounts.map(async (account) => ({
        account,
        options: await fetchFacturaCuentas({
          empresaId,
          cuenta: account,
          limit: 10,
        }),
      })),
    );
    accountResults.forEach((result, index) => {
      const account = accounts[index];
      if (result.status === 'rejected') {
        issues.push(
          validationIssue(
            'cuentas_api_no_disponible',
            'cuentas_contables',
            'No se pudieron comprobar las cuentas contables en el ERP.',
          ),
        );
      } else if (
        !result.value.options.some((option) => option.value === account)
      ) {
        issues.push(
          validationIssue(
            'cuenta_contable_no_encontrada',
            'cuentas_contables',
            `La cuenta ${account} no existe para la empresa ERP ${empresaId}.`,
            { empresa_id: empresaId, cuenta: account },
          ),
        );
      }
    });
  }

  let provider: FacturaProveedorERPDetail | null = null;
  if (proveedorId) {
    try {
      provider = await fetchFacturaProveedorERPDetail(
        proveedorId,
        factura.fr_sufa,
        factura.match_evidence,
      );
      if (!provider) {
        issues.push(validationIssue(
          'proveedor_no_encontrado',
          'FRR_idproveedor',
          `El proveedor ${proveedorId} no existe en la API del ERP.`,
          { proveedor_id: proveedorId },
        ));
      } else if (cuentaFactura && provider.cuenta !== cuentaFactura) {
        issues.push(validationIssue(
          'cuenta_proveedor_no_coincide',
          'FRR_idcuenta',
          `La cuenta ${cuentaFactura} no coincide con la cuenta ${provider.cuenta ?? 'sin informar'} del proveedor en el ERP.`,
          { proveedor_id: proveedorId, cuenta_factura: cuentaFactura, cuenta_erp: provider.cuenta },
        ));
      }
    } catch (error) {
      const notFound = looksLikeProveedorNotFoundError(error);
      issues.push(validationIssue(
        notFound ? 'proveedor_no_encontrado' : 'proveedor_api_no_disponible',
        'FRR_idproveedor',
        notFound
          ? `El proveedor ${proveedorId} no existe en la API del ERP.`
          : `No se pudo consultar el proveedor ${proveedorId} porque la API del ERP no esta disponible. ${error instanceof Error ? error.message : ''}`.trim(),
        { proveedor_id: proveedorId },
      ));
    }
  }

  let duplicate: FacturaERPDuplicateCandidate | null = null;
  const canCheckDuplicate = Boolean(
    empresaId &&
      ejercicio !== null &&
      proveedorId &&
      numeroFactura &&
      tipoFactura,
  );
  if (canCheckDuplicate && !issues.some((issue) => issue.code === 'proveedor_api_no_disponible')) {
    try {
      const response = await erpRead<unknown>(buildFacturaDuplicateConsulta({
        empresaId: empresaId as number,
        ejercicio: ejercicio as number,
        proveedorId: proveedorId as number,
        numeroFactura: numeroFactura as string,
        tipoFactura: tipoFactura as string,
      }));
      duplicate = mapDuplicateCandidate(response);
      if (duplicate) {
        issues.push(validationIssue(
          'factura_duplicada_erp',
          'FRR_numerofactura',
          `Ya existe la factura en ERP con FRR_id ${duplicate.frrId}.`,
          {
            FRR_id: duplicate.frrId,
            empresa_id: duplicate.empresaId,
            ejercicio: duplicate.ejercicio,
            proveedor_id: duplicate.proveedorId,
            numero_factura: duplicate.numeroFactura,
          },
        ));
      }
    } catch (error) {
      issues.push(validationIssue(
        'duplicado_api_no_disponible',
        'FRR_numerofactura',
        `No se pudo comprobar el duplicado en la API del ERP. ${error instanceof Error ? error.message : ''}`.trim(),
      ));
    }
  }

  return {
    provider,
    duplicate,
    issues: normalizeFacturaValidationIssues(issues),
  };
};

export const fetchFacturaEmpresas = async (): Promise<FacturaEmpresaOption[]> => {
  const response = await erpRead<ERPReadListResponse<ERPReadGenericRow> | ERPReadGenericRow[]>('empresas');
  return responseItems(response)
    .map((item) => (item && typeof item === 'object' ? (item as ERPReadGenericRow) : null))
    .filter((item): item is ERPReadGenericRow => Boolean(item))
    .map((item) => {
      const id = cleanText(firstValue(item, ['EMP_idempresa', 'id', 'empresa_id', 'codigo']));
      const nombre = readText(item, ['EMP_nombre', 'EMP_Nombre', 'nombre', 'razon_social'], null);
      const cif = readText(item, ['EMP_cif', 'EMP_Cif', 'cif', 'nif'], null);
      if (!id) return null;

      return {
        id,
        nombre,
        cif,
        label: [id, nombre].filter(Boolean).join(' - '),
      } satisfies FacturaEmpresaOption;
    })
    .filter((item): item is FacturaEmpresaOption => Boolean(item));
};

// Descripciones facilitadas por Campojoyma (correo del 07/07/2026, archivado en
// docs/evidencias/facturas-recibidas/onduspan/). Se conserva su texto literal.
// FI, CE y GM no llevan descripcion ni en la lista oficial del cliente, y el ERP
// tampoco la almacena: facturasrecibidastipo existe con cero filas.
export const TIPO_FACTURA_DESCRIPCIONES: Record<string, string> = {
  OT: 'OTROS',
  GE: 'COMPRAS GENERO',
  MA: 'MATERIALES',
  GV: 'GASTOS VENTAS',
  GC: 'GASTOS COMPRAS',
  FZ: 'FIANZA',
  CX: 'COSTES EXTERNOS',
};

export const tipoFacturaRadioValue = (
  value?: string | null,
  matchEvidence: unknown = null,
  expectedProviderId: unknown = null,
): 'GE' | 'OT' | '' => {
  const tipo = value?.trim().toUpperCase();
  if (!tipo) {
    const evidenceType = facturaProveedorERPKindFromMatchEvidence(
      matchEvidence,
      expectedProviderId,
    );
    return evidenceType === 'agricultor'
      ? 'GE'
      : evidenceType === 'acreedor'
        ? 'OT'
        : '';
  }
  return tipo === 'GE' ? 'GE' : 'OT';
};

export const labelTipoFactura = (value: string): string => {
  const descripcion = TIPO_FACTURA_DESCRIPCIONES[value.trim().toUpperCase()];
  return descripcion ? `${value} — ${descripcion}` : value;
};

export const fetchFacturaTipos = async (): Promise<FacturaTipoOption[]> => {
  const response = await erpRead<ERPReadListResponse<ERPReadGenericRow> | ERPReadGenericRow[] | string[]>(
    'facturasrecibidas/tipos',
  );
  const values = responseItems(response)
    .map((item) => {
      if (typeof item === 'string') return cleanText(item);
      if (!item || typeof item !== 'object') return null;
      return cleanText(firstValue(item as ERPReadGenericRow, ['tipo_factura', 'FRR_tipofactura', 'tipo', 'value', 'codigo']));
    })
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(values)).map((value) => ({ value, label: labelTipoFactura(value) }));
};

export const fetchFacturaRegimenes = async (): Promise<FacturaRegimenOption[]> => {
  const response = await erpRead<ERPReadListResponse<ERPReadGenericRow> | ERPReadGenericRow[] | string[]>(
    'regimenes',
  );
  return responseItems(response)
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') {
        const value = cleanText(item);
        return value ? { value, label: value } : null;
      }
      if (!item || typeof item !== 'object') return null;
      const record = item as ERPReadGenericRow;
      const value = cleanText(firstValue(record, [
        'id',
        'codigo',
        'regimen_id',
        'idregimen',
        'REG_id',
        'FRR_idregimen',
      ]));
      const description = readText(record, [
        'descripcion',
        'nombre',
        'regimen',
        'REG_descripcion',
      ], null);
      return value
        ? { value, label: description ? `${value} - ${description}` : value }
        : null;
    })
    .filter((item): item is FacturaRegimenOption => Boolean(item));
};

export type FetchFacturaCuentasOptions = {
  empresaId?: number | null;
  search?: string;
  cuenta?: string;
  limit?: number;
  offset?: number;
};

export const fetchFacturaCuentas = async (
  options: FetchFacturaCuentasOptions | string = {},
): Promise<FacturaCuentaOption[]> => {
  const normalized =
    typeof options === 'string' ? { search: options } : options;
  const params = new URLSearchParams();
  if (
    normalized.empresaId !== null &&
    normalized.empresaId !== undefined &&
    Number.isInteger(Number(normalized.empresaId)) &&
    Number(normalized.empresaId) > 0
  ) {
    params.set('empresa_id', String(normalized.empresaId));
  }
  if (normalized.search?.trim()) params.set('q', normalized.search.trim());
  if (normalized.cuenta?.trim()) params.set('cuenta', normalized.cuenta.trim());
  params.set(
    'limit',
    String(Math.min(Math.max(1, Math.trunc(normalized.limit ?? 50)), 100)),
  );
  params.set('offset', String(Math.max(0, Math.trunc(normalized.offset ?? 0))));
  const query = `cuentas-contables?${params.toString()}`;
  const response = await erpRead<ERPReadListResponse<ERPReadGenericRow> | ERPReadGenericRow[]>(query);
  return responseItems(response)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as ERPReadGenericRow;
      const value = readText(record, ['cuenta', 'codigo', 'id', 'CTA_Cuenta'], null);
      const description = readText(record, ['descripcion', 'nombre', 'CTA_Descripcion'], null);
      return value
        ? {
            value,
            label: description ? `${value} - ${description}` : value,
            description,
            nif: readText(record, ['nif', 'NIF', 'CTA_Nif'], null),
          }
        : null;
    })
    .filter((item): item is FacturaCuentaOption => Boolean(item));
};

export const normalizeFacturaTiposIva = (
  response: ERPReadListResponse<ERPReadGenericRow> | ERPReadGenericRow[],
): FacturaTipoIvaOption[] => {
  const byPercentage = new Map<number, FacturaTipoIvaOption>();
  [
    { porcentaje: 0, nombre: 'Sin IVA' },
    { porcentaje: 4, nombre: 'Superreducido' },
    { porcentaje: 10, nombre: 'Reducido' },
    { porcentaje: 21, nombre: 'General' },
  ].forEach(({ porcentaje, nombre }) => {
    byPercentage.set(porcentaje, {
      value: String(porcentaje),
      porcentaje,
      label: `${porcentaje.toLocaleString('es-ES')} % — ${nombre}`,
      nombre,
    });
  });

  responseItems(response).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const record = item as ERPReadGenericRow;
    const porcentaje = readNumber(
      record,
      ['iva', 'porcentaje', 'TIV_IVA', 'IVA'],
      null,
    );
    if (
      porcentaje === null ||
      !Number.isFinite(porcentaje) ||
      porcentaje < 0
    ) {
      return;
    }
    const normalizedPercentage = Number(porcentaje);
    const nombre = readText(
      record,
      ['nombre', 'descripcion', 'TIV_Descripcion'],
      null,
    );
    byPercentage.set(normalizedPercentage, {
      value: String(normalizedPercentage),
      porcentaje: normalizedPercentage,
      label: `${normalizedPercentage.toLocaleString('es-ES')} %${
        nombre ? ` — ${nombre}` : ''
      }`,
      nombre,
    });
  });

  return Array.from(byPercentage.values()).sort(
    (left, right) => left.porcentaje - right.porcentaje,
  );
};

export const fetchFacturaTiposIva = async (): Promise<
  FacturaTipoIvaOption[]
> => {
  const response = await erpRead<
    ERPReadListResponse<ERPReadGenericRow> | ERPReadGenericRow[]
  >('tipos-iva');
  return normalizeFacturaTiposIva(response);
};

export const validateFacturaAccountPairs = (input: {
  gastos: FacturaRecibidaLinea[];
  ctb: FacturaRecibidaLinea[];
}): FacturaValidationIssue[] => {
  const issues: FacturaValidationIssue[] = [];
  const validate = (
    linea: FacturaRecibidaLinea,
    kind: 'gasto' | 'ctb',
    index: number,
  ) => {
    const account = cleanText(linea.descripcion);
    const amount = numberValue(linea.importe, 0) ?? 0;
    const hasAnyData =
      kind === 'ctb'
        ? !isFacturaCtbLineaEmpty(linea)
        : Boolean(account) || Math.abs(amount) > 0.01;
    if (!hasAnyData) return;
    const label = kind === 'gasto' ? 'gasto' : 'CTB';
    if (!account) {
      issues.push(
        validationIssue(
          `${kind}_cuenta_requerida`,
          `${kind}.${index}.cuenta`,
          `Indica la cuenta de la línea ${index + 1} de ${label}.`,
        ),
      );
    }
    if (account && Math.abs(amount) <= 0.01) {
      issues.push(
        validationIssue(
          `${kind}_importe_requerido`,
          `${kind}.${index}.importe`,
          `Indica un importe distinto de cero en la línea ${index + 1} de ${label}.`,
        ),
      );
    }
  };

  input.gastos.forEach((linea, index) => validate(linea, 'gasto', index));
  input.ctb.forEach((linea, index) => validate(linea, 'ctb', index));
  return normalizeFacturaValidationIssues(issues);
};

export const searchFacturasERP = async (search: string): Promise<FacturaERPMatch[]> => {
  const query = search.trim();
  if (!query) return [];

  const requests: Array<Promise<ERPReadListResponse<ERPReadFacturaRow> | ERPReadFacturaRow>> = [
    erpRead<ERPReadListResponse<ERPReadFacturaRow>>(
      `facturasrecibidas?numero_factura=${encodeURIComponent(query)}&limit=20`,
    ),
  ];
  if (/^\d+$/.test(query)) {
    requests.push(erpRead<ERPReadFacturaRow>(`facturasrecibidas/${encodeURIComponent(query)}`));
  }

  const settled = await Promise.allSettled(requests);
  const rows = settled.flatMap((result) => {
    if (result.status !== 'fulfilled') return [];
    const items = responseItems(result.value);
    return items.length > 0 ? items : [result.value];
  });
  if (rows.length === 0 && settled.every((result) => result.status === 'rejected')) {
    const firstFailure = settled.find((result) => result.status === 'rejected');
    if (firstFailure?.status === 'rejected') throw firstFailure.reason;
  }

  const byId = new Map<number, FacturaERPMatch>();
  rows.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const row = item as ERPReadFacturaRow;
    const frrId = readNumber(row, ['FRR_id', 'frr_id', 'id'], null);
    if (!frrId) return;
    byId.set(frrId, {
      frrId,
      numero: readNumber(row, ['FRR_numero', 'numero'], null),
      numeroFactura: readText(row, ['FRR_numerofactura', 'numero_factura'], null),
      proveedor: readText(row, ['acreedor_nombre', 'proveedor_nombre', 'ACR_Nombre'], null),
      fecha: readText(row, ['FRR_fechafactura', 'fecha_factura'], null),
      total: readNumber(row, ['FRR_totalfac', 'total'], null),
    });
  });
  return Array.from(byId.values());
};

export const fetchFacturaPunteables = async (params: {
  empresaId: number;
  proveedorId: number;
}): Promise<FacturaRecibidaPunteo[]> => {
  const response = await erpRead<{ items?: ERPReadPunteoRow[] }>(
    `albaranes-gastos/punteables?empresa_id=${params.empresaId}&proveedor_id=${params.proveedorId}&solo_pendientes=true&include_lines=false&limit=100`,
  );
  return (response.items ?? []).map((punteo, index) => ({
    ...mapRemotePunteoToUi(punteo, index, `candidate-${params.empresaId}-${params.proveedorId}`),
    seleccionado: false,
  }));
};

export const fetchFacturaPunteosLive = async (
  facturaId: number,
): Promise<FacturaRecibidaPunteo[]> => {
  if (!Number.isInteger(facturaId) || facturaId < 1) {
    throw new Error('La factura no tiene una identidad ERP válida.');
  }

  const response = await erpRead<{ items?: ERPReadPunteoRow[] }>(
    `facturasrecibidas/${facturaId}/punteos?include_lines=false`,
  );
  if (!Array.isArray(response?.items)) {
    throw new Error('La API no devolvió un listado válido de albaranes vinculados.');
  }

  return response.items.map((punteo, index) =>
    mapRemotePunteoToUi(punteo, index, facturaId));
};

const mapAlbaranEntradaLineaERP = (
  linea: ERPReadGenericRow,
  requestedAlbaranId: number,
): AlbaranEntradaLineaERP => {
  const id = readNumber(linea, ['id'], null);
  const albaranId = readNumber(linea, ['albaran_id'], null);
  if (
    id === null ||
    !Number.isInteger(id) ||
    id < 1 ||
    albaranId === null ||
    !Number.isInteger(albaranId) ||
    albaranId !== requestedAlbaranId
  ) {
    throw new Error('La API devolvió una línea de albarán con una identidad no válida.');
  }

  return {
    id,
    albaran_id: albaranId,
    linea: readNumber(linea, ['linea'], null),
    partida: readNumber(linea, ['partida'], null),
    genero_id: readNumber(linea, ['genero_id'], null),
    genero_nombre: readText(linea, ['genero_nombre'], null),
    categoria_id: readNumber(linea, ['categoria_id'], null),
    categoria_nombre: readText(linea, ['categoria_nombre'], null),
    categoria_calibre: readText(linea, ['categoria_calibre'], null),
    categoria_calibre_nombre: readText(linea, ['categoria_calibre_nombre'], null),
    envase_id: readNumber(linea, ['envase_id'], null),
    envase_nombre: readText(linea, ['envase_nombre'], null),
    cultivo_id: readNumber(linea, ['cultivo_id'], null),
    tipo_cultivo_id: readNumber(linea, ['tipo_cultivo_id'], null),
    tipo_cultivo_abreviatura: readText(linea, ['tipo_cultivo_abreviatura'], null),
    tipo_cultivo_nombre: readText(linea, ['tipo_cultivo_nombre'], null),
    calidad_codigo: readText(linea, ['calidad_codigo'], null),
    kilos_brutos: readNumber(linea, ['kilos_brutos'], null),
    kilos_netos: readNumber(linea, ['kilos_netos'], null),
    palets: readNumber(linea, ['palets'], null),
    bultos: readNumber(linea, ['bultos'], null),
    piezas: readNumber(linea, ['piezas'], null),
    precio: readNumber(linea, ['precio'], null),
    importe: readNumber(linea, ['importe'], null),
  };
};

export const fetchAlbaranEntradaLineas = async (
  albaranId: number,
): Promise<AlbaranEntradaLineaERP[]> => {
  if (!Number.isInteger(albaranId) || albaranId < 1) {
    throw new Error('El albarán no tiene una identidad ERP válida.');
  }

  const response = await erpRead<{ items?: ERPReadGenericRow[] }>(
    `albaranes/entrada/${albaranId}/lineas`,
  );
  if (!Array.isArray(response?.items)) {
    throw new Error('La API no devolvió un listado válido de líneas del albarán.');
  }

  return response.items.map((linea) => mapAlbaranEntradaLineaERP(linea, albaranId));
};

export const fetchAlbaranMaterialLineas = async (
  materialId: number,
  facturaId?: number | null,
): Promise<FacturaRecibidaPunteoLinea[]> => {
  if (!Number.isInteger(materialId) || materialId < 1) {
    throw new Error('El albarán de material no tiene una identidad ERP válida.');
  }

  try {
    const response = await erpRead<{ items?: ERPReadGenericRow[] }>(
      `albaranes/material/${materialId}/lineas`,
    );
    if (!Array.isArray(response?.items)) {
      throw new Error('La API no devolvió un listado válido de líneas del albarán.');
    }
    return response.items.map(mapPunteoLinea);
  } catch (error) {
    if (!Number.isInteger(facturaId) || Number(facturaId) < 1) throw error;

    const response = await erpRead<{ items?: ERPReadPunteoRow[] }>(
      `facturasrecibidas/${Number(facturaId)}/punteos?include_lines=true`,
    );
    const material = (Array.isArray(response?.items) ? response.items : []).find(
      (punteo) =>
        readText(punteo, ['source_table'], null)?.toLowerCase() === 'albmaterial' &&
        readNumber(punteo, ['source_id'], null) === materialId,
    );
    if (!material || !Array.isArray(material.lines)) {
      throw new Error('La API no devolvió las líneas del albarán solicitado.');
    }
    return asRecordArray(material.lines).map(mapPunteoLinea);
  }
};

const validateFacturaPdf = (file: File) => {
  if (file.type && file.type !== 'application/pdf') {
    throw new Error('Solo se admiten archivos PDF.');
  }
  if (file.size > MAX_FACTURA_PDF_BYTES) {
    throw new Error('El PDF supera el tamaño máximo permitido de 20 MB.');
  }
};

export const getFacturaPdfSignedUrl = async (pdfPath?: string | null) => {
  const pdfId = pdfIdFromPath(pdfPath);
  if (!pdfId) return null;
  const { data: metadata, error: metadataError } = await supabase
    .from('archivos_pdf')
    .select('storage_bucket, storage_path')
    .eq('id', pdfId)
    .single();
  if (metadataError) throw metadataError;
  if (metadata.storage_bucket && metadata.storage_path) {
    const { data, error } = await supabase.storage
      .from(metadata.storage_bucket)
      .createSignedUrl(metadata.storage_path, 5 * 60);
    if (error) throw error;
    return data.signedUrl;
  }
  const pdf = await facturasRecibidas.getPdfBase64(pdfId);
  return pdf.base64 ? `data:application/pdf;base64,${pdf.base64}` : null;
};

export type FacturaRecibidaExtraerResponse = {
  contract_version?: number;
  request_id?: string;
  ok?: boolean;
  factura_id?: string;
  version?: number;
  factura?: {
    id?: string | null;
  } | null;
  estado?: UiFacturaEstado;
  validation_errors?: unknown[];
  error?: string;
};

export const extractFacturaFromPdf = async (
  file: File,
  factura: Partial<UiFacturaRecibida> = {},
): Promise<UiFacturaRecibida> => {
  validateFacturaPdf(file);
  const requestId = crypto.randomUUID();
  const pdfBase64 = await blobToBase64(file);

  const { data, error } = await supabase.functions.invoke<FacturaRecibidaExtraerResponse>('factura-recibida-extraer', {
    body: {
      contract_version: 2,
      request_id: requestId,
      factura_id: factura.id ?? undefined,
      expected_version: factura.id ? factura.version ?? undefined : undefined,
      source: 'front_draft',
      pdf_base64: pdfBase64,
      pdf_nombre: file.name,
      pdf_mime_type: file.type || 'application/pdf',
      pdf_size: file.size,
    },
  });

  if (error) {
    throw new Error(
      (await getFunctionInvokeErrorMessage(error, data)) ??
        'No se pudo analizar la factura mediante xFuego.',
    );
  }
  const message = getFunctionErrorMessage(data);
  if (message) throw new Error(message);

  const facturaId = data?.factura_id ?? data?.factura?.id ?? null;
  if (!facturaId) {
    throw new Error('La extraccion no devolvio la factura creada.');
  }

  const saved = await fetchFacturaRecibidaById(facturaId);
  if (!saved) {
    throw new Error('No se pudo recuperar la factura creada.');
  }
  return saved;
};
