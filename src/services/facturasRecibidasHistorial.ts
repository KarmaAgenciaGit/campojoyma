import { supabase } from '@/integrations/supabase/client';
import type { FacturaRecibidaIvaTramo } from '@/services/apiContracts';

/**
 * Sugerencias derivadas del historico real del ERP.
 *
 * Esto NO son reglas aprobadas: `facturasRecibidasErpRules` sigue siendo la unica
 * fuente autoritativa y tiene precedencia. Aqui solo se mide lo que el ERP ya hizo
 * con ese proveedor para proponerlo con su confianza a la vista. Una sugerencia
 * ambigua nunca se auto-aplica; exige eleccion manual.
 *
 * Frecuencias que respaldan cada decision en
 * docs/REGLAS_DERIVADAS_FACTURAS_RECIBIDAS.md.
 */

const ERP_READ_FUNCTION = 'facturas-recibidas-erp-read';

/** Umbral de la medicion: por debajo de 3 facturas previas no se sugiere nada. */
export const MIN_HISTORIAL_SUGERENCIA = 3;

/** El ERP corta concepto y observaciones AEAT a varchar(50). */
export const LONGITUD_CONCEPTO = 50;

/** Paginas de 100 como maximo: la API devuelve HTTP 500 por encima. */
const MAX_HISTORIAL = 100;

export type FacturaHistorica = {
  tipo_factura: string | null;
  regimen_id: number | null;
  iva1: number | null;
  fecha_factura: string | null;
};

export type Sugerencia<T> = {
  valor: T | null;
  /** Facturas del historico consideradas para esta sugerencia. */
  total: number;
  /** Cuantas de ellas usan el valor sugerido. */
  coincidencias: number;
  /** Entre 0 y 1. `null` cuando no hay historico suficiente. */
  ratio: number | null;
  /** `true` cuando el historico no es unanime: obliga a confirmacion manual. */
  ambigua: boolean;
  /** Otros valores observados, de mas a menos frecuente. */
  alternativas: Array<{ valor: string; total: number }>;
  /** Criterio con el que se agrupo el historico. */
  criterio: 'proveedor' | 'proveedor+iva' | 'sin_historial';
};

export type SugerenciasFactura = {
  tipo_factura: Sugerencia<string>;
  regimen_id: Sugerencia<number>;
};

export type EstadoPerfilIva = 'sin_historial' | 'dominante' | 'ambiguo';

export type PlantillaIvaSugerida = {
  porcentajes: [
    number | null,
    number | null,
    number | null,
    number | null,
    number | null,
  ];
  usos: number;
  confianza: number;
  criterio: 'perfil_historico_dominante';
};

export type PerfilIvaHistoricoTramo = {
  posicion: FacturaRecibidaIvaTramo['posicion'];
  porcentaje: number | null;
  usos_activos: number;
  confianza_activa: number;
};

export type PerfilIvaHistorico = {
  porcentajes: PlantillaIvaSugerida['porcentajes'];
  usos: number;
  confianza: number;
  tramos: PerfilIvaHistoricoTramo[];
};

export type PerfilesIvaRegimen = {
  regimen_id: number;
  filtros: {
    proveedor_id: number | null;
    tipo_factura: string | null;
  };
  total_facturas: number;
  estado: EstadoPerfilIva;
  ambiguo: boolean;
  perfiles: PerfilIvaHistorico[];
  /** Perfil con mayor frecuencia, aunque no alcance el umbral de dominancia. */
  perfil_mas_usado: PerfilIvaHistorico | null;
  plantilla_sugerida: PlantillaIvaSugerida | null;
};

export type ResultadoAplicacionPlantillaIva = {
  aplicada: boolean;
  motivo: 'aplicada' | 'sin_historial' | 'ambigua';
  tramos: FacturaRecibidaIvaTramo[];
};

