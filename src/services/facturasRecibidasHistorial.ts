import { supabase } from '@/integrations/supabase/client';

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
  calcular: calcularSugerencias,
  concepto: construirConceptoFactura,
  describir: describirSugerencia,
};
