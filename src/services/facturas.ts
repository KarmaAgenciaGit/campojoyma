import { supabase } from '@/integrations/supabase/client';
import { facturasRecibidas } from '@/services/facturasRecibidas';
import type {
  FacturaRecibida as UiFacturaRecibida,
  FacturaRecibidaEstado as UiFacturaEstado,
  FacturaRecibidaLinea,
} from '@/services/apiContracts';
import type {
  FacturaRecibida as ERPFacturaRecibida,
  FacturaRecibidaEstado as ERPFacturaEstado,
} from '@/types/facturasRecibidas';
import { nullableNumber } from '@/types/facturasRecibidas';

const PDF_PATH_PREFIX = 'archivo_pdf_id:';
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
type ERPReadGenericRow = Record<string, unknown>;

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

const cleanText = (value: unknown) => {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
};

const numberValue = (value: unknown, fallback: number | null = null) => {
  const parsed = nullableNumber(value);
  return parsed ?? fallback;
};

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

const responseItems = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.datos)) return record.datos;
  return [];
};

const isFunctionUnavailable = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown; context?: { status?: unknown } }).status ?? (error as { context?: { status?: unknown } }).context?.status;
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  return status === 404 || message.includes('function not found') || message.includes('not found');
};

const erpRemoteId = (id: unknown) => `${ERP_REMOTE_ID_PREFIX}${String(id ?? '').trim()}`;

const erpIdFromUiId = (id?: string | null) => {
  if (!id?.startsWith(ERP_REMOTE_ID_PREFIX)) return null;
  const parsed = Number(id.slice(ERP_REMOTE_ID_PREFIX.length));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

export const isERPReadOnlyFactura = (factura: Partial<UiFacturaRecibida> | null | undefined) =>
  factura?.erp_payload?.source === ERP_READ_SOURCE || Boolean(erpIdFromUiId(factura?.id ?? null));

const erpRead = async <T>(consulta: string): Promise<T> => {
  const { data, error } = await supabase.functions.invoke(ERP_READ_FUNCTION, {
    body: { consulta },
  });
  if (error) throw error;
  const message = getFunctionErrorMessage(data);
  if (message) throw new Error(message);
  return data as T;
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

const validationMessages = (factura: ERPFacturaRecibida) =>
  [
    ...(factura.validation_errors ?? []).map((item) => item.message),
    factura.erp_error,
  ].filter((value): value is string => Boolean(cleanText(value)));

const erpFacturaPayloadKeys = [
  'FRR_id',
  'FRR_numero',
  'FRR_ejercicio',
  'FRR_idcentro',
  'FRR_idproveedor',
  'FRR_idcuenta',
  'FRR_numerofactura',
  'FRR_fechafactura',
  'FRR_fechactb',
  'FRR_Idempresa',
  'FRR_base1',
  'FRR_iva1',
  'FRR_cuota1',
  'FRR_base2',
  'FRR_iva2',
  'FRR_cuota2',
  'FRR_base3',
  'FRR_iva3',
  'FRR_cuota3',
  'FRR_base4',
  'FRR_iva4',
  'FRR_cuota4',
  'FRR_base5',
  'FRR_iva5',
  'FRR_cuota5',
  'FRR_baseret',
  'FRR_ret',
  'FRR_cuotaret',
  'FRR_totalfac',
  'FRR_tipofactura',
  'FRR_Concepto',
  'FRR_Observaciones',
  'FRR_ObservacionesAEAT',
  'FRR_ImpSuplido',
  'FRR_CuotaNoDeducible',
] as const;

const erpCtbPayloadKeys = [
  'FRC_id',
  'FRC_idfacturarecibida',
  'FRC_Cuenta',
  'FRC_Importe',
  'FRC_IdActividad',
  'FRC_Idseccion',
  'FRC_Iddepartamento',
  'FRC_Idsubdepartamento',
  'FRC_IdUsuarioLog',
  'FRC_FechaLog',
  'FRC_HoraLog',
] as const;

const pickPayloadKeys = <TSource extends Record<string, unknown>>(source: TSource, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, source[key] ?? null]));

const buildERPWebhookPayloadPreview = (factura: ERPFacturaRecibida) => ({
  operation: 'factura_recibida.create',
  request_id: factura.id,
  factura: pickPayloadKeys(factura as unknown as Record<string, unknown>, erpFacturaPayloadKeys),
  ctb: factura.ctb.map((linea) => pickPayloadKeys(linea as unknown as Record<string, unknown>, erpCtbPayloadKeys)),
});