export type AplicarPlantillaIvaOptions = {
  /**
   * Pensado para hidratar una factura ya existente: completa huecos de la
   * plantilla, pero no reemplaza ningun porcentaje que ya estuviera informado.
   */
  preserveExistingPercentages?: boolean;
  /**
   * Al cambiar el régimen de forma explícita, reemplaza las cinco posiciones
   * por su perfil histórico sin tocar bases ni cuotas.
   */
  replaceExistingPercentages?: boolean;
  /** Permite usar explicitamente el perfil mas frecuente de un resultado ambiguo. */
  allowMostUsedProfile?: boolean;
};

const sinHistorial = <T>(): Sugerencia<T> => ({
  valor: null,
  total: 0,
  coincidencias: 0,
  ratio: null,
  ambigua: false,
  alternativas: [],
  criterio: 'sin_historial',
});

const numeroONull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const textoONull = (value: unknown): string | null => {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
};

const enteroPositivoONull = (value: unknown): number | null => {
  const parsed = numeroONull(value);
  return parsed !== null && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizarPorcentaje = (value: unknown): number | null | undefined => {
  if (value === null) return null;
  const parsed = numeroONull(value);
  return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : undefined;
};

const normalizarPlantillaIva = (value: unknown): PlantillaIvaSugerida | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.porcentajes) || source.porcentajes.length !== 5) {
    return null;
  }
  const porcentajes = source.porcentajes.map(normalizarPorcentaje);
  if (porcentajes.some((porcentaje) => porcentaje === undefined)) return null;
  const usos = enteroPositivoONull(source.usos);
  const confianza = numeroONull(source.confianza);
  if (
    usos === null ||
    confianza === null ||
    confianza < 0 ||
    confianza > 1 ||
    source.criterio !== 'perfil_historico_dominante'
  ) {
    return null;
  }
  return {
    porcentajes: porcentajes as PlantillaIvaSugerida['porcentajes'],
    usos,
    confianza,
    criterio: 'perfil_historico_dominante',
  };
};

const normalizarPerfilIva = (value: unknown): PerfilIvaHistorico | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.porcentajes) || source.porcentajes.length !== 5) return null;
  const porcentajes = source.porcentajes.map(normalizarPorcentaje);
  const usos = enteroPositivoONull(source.usos);
  const confianza = numeroONull(source.confianza);
  if (
    porcentajes.some((porcentaje) => porcentaje === undefined) ||
    usos === null ||
    confianza === null ||
    confianza < 0 ||
    confianza > 1 ||
    !Array.isArray(source.tramos) ||
    source.tramos.length !== 5
  ) {
    return null;
  }

  const tramos = source.tramos.map((valueTramo, index): PerfilIvaHistoricoTramo | null => {
    if (!valueTramo || typeof valueTramo !== 'object') return null;
    const tramo = valueTramo as Record<string, unknown>;
    const posicion = numeroONull(tramo.posicion);
    const porcentaje = normalizarPorcentaje(tramo.porcentaje);
    const usosActivos = numeroONull(tramo.usos_activos);
    const confianzaActiva = numeroONull(tramo.confianza_activa);
    if (
      posicion !== index + 1 ||
      porcentaje === undefined ||
      usosActivos === null ||
      !Number.isInteger(usosActivos) ||
      usosActivos < 0 ||
      confianzaActiva === null ||
      confianzaActiva < 0 ||
      confianzaActiva > 1
    ) {
      return null;
    }
    return {
      posicion: posicion as FacturaRecibidaIvaTramo['posicion'],
      porcentaje,
      usos_activos: usosActivos,
      confianza_activa: confianzaActiva,
    };
  });
  if (tramos.some((tramo) => tramo === null)) return null;

  return {
    porcentajes: porcentajes as PerfilIvaHistorico['porcentajes'],
    usos,
    confianza,
    tramos: tramos as PerfilIvaHistoricoTramo[],
  };
};

