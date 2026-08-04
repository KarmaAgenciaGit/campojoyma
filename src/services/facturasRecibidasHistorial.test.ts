// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: invokeMock },
  },
}));

import {
  LONGITUD_CONCEPTO,
  MIN_HISTORIAL_SUGERENCIA,
  aplicarPlantillaIvaHistorica,
  calcularSugerencias,
  construirConceptoFactura,
  describirSugerencia,
  normalizarFacturaHistorica,
  obtenerPerfilesIvaRegimen,
  type FacturaHistorica,
  type PerfilesIvaRegimen,
} from './facturasRecibidasHistorial';
import type { FacturaRecibidaIvaTramo } from './apiContracts';

const factura = (overrides: Partial<FacturaHistorica> = {}): FacturaHistorica => ({
  tipo_factura: 'OT',
  regimen_id: 2110,
  iva1: 21,
  fecha_factura: '2026-06-30',
  ...overrides,
});

const repetir = (n: number, overrides: Partial<FacturaHistorica> = {}) =>
  Array.from({ length: n }, () => factura(overrides));

const tramosIva = (
  overrides: Partial<Record<FacturaRecibidaIvaTramo['posicion'], Partial<FacturaRecibidaIvaTramo>>> = {},
): FacturaRecibidaIvaTramo[] =>
  [1, 2, 3, 4, 5].map((posicion) => ({
    posicion: posicion as FacturaRecibidaIvaTramo['posicion'],
    base: posicion * 100,
    porcentaje: posicion,
    cuota: posicion * 10,
    ...overrides[posicion as FacturaRecibidaIvaTramo['posicion']],
  }));

const perfilesDominantes = (
  overrides: Partial<PerfilesIvaRegimen> = {},
): PerfilesIvaRegimen => {
  const perfil = {
    porcentajes: [21, 10, 4, 5, 0],
    usos: 9,
    confianza: 0.9,
    tramos: [1, 2, 3, 4, 5].map((posicion) => ({
      posicion: posicion as FacturaRecibidaIvaTramo['posicion'],
      porcentaje: [21, 10, 4, 5, 0][posicion - 1],
      usos_activos: posicion === 1 ? 9 : 0,
      confianza_activa: posicion === 1 ? 1 : 0,
    })),
  };
  return {
    regimen_id: 2110,
    filtros: { proveedor_id: null, tipo_factura: null },
    total_facturas: 10,
    estado: 'dominante',
    ambiguo: false,
    perfiles: [perfil],
    perfil_mas_usado: perfil,
    plantilla_sugerida: {
      porcentajes: [21, 10, 4, 5, 0],
      usos: 9,
      confianza: 0.9,
      criterio: 'perfil_historico_dominante',
    },
    ...overrides,
  };
};

beforeEach(() => {
  invokeMock.mockReset();
});

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