const mapLineToUi = (linea: ERPFacturaRecibida['ctb'][number], index: number): FacturaRecibidaLinea => ({
  id: linea.id,
  factura_recibida_id: linea.factura_id,
  posicion: linea.posicion ?? index + 1,
  descripcion: linea.FRC_Cuenta ?? '',
  importe: linea.FRC_Importe ?? 0,
  created_at: linea.created_at,
  updated_at: linea.updated_at,
});

const mapFacturaToUi = (factura: ERPFacturaRecibida): UiFacturaRecibida => ({
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
  fr_alm: cleanText(factura.FRR_Idempresa),
  fr_sufa: factura.FRR_tipofactura,
  fecha_factura: factura.FRR_fechafactura,
  base_imponible: factura.FRR_base1,
  iva_porcentaje: factura.FRR_iva1,
  iva_importe:
    (factura.FRR_cuota1 ?? 0) +
    (factura.FRR_cuota2 ?? 0) +
    (factura.FRR_cuota3 ?? 0) +
    (factura.FRR_cuota4 ?? 0) +
    (factura.FRR_cuota5 ?? 0),
  retencion_porcentaje: factura.FRR_ret,
  retencion_importe: factura.FRR_cuotaret,
  total: factura.FRR_totalfac,
  asunto_email: factura.FRR_Concepto ?? factura.FRR_Observaciones,
  pdf_path: pdfPathFromId(factura.archivo_pdf_id),
  pdf_nombre: factura.source_pdf_name,
  pdf_mime_type: 'application/pdf',
  pdf_size: null,
  validation_errors: validationMessages(factura),
  erp_last_attempt_at: null,
  erp_sent_at: factura.erp_sent_at,
  erp_response: factura.erp_response as Record<string, unknown> | null,
  erp_error: factura.erp_error,
  erp_payload: null,
  erp_factura_id: factura.FRR_id ? String(factura.FRR_id) : null,
  created_at: factura.created_at,
  updated_at: factura.updated_at,
  facturas_recibidas_lineas: factura.ctb.map(mapLineToUi),
});

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
    created_at: timestamp,
    updated_at: timestamp,
  };
};

const mapRemoteFacturaToUi = (
  factura: ERPReadFacturaRow,
  lineas: ERPReadCtbRow[] = [],
): UiFacturaRecibida => {
  const frrId = readNumber(factura, ['FRR_id', 'frr_id', 'id'], 0) ?? 0;
  const fechaFactura = readText(factura, ['FRR_fechafactura', 'fecha_factura'], null);
  const fechaContable = readText(factura, ['FRR_fechactb', 'fecha_contable'], fechaFactura);
  const fechaLog = readText(factura, ['FRR_FechaLog', 'fecha_log'], fechaContable);
  const timestamp = fechaLog ? `${fechaLog}T00:00:00` : new Date().toISOString();
  const cuotaIva =
    (readNumber(factura, ['FRR_cuota1', 'cuota1'], 0) ?? 0) +
    (readNumber(factura, ['FRR_cuota2', 'cuota2'], 0) ?? 0) +
    (readNumber(factura, ['FRR_cuota3', 'cuota3'], 0) ?? 0) +
    (readNumber(factura, ['FRR_cuota4', 'cuota4'], 0) ?? 0) +
    (readNumber(factura, ['FRR_cuota5', 'cuota5'], 0) ?? 0);

  return {
    id: erpRemoteId(frrId),
    documento_codigo: cleanText(frrId),
    estado: 'enviada_erp',
    proveedor_nombre: readText(factura, ['acreedor_nombre', 'proveedor_nombre', 'ACR_Nombre'], null),
    proveedor_nif: readText(factura, ['acreedor_nif', 'proveedor_nif', 'ACR_Nif'], null),
    proveedor_codigo: cleanText(readNumber(factura, ['FRR_idproveedor', 'proveedor_id', 'acreedor_codigo'], null)),
    proveedor_cuenta: readText(factura, ['FRR_idcuenta', 'cuenta_proveedor', 'ACR_Cuenta'], null),
    numero_factura: readText(factura, ['FRR_numerofactura', 'numero_factura'], null),
    referencia: cleanText(readNumber(factura, ['FRR_numero', 'numero'], null)),
    fr_alm: cleanText(readNumber(factura, ['FRR_Idempresa', 'empresa_id'], null)),
    fr_sufa: readText(factura, ['FRR_tipofactura', 'tipo_factura'], null),
    fecha_factura: fechaFactura,
    base_imponible: readNumber(factura, ['FRR_base1', 'base1'], null),
    iva_porcentaje: readNumber(factura, ['FRR_iva1', 'iva1', 'iva_porcentaje', 'tipo_iva'], null),
    iva_importe: cuotaIva,
    retencion_porcentaje: readNumber(factura, ['FRR_ret', 'retencion_porcentaje'], null),
    retencion_importe: readNumber(factura, ['FRR_cuotaret', 'retencion_importe'], null),
    total: readNumber(factura, ['FRR_totalfac', 'total_factura'], null),
    asunto_email: readText(factura, ['FRR_Concepto', 'concepto', 'FRR_Observaciones'], null),
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
    created_at: timestamp,
    updated_at: timestamp,
    facturas_recibidas_lineas: lineas.map((linea, index) => mapRemoteCtbToUi(linea, index, frrId)),
  };
};