const normalizarPerfilesIvaRegimen = (
  payload: unknown,
  regimenIdEsperado: number,
): PerfilesIvaRegimen => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('La respuesta del histórico de IVA no es válida.');
  }
  const source = payload as Record<string, unknown>;
  const regimenId = enteroPositivoONull(source.regimen_id);
  const totalFacturas = numeroONull(source.total_facturas);
  const estado = textoONull(source.estado);
  const filtrosSource =
    source.filtros && typeof source.filtros === 'object'
      ? (source.filtros as Record<string, unknown>)
      : {};
  const proveedorIdRespuesta = enteroPositivoONull(filtrosSource.proveedor_id);
  const tipoFacturaRespuesta = textoONull(filtrosSource.tipo_factura)?.toUpperCase() ?? null;
  if (
    regimenId !== regimenIdEsperado ||
    proveedorIdRespuesta !== null ||
    tipoFacturaRespuesta !== null ||
    totalFacturas === null ||
    !Number.isInteger(totalFacturas) ||
    totalFacturas < 0 ||
    !['sin_historial', 'dominante', 'ambiguo'].includes(estado ?? '') ||
    typeof source.ambiguo !== 'boolean'
  ) {
    throw new Error('La respuesta del histórico de IVA no respeta el contrato.');
  }

  if (!Array.isArray(source.perfiles)) {
    throw new Error('La respuesta del historico de IVA no incluye sus perfiles.');
  }
  // El histórico real contiene perfiles aislados corruptos (por ejemplo, un
  // porcentaje superior al 100 %). Se descartan de la sugerencia sin permitir
  // que un registro imposible inutilice todos los perfiles válidos del régimen.
  const perfiles = source.perfiles
    .map(normalizarPerfilIva)
    .filter((perfil): perfil is PerfilIvaHistorico => perfil !== null);
  const perfilMasUsado = perfiles.reduce<PerfilIvaHistorico | null>(
    (masUsado, perfil) => (masUsado === null || perfil.usos > masUsado.usos ? perfil : masUsado),
    null,
  );

  const plantilla = normalizarPlantillaIva(source.plantilla_sugerida);
  const esDominante = estado === 'dominante' && source.ambiguo === false;
  if ((esDominante && !plantilla) || (!esDominante && source.plantilla_sugerida !== null)) {
    throw new Error('La plantilla histórica de IVA no es coherente con su estado.');
  }

  return {
    regimen_id: regimenId,
    filtros: {
      proveedor_id: proveedorIdRespuesta,
      tipo_factura: tipoFacturaRespuesta,
    },
    total_facturas: totalFacturas,
    estado: estado as EstadoPerfilIva,
    ambiguo: source.ambiguo,
    perfiles,
    perfil_mas_usado: perfilMasUsado,
    plantilla_sugerida: plantilla,
  };
};

/**
 * Normaliza una fila del listado ERP. Acepta tanto los nombres del listado
 * (`tipo_factura`) como los de la cabecera (`FRR_tipofactura`).
 */
export const normalizarFacturaHistorica = (row: Record<string, unknown>): FacturaHistorica => ({
  tipo_factura: textoONull(row.tipo_factura ?? row.FRR_tipofactura),
  regimen_id: numeroONull(row.regimen_id ?? row.FRR_idregimen),
  iva1: numeroONull(row.iva1 ?? row.FRR_iva1),
  fecha_factura: textoONull(row.fecha_factura ?? row.FRR_fechafactura),
});

/** Moda de una lista con su recuento y sus alternativas. */
const moda = <T extends string | number>(
  valores: Array<T | null>,
  criterio: Sugerencia<T>['criterio'],
): Sugerencia<T> => {
  const presentes = valores.filter((value): value is T => value !== null && value !== undefined);
  if (presentes.length < MIN_HISTORIAL_SUGERENCIA) return sinHistorial<T>();

  const recuento = new Map<string, { valor: T; total: number }>();
  for (const valor of presentes) {
    const clave = String(valor);
    const previo = recuento.get(clave);
    if (previo) previo.total += 1;
    else recuento.set(clave, { valor, total: 1 });
  }

  const ordenado = [...recuento.values()].sort((a, b) => b.total - a.total);
  const ganador = ordenado[0];

  return {
    valor: ganador.valor,
    total: presentes.length,
    coincidencias: ganador.total,
    ratio: ganador.total / presentes.length,
    ambigua: ordenado.length > 1,
    alternativas: ordenado.slice(1).map((entry) => ({ valor: String(entry.valor), total: entry.total })),
    criterio,
  };
};

