import { legacySupabase as supabase } from '@/integrations/supabase/legacyClient';
import { agroirisAuth } from '@/services/agroirisAuth';
import type { Pedido, PedidoLinea, PedidoLineaCentro, TipoPedido } from '@/types/pedidos';
import { resolveOrizonId } from '@/utils/orizon';
import { normalizeApiNumber } from '@/utils/number';

const DEFAULT_DATE = '1900-01-01';
const DEFAULT_STRING = '';
const DEFAULT_IDIOMA_NOMBRE = '';
const DEFAULT_TIPO_DIRECCION = '';
const DEFAULT_DIRECCION = '';

const assignIfDefined = (
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  { allowEmptyString = false }: { allowEmptyString?: boolean } = {},
) => {
  if (value === null || value === undefined) return;
  if (!allowEmptyString && typeof value === 'string' && value.trim() === '') return;
  target[key] = value;
};

const normalizeEanValue = (value: unknown) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return !trimmed || trimmed === '0' ? '' : trimmed;
};

const toOrizonInteger = (value: number | null | undefined) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.ceil(value);
};

const toNullableFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export interface AgroirisPedidoClienteDetalle {
  pedidoclienteid: number | null;
  codigo_pedido: number | null;
  [key: string]: unknown;
}

const pedidoClienteDetalleCache = new Map<number, AgroirisPedidoClienteDetalle | null>();
const pedidoClienteDetalleInFlight = new Map<number, Promise<AgroirisPedidoClienteDetalle | null>>();

const normalizePedidoClienteDetalle = (value: unknown): AgroirisPedidoClienteDetalle | null => {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Record<string, unknown>;
  const pedidoclienteid = toNullableFiniteNumber(
    raw.pedidoclienteid ?? raw.pedidoClienteId ?? raw.id,
  );
  const codigo_pedido = toNullableFiniteNumber(raw.codigo_pedido ?? raw.codigoPedido);

  if (pedidoclienteid === null && codigo_pedido === null) {
    return null;
  }

  return {
    ...raw,
    pedidoclienteid,
    codigo_pedido,
  };
};

const createBasePedidoPayload = () => ({
  serieid: 0,
  codigo_pedido: 0,
  tipo_pedido: DEFAULT_STRING,
  fecha_pedido: DEFAULT_DATE,
  fecha_carga: DEFAULT_DATE,
  fecha_cancelacion: DEFAULT_DATE,
  referencia_cliente: DEFAULT_STRING,
  referencia2_cliente: DEFAULT_STRING,
  observaciones_cabecera: DEFAULT_STRING,
  clienteid: 0,
  clienteid_envio: 0,
  divisa_cliente: 0,
  observaciones_entrega: DEFAULT_STRING,
  revision_son: true,
  comercialid: 0,
  comercial2id: 0,
  sujetodomicilioid_destino: 0,
  sujetodomicilioid_envio: 0,
  fecha_llegada: DEFAULT_DATE,
  acreedorid_porte: 0,
  tarifaporteid: 0,
  matricula_tractora: DEFAULT_STRING,
  matricula_remolque: DEFAULT_STRING,
  nombre_transportista: DEFAULT_STRING,
  telefono_transportista: DEFAULT_STRING,
  condicionentregaid_porte: 0,
  muelle_porte: DEFAULT_STRING,
  acreedorid_porte2: 0,
  tarifaporteid2: 0,
  matricula_tractora2: DEFAULT_STRING,
  matricula_remolque2: DEFAULT_STRING,
  nombre_transportista2: DEFAULT_STRING,
  telefono_transportista2: DEFAULT_STRING,
  condicionentregaid_porte2: 0,
  ingreso_mediacion: true,
  pedidoprograma: false,
  importe_porte1: 0,
  importe_porte2: 0,
  listGastos: [] as Record<string, unknown>[],
  listLineaPed: [] as Record<string, unknown>[],
});