const buildFacturaPayload = (
  factura: Partial<UiFacturaRecibida>,
  current?: ERPFacturaRecibida | null,
) => ({
  FRR_idproveedor: numberValue(factura.proveedor_codigo, current?.FRR_idproveedor ?? null),
  FRR_idcuenta: cleanText(factura.proveedor_cuenta) ?? current?.FRR_idcuenta ?? null,
  FRR_numerofactura: cleanText(factura.numero_factura) ?? current?.FRR_numerofactura ?? null,
  FRR_fechafactura: cleanText(factura.fecha_factura) ?? current?.FRR_fechafactura ?? null,
  FRR_fechactb: cleanText(factura.fecha_factura) ?? current?.FRR_fechactb ?? current?.FRR_fechafactura ?? null,
  FRR_Idempresa: numberValue(factura.fr_alm, current?.FRR_Idempresa ?? 1) ?? 1,
  FRR_tipofactura: cleanText(factura.fr_sufa) ?? current?.FRR_tipofactura ?? null,
  FRR_base1: numberValue(factura.base_imponible, current?.FRR_base1 ?? 0) ?? 0,
  FRR_iva1: numberValue(factura.iva_porcentaje, current?.FRR_iva1 ?? 0) ?? 0,
  FRR_cuota1: numberValue(factura.iva_importe, current?.FRR_cuota1 ?? 0) ?? 0,
  FRR_base2: current?.FRR_base2 ?? 0,
  FRR_iva2: current?.FRR_iva2 ?? 0,
  FRR_cuota2: current?.FRR_cuota2 ?? 0,
  FRR_baseret: current?.FRR_baseret ?? 0,
  FRR_ret: numberValue(factura.retencion_porcentaje, current?.FRR_ret ?? 0) ?? 0,
  FRR_cuotaret: numberValue(factura.retencion_importe, current?.FRR_cuotaret ?? 0) ?? 0,
  FRR_totalfac: numberValue(factura.total, current?.FRR_totalfac ?? null),
  FRR_ImpSuplido: current?.FRR_ImpSuplido ?? 0,
  FRR_CuotaNoDeducible: current?.FRR_CuotaNoDeducible ?? 0,
  FRR_Concepto: cleanText(factura.asunto_email) ?? current?.FRR_Concepto ?? null,
  FRR_Observaciones: current?.FRR_Observaciones ?? null,
});

const buildCtbPayload = (lineas: FacturaRecibidaLinea[]) =>
  lineas.map((linea, index) => ({
    posicion: index + 1,
    FRC_Cuenta: cleanText(linea.descripcion),
    FRC_Importe: numberValue(linea.importe, 0) ?? 0,
    FRC_IdActividad: null,
    FRC_Idseccion: null,
    FRC_Iddepartamento: null,
    FRC_Idsubdepartamento: null,
  }));

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').replace(/^data:.*;base64,/i, ''));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el PDF.'));
    reader.readAsDataURL(blob);
  });

