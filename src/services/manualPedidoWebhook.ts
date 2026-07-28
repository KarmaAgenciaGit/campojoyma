import { supabase } from '@/integrations/supabase/client';
import { sanitizeUserFacingErrorMessage } from '@/lib/userFacingErrors';
import { agroirisAuth } from '@/services/agroirisAuth';
import { agroirisPaises } from '@/services/agroirisPaises';
import type { AgroIrisClient } from '@/services/agroirisClients';
import type { SujetoDomicilio } from '@/services/agroirisDomicilios';
import type { ManualPedidoPayloadItem } from '@/types/manualPedidoWebhook';

const DEFAULT_MAX_PDF_MB = 15;
const PDF_DATA_URL_PREFIX = 'data:application/pdf;base64,';
const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

type AgroIrisClienteContactoInforme = {
  sujetocontactoid?: number | string | null;
  sujetoid?: number | string | null;
  clienteid?: number | string | null;
  cliente?: string | null;
  persona_contacto?: string | null;
  observacion?: string | null;
  sujetocontactodetid?: number | string | null;
  tipo_dato?: string | null;
  dato?: string | null;
  perfilcliente?: string | null;
  subgrupoanalisis?: string | null;
};

const normalizeText = (value: string | null | undefined) =>
  (value ?? '').replace(/\s+/g, ' ').trim();

const toNullableNumber = (value: unknown): number | null => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

let clienteContactoCache: AgroIrisClienteContactoInforme[] | null = null;
let clienteContactoPromise: Promise<AgroIrisClienteContactoInforme[]> | null = null;

export class ManualPedidoWebhookError extends Error {
  status?: number;
  details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ManualPedidoWebhookError';
    this.status = status;
    this.details = details;
  }
}

const getClienteContactosInforme = async () => {
  if (clienteContactoCache) {
    return clienteContactoCache;
  }

  if (clienteContactoPromise) {
    return clienteContactoPromise;
  }

  clienteContactoPromise = agroirisAuth
    .authenticatedFetch<AgroIrisClienteContactoInforme[]>('/cliente/clientecontactoinforme')
    .then((data) => (Array.isArray(data) ? data : []))
    .catch((error) => {
      console.error('Error cargando clientecontactoinforme:', error);
      return [];
    })
    .then((rows) => {
      clienteContactoCache = rows;
      return rows;
    })
    .finally(() => {
      clienteContactoPromise = null;
    });

  return clienteContactoPromise;
};

const getBestClienteContacto = async (clienteId: number) => {
  const allContactos = await getClienteContactosInforme();
  const rows = allContactos.filter((row) => toNullableNumber(row.clienteid) === clienteId);
  if (rows.length === 0) return null;

  const scoreContacto = (row: AgroIrisClienteContactoInforme) => {
    let score = 0;
    if (normalizeText(row.tipo_dato).toUpperCase() === 'E') score += 5;
    if (normalizeText(row.dato).includes('@')) score += 4;
    if (normalizeText(row.persona_contacto).toUpperCase().includes('PEDIDOS')) score += 3;
    if (normalizeText(row.observacion).toUpperCase().includes('PEDID')) score += 2;
    if (toNullableNumber(row.sujetocontactodetid) !== null) score += 1;
    return score;
  };

  return rows.sort((a, b) => scoreContacto(b) - scoreContacto(a))[0];
};

const resolveProjectId = () => {
  const fromEnv = normalizeText(import.meta.env.VITE_SUPABASE_PROJECT_ID);
  if (fromEnv) return fromEnv;

  const supabaseUrl = normalizeText(import.meta.env.VITE_SUPABASE_URL);
  if (!supabaseUrl) return 'unknown-project';
  try {
    const hostname = new URL(supabaseUrl).hostname;
    const subdomain = hostname.split('.')[0];
    return normalizeText(subdomain) || 'unknown-project';
  } catch {
    return 'unknown-project';
  }
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer el PDF.'));
    reader.readAsDataURL(file);
  });

export const getManualPedidoMaxPdfBytes = () => {
  const envValue = Number(import.meta.env.VITE_MANUAL_PEDIDO_MAX_PDF_MB);
  const maxMb = Number.isFinite(envValue) && envValue > 0 ? envValue : DEFAULT_MAX_PDF_MB;
  return Math.floor(maxMb * 1024 * 1024);
};

export const cleanBase64 = (rawBase64: string) =>
  rawBase64
    .replace(PDF_DATA_URL_PREFIX, '')
    .replace(/^data:.*;base64,/, '')
    .replace(/\s+/g, '');

export const isValidBase64 = (value: string) => {
  if (!value) return false;
  if (!BASE64_REGEX.test(value)) return false;
  return value.length % 4 === 0;
};

export const getCleanPdfBase64FromFile = async (file: File) => {
  const dataUrl = await fileToDataUrl(file);
  const cleaned = cleanBase64(dataUrl);
  if (!isValidBase64(cleaned)) {
    throw new ManualPedidoWebhookError('El PDF no tiene un base64 válido.');
  }
  return cleaned;
};

export const validatePdfFile = (file: File) => {
  if (file.type !== 'application/pdf') {
    throw new ManualPedidoWebhookError('Solo se permiten archivos PDF.');
  }

  const maxBytes = getManualPedidoMaxPdfBytes();
  if (file.size > maxBytes) {
    const maxMb = Math.floor(maxBytes / (1024 * 1024));
    throw new ManualPedidoWebhookError(`El PDF supera el tamaño máximo permitido (${maxMb}MB).`);
  }
};