const createBaseLineaPayload = () => ({
  confeccionpaletid: 0,
  abreviatura_confeccionpalet: DEFAULT_STRING,
  abreviatura_palet: DEFAULT_STRING,
  catalogoconfecid: 0,
  nombre_catalogoconfeccion: DEFAULT_STRING,
  confeccionsalidaid: 0,
  grupoconfeccionid: 0,
  abreviatura_grupoconfeccion: DEFAULT_STRING,
  peddetorigenid: 0,
  generoid: 0,
  descripcion_genero: DEFAULT_STRING,
  tipocultivoid: 0,
  origenid: 0,
  calibreid: 0,
  nombre_calibre: DEFAULT_STRING,
  bultos: 0,
  kilosxbulto: 0,
  piezasxbulto: 0,
  total_piezas: 0,
  catconfecpiezaid: 0,
  descripcion_salida: DEFAULT_STRING,
  precio_compra: 0,
  precio_venta: 0,
  observacion: DEFAULT_STRING,
  tipo_precio_compra: DEFAULT_STRING,
  tipo_precio_venta: DEFAULT_STRING,
  nlote_cliente: DEFAULT_STRING,
  ean_bultos: DEFAULT_STRING,
  ean_piezas: DEFAULT_STRING,
  referencia_cliente: DEFAULT_STRING,
  observaciones_confeccion: DEFAULT_STRING,
  observaciones_etiquetas: DEFAULT_STRING,
  programacalidadid: 0,
  bultosxpalet: 0,
  marcaid_envase: 0,
  numero_palet: 0,
  mixto: DEFAULT_STRING,
  kilos_cliente: 0,
  catconfeckilosbultoid: 0,
  materialmarcaid: 0,
  contenido_caja: DEFAULT_STRING,
  contenido_piezas: DEFAULT_STRING,
  medidas_etq: DEFAULT_STRING,
  observacion1: DEFAULT_STRING,
  observacion2: DEFAULT_STRING,
  campo_ref1: DEFAULT_STRING,
  campo_ref2: DEFAULT_STRING,
  campo_ref3: DEFAULT_STRING,
  campo_ref4: DEFAULT_STRING,
  campo_ref5: DEFAULT_STRING,
  campo_ref6: DEFAULT_STRING,
  lineaproduccionid: 0,
  calidad: DEFAULT_STRING,
  dia_max_producto: DEFAULT_STRING,
  refproductoid: 0,
  estado: DEFAULT_STRING,
  categoria: DEFAULT_STRING,
  ordencalibradoraid: 0,
  img_etiquetacaja_pedidodet: DEFAULT_STRING,
  nombre_idioma: DEFAULT_IDIOMA_NOMBRE,
  tipo_direccion: DEFAULT_TIPO_DIRECCION,
  direccion: DEFAULT_DIRECCION,
  listPedidoCentro: [] as Record<string, unknown>[],
  pedidoclienteid: 0,
});

const createBaseCentroPayload = () => ({
  asignacion: DEFAULT_STRING,
  numero_palets: 0,
  subprov: 0,
  sujetodomicilioid: 0,
  sujetodomicilioid_origen: 0,
  serieid: 0,
  codigo: 0,
  fecha: DEFAULT_DATE,
  serie_codigo: DEFAULT_STRING,
  programapedido: false,
  estado_orden: DEFAULT_STRING,
  pedidocentroid: 0,
  pedidodetid: 0,
});

const getAgroirisPedidoEndpoint = (isUpdate: boolean) => {
  const baseUrl = import.meta.env.VITE_AGROIRIS_API_URL;
  if (!baseUrl) {
    throw new Error('VITE_AGROIRIS_API_URL no esta configurado');
  }
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return isUpdate
    ? `${normalizedBase}/pedidocliente/completo/externo`
    : `${normalizedBase}/pedidocliente/completo/externo`;
};