const sha256Hex = async (buffer: ArrayBuffer) => {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const getFunctionErrorMessage = (data: unknown) => {
  if (!data || typeof data !== 'object') return null;
  const error = (data as { error?: unknown }).error;
  return typeof error === 'string' ? error : null;
};

export const fetchFacturasRecibidas = async (): Promise<UiFacturaRecibida[]> => {
  const page = await facturasRecibidas.list({ page: 1, pageSize: 500 });
  return page.items.map(mapFacturaToUi);
};

export const fetchFacturaRecibidaById = async (id: string): Promise<UiFacturaRecibida | null> => {
  const remoteId = erpIdFromUiId(id);
  if (remoteId) {
    const [factura, ctb] = await Promise.all([
      erpRead<ERPReadFacturaRow>(`facturasrecibidas/${remoteId}`),
      erpRead<{ items?: ERPReadCtbRow[] }>(`facturasrecibidas/${remoteId}/ctb`),
    ]);
    return mapRemoteFacturaToUi(factura, ctb.items ?? []);
  }

  const factura = await facturasRecibidas.getById(id);
  return factura ? mapFacturaToUi(factura) : null;
};

export const saveFacturaRecibida = async (
  factura: Partial<UiFacturaRecibida>,
  lineas: FacturaRecibidaLinea[],
): Promise<UiFacturaRecibida> => {
  if (isERPReadOnlyFactura(factura)) {
    throw new Error('Las facturas reales de ERP son de solo lectura desde esta pantalla.');
  }

  if (factura.id) {
    const current = await facturasRecibidas.getById(factura.id);
    const updated = await facturasRecibidas.update({
      factura_id: factura.id,
      estado: mapEstadoToERP(factura.estado),
      proveedor_nombre: cleanText(factura.proveedor_nombre),
      proveedor_nif: cleanText(factura.proveedor_nif),
      factura: buildFacturaPayload(factura, current),
      ctb: buildCtbPayload(lineas),
    });
    return mapFacturaToUi(updated);
  }

  const archivoPdfId = pdfIdFromPath(factura.pdf_path);
  const insertPayload = {
    archivo_pdf_id: archivoPdfId,
    estado: mapEstadoToERP(factura.estado) ?? 'pendiente_revision',
    proveedor_nombre: cleanText(factura.proveedor_nombre),
    proveedor_nif: cleanText(factura.proveedor_nif),
    source_pdf_name: cleanText(factura.pdf_nombre),
    ...buildFacturaPayload(factura),
  };

  const { data, error } = await supabase
    .from('facturasrecibidas')
    .insert(insertPayload)
    .select('id')
    .single();
  if (error || !data?.id) throw error ?? new Error('No se pudo crear la factura.');

  if (lineas.length > 0) {
    const { error: linesError } = await supabase.from('facturasrecibidas_ctb').insert(
      buildCtbPayload(lineas).map((linea) => ({
        ...linea,
        factura_id: data.id,
      })),
    );
    if (linesError) throw linesError;
  }

  const created = await facturasRecibidas.getById(data.id);
  if (!created) throw new Error('Factura no encontrada tras crearla.');
  return mapFacturaToUi(created);
};

export const sendFacturaRecibidaToERP = async (id: string): Promise<UiFacturaRecibida> => {
  if (erpIdFromUiId(id)) {
    throw new Error('Esta factura ya existe en ERP y se muestra en modo solo lectura.');
  }

  const sent = await facturasRecibidas.sendToERP(id);
  return mapFacturaToUi(sent);
};

export type FacturaERPPayloadPreview = {
  ok: boolean;
  factura_id: string;
  validation_errors: string[];
  payload: Record<string, unknown>;
  body_json: string;
};

export const fetchFacturaRecibidaERPPayloadPreview = async (
  id: string,
): Promise<FacturaERPPayloadPreview> => {
  const remoteId = erpIdFromUiId(id);
  if (remoteId) {
    const factura = await fetchFacturaRecibidaById(id);
    return {
      ok: Boolean(factura),
      factura_id: id,
      validation_errors: [],
      payload: factura?.erp_response ?? {},
      body_json: JSON.stringify(factura?.erp_response ?? {}, null, 2),
    };
  }

  const factura = await facturasRecibidas.getById(id);
  return {
    ok: Boolean(factura),
    factura_id: id,
    validation_errors: factura ? validationMessages(factura) : ['Factura no encontrada.'],
    payload: factura ? buildERPWebhookPayloadPreview(factura) : {},
    body_json: JSON.stringify(factura ? buildERPWebhookPayloadPreview(factura) : {}, null, 2),
  };
};

export const cleanupFacturaRecibidaUpload = async (payload: {
  id?: string | null;
  pdf_path?: string | null;
}): Promise<void> => {
  if (payload.id) {
    await facturasRecibidas.delete(payload.id).catch(() => undefined);
  }
  const pdfId = pdfIdFromPath(payload.pdf_path);
  if (pdfId) {
    await supabase.from('archivos_pdf').delete().eq('id', pdfId);
  }
};

export type LocalizarProveedorResponse = {
  ok: boolean;
  erp_response?: {
    resultado?: string;
    datos?: Record<string, unknown> | string;
    [key: string]: unknown;
  };
};

export const localizarProveedorERP = async (payload: {
  nif?: string | null;
  nombre?: string | null;
}): Promise<LocalizarProveedorResponse> => {
  try {
    const consulta = payload.nif?.trim()
      ? `acreedores?nif=${encodeURIComponent(payload.nif.trim())}&limit=1`
      : payload.nombre?.trim()
        ? `acreedores?nombre=${encodeURIComponent(payload.nombre.trim())}&limit=1`
        : null;

    if (consulta) {
      const page = await erpRead<ERPReadListResponse<Record<string, unknown>>>(consulta);
      const data = page.items?.[0];
      if (!data) return { ok: true, erp_response: { datos: 'Proveedor no localizado.' } };

      return {
        ok: true,
        erp_response: {
          resultado: 'ok',
          datos: {
            codigo: readNumber(data, ['codigo', 'id', 'ACR_Codigo'], null),
            nombre: readText(data, ['nombre', 'ACR_Nombre'], null),
            cif: readText(data, ['nif', 'ACR_Nif'], null),
            cuenta: readText(data, ['cuenta', 'ACR_Cuenta'], null),
          },
        },
      };
    }
  } catch (error) {
    if (!isFunctionUnavailable(error)) {
      return { ok: false, erp_response: { datos: error instanceof Error ? error.message : 'No se pudo buscar proveedor.' } };
    }
  }

  let query = supabase.from('acreedores_cache').select('*').limit(1);
  if (payload.nif?.trim()) {
    query = query.ilike('ACR_Nif', `%${payload.nif.trim()}%`);
  } else if (payload.nombre?.trim()) {
    query = query.ilike('ACR_Nombre', `%${payload.nombre.trim()}%`);
  } else {
    return { ok: false, erp_response: { datos: 'Indica NIF o nombre para buscar proveedor.' } };
  }

  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, erp_response: { datos: error.message } };
  if (!data) return { ok: true, erp_response: { datos: 'Proveedor no localizado.' } };

  return {
    ok: true,
    erp_response: {
      resultado: 'ok',
      datos: {
        codigo: data.ACR_Codigo,
        nombre: data.ACR_Nombre,
        cif: data.ACR_Nif,
        cuenta: data.ACR_Cuenta,
      },
    },
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

  return Array.from(new Set(values)).map((value) => ({ value, label: value }));
};

export const uploadFacturaPdf = async (file: File) => {
  if (file.type && file.type !== 'application/pdf') {
    throw new Error('Solo se admiten archivos PDF.');
  }

  const buffer = await file.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const existing = await supabase
    .from('archivos_pdf')
    .select('id')
    .eq('hash_sha256', hash)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) {
    return {
      pdf_path: pdfPathFromId(existing.data.id),
      pdf_nombre: file.name,
      pdf_mime_type: file.type || 'application/pdf',
      pdf_size: file.size,
      pdf_reutilizado: true,
    };
  }

  const base64 = await blobToBase64(file);
  const { data, error } = await supabase
    .from('archivos_pdf')
    .insert({
      hash_sha256: hash,
      b64_contenido: base64,
      nombre_archivo: file.name,
      tamanio_bytes: file.size,
      mime_type: file.type || 'application/pdf',
    })
    .select('id')
    .single();
  if (error || !data?.id) throw error ?? new Error('No se pudo guardar el PDF.');

  return {
    pdf_path: pdfPathFromId(data.id),
    pdf_nombre: file.name,
    pdf_mime_type: file.type || 'application/pdf',
    pdf_size: file.size,
    pdf_reutilizado: false,
  };
};

