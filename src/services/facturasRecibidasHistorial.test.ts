// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  LONGITUD_CONCEPTO,
  MIN_HISTORIAL_SUGERENCIA,
  calcularSugerencias,
  construirConceptoFactura,
  describirSugerencia,
  normalizarFacturaHistorica,
  type FacturaHistorica,
} from './facturasRecibidasHistorial';

const factura = (overrides: Partial<FacturaHistorica> = {}): FacturaHistorica => ({
  tipo_factura: 'OT',
  regimen_id: 2110,
  iva1: 21,
  fecha_factura: '2026-06-30',
  ...overrides,
});

const repetir = (n: number, overrides: Partial<FacturaHistorica> = {}) =>
  Array.from({ length: n }, () => factura(overrides));

describe('construirConceptoFactura', () => {
  it('aplica la convencion FRA. + nombre observada en el 100% del historico', () => {
    expect(construirConceptoFactura('ONDUSPAN, S.A')).toBe('FRA. ONDUSPAN, S.A');
    expect(construirConceptoFactura('RUIZ SALAZAR RAMON')).toBe('FRA. RUIZ SALAZAR RAMON');
  });

  it('corta a los 50 caracteres del varchar del ERP', () => {
    const concepto = construirConceptoFactura(
      'GLOBALPACK ENVASES, ETIQUETAS Y EMBALAJES S.C.A. Y MAS',
    );
    expect(concepto).toHaveLength(LONGITUD_CONCEPTO);
    expect(concepto?.startsWith('FRA. GLOBALPACK')).toBe(true);
  });

  it('no inventa concepto sin nombre de acreedor', () => {
    expect(construirConceptoFactura(null)).toBeNull();
    expect(construirConceptoFactura('   ')).toBeNull();
  });
});

describe('calcularSugerencias', () => {
  it('no sugiere nada por debajo del umbral de historico medido', () => {
    const sugerencias = calcularSugerencias(repetir(MIN_HISTORIAL_SUGERENCIA - 1));
    expect(sugerencias.tipo_factura.criterio).toBe('sin_historial');
    expect(sugerencias.tipo_factura.valor).toBeNull();
    expect(sugerencias.regimen_id.valor).toBeNull();
  });

  it('sugiere sin ambiguedad cuando el proveedor es constante', () => {
    const sugerencias = calcularSugerencias(repetir(47), { iva1: 21 });
    expect(sugerencias.tipo_factura.valor).toBe('OT');
    expect(sugerencias.tipo_factura.ambigua).toBe(false);
    expect(sugerencias.tipo_factura.coincidencias).toBe(47);
    expect(sugerencias.regimen_id.valor).toBe(2110);
    expect(sugerencias.regimen_id.criterio).toBe('proveedor+iva');
  });

  it('marca ambiguo el tipo cuando el proveedor mezcla valores', () => {
    const historial = [...repetir(6, { tipo_factura: 'OT' }), ...repetir(4, { tipo_factura: 'MA' })];
    const sugerencias = calcularSugerencias(historial);
    expect(sugerencias.tipo_factura.valor).toBe('OT');
    expect(sugerencias.tipo_factura.ambigua).toBe(true);
    expect(sugerencias.tipo_factura.alternativas).toEqual([{ valor: 'MA', total: 4 }]);
  });

  it('separa el regimen por IVA: el mismo proveedor usa regimenes distintos', () => {
    // Caso real: un proveedor con 21% en 2110 y con 0% en 4110.
    const historial = [
      ...repetir(8, { iva1: 21, regimen_id: 2110 }),
      ...repetir(5, { iva1: 0, regimen_id: 4110 }),
    ];

    expect(calcularSugerencias(historial, { iva1: 21 }).regimen_id.valor).toBe(2110);
    expect(calcularSugerencias(historial, { iva1: 0 }).regimen_id.valor).toBe(4110);
  });

  it('no deriva el regimen del porcentaje de IVA: 21% no implica 2110', () => {
    // Contraejemplo medido: ONDUSPAN (prov 17) usa 2110 y RUIZ SALAZAR (prov 345)
    // usa 2114, ambos al 21%. El regimen sale del historico del proveedor.
    const onduspan = calcularSugerencias(repetir(5, { iva1: 21, regimen_id: 2110 }), { iva1: 21 });
    const ruiz = calcularSugerencias(repetir(5, { iva1: 21, regimen_id: 2114 }), { iva1: 21 });

    expect(onduspan.regimen_id.valor).toBe(2110);
    expect(ruiz.regimen_id.valor).toBe(2114);
  });

  it('cae al historico completo cuando no hay suficientes facturas con ese IVA', () => {
    const historial = [...repetir(9, { iva1: 21, regimen_id: 2110 }), factura({ iva1: 4, regimen_id: 1110 })];
    const sugerencias = calcularSugerencias(historial, { iva1: 4 });
    expect(sugerencias.regimen_id.criterio).toBe('proveedor');
    expect(sugerencias.regimen_id.valor).toBe(2110);
    expect(sugerencias.regimen_id.ambigua).toBe(true);
  });

  it('ignora los huecos sin valor en lugar de contarlos como una opcion', () => {
    const historial = [...repetir(4, { tipo_factura: 'GE' }), ...repetir(3, { tipo_factura: null })];
    const sugerencias = calcularSugerencias(historial);
    expect(sugerencias.tipo_factura.valor).toBe('GE');
    expect(sugerencias.tipo_factura.total).toBe(4);
    expect(sugerencias.tipo_factura.ambigua).toBe(false);
  });
});

describe('normalizarFacturaHistorica', () => {
  it('acepta los nombres del listado y los de la cabecera', () => {
    expect(normalizarFacturaHistorica({ tipo_factura: 'MA', regimen_id: '2112', iva1: '21.00' })).toEqual({
      tipo_factura: 'MA',
      regimen_id: 2112,
      iva1: 21,
      fecha_factura: null,
    });

    expect(
      normalizarFacturaHistorica({
        FRR_tipofactura: 'GE',
        FRR_idregimen: 4110,
        FRR_iva1: '0.00',
        FRR_fechafactura: '2026-01-15',
      }),
    ).toEqual({ tipo_factura: 'GE', regimen_id: 4110, iva1: 0, fecha_factura: '2026-01-15' });
  });
});

describe('describirSugerencia', () => {
  it('distingue una sugerencia unanime de una ambigua', () => {
    const unanime = calcularSugerencias(repetir(47), { iva1: 21 });
    expect(describirSugerencia(unanime.tipo_factura)).toBe('47 de 47 facturas previas');
    expect(describirSugerencia(unanime.regimen_id)).toBe('47 de 47 facturas previas con el mismo IVA');

    const ambigua = calcularSugerencias([
      ...repetir(6, { tipo_factura: 'OT' }),
      ...repetir(4, { tipo_factura: 'MA' }),
    ]);
    expect(describirSugerencia(ambigua.tipo_factura)).toBe(
      '6 de 10 facturas previas; tambien MA (4)',
    );
  });

  it('no describe nada sin historico', () => {
    const vacio = calcularSugerencias([]);
    expect(describirSugerencia(vacio.tipo_factura)).toBeNull();
  });
});