const toManualClienteObtenido = async ({
  client,
  domicilio,
}: {
  client: AgroIrisClient;
  domicilio: SujetoDomicilio;
}) => {
  const contacto = await getBestClienteContacto(client.clienteid);
  const paisNombre = await agroirisPaises.getPaisNombreById(domicilio.paisid);
  const domicilioNombre = normalizeText(domicilio.nombre_identificador_domicilio_sujeto);

  return {
    sujetocontactoid: toNullableNumber(contacto?.sujetocontactoid),
    sujetoid: toNullableNumber(contacto?.sujetoid) ?? client.sujetoid,
    clienteid: toNullableNumber(contacto?.clienteid) ?? client.clienteid,
    cliente:
      normalizeText(contacto?.cliente) ||
      normalizeText(client.nombre_sujeto || client.nombre_comercial) ||
      `Cliente ${client.clienteid}`,
    persona_contacto: normalizeText(contacto?.persona_contacto) || 'PEDIDOS',
    observacion: normalizeText(contacto?.observacion),
    sujetocontactodetid: toNullableNumber(contacto?.sujetocontactodetid),
    tipo_dato: normalizeText(contacto?.tipo_dato) || 'E',
    dato: normalizeText(contacto?.dato),
    perfilcliente: normalizeText(contacto?.perfilcliente),
    subgrupoanalisis: normalizeText(contacto?.subgrupoanalisis),
    clienteX: {
      clienteid: client.clienteid,
      perfilclienteid: client.perfilclienteid ?? null,
      empresaid: String(client.empresaid ?? ''),
      comercialid: String(client.comercialid ?? ''),
    },
    domicilio: {
      PAIS: paisNombre ?? '',
      DOMICILIO: normalizeText(domicilio.domicilio_sujeto),
      POBLACION: normalizeText(domicilio.poblacion_domicilio_sujeto),
      ID_DOMSUJ: domicilioNombre,
      sujetodomicilioid: domicilio.sujetodomicilioid,
      codigopostal: normalizeText(domicilio.cp_domicilio_sujeto),
      nombre_identificador_domicilio_sujeto: domicilioNombre,
    },
  };
};

const buildSubject = (clienteNombre: string, domicilioNombre: string) =>
  `PEDIDO MANUAL - ${normalizeText(clienteNombre)} - ${normalizeText(domicilioNombre)}`;

export const buildManualPedidoPayload = async ({
  fileName,
  pdfB64,
  client,
  domicilio,
}: {
  fileName: string;
  pdfB64: string;
  client: AgroIrisClient;
  domicilio: SujetoDomicilio;
}): Promise<ManualPedidoPayloadItem[]> => {
  if (!isValidBase64(pdfB64)) {
    throw new ManualPedidoWebhookError('El base64 del PDF no es válido.');
  }

  const clienteObtenido = await toManualClienteObtenido({ client, domicilio });
  const subject = buildSubject(
    clienteObtenido.cliente,
    clienteObtenido.domicilio.nombre_identificador_domicilio_sujeto,
  );

  return [
    {
      subject,
      clienteObtenido,
      adjuntosIgnorados: [],
      pdf: {
        b64: pdfB64,
        fileName: normalizeText(fileName) || 'pedido.pdf',
        texto_extraido: null,
      },
      pdfExiste: false,
      pdfHash: null,
      pdfIdSupabase: null,
      skip: false,
      skip_reason: null,
      ipOrizon: '46.24.40.100',
      idSupabase: resolveProjectId(),
      data: pdfB64,
      tipoEntrada: 'PEDIDO',
    },
  ];
};

const resolveInvokeError = async (error: unknown) => {
  const fallbackMessage = error instanceof Error ? error.message : 'No se pudo enviar el pedido.';
  const response = (error as { context?: unknown } | null)?.context;

  if (!(response instanceof Response)) {
    return {
      status: undefined,
      message: sanitizeUserFacingErrorMessage(fallbackMessage),
      details: undefined,
    };
  }

  const status = response.status;
  let message = fallbackMessage;
  let details: unknown;

  try {
    const json = await response.clone().json();
    details = json;
    if (typeof json?.error === 'string' && json.error.trim()) {
      message = json.error.trim();
    } else if (typeof json?.message === 'string' && json.message.trim()) {
      message = json.message.trim();
    }
  } catch {
    try {
      const text = (await response.clone().text()).trim();
      if (text) {
        details = text;
        message = text;
      }
    } catch {
      // Se mantiene fallback
    }
  }

  return {
    status,
    message: sanitizeUserFacingErrorMessage(message),
    details,
  };
};

export const sendManualPedidoToWebhook = async ({
  file,
  client,
  domicilio,
}: {
  file: File;
  client: AgroIrisClient;
  domicilio: SujetoDomicilio;
}) => {
  validatePdfFile(file);
  const pdfB64 = await getCleanPdfBase64FromFile(file);
  const payload = await buildManualPedidoPayload({
    fileName: file.name,
    pdfB64,
    client,
    domicilio,
  });

  const { data, error } = await supabase.functions.invoke('manual-pedido-webhook-proxy', {
    body: payload,
  });

  if (error) {
    const parsed = await resolveInvokeError(error);
    throw new ManualPedidoWebhookError(parsed.message, parsed.status, parsed.details);
  }

  return data;
};