/**
 * Calcula las sugerencias a partir del historico del proveedor.
 *
 * El regimen se agrupa por (proveedor + iva1) porque esa pareja acierta el 98,6%
 * del historico, frente al 89,3% del proveedor solo y el 80,9% del IVA solo.
 * El tipo de factura se agrupa solo por proveedor: anadir IVA o regimen no mejora
 * su techo del 84%, porque depende de que se compro y eso no esta en la cabecera.
 */
export const calcularSugerencias = (
  historial: FacturaHistorica[],
  contexto: { iva1?: number | null } = {},
): SugerenciasFactura => {
  const tipo = moda(
    historial.map((factura) => factura.tipo_factura),
    'proveedor',
  );

  const iva = numeroONull(contexto.iva1);
  const mismoIva = iva === null
    ? []
    : historial.filter((factura) => factura.iva1 !== null && Math.abs(factura.iva1 - iva) < 0.005);

  // Con IVA conocido y suficientes coincidencias, el par proveedor+IVA manda.
  const regimen = mismoIva.length >= MIN_HISTORIAL_SUGERENCIA
    ? moda(mismoIva.map((factura) => factura.regimen_id), 'proveedor+iva')
    : moda(historial.map((factura) => factura.regimen_id), 'proveedor');

  return { tipo_factura: tipo, regimen_id: regimen };
};

/**
 * Convencion del ERP para el concepto de asiento, medida sobre 28.557 facturas:
 * el 100,0% empieza por `FRA` y el 87,2% es exactamente `"FRA. " + nombre`.
 * `FRR_ObservacionesAEAT` es identico al concepto en el 100% de los casos rellenos.
 */
export const construirConceptoFactura = (nombreAcreedor: string | null | undefined): string | null => {
  const nombre = textoONull(nombreAcreedor);
  if (!nombre) return null;
  return `FRA. ${nombre}`.slice(0, LONGITUD_CONCEPTO);
};

const erpRead = async <T>(consulta: string): Promise<T> => {
  const { data, error } = await supabase.functions.invoke(ERP_READ_FUNCTION, {
    body: { consulta },
  });
  if (error) throw new Error(`No se pudo leer el historico del ERP: ${error.message}`);
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    throw new Error(`No se pudo leer el historico del ERP: ${(data as { error: string }).error}`);
  }
  return data as T;
};

/**
 * Consulta el perfil histórico global de porcentajes para un régimen.
 * El desglose del régimen no se filtra por proveedor ni por circuito.
 */
export const obtenerPerfilesIvaRegimen = async ({
  regimenId,
}: {
  regimenId: number;
}): Promise<PerfilesIvaRegimen> => {
  const normalizedRegimenId = enteroPositivoONull(regimenId);
  if (normalizedRegimenId === null) {
    throw new Error('El régimen IVA ERP no es válido.');
  }
  const payload = await erpRead<unknown>(
    `regimenes/${encodeURIComponent(String(normalizedRegimenId))}/perfiles-iva`,
  );
  return normalizarPerfilesIvaRegimen(payload, normalizedRegimenId);
};

const IVA_TRAMO_ACTIVE_EPSILON = 0.005;

const isIvaTramoActive = (tramo: FacturaRecibidaIvaTramo): boolean =>
  Math.abs(tramo.base ?? 0) >= IVA_TRAMO_ACTIVE_EPSILON ||
  Math.abs(tramo.cuota ?? 0) >= IVA_TRAMO_ACTIVE_EPSILON;

/**
 * Aplica los porcentajes de una plantilla dominante por posición. Los huecos sin
 * porcentaje se completan aunque todavía no tengan importe; un porcentaje ya
 * informado en una fila inactiva se conserva. Un `null` de la plantilla nunca
 * borra un valor existente ni se interpreta como 0. Bases, cuotas, posición y
 * cualquier otro dato se conservan literalmente.
 */