const sendPedidoToAgroiris = async (payload: Record<string, unknown>, isUpdate: boolean) => {
  const token = await agroirisAuth.getToken();
  if (!token) {
    throw new Error('No se pudo obtener el token de AgroIris');
  }

  const endpoint = getAgroirisPedidoEndpoint(isUpdate);

  try {
    console.log('[Orizon] Enviando pedido', {
      method: isUpdate ? 'PUT' : 'POST',
      endpoint,
      pedidoclienteid: (payload as Record<string, unknown>)?.pedidoclienteid ?? null,
    });
    console.log('[Orizon] Payload', JSON.stringify(payload, null, 2));
  } catch {
    console.log('[Orizon] Payload', payload);
  }

  const response = await fetch(endpoint, {
    method: isUpdate ? 'PUT' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let data: any = null;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = responseText;
    }
  }

  if (!response.ok) {
    const errorMessage =
      typeof data === 'object' && data?.title
        ? data.title
        : `Error ${response.status} al enviar el pedido`;
    const error: any = new Error(errorMessage);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
};

type LineaWithCentros = PedidoLinea & { centros?: PedidoLineaCentro[] };

const isMissingRequiredId = (value: unknown) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number') return !Number.isFinite(value) || value <= 0;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return true;
    const parsed = Number(trimmed);
    return !Number.isFinite(parsed) || parsed <= 0;
  }
  return false;
};

const formatLineaValidationLabel = (linea: PedidoLinea, index: number) => {
  const descripcion =
    typeof linea.descripcion_salida === 'string' ? linea.descripcion_salida.trim() : '';
  const base = `Línea ${index + 1}`;
  return descripcion ? `${base} (${descripcion})` : `${base} (pedidodetid ${linea.pedidodetid})`;
};

const validatePedidoTemplateLookupFields = ({
  pedido,
  lineas,
}: {
  pedido: Pedido;
  lineas: LineaWithCentros[];
}) => {
  const missingHeaderFields: string[] = [];

  if (isMissingRequiredId(pedido.clienteid)) missingHeaderFields.push('clienteid');
  if (isMissingRequiredId(pedido.sujetodomicilioid_envio)) {
    missingHeaderFields.push('sujetodomicilioid_envio');
  }

  const missingLineFields = lineas
    .map((linea, index) => {
      const missingFields: string[] = [];

      if (isMissingRequiredId(linea.catalogoconfecid)) missingFields.push('catalogoconfecid');
      if (isMissingRequiredId(linea.calibreid)) missingFields.push('calibreid');

      if (missingFields.length === 0) return null;

      return `${formatLineaValidationLabel(linea, index)}: ${missingFields.join(', ')}`;
    })
    .filter((value): value is string => Boolean(value));

  if (missingHeaderFields.length === 0 && missingLineFields.length === 0) {
    return;
  }

  const detailParts: string[] = [];
  if (missingHeaderFields.length > 0) {
    detailParts.push(`Cabecera: ${missingHeaderFields.join(', ')}`);
  }
  if (missingLineFields.length > 0) {
    detailParts.push(`Líneas: ${missingLineFields.join(' | ')}`);
  }

  throw new Error(
    `No se puede enviar el pedido porque faltan campos obligatorios para la búsqueda de plantilla. ${detailParts.join('. ')}`,
  );
};