describe('perfil histórico de IVA por régimen', () => {
  it('consulta el histórico global del régimen sin filtrar por proveedor ni circuito', async () => {
    const minoritarioRedondeado = {
      porcentajes: [null, null, null, null, null],
      usos: 1,
      confianza: 0,
      tramos: [1, 2, 3, 4, 5].map((posicion) => ({
        posicion,
        porcentaje: null,
        usos_activos: 0,
        confianza_activa: 0,
      })),
    };
    const perfilCorrupto = {
      ...minoritarioRedondeado,
      porcentajes: [381.82, 10, 4, 0, 0],
      tramos: minoritarioRedondeado.tramos.map((tramo, index) => ({
        ...tramo,
        porcentaje: [381.82, 10, 4, 0, 0][index],
      })),
    };
    invokeMock.mockResolvedValue({
      data: {
        ...perfilesDominantes(),
        perfiles: [
          ...perfilesDominantes().perfiles,
          minoritarioRedondeado,
          perfilCorrupto,
        ],
        plantilla_sugerida: {
          porcentajes: ['21.00', '10.00', '4.00', '5.00', null],
          usos: 9,
          confianza: 0.9,
          criterio: 'perfil_historico_dominante',
        },
      },
      error: null,
    });

    const result = await obtenerPerfilesIvaRegimen({
      regimenId: 2110,
    });

    expect(invokeMock).toHaveBeenCalledWith('facturas-recibidas-erp-read', {
      body: {
        consulta: 'regimenes/2110/perfiles-iva',
      },
    });
    expect(result.filtros).toEqual({ proveedor_id: null, tipo_factura: null });
    expect(result.perfiles).toHaveLength(2);
    expect(result.perfiles[1].confianza).toBe(0);
    expect(result.perfiles.flatMap((perfil) => perfil.porcentajes)).not.toContain(381.82);
    expect(result.plantilla_sugerida?.porcentajes).toEqual([21, 10, 4, 5, null]);
  });

  it('no sobrescribe ningún tramo cuando el histórico es ambiguo', () => {
    const originales = tramosIva();
    const result = aplicarPlantillaIvaHistorica(
      originales,
      perfilesDominantes({
        estado: 'ambiguo',
        ambiguo: true,
        plantilla_sugerida: null,
      }),
    );

    expect(result).toMatchObject({ aplicada: false, motivo: 'ambigua' });
    expect(result.tramos).toBe(originales);
    expect(result.tramos).toEqual(tramosIva());
  });

  it('usa el perfil global más frecuente de un régimen ambiguo solo cuando se solicita', () => {
    const originales = tramosIva({
      1: { porcentaje: null },
      2: { porcentaje: null },
      3: { porcentaje: null },
      4: { porcentaje: null },
      5: { porcentaje: null },
    });
    const perfiles = perfilesDominantes({
      estado: 'ambiguo',
      ambiguo: true,
      plantilla_sugerida: null,
    });

    const conservador = aplicarPlantillaIvaHistorica(originales, perfiles);
    const solicitado = aplicarPlantillaIvaHistorica(originales, perfiles, {
      allowMostUsedProfile: true,
    });

    expect(conservador).toMatchObject({ aplicada: false, motivo: 'ambigua' });
    expect(solicitado.aplicada).toBe(true);
    expect(solicitado.tramos.map((tramo) => tramo.porcentaje)).toEqual([21, 10, 4, 5, 0]);
  });

  it('aplica la plantilla por posición y completa los cinco huecos sin porcentaje', () => {
    const originales = tramosIva({
      1: { base: 0, cuota: 0, porcentaje: null },
      2: { base: 423.41, cuota: 42.34 },
      3: { base: null, cuota: null, porcentaje: null },
      4: { base: null, cuota: null, porcentaje: null },
      5: { base: null, cuota: null, porcentaje: null },
    });

    const result = aplicarPlantillaIvaHistorica(originales, perfilesDominantes());

    expect(result.aplicada).toBe(true);
    expect(result.tramos.map((tramo) => tramo.porcentaje)).toEqual([21, 10, 4, 5, 0]);
    expect(result.tramos[0]).toMatchObject({ base: 0, cuota: 0 });
    expect(result.tramos[1]).toMatchObject({ base: 423.41, cuota: 42.34 });
  });

  it('preserva literalmente todas las bases y cuotas al actualizar porcentajes', () => {
    const originales = tramosIva({
      1: { base: 42_341.52, cuota: 8_891.72 },
      2: { base: -12.34, cuota: -1.23 },
      3: { base: null, cuota: null, porcentaje: null },
      4: { base: 0, cuota: 0, porcentaje: null },
      5: { base: 99.99, cuota: 7.77 },
    });
    const importesOriginales = originales.map(({ base, cuota }) => ({ base, cuota }));

    const result = aplicarPlantillaIvaHistorica(originales, perfilesDominantes());

    expect(result.tramos.map(({ base, cuota }) => ({ base, cuota }))).toEqual(importesOriginales);
    expect(result.tramos.map((tramo) => tramo.porcentaje)).toEqual([21, 10, 4, 5, 0]);
  });

  it('considera activo un abono y aplica su porcentaje histórico', () => {
    const originales = tramosIva({
      1: { base: -100, cuota: -21, porcentaje: null },
      2: { base: null, cuota: null, porcentaje: null },
    });

    const result = aplicarPlantillaIvaHistorica(originales, perfilesDominantes());

    expect(result.tramos[0]).toMatchObject({ base: -100, cuota: -21, porcentaje: 21 });
    expect(result.tramos[1]).toMatchObject({ base: null, cuota: null, porcentaje: 10 });
  });

  it('no altera un porcentaje manual de una fila sin importe', () => {
    const originales = tramosIva({
      1: { base: 0.004, cuota: -0.004, porcentaje: 7 },
    });

    const result = aplicarPlantillaIvaHistorica(originales, perfilesDominantes());

    expect(result.tramos[0]).toBe(originales[0]);
    expect(result.tramos[0].porcentaje).toBe(7);
  });

  it('reemplaza las cinco posiciones cuando el usuario cambia expresamente el régimen', () => {
    const originales = tramosIva({
      1: { base: 100, cuota: 7, porcentaje: 7 },
      2: { base: null, cuota: null, porcentaje: 8 },
      3: { base: null, cuota: null, porcentaje: 9 },
      4: { base: null, cuota: null, porcentaje: 12 },
      5: { base: null, cuota: null, porcentaje: 15 },
    });
    const importesOriginales = originales.map(({ base, cuota }) => ({ base, cuota }));

    const result = aplicarPlantillaIvaHistorica(originales, perfilesDominantes(), {
      replaceExistingPercentages: true,
    });

    expect(result.tramos.map((tramo) => tramo.porcentaje)).toEqual([21, 10, 4, 5, 0]);
    expect(result.tramos.map(({ base, cuota }) => ({ base, cuota }))).toEqual(importesOriginales);
  });

  it('no interpreta un porcentaje nulo de la plantilla como cero ni borra el existente', () => {
    const originales = tramosIva({
      1: { base: 100, cuota: 21, porcentaje: 7 },
      2: { base: null, cuota: null, porcentaje: null },
      3: { base: null, cuota: null, porcentaje: 8 },
    });
    const perfiles = perfilesDominantes({
      plantilla_sugerida: {
        porcentajes: [null, 10, 4, 5, 0],
        usos: 9,
        confianza: 0.9,
        criterio: 'perfil_historico_dominante',
      },
    });

    const result = aplicarPlantillaIvaHistorica(originales, perfiles);

    expect(result.tramos.map((tramo) => tramo.porcentaje)).toEqual([7, 10, 8, 5, 0]);
    expect(result.tramos[0]).toBe(originales[0]);
    expect(result.tramos[2]).toBe(originales[2]);
  });

  it('en hidratación inicial solo completa porcentajes nulos', () => {
    const originales = tramosIva({
      1: { base: 100, cuota: 21, porcentaje: 7 },
      2: { base: null, cuota: null, porcentaje: null },
      3: { base: 50, cuota: 2, porcentaje: null },
      4: { base: null, cuota: null, porcentaje: 6 },
      5: { base: null, cuota: null, porcentaje: null },
    });
    const importesOriginales = originales.map(({ base, cuota }) => ({ base, cuota }));

    const result = aplicarPlantillaIvaHistorica(originales, perfilesDominantes(), {
      preserveExistingPercentages: true,
    });

    expect(result.tramos.map((tramo) => tramo.porcentaje)).toEqual([7, 10, 4, 6, 0]);
    expect(result.tramos.map(({ base, cuota }) => ({ base, cuota }))).toEqual(importesOriginales);
    expect(result.tramos[0]).toBe(originales[0]);
    expect(result.tramos[3]).toBe(originales[3]);
  });
});
