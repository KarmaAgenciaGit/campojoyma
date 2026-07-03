import { supabase } from '@/integrations/supabase/client';
import { facturasRecibidas } from '@/services/facturasRecibidas';
import type {
  FacturaRecibida as UiFacturaRecibida,
  FacturaRecibidaEstado as UiFacturaEstado,
  FacturaRecibidaLinea,
} from '@/services/apiContracts';
import type {
  FacturaRecibida as NetagroFacturaRecibida,
  FacturaRecibidaEstado as NetagroFacturaEstado,
} from '@/types/facturasRecibidas';
import { nullableNumber } from '@/types/facturasRecibidas';

const PDF_PATH_PREFIX = 'archivo_pdf_id:';
const NETAGRO_READ_FUNCTION = 'facturas-recibidas-netagro-read';
const NETAGRO_READ_SOURCE = 'netagro-read';
const NETAGRO_REMOTE_ID_PREFIX = 'netagro:';

type NetagroReadListResponse<T> = {
  items?: T[];
  limit?: number;
  offset?: number;
  total?: number;
};

type NetagroReadFacturaRow = Record<string, unknown>;
type NetagroReadCtbRow = Record<string, unknown>;

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

const isFunctionUnavailable = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown; context?: { status?: unknown } }).status ?? (error as { context?: { status?: unknown } }).context?.status;
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  return status === 404 || message.includes('function not found') || message.includes('not found');
};

const netagroRemoteId = (id: unknown) => `${NETAGRO_REMOTE_ID_PREFIX}${String(id ?? '').trim()}`;