export const buildPedidoOrizonPayload = ({
  pedido,
  tipoPedido,
  lineas,
}: {
  pedido: Pedido;
  tipoPedido: TipoPedido;
  lineas: LineaWithCentros[];
  clienteBehaviorRule?: unknown;
}) => {
  const pedidoAny = pedido as Record<string, any>;
  const pedidoOrizonId = resolveOrizonId(pedidoAny.idpedido_orizon, pedidoAny.pedidoclienteid);
  const isUpdate = Boolean(pedidoOrizonId);

  const listLineaPed: Record<string, unknown>[] = [];
  const lineaIdsForPayload: number[] = [];
  const centroIdsForPayload: number[][] = [];

  for (const linea of lineas || []) {
    const normalizedLinea = {
      ...linea,
      bultos: normalizeApiNumber(linea.bultos),
      bultosxpalet: normalizeApiNumber(linea.bultosxpalet),
      numero_palet: normalizeApiNumber(linea.numero_palet),
      piezasxbulto: normalizeApiNumber(linea.piezasxbulto),
      total_piezas: normalizeApiNumber(linea.total_piezas),
      kilosxbulto: normalizeApiNumber((linea as any)?.kilosxbulto),
      kilos_cliente: normalizeApiNumber((linea as any)?.kilos_cliente),
      precio_venta: normalizeApiNumber((linea as any)?.precio_venta),
    };

    const centros = linea.centros ?? [];
    const centroIds: number[] = [];
    let listPedidoCentro = centros.map((centro) => {
      const centroAny = centro as Record<string, any>;
      const normalizedCentro = {
        ...centro,
        numero_palets: normalizeApiNumber(centroAny?.numero_palets),
      };
      const numeroPaletsOrizon = toOrizonInteger(normalizedCentro.numero_palets);
      const centroPayload = createBaseCentroPayload();
      assignIfDefined(centroPayload, 'asignacion', centro.asignacion);
      assignIfDefined(centroPayload, 'numero_palets', numeroPaletsOrizon);
      assignIfDefined(centroPayload, 'subprov', centro.subprov);
      assignIfDefined(centroPayload, 'sujetodomicilioid', centroAny.sujetodomicilioid);
      assignIfDefined(centroPayload, 'sujetodomicilioid_origen', centroAny.sujetodomicilioid_origen);
      assignIfDefined(centroPayload, 'serieid', centroAny.serieid);
      assignIfDefined(centroPayload, 'codigo', centroAny.codigo);
      assignIfDefined(centroPayload, 'fecha', centroAny.fecha);
      assignIfDefined(centroPayload, 'serie_codigo', centroAny.serie_codigo);
      assignIfDefined(centroPayload, 'programapedido', centroAny.programapedido);
      assignIfDefined(centroPayload, 'estado_orden', centroAny.estado_orden);
      assignIfDefined(centroPayload, 'pedidocentroid', centroAny.pedidocentroid_orizon);
      assignIfDefined(centroPayload, 'pedidodetid', linea.idpedidodet_orizon);
      centroIds.push(centro.pedcentroid);
      return centroPayload;
    });
    if (listPedidoCentro.length === 0) {
      listPedidoCentro = [createBaseCentroPayload()];
      centroIds.push(0);
    }

    const lineaPayload = createBaseLineaPayload();
    assignIfDefined(lineaPayload, 'confeccionpaletid', linea.confeccionpaletid);
    assignIfDefined(lineaPayload, 'catalogoconfecid', linea.catalogoconfecid);
    assignIfDefined(lineaPayload, 'confeccionsalidaid', linea.confeccionsalidaid);
    assignIfDefined(lineaPayload, 'grupoconfeccionid', linea.grupoconfeccionid);
    assignIfDefined(lineaPayload, 'generoid', linea.generoid);
    assignIfDefined(lineaPayload, 'tipocultivoid', linea.tipocultivoid);
    assignIfDefined(lineaPayload, 'origenid', linea.origenid);
    assignIfDefined(lineaPayload, 'calibreid', linea.calibreid);
    assignIfDefined(lineaPayload, 'bultos', normalizedLinea.bultos);
    assignIfDefined(lineaPayload, 'kilosxbulto', normalizedLinea.kilosxbulto);
    assignIfDefined(lineaPayload, 'piezasxbulto', normalizedLinea.piezasxbulto);
    assignIfDefined(lineaPayload, 'total_piezas', normalizedLinea.total_piezas);
    assignIfDefined(lineaPayload, 'catconfecpiezaid', linea.catconfecpiezaid);
    assignIfDefined(lineaPayload, 'descripcion_salida', linea.descripcion_salida);
    assignIfDefined(lineaPayload, 'bultosxpalet', normalizedLinea.bultosxpalet);
    assignIfDefined(lineaPayload, 'numero_palet', toOrizonInteger(normalizedLinea.numero_palet));
    assignIfDefined(lineaPayload, 'kilos_cliente', normalizedLinea.kilos_cliente);
    assignIfDefined(lineaPayload, 'catconfeckilosbultoid', linea.catconfeckilosbultoid);
    assignIfDefined(lineaPayload, 'precio_venta', normalizedLinea.precio_venta);
    const lineaNloteClienteRaw = (linea as any)?.nlote_cliente;
    const lineaNloteCliente =
      typeof lineaNloteClienteRaw === 'string' ? lineaNloteClienteRaw.trim() : '';
    if (lineaNloteCliente) {
      lineaPayload.nlote_cliente = lineaNloteCliente;
    }
    const lineaEanPieza =
      normalizeEanValue((linea as any)?.ean_pieza) ||
      normalizeEanValue((linea as any)?.ean_bulto) ||
      normalizeEanValue(linea.ean);
    const lineaEanBulto = normalizeEanValue((linea as any)?.ean_caja);
    lineaPayload.ean_piezas = lineaEanPieza;
    lineaPayload.ean_bultos = lineaEanBulto;
    assignIfDefined(lineaPayload, 'pedidodetid', linea.idpedidodet_orizon);
    assignIfDefined(lineaPayload, 'pedidoclienteid', pedidoOrizonId);

    lineaPayload.nombre_idioma = DEFAULT_IDIOMA_NOMBRE;
    lineaPayload.tipo_direccion = DEFAULT_TIPO_DIRECCION;
    lineaPayload.direccion = DEFAULT_DIRECCION;
    lineaPayload.listPedidoCentro = listPedidoCentro;

    listLineaPed.push(lineaPayload);
    lineaIdsForPayload.push(linea.pedidodetid);
    centroIdsForPayload.push(centroIds);
  }

  if (listLineaPed.length === 0) {
    listLineaPed.push(createBaseLineaPayload());
  }

  const pedidoPayload = createBasePedidoPayload();
  assignIfDefined(pedidoPayload, 'serieid', pedido.serieid);
  assignIfDefined(pedidoPayload, 'tipo_pedido', pedido.tipo_pedido || tipoPedido);
  assignIfDefined(pedidoPayload, 'fecha_pedido', pedido.fecha_pedido);
  assignIfDefined(pedidoPayload, 'fecha_carga', pedido.fecha_carga);
  assignIfDefined(pedidoPayload, 'referencia_cliente', pedido.referencia_cliente);
  assignIfDefined(pedidoPayload, 'clienteid', pedido.clienteid);
  assignIfDefined(pedidoPayload, 'clienteid_envio', pedido.clienteid_envio);
  assignIfDefined(pedidoPayload, 'divisa_cliente', pedido.divisa_cliente);
  assignIfDefined(pedidoPayload, 'comercialid', pedido.comercialid);
  assignIfDefined(pedidoPayload, 'sujetodomicilioid_destino', pedido.sujetodomicilioid_destino);
  assignIfDefined(pedidoPayload, 'sujetodomicilioid_envio', pedido.sujetodomicilioid_envio);
  assignIfDefined(pedidoPayload, 'acreedorid_porte', pedido.acreedorid_porte);
  assignIfDefined(pedidoPayload, 'matricula_tractora', pedidoAny.matricula_tractora);
  assignIfDefined(pedidoPayload, 'matricula_remolque', pedidoAny.matricula_remolque);
  assignIfDefined(pedidoPayload, 'muelle_porte', pedidoAny.muelle_porte);
  assignIfDefined(pedidoPayload, 'nombre_transportista', pedidoAny.nombre_transportista);
  assignIfDefined(pedidoPayload, 'telefono_transportista', pedidoAny.telefono_transportista);
  assignIfDefined(pedidoPayload, 'observaciones_cabecera', pedidoAny.observaciones_cabecera);
  assignIfDefined(pedidoPayload, 'observaciones_entrega', pedidoAny.observaciones_entrega);
  assignIfDefined(pedidoPayload, 'referencia2_cliente', pedidoAny.referencia2_cliente);
  assignIfDefined(pedidoPayload, 'pedidoclienteid', pedidoOrizonId);
  assignIfDefined(pedidoPayload, 'matricula_tractora2', pedidoAny.matricula_tractora2);
  assignIfDefined(pedidoPayload, 'matricula_remolque2', pedidoAny.matricula_remolque2);
  assignIfDefined(pedidoPayload, 'nombre_transportista2', pedidoAny.nombre_transportista2);
  assignIfDefined(pedidoPayload, 'telefono_transportista2', pedidoAny.telefono_transportista2);

  pedidoPayload.listLineaPed = listLineaPed;

  return {
    payload: pedidoPayload,
    lineaIdsForPayload,
    centroIdsForPayload,
    isUpdate,
  };
};