export const aplicarPlantillaIvaHistorica = (
  tramos: FacturaRecibidaIvaTramo[],
  perfiles: PerfilesIvaRegimen,
  options: AplicarPlantillaIvaOptions = {},
): ResultadoAplicacionPlantillaIva => {
  const perfilAplicable =
    perfiles.estado === 'dominante' && !perfiles.ambiguo
      ? perfiles.plantilla_sugerida
      : options.allowMostUsedProfile
        ? perfiles.perfil_mas_usado
        : null;
  if (perfilAplicable === null) {
    return {
      aplicada: false,
      motivo: perfiles.estado === 'sin_historial' ? 'sin_historial' : 'ambigua',
      tramos,
    };
  }

  const porcentajes = perfilAplicable.porcentajes;
  return {
    aplicada: true,
    motivo: 'aplicada',
    tramos: tramos.map((tramo) => {
      const porcentajeSugerido = porcentajes[tramo.posicion - 1];
      const tienePorcentaje = tramo.porcentaje !== null && tramo.porcentaje !== undefined;
      const debeConservarExistente =
        !options.replaceExistingPercentages &&
        ((options.preserveExistingPercentages && tienePorcentaje) ||
          (!isIvaTramoActive(tramo) && tienePorcentaje));

      if (
        porcentajeSugerido === null ||
        debeConservarExistente
      ) {
        return tramo;
      }

      return {
        ...tramo,
        porcentaje: porcentajeSugerido,
      };
    }),
  };
};

const extraerFilas = (payload: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (!payload || typeof payload !== 'object') return [];
  const items = (payload as { items?: unknown }).items;
  return Array.isArray(items) ? (items as Array<Record<string, unknown>>) : [];
};

/** Lee el historico reciente de un proveedor en el ERP. Solo lectura. */
export const obtenerHistorialProveedor = async (
  proveedorId: number,
  limite = MAX_HISTORIAL,
): Promise<FacturaHistorica[]> => {
  if (!Number.isFinite(proveedorId) || proveedorId <= 0) {
    throw new Error('El identificador de proveedor ERP no es valido.');
  }
  const pageSize = Math.min(Math.max(1, Math.trunc(limite)), MAX_HISTORIAL);
  const payload = await erpRead(
    `facturasrecibidas?proveedor_id=${encodeURIComponent(String(proveedorId))}&limit=${pageSize}&offset=0`,
  );
  return extraerFilas(payload).map(normalizarFacturaHistorica);
};

/** Sugerencias listas para la pantalla de revision de un borrador. */
export const obtenerSugerenciasProveedor = async (
  proveedorId: number,
  contexto: { iva1?: number | null } = {},
): Promise<SugerenciasFactura> => {
  const historial = await obtenerHistorialProveedor(proveedorId);
  return calcularSugerencias(historial, contexto);
};

/** Texto corto para mostrar la confianza junto al campo sugerido. */
export const describirSugerencia = (sugerencia: Sugerencia<string | number>): string | null => {
  if (sugerencia.criterio === 'sin_historial' || sugerencia.valor === null) return null;
  const base = `${sugerencia.coincidencias} de ${sugerencia.total} facturas previas`;
  const detalle = sugerencia.criterio === 'proveedor+iva' ? ' con el mismo IVA' : '';
  if (!sugerencia.ambigua) return `${base}${detalle}`;
  const otras = sugerencia.alternativas
    .map((alternativa) => `${alternativa.valor} (${alternativa.total})`)
    .join(', ');
  return `${base}${detalle}; tambien ${otras}`;
};

export const facturasRecibidasHistorial = {
  historial: obtenerHistorialProveedor,
  sugerencias: obtenerSugerenciasProveedor,
  perfilesIvaRegimen: obtenerPerfilesIvaRegimen,
  aplicarPlantillaIva: aplicarPlantillaIvaHistorica,
  calcular: calcularSugerencias,
  concepto: construirConceptoFactura,
  describir: describirSugerencia,
};