const netagroIdFromUiId = (id?: string | null) => {
  if (!id?.startsWith(NETAGRO_REMOTE_ID_PREFIX)) return null;
  const parsed = Number(id.slice(NETAGRO_REMOTE_ID_PREFIX.length));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

export const isNetagroReadOnlyFactura = (factura: Partial<UiFacturaRecibida> | null | undefined) =>
  factura?.gsbase_payload?.source === NETAGRO_READ_SOURCE || Boolean(netagroIdFromUiId(factura?.id ?? null));

const netagroRead = async <T>(consulta: string): Promise<T> => {
  const { data, error } = await supabase.functions.invoke(NETAGRO_READ_FUNCTION, {
    body: { consulta },
  });
  if (error) throw error;
  const message = getFunctionErrorMessage(data);
  if (message) throw new Error(message);
  return data as T;
};

const mapEstadoToUi = (estado: NetagroFacturaEstado): UiFacturaEstado => {
  if (estado === 'enviada_netagro') return 'enviada_gsbase';
  if (estado === 'error_netagro') return 'error_gsbase';
  if (estado === 'descartada') return 'descartada';
  if (estado === 'validada' || estado === 'preparada_netagro') return 'validada';
  return 'pendiente_revision';
};

const mapEstadoToNetagro = (estado?: UiFacturaEstado): NetagroFacturaEstado | undefined => {
  if (!estado) return undefined;
  if (estado === 'enviada_gsbase') return 'enviada_netagro';
  if (estado === 'error_gsbase') return 'error_netagro';
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

const validationMessages = (factura: NetagroFacturaRecibida) =>
  [
    ...(factura.validation_errors ?? []).map((item) => item.message),
    factura.netagro_error,
  ].filter((value): value is string => Boolean(cleanText(value)));

const mapLineToUi = (linea: NetagroFacturaRecibida['ctb'][number], index: number): FacturaRecibidaLinea => ({
  id: linea.id,
  factura_recibida_id: linea.factura_id,
  posicion: linea.posicion ?? index + 1,
  descripcion: linea.FRC_Cuenta ?? '',
  iva: 0,
  importe: linea.FRC_Importe ?? 0,
  created_at: linea.created_at,
  updated_at: linea.updated_at,
});

const mapFacturaToUi = (factura: NetagroFacturaRecibida): UiFacturaRecibida => ({
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
  numero_factura: factura.FRR_numerofactura,
  referencia: cleanText(factura.FRR_numero),
  fr_alm: cleanText(factura.FRR_Idempresa),
  fr_sufa: factura.FRR_tipofactura,
  fecha_factura: factura.FRR_fechafactura,
  base_imponible: factura.FRR_base1,
  iva_importe:
    (factura.FRR_cuota1 ?? 0) +
    (factura.FRR_cuota2 ?? 0) +
    (factura.FRR_cuota3 ?? 0) +
    (factura.FRR_cuota4 ?? 0) +
    (factura.FRR_cuota5 ?? 0),
  retencion_porcentaje: factura.FRR_ret,
  retencion_importe: factura.FRR_cuotaret,
  descuento_general: 0,
  descuento_pronto_pago: 0,
  total: factura.FRR_totalfac,
  pendiente_pago: factura.FRR_totalfac,
  albaranes: null,
  email_remitente: null,
  asunto_email: factura.FRR_Concepto ?? factura.FRR_Observaciones,
  pdf_path: pdfPathFromId(factura.archivo_pdf_id),
  pdf_nombre: factura.source_pdf_name,
  pdf_mime_type: 'application/pdf',
  pdf_size: null,
  validation_errors: validationMessages(factura),
  gsbase_last_attempt_at: null,
  gsbase_sent_at: factura.netagro_sent_at,
  gsbase_response: factura.netagro_response as Record<string, unknown> | null,
  gsbase_error: factura.netagro_error,
  gsbase_payload: null,
  gsbase_factura_id: factura.FRR_id ? String(factura.FRR_id) : null,
  created_at: factura.created_at,
  updated_at: factura.updated_at,
  facturas_recibidas_lineas: factura.ctb.map(mapLineToUi),
});

const mapRemoteCtbToUi = (
  linea: NetagroReadCtbRow,
  index: number,
  facturaId: number | string,
): FacturaRecibidaLinea => {
  const id = readText(linea, ['id', 'frc_id', 'FRC_id'], `${facturaId}-${index + 1}`);
  const fechaLog = readText(linea, ['fecha_log', 'FRC_FechaLog'], null);
  const horaLog = readText(linea, ['hora_log', 'FRC_HoraLog'], null);
  const timestamp = fechaLog ? `${fechaLog}${horaLog ? `T${horaLog}` : ''}` : new Date().toISOString();

  return {
    id: `${NETAGRO_REMOTE_ID_PREFIX}ctb:${id}`,
    factura_recibida_id: netagroRemoteId(facturaId),
    posicion: index + 1,
    descripcion: readText(linea, ['cuenta', 'FRC_Cuenta'], '') ?? '',
    iva: 0,
    importe: readNumber(linea, ['importe', 'FRC_Importe'], 0) ?? 0,
    created_at: timestamp,
    updated_at: timestamp,
  };
};

const mapRemoteFacturaToUi = (
  factura: NetagroReadFacturaRow,
  lineas: NetagroReadCtbRow[] = [],
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
    id: netagroRemoteId(frrId),
    documento_codigo: cleanText(frrId),
    estado: 'enviada_gsbase',
    proveedor_nombre: readText(factura, ['acreedor_nombre', 'proveedor_nombre', 'ACR_Nombre'], null),
    proveedor_nif: readText(factura, ['acreedor_nif', 'proveedor_nif', 'ACR_Nif'], null),
    proveedor_codigo: cleanText(readNumber(factura, ['FRR_idproveedor', 'proveedor_id', 'acreedor_codigo'], null)),
    numero_factura: readText(factura, ['FRR_numerofactura', 'numero_factura'], null),
    referencia: cleanText(readNumber(factura, ['FRR_numero', 'numero'], null)),
    fr_alm: cleanText(readNumber(factura, ['FRR_Idempresa', 'empresa_id'], null)),
    fr_sufa: readText(factura, ['FRR_tipofactura', 'tipo_factura'], null),
    fecha_factura: fechaFactura,
    base_imponible: readNumber(factura, ['FRR_base1', 'base1'], null),
    iva_importe: cuotaIva,
    retencion_porcentaje: readNumber(factura, ['FRR_ret', 'retencion_porcentaje'], null),
    retencion_importe: readNumber(factura, ['FRR_cuotaret', 'retencion_importe'], null),
    descuento_general: 0,
    descuento_pronto_pago: 0,
    total: readNumber(factura, ['FRR_totalfac', 'total_factura'], null),
    pendiente_pago: 0,
    albaranes: null,
    email_remitente: readText(factura, ['acreedor_email', 'email'], null),
    asunto_email: readText(factura, ['FRR_Concepto', 'concepto', 'FRR_Observaciones'], null),
    pdf_path: null,
    pdf_nombre: null,
    pdf_mime_type: null,
    pdf_size: null,
    validation_errors: null,
    gsbase_last_attempt_at: null,
    gsbase_sent_at: fechaContable,
    gsbase_response: factura,
    gsbase_error: null,
    gsbase_payload: { source: NETAGRO_READ_SOURCE },
    gsbase_factura_id: frrId ? String(frrId) : null,
    created_at: timestamp,
    updated_at: timestamp,
    facturas_recibidas_lineas: lineas.map((linea, index) => mapRemoteCtbToUi(linea, index, frrId)),
  };
};

const buildFacturaPayload = (
  factura: Partial<UiFacturaRecibida>,
  current?: NetagroFacturaRecibida | null,
) => ({
  FRR_idproveedor: numberValue(factura.proveedor_codigo, current?.FRR_idproveedor ?? null),
  FRR_idcuenta: current?.FRR_idcuenta ?? null,
  FRR_numerofactura: cleanText(factura.numero_factura) ?? current?.FRR_numerofactura ?? null,
  FRR_fechafactura: cleanText(factura.fecha_factura) ?? current?.FRR_fechafactura ?? null,
  FRR_fechactb: cleanText(factura.fecha_factura) ?? current?.FRR_fechactb ?? current?.FRR_fechafactura ?? null,
  FRR_Idempresa: numberValue(factura.fr_alm, current?.FRR_Idempresa ?? 1) ?? 1,
  FRR_tipofactura: cleanText(factura.fr_sufa) ?? current?.FRR_tipofactura ?? '1',
  FRR_base1: numberValue(factura.base_imponible, current?.FRR_base1 ?? 0) ?? 0,
  FRR_iva1: current?.FRR_iva1 ?? 0,
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
  const remoteId = netagroIdFromUiId(id);
  if (remoteId) {
    const [factura, ctb] = await Promise.all([
      netagroRead<NetagroReadFacturaRow>(`facturasrecibidas/${remoteId}`),
      netagroRead<{ items?: NetagroReadCtbRow[] }>(`facturasrecibidas/${remoteId}/ctb`),
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
  if (isNetagroReadOnlyFactura(factura)) {
    throw new Error('Las facturas reales de Netagro son de solo lectura desde esta pantalla.');
  }

  if (factura.id) {
    const current = await facturasRecibidas.getById(factura.id);
    const updated = await facturasRecibidas.update({
      factura_id: factura.id,
      estado: mapEstadoToNetagro(factura.estado),
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
    estado: mapEstadoToNetagro(factura.estado) ?? 'pendiente_revision',
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

export const sendFacturaRecibidaToGsBase = async (id: string): Promise<UiFacturaRecibida> => {
  if (netagroIdFromUiId(id)) {
    throw new Error('Esta factura ya existe en Netagro y se muestra en modo solo lectura.');
  }

  const sent = await facturasRecibidas.sendToNetagro(id);
  return mapFacturaToUi(sent);
};

export type FacturaGsBasePayloadPreview = {
  ok: boolean;
  factura_id: string;
  validation_errors: string[];
  payload: Record<string, unknown>;
  body_json: string;
};

export const fetchFacturaRecibidaGsBasePayloadPreview = async (
  id: string,
): Promise<FacturaGsBasePayloadPreview> => {
  const remoteId = netagroIdFromUiId(id);
  if (remoteId) {
    const factura = await fetchFacturaRecibidaById(id);
    return {
      ok: Boolean(factura),
      factura_id: id,
      validation_errors: [],
      payload: factura?.gsbase_response ?? {},
      body_json: JSON.stringify(factura?.gsbase_response ?? {}, null, 2),
    };
  }

  const factura = await facturasRecibidas.getById(id);
  return {
    ok: Boolean(factura),
    factura_id: id,
    validation_errors: factura ? validationMessages(factura) : ['Factura no encontrada.'],
    payload: factura ? (factura.netagro_response as Record<string, unknown>) ?? {} : {},
    body_json: JSON.stringify(factura ?? {}, null, 2),
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
  gsbase_response?: {
    resultado?: string;
    datos?: Record<string, unknown> | string;
    [key: string]: unknown;
  };
};

export const localizarProveedorGsBase = async (payload: {
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
      const page = await netagroRead<NetagroReadListResponse<Record<string, unknown>>>(consulta);
      const data = page.items?.[0];
      if (!data) return { ok: true, gsbase_response: { datos: 'Proveedor no localizado.' } };

      return {
        ok: true,
        gsbase_response: {
          resultado: 'ok',
          datos: {
            codigo: readNumber(data, ['codigo', 'id', 'ACR_Codigo'], null),
            nombre: readText(data, ['nombre', 'ACR_Nombre'], null),
            cif: readText(data, ['nif', 'ACR_Nif'], null),
          },
        },
      };
    }
  } catch (error) {
    if (!isFunctionUnavailable(error)) {
      return { ok: false, gsbase_response: { datos: error instanceof Error ? error.message : 'No se pudo buscar proveedor.' } };
    }
  }

  let query = supabase.from('acreedores_cache').select('*').limit(1);
  if (payload.nif?.trim()) {
    query = query.ilike('ACR_Nif', `%${payload.nif.trim()}%`);
  } else if (payload.nombre?.trim()) {
    query = query.ilike('ACR_Nombre', `%${payload.nombre.trim()}%`);
  } else {
    return { ok: false, gsbase_response: { datos: 'Indica NIF o nombre para buscar proveedor.' } };
  }

  const { data, error } = await query.maybeSingle();
  if (error) return { ok: false, gsbase_response: { datos: error.message } };
  if (!data) return { ok: true, gsbase_response: { datos: 'Proveedor no localizado.' } };

  return {
    ok: true,
    gsbase_response: {
      resultado: 'ok',
      datos: {
        codigo: data.ACR_Codigo,
        nombre: data.ACR_Nombre,
        cif: data.ACR_Nif,
      },
    },
  };
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
  };
};

export const getFacturaPdfSignedUrl = async (pdfPath?: string | null) => {
  const pdfId = pdfIdFromPath(pdfPath);
  if (!pdfId) return null;
  const pdf = await facturasRecibidas.getPdfBase64(pdfId);
  return pdf.base64 ? `data:application/pdf;base64,${pdf.base64}` : null;
};

export type FacturaIaLineaExtraida = {
  descripcion?: string | null;
  iva?: number | string | null;
  importe?: number | string | null;
};

export type FacturaIaExtraccion = {
  proveedor_nombre?: string | null;
  proveedor_nif?: string | null;
  proveedor_codigo?: string | null;
  numero_factura?: string | null;
  referencia?: string | null;
  fecha_factura?: string | null;
  base_imponible?: number | string | null;
  iva_importe?: number | string | null;
  retencion_porcentaje?: number | string | null;
  retencion_importe?: number | string | null;
  descuento_general?: number | string | null;
  descuento_pronto_pago?: number | string | null;
  total?: number | string | null;
  pendiente_pago?: number | string | null;
  albaranes?: string | null;
  email_remitente?: string | null;
  asunto_email?: string | null;
  fr_alm?: string | null;
  fr_sufa?: string | null;
  lineas?: FacturaIaLineaExtraida[];
  confidence?: number | string | null;
  warnings?: string[];
  raw_text_summary?: string | null;
};

export type FacturaIaExtraccionResponse = {
  ok: boolean;
  extraction?: FacturaIaExtraccion;
  error?: string;
  metadata?: Record<string, unknown>;
  raw_response?: unknown;
};

export const extractFacturaWithN8n = async (): Promise<FacturaIaExtraccionResponse> => ({
  ok: true,
  extraction: {},
});