export type SendPedidoResult = {
  response: any;
  numericResponseId: number | null;
  isUpdate: boolean;
  newOrizonId: number | string | null;
  detalleLineaMap: Map<number, number>;
  centroLineaMap: Map<number, number>;
  detalleUpdateError?: any;
  centroUpdateError?: any;
  updateError?: any;
};

export const sendPedidoToOrizon = async ({
  pedido,
  tipoPedido,
  sentBy,
}: {
  pedido: Pedido;
  tipoPedido: TipoPedido;
  sentBy?: string | null;
}): Promise<SendPedidoResult> => {
  const pedidoAny = pedido as Record<string, any>;

  const { data: lineasData, error: lineasError } = await supabase
    .from('pedido_linea')
    .select('*')
    .eq('pedidoid', pedido.id);

  if (lineasError) throw lineasError;

  const lineasWithCentros: LineaWithCentros[] = [];
  for (const linea of lineasData || []) {
    const { data: centrosData, error: centrosError } = await supabase
      .from('pedido_linea_centro')
      .select('*')
      .eq('pedidodetid', linea.pedidodetid);

    if (centrosError) throw centrosError;

    lineasWithCentros.push({
      ...(linea as PedidoLinea),
      centros: (centrosData as PedidoLineaCentro[]) || [],
    });
  }

  validatePedidoTemplateLookupFields({
    pedido,
    lineas: lineasWithCentros,
  });

  const { payload: pedidoPayload, lineaIdsForPayload, centroIdsForPayload, isUpdate } =
    buildPedidoOrizonPayload({
      pedido,
      tipoPedido,
      lineas: lineasWithCentros,
    });

  const apiResponse = await sendPedidoToAgroiris(pedidoPayload, isUpdate);

  const responseId =
    typeof apiResponse === 'object' && apiResponse !== null
      ? apiResponse.pedidoclienteid ?? apiResponse.pedidoClienteId ?? apiResponse.id
      : apiResponse;

  const numericResponseId =
    typeof responseId === 'number'
      ? responseId
      : typeof responseId === 'string' && responseId.trim() !== ''
      ? Number(responseId)
      : null;

  const detalleRetorno = Array.isArray((apiResponse as any)?.listPedidoDetRetorno)
    ? (apiResponse as any).listPedidoDetRetorno
    : [];

  const detalleLineaMap = new Map<number, number>();
  const centroLineaMap = new Map<number, number>();

  let detalleUpdateError: any = null;
  let centroUpdateError: any = null;

  if (detalleRetorno.length && lineaIdsForPayload.length) {
    const detalleUpdatePromises = detalleRetorno
      .map((retorno: any, index: number) => {
        const localPedidodet = lineaIdsForPayload[index];
        const remotePedidodet =
          typeof retorno?.pedidodetid === 'number'
            ? retorno.pedidodetid
            : typeof retorno?.pedidodetid === 'string' && retorno.pedidodetid.trim() !== ''
            ? Number(retorno.pedidodetid)
            : null;

        if (!localPedidodet || remotePedidodet === null || Number.isNaN(remotePedidodet)) {
          return null;
        }

        detalleLineaMap.set(localPedidodet, remotePedidodet);
        return supabase
          .from('pedido_linea')
          .update({ idpedidodet_orizon: remotePedidodet })
          .eq('pedidodetid', localPedidodet);
      })
      .filter(Boolean) as Promise<{ error: any }>[];

    if (detalleUpdatePromises.length) {
      const detalleResults = await Promise.all(detalleUpdatePromises);
      detalleUpdateError = detalleResults.find((result) => result.error)?.error ?? null;
    }

    const centroPromises: PromiseLike<{ error: any } | null>[] = [];

    detalleRetorno.forEach((retorno: any, index: number) => {
      const centrosRetorno = Array.isArray(retorno?.listPedidoCentroRetorno)
        ? retorno.listPedidoCentroRetorno
        : [];
      const localCentros = centroIdsForPayload[index] || [];

      centrosRetorno.forEach((centroRet: any, centroIndex: number) => {
        const localCentroId = localCentros[centroIndex];
        const remoteCentroId =
          typeof centroRet?.pedidocentroid === 'number'
            ? centroRet.pedidocentroid
            : typeof centroRet?.pedidocentroid === 'string' && centroRet.pedidocentroid.trim() !== ''
            ? Number(centroRet.pedidocentroid)
            : null;

        if (!localCentroId || remoteCentroId === null || Number.isNaN(remoteCentroId)) {
          return;
        }

        centroLineaMap.set(localCentroId, remoteCentroId);
        centroPromises.push(
          supabase
            .from('pedido_linea_centro')
            .update({ pedidocentroid_orizon: remoteCentroId })
            .eq('pedcentroid', localCentroId),
        );
      });
    });

    if (centroPromises.length) {
      const centroResults = await Promise.all(centroPromises);
      centroUpdateError = centroResults.find((result) => result?.error)?.error ?? null;
    }
  }

  const updateData: Record<string, unknown> = { enviado: true, needs_sync: false };
  if (numericResponseId !== null && !Number.isNaN(numericResponseId)) {
    updateData.idpedido_orizon = numericResponseId;
    updateData.pedidoclienteid = String(numericResponseId);
  }

  const { error: updateError } = await supabase.from('pedidos').update(updateData).eq('id', pedido.id);
  const existingOrizonId = resolveOrizonId(pedidoAny.idpedido_orizon, pedidoAny.pedidoclienteid);
  const newOrizonId = numericResponseId ?? existingOrizonId;

  if (!isUpdate && sentBy) {
    const { error: sentMetaError } = await supabase
      .from('pedidos')
      .update({ enviado_por: sentBy, enviado_en: new Date().toISOString() })
      .eq('id', pedido.id)
      .is('enviado_por', null);
    if (sentMetaError) {
      console.error('Error guardando enviado_por/enviado_en:', sentMetaError);
    }
  }

  return {
    response: apiResponse,
    numericResponseId,
    isUpdate,
    newOrizonId,
    detalleLineaMap,
    centroLineaMap,
    detalleUpdateError,
    centroUpdateError,
    updateError,
  };
};

export const getPedidoClienteCeoxDetalle = async (
  pedidoclienteid: number,
): Promise<AgroirisPedidoClienteDetalle | null> => {
  if (!pedidoclienteid || pedidoclienteid <= 0) return null;

  if (pedidoClienteDetalleCache.has(pedidoclienteid)) {
    return pedidoClienteDetalleCache.get(pedidoclienteid) ?? null;
  }

  if (pedidoClienteDetalleInFlight.has(pedidoclienteid)) {
    return pedidoClienteDetalleInFlight.get(pedidoclienteid) ?? null;
  }

  const request = agroirisAuth
    .authenticatedFetch<unknown>(`/pedidocliente/${pedidoclienteid}`)
    .then((data) => normalizePedidoClienteDetalle(data))
    .then((data) => {
      pedidoClienteDetalleCache.set(pedidoclienteid, data);
      return data;
    })
    .catch((error) => {
      console.error('Error cargando pedido en Ceox', pedidoclienteid, error);
      return null;
    })
    .finally(() => {
      pedidoClienteDetalleInFlight.delete(pedidoclienteid);
    });

  pedidoClienteDetalleInFlight.set(pedidoclienteid, request);
  return request;
};
