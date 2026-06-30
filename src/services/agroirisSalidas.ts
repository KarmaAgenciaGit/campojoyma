import { agroirisAuth, agroirisCuentaVentaAuth } from './agroirisAuth';

export interface AgroirisSalidaDetalle {
  salidadetalleid: number;
  salidaid: number;
  bultosxpalet: number;
  nro_palets: number;
  referencia_palet: string | null;
  confeccionpaletid: number;
  abreviatura_confeccionpalet: string | null;
  abreviatura_palet: string | null;
  catalogoconfecid: number;
  nombre_catalogoconfeccion: string | null;
  grupoconfeccionid: number;
  abreviatura_grupoconfeccion: string | null;
  generoid: number;
  tipocultivoid: number;
  descripcion_genero: string | null;
  nombre_tipocultivo: string | null;
  abreviatura_tipocultivo: string | null;
  origenid: number;
  nombre_origen: string | null;
  confeccionsalidaid: number;
  descripcion_salida: string | null;
  calibreid: number;
  nombre_calibre: string | null;
  programacalidadid: number;
  descripcion_programacal: string | null;
  bultos: number;
  kilosxbulto: number;
  piezasxbulto: number;
  total_kilosbrutos: number;
  total_kiloscliente: number;
  total_kilosnetos: number;
  total_piezas: number;
  observacion: string | null;
  confeccion_propia: boolean;
  envase_propio: boolean;
  material_propio: boolean;
  precio_ref: number;
  divisaid: number;
  cambiodivisa_ref: number;
  tipo_precio: string | null;
  importexlinea: number;
  importe_est: number;
  importe_rec: number;
  facturaemitidaid: number;
  facemitidaid_est: number;
  facemitidaid_rec: number;
  pedidodetid: number;
  coste_estructura: number;
  gasto_confeccion: number;
  inc_gasto_confeccion: number;
  marcaid: number;
  catconfecpiezaid: number;
  catconfeckilosbultoid: number;
  materialmarcaid: number;
  palets_carga: number;
  refproductoid: number;
  kilos_facturar: number;
  porcentajeivaid: number;
  [key: string]: any;
}

export interface AgroirisSalidaDetalleResumen {
  salidadetalleid: number;
  salidaid?: number | null;
  referencia_cliente?: string | null;
  referencia2_cliente?: string | null;
  descripcion_salida?: string | null;
  descripcion_genero?: string | null;
  nombre_catalogoconfeccion?: string | null;
  [key: string]: any;
}

export interface AgroirisSalidaDetalleCuentaVentaImportable {
  salidadetalleid: number;
  salidaid: number | null;
  referencia_cliente: string | null;
  referencia2_cliente: string | null;
  tipo_precio: string | null;
  bultos: number;
  total_kiloscliente: number;
  total_piezas: number;
  descripcion_salida: string | null;
  descripcion_genero: string | null;
  nombre_calibre: string | null;
  nro_palets: number;
  total_kilosnetos: number;
  total_kilosbrutos: number;
  divisaid: number | null;
  precio: number | null;
}

export interface AgroirisCuentaVentaSalidaLookup {
  salidaid: number;
  cuentaventaid: number | null;
  serieid: number | null;
  codigo_cuentaventa: number | null;
  fechavaloracion: string | null;
  numero_cuentaventa: string | null;
  observaciones_valoracion: string | null;
  clienteid: number | null;
  endpoint: 'albmaterial' | 'albsalida';
}

const toNullableFiniteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toNullablePositiveNumber = (value: unknown): number | null => {
  const parsed = toNullableFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const toNullableTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toFiniteNumberOrZero = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeImportableSalidaDetalle = (
  item: AgroirisSalidaDetalleResumen,
): AgroirisSalidaDetalleCuentaVentaImportable | null => {
  const salidadetalleid = Number(item.salidadetalleid);
  if (!Number.isFinite(salidadetalleid) || salidadetalleid <= 0) return null;

  const divisaid = toNullableFiniteNumber(item.divisaid);
  const precio =
    toNullableFiniteNumber(item.precio) ??
    toNullableFiniteNumber(item.precio_ref) ??
    toNullableFiniteNumber(item.precioref);

  return {
    salidadetalleid,
    salidaid: toNullablePositiveNumber(item.salidaid),
    referencia_cliente:
      typeof item.referencia_cliente === 'string' && item.referencia_cliente.trim().length > 0
        ? item.referencia_cliente.trim()
        : null,
    referencia2_cliente:
      typeof item.referencia2_cliente === 'string' && item.referencia2_cliente.trim().length > 0
        ? item.referencia2_cliente.trim()
        : null,
    tipo_precio:
      typeof item.tipo_precio === 'string' && item.tipo_precio.trim().length > 0 ? item.tipo_precio.trim() : null,
    bultos: toFiniteNumberOrZero(item.bultos),
    total_kiloscliente: toFiniteNumberOrZero(item.total_kiloscliente),
    total_piezas: toFiniteNumberOrZero(item.total_piezas),
    descripcion_salida:
      typeof item.descripcion_salida === 'string' && item.descripcion_salida.trim().length > 0
        ? item.descripcion_salida.trim()
        : null,
    descripcion_genero:
      typeof item.descripcion_genero === 'string' && item.descripcion_genero.trim().length > 0
        ? item.descripcion_genero.trim()
        : null,
    nombre_calibre:
      typeof item.nombre_calibre === 'string' && item.nombre_calibre.trim().length > 0
        ? item.nombre_calibre.trim()
        : null,
    nro_palets: toFiniteNumberOrZero(item.nro_palets),
    total_kilosnetos: toFiniteNumberOrZero(item.total_kilosnetos),
    total_kilosbrutos: toFiniteNumberOrZero(item.total_kilosbrutos),
    divisaid,
    precio,
  };
};

const normalizeCuentaVentaSalidaLookup = (
  salidaid: number,
  endpoint: 'albmaterial' | 'albsalida',
  item: unknown,
): AgroirisCuentaVentaSalidaLookup | null => {
  if (!item || typeof item !== 'object') return null;

  const raw = item as Record<string, unknown>;
  const cuentaventaid = toNullablePositiveNumber(raw.cuentaventaid);
  const serieid = toNullablePositiveNumber(raw.serieid);
  const codigo_cuentaventa = toNullablePositiveNumber(raw.codigo_cuentaventa);
  const fechavaloracion = toNullableTrimmedString(raw.fechavaloracion);
  const numero_cuentaventa = toNullableTrimmedString(raw.numero_cuentaventa);
  const observaciones_valoracion = toNullableTrimmedString(raw.observaciones_valoracion);
  const clienteid = toNullablePositiveNumber(raw.clienteid);

  const hasMeaningfulData = Boolean(
    cuentaventaid ??
      serieid ??
      codigo_cuentaventa ??
      fechavaloracion ??
      numero_cuentaventa ??
      observaciones_valoracion ??
      clienteid,
  );

  if (!hasMeaningfulData) return null;

  return {
    salidaid,
    cuentaventaid,
    serieid,
    codigo_cuentaventa,
    fechavaloracion,
    numero_cuentaventa,
    observaciones_valoracion,
    clienteid,
    endpoint,
  };
};

class AgroirisSalidasService {
  private cache = new Map<number, AgroirisSalidaDetalle>();
  private inFlight = new Map<number, Promise<AgroirisSalidaDetalle | null>>();
  private cuentaVentaCache = new Map<number, AgroirisSalidaDetalleResumen[]>();
  private cuentaVentaInFlight = new Map<number, Promise<AgroirisSalidaDetalleResumen[]>>();
  private cuentaVentaBySalidaCache = new Map<number, AgroirisCuentaVentaSalidaLookup | null>();
  private cuentaVentaBySalidaInFlight = new Map<number, Promise<AgroirisCuentaVentaSalidaLookup | null>>();

  private isCuentaVentaFallbackStatus(status: unknown): boolean {
    return status === 404 || status === 405 || status === 410 || status === 500 || status === 501;
  }

  private async fetchCuentaVentaBySalidaFromEndpoint(
    salidaid: number,
    endpoint: 'albmaterial' | 'albsalida',
  ): Promise<AgroirisCuentaVentaSalidaLookup | null> {
    const data = await agroirisCuentaVentaAuth.authenticatedFetch<unknown>(`/cuentaventa/${endpoint}/${salidaid}`);
    return normalizeCuentaVentaSalidaLookup(salidaid, endpoint, data);
  }

  async getSalidaDetalle(salidadetalleid: number): Promise<AgroirisSalidaDetalle | null> {
    if (!salidadetalleid) return null;
    if (this.cache.has(salidadetalleid)) {
      return this.cache.get(salidadetalleid) ?? null;
    }
    if (this.inFlight.has(salidadetalleid)) {
      return this.inFlight.get(salidadetalleid) ?? null;
    }

    const request = agroirisAuth
      .authenticatedFetch<AgroirisSalidaDetalle>(`/salidadetalle/${salidadetalleid}`)
      .then((data) => {
        if (data) {
          this.cache.set(salidadetalleid, data);
        }
        return data ?? null;
      })
      .catch((error) => {
        console.error('Error cargando salidadetalle', salidadetalleid, error);
        return null;
      })
      .finally(() => {
        this.inFlight.delete(salidadetalleid);
      });

    this.inFlight.set(salidadetalleid, request);
    return request;
  }

  async getSalidasDetalleCuentaVenta(clienteid: number): Promise<AgroirisSalidaDetalleResumen[]> {
    if (!clienteid) return [];
    if (this.cuentaVentaCache.has(clienteid)) {
      return this.cuentaVentaCache.get(clienteid) ?? [];
    }
    if (this.cuentaVentaInFlight.has(clienteid)) {
      return this.cuentaVentaInFlight.get(clienteid) ?? [];
    }

    const request = agroirisAuth
      .authenticatedFetch<AgroirisSalidaDetalleResumen[]>(`/salidadetalle/cuentaventa/${clienteid}`)
      .then((data) => (Array.isArray(data) ? data : []))
      .then((data) => {
        this.cuentaVentaCache.set(clienteid, data);
        return data;
      })
      .catch((error) => {
        console.error('Error cargando salidadetalle por cliente', clienteid, error);
        return [];
      })
      .finally(() => {
        this.cuentaVentaInFlight.delete(clienteid);
      });

    this.cuentaVentaInFlight.set(clienteid, request);
    return request;
  }

  async getCuentaVentaBySalidaId(salidaid: number): Promise<AgroirisCuentaVentaSalidaLookup | null> {
    if (!salidaid) return null;
    if (this.cuentaVentaBySalidaCache.has(salidaid)) {
      return this.cuentaVentaBySalidaCache.get(salidaid) ?? null;
    }
    if (this.cuentaVentaBySalidaInFlight.has(salidaid)) {
      return this.cuentaVentaBySalidaInFlight.get(salidaid) ?? null;
    }

    const request = this.fetchCuentaVentaBySalidaFromEndpoint(salidaid, 'albmaterial')
      .catch(async (error: any) => {
        if (!this.isCuentaVentaFallbackStatus(error?.status)) throw error;
        return this.fetchCuentaVentaBySalidaFromEndpoint(salidaid, 'albsalida').catch((fallbackError: any) => {
          if (this.isCuentaVentaFallbackStatus(fallbackError?.status)) return null;
          throw fallbackError;
        });
      })
      .catch((error) => {
        console.error('Error comprobando cuenta de venta por salida', salidaid, error);
        return null;
      })
      .then((data) => {
        this.cuentaVentaBySalidaCache.set(salidaid, data);
        return data;
      })
      .finally(() => {
        this.cuentaVentaBySalidaInFlight.delete(salidaid);
      });

    this.cuentaVentaBySalidaInFlight.set(salidaid, request);
    return request;
  }

  async resolveSalidaIdsForCuentaVentaImportables(
    items: AgroirisSalidaDetalleCuentaVentaImportable[],
  ): Promise<AgroirisSalidaDetalleCuentaVentaImportable[]> {
    return Promise.all(
      items.map(async (item) => {
        if (item.salidaid && item.salidaid > 0) return item;
        const detalle = await this.getSalidaDetalle(item.salidadetalleid);
        const salidaid = toNullablePositiveNumber(detalle?.salidaid);
        if (!salidaid) return item;
        return { ...item, salidaid };
      }),
    );
  }

  async getCuentaVentaLinksBySalidaIds(
    salidaIds: Array<number | null | undefined>,
  ): Promise<Record<number, AgroirisCuentaVentaSalidaLookup>> {
    const uniqueSalidaIds = Array.from(
      new Set(
        salidaIds
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0),
      ),
    );

    if (uniqueSalidaIds.length === 0) return {};

    const resolved = await Promise.all(
      uniqueSalidaIds.map(async (salidaid) => [salidaid, await this.getCuentaVentaBySalidaId(salidaid)] as const),
    );

    const entries: Array<[number, AgroirisCuentaVentaSalidaLookup]> = [];
    resolved.forEach(([salidaid, lookup]) => {
      if (lookup) {
        entries.push([salidaid, lookup]);
      }
    });

    return Object.fromEntries(entries);
  }

  async searchSalidasDetalleCuentaVentaByReferencia(
    clienteid: number,
    referencia:
      | string
      | {
          referenciaCliente?: string | null;
          referencia2Cliente?: string | null;
        },
  ): Promise<AgroirisSalidaDetalleCuentaVentaImportable[]> {
    const referenciaClienteNormalizada =
      typeof referencia === 'string'
        ? referencia.trim().toLowerCase()
        : (referencia.referenciaCliente ?? '').trim().toLowerCase();
    const referencia2ClienteNormalizada =
      typeof referencia === 'string' ? '' : (referencia.referencia2Cliente ?? '').trim().toLowerCase();

    if (!clienteid || (!referenciaClienteNormalizada && !referencia2ClienteNormalizada)) return [];

    const salidas = await this.getSalidasDetalleCuentaVenta(clienteid);
    const uniqueBySalidaDetalleId = new Map<number, AgroirisSalidaDetalleCuentaVentaImportable>();

    for (const item of salidas) {
      const referenciaCliente = (item.referencia_cliente ?? '').toString().trim().toLowerCase();
      const referencia2Cliente = (item.referencia2_cliente ?? '').toString().trim().toLowerCase();
      const matchesReferenciaCliente = referenciaClienteNormalizada
        ? referenciaCliente.includes(referenciaClienteNormalizada)
        : false;
      const matchesReferencia2Cliente = referencia2ClienteNormalizada
        ? referencia2Cliente.includes(referencia2ClienteNormalizada)
        : false;

      if (!matchesReferenciaCliente && !matchesReferencia2Cliente) continue;

      const normalized = normalizeImportableSalidaDetalle(item);
      if (!normalized) continue;
      if (uniqueBySalidaDetalleId.has(normalized.salidadetalleid)) continue;

      uniqueBySalidaDetalleId.set(normalized.salidadetalleid, normalized);
    }

    return Array.from(uniqueBySalidaDetalleId.values());
  }
}

export const agroirisSalidas = new AgroirisSalidasService();