export const getFacturaPdfSignedUrl = async (pdfPath?: string | null) => {
  const pdfId = pdfIdFromPath(pdfPath);
  if (!pdfId) return null;
  const pdf = await facturasRecibidas.getPdfBase64(pdfId);
  return pdf.base64 ? `data:application/pdf;base64,${pdf.base64}` : null;
};

export type FacturaRecibidaExtraerResponse = {
  ok?: boolean;
  factura_id?: string;
  factura?: {
    id?: string | null;
  } | null;
  estado?: UiFacturaEstado;
  validation_errors?: unknown[];
  error?: string;
};

export const extractFacturaWithN8n = async (
  factura: Partial<UiFacturaRecibida>,
): Promise<UiFacturaRecibida> => {
  const archivoPdfId = pdfIdFromPath(factura.pdf_path);
  if (!archivoPdfId) {
    throw new Error('No se encontro el PDF guardado para analizar.');
  }

  const { data, error } = await supabase.functions.invoke<FacturaRecibidaExtraerResponse>('factura-recibida-extraer', {
    body: {
      archivo_pdf_id: archivoPdfId,
      source: 'xfuego-front',
      pdf_nombre: factura.pdf_nombre,
      pdf_mime_type: factura.pdf_mime_type,
      pdf_size: factura.pdf_size,
    },
  });

  if (error) throw error;
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
