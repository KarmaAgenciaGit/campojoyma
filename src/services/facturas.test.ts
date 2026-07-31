import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

vi.mock('@/services/facturasRecibidas', () => ({
  facturasRecibidas: {},
}));

import {
  buildCtbPayload,
  buildFacturaDuplicateConsulta,
  buildFacturaPayload,
  buildPunteosPayload,
  fetchAlbaranEntradaLineas,
  fetchAlbaranMaterialLineas,
  fetchFacturaPunteables,
  fetchFacturaPunteosLive,
  fetchFacturaTiposIva,
  fetchFacturasRecibidasERPRuntime,
  facturaProveedorERPKind,
  getFacturaERPSendConfirmation,
  getFacturaERPReconciliationRequestId,
  getPunteoImporte,
  mapProveedorERPDetail,
  getFunctionInvokeErrorMessage,
  isERPReferenceFactura,
  isRetryableFacturaERPReadError,
  labelTipoFactura,
  isERPReadOnlyFactura,
  localizarProveedorERP,
  mapFacturaToUi,
  mapRemoteFacturaToUi,
  normalizeFacturaValidationIssues,
  normalizeFacturaTiposIva,
  partitionFacturaValidationIssues,
  preflightFacturaRecibidaERP,
  tipoFacturaRadioValue,
  validateFacturaAccountPairs,
} from '@/services/facturas';
import { supabase } from '@/integrations/supabase/client';
import { isFacturaRecibidaInboxSourceKind } from '@/types/facturasRecibidas';
import type { FacturaRecibidaLinea } from '@/services/apiContracts';

const onduSpanHeader = {
  FRR_id: 49305,
  FRR_numero: 5052,
  FRR_ejercicio: 25,
  FRR_idproveedor: 17,
  FRR_idcuenta: '41000000017',
  FRR_numerofactura: 'A-00748886',
  FRR_fechafactura: '2026-06-30',
  FRR_fechactb: '2026-06-30',
  FRR_Idempresa: 1,
  FRR_idregimen: 2110,
  FRR_tipofactura: 'OT',
  FRR_base1: 42341.52,
  FRR_iva1: 21,
  FRR_cuota1: 8891.72,
  FRR_base2: 0,
  FRR_iva2: 10,
  FRR_cuota2: 0,
  FRR_base3: 0,
  FRR_iva3: 4,
  FRR_cuota3: 0,
  FRR_base4: 0,
  FRR_iva4: 5,
  FRR_cuota4: 0,
  FRR_base5: 0,
  FRR_iva5: 0,
  FRR_cuota5: 0,
  FRR_igasto1: 42341.52,
  FRR_ctagasto1: '60200000001',
  FRR_totalfac: 51233.24,
  FRR_IdAsientoNet: 390305,
  FRR_Concepto: 'FRA. ONDUSPAN, S.A',
  FRR_Contabilizar: 'S',
  FRR_GeneraCartera: 'N',
};

const invokeMock = vi.mocked(supabase.functions.invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

const onduSpanPunteos = Array.from({ length: 17 }, (_, index) => {
  const amount = index === 16 ? 3941.52 : 2400;
  const lineCount = index < 4 ? 2 : 1;
  return {
    remote_id: `MA:${2058 + index}`,
    source_table: 'albmaterial',
    source_id: 2058 + index,
    importe_factura: amount,
    Origen: 'MA',
    Serie: 'A26',
    Albaran: 2058 + index,
    Ref: String(478897 + index),
    Fecha: '2026-06-23',
    'Importe P': amount,
    Importe: amount,
    S: true,
    Ver: false,
    line_count: lineCount,
    lines: Array.from({ length: lineCount }, (_, lineIndex) => ({
      line_id: `${index + 1}-${lineIndex + 1}`,
      position: lineIndex + 1,
      description: `Material ${index + 1}.${lineIndex + 1}`,
      quantity: 1,
      unit_price: amount / lineCount,
      amount: amount / lineCount,
    })),
  };
});

describe('errores de Edge Functions', () => {
  it('muestra el error JSON de la funcion en vez del mensaje generico del SDK', async () => {
    const error = new FunctionsHttpError(
      new Response(JSON.stringify({ error: 'FRR_Observaciones supera el limite de 50 caracteres.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getFunctionInvokeErrorMessage(error)).resolves.toBe(
      'FRR_Observaciones supera el limite de 50 caracteres.',
    );
  });

  it('no expone el nombre interno del servicio en mensajes de interfaz', async () => {
    const internalName = ['n', '8', 'n'].join('');
    const error = new FunctionsHttpError(
      new Response(JSON.stringify({ error: `${internalName} no pudo extraer la factura` }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getFunctionInvokeErrorMessage(error)).resolves.toBe(
      'xFuego no pudo extraer la factura',
    );
  });

  it('conserva la indicación retryable de una lectura ERP estructurada', async () => {
    const error = new FunctionsHttpError(
      new Response(JSON.stringify({
        code: 'upstream_unavailable',
        user_message: 'La consulta a Netagro ha tardado demasiado. Puede volver a intentarlo.',
        retryable: true,
        request_id: '6d310312-0a50-46af-b705-c90b52aeb4ef',
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    invokeMock.mockResolvedValueOnce({ data: null, error } as never);

    const result = await fetchFacturaTiposIva().catch((caught) => caught);

    expect(result).toMatchObject({
      name: 'FacturaERPReadError',
      code: 'upstream_unavailable',
      retryable: true,
      requestId: '6d310312-0a50-46af-b705-c90b52aeb4ef',
      message: 'La consulta a Netagro ha tardado demasiado. Puede volver a intentarlo.',
    });
    expect(isRetryableFacturaERPReadError(result)).toBe(true);
  });
});

describe('reintentos ERP', () => {
  it('mantiene un error ERP historico visible sin convertirlo en un bloqueo de validacion', () => {
    const factura = mapFacturaToUi({
      id: 'factura-reintentable',
      estado: 'error_erp',
      validation_errors: [],
      erp_error: 'El intento anterior devolvio HTTP 422',
      asientos: [],
      ctb: [],
      punteos: [],
    } as never);

    expect(factura.validation_errors).toEqual([]);
    expect(factura.erp_error).toBe('El intento anterior devolvio HTTP 422');
  });

  it('conserva FRR_id histórico sin presentar la referencia legacy como confirmada', () => {
    const factura = mapFacturaToUi({
      id: 'factura-finalizada-antigua',
      estado: 'enviada_erp',
      sync_status: 'sent',
      last_request_id: 'c2caa09c-3574-46f7-9b47-11c6651b8e55',
      FRR_id: 49305,
      remote_frr_id: null,
      validation_errors: [],
      asientos: [],
      ctb: [],
      punteos: [],
    } as never);

    expect(factura.remote_frr_id).toBe(49305);
    expect(factura.erp_reference_status).toBe('legacy_unverified');
    expect(factura.last_request_id).toBe('c2caa09c-3574-46f7-9b47-11c6651b8e55');
    expect(getFacturaERPSendConfirmation(factura)).toBe('unconfirmed');
  });
});

describe('modelo reversible de facturas recibidas', () => {
  it('recupera el ID de cabecera del albarán desde raw sin confundirlo con el histórico', () => {
    const factura = mapFacturaToUi({
      id: 'factura-ge',
      estado: 'enviada_erp',
      ctb: [],
      asientos: [],
      punteos: [{
        id: 'punteo-ge',
        factura_id: 'factura-ge',
        posicion: 1,
        remote_id: 'AEH:212162',
        source_table: 'albentrada_his',
        source_id: 212162,
        importe_factura: 129.2,
        Origen: 'GE',
        Serie: 'A26',
        Albaran: 8436,
        Ref: null,
        Fecha: '2026-07-27',
        'Importe P': 0,
        Importe: 129.2,
        S: true,
        Ver: true,
        empresa_id: 1,
        proveedor_id: 1954,
        cuenta_gasto: null,
        line_count: 1,
        source_lines: [],
        raw: { albaran_id: 82548 },
      }],
    } as never);

    expect(factura.punteos?.[0]).toMatchObject({
      source_id: 212162,
      albaran_id: 82548,
    });
  });

  it('clasifica ONDUSPAN sin inventar el número visible ni los apuntes del asiento', () => {
    const factura = mapRemoteFacturaToUi(onduSpanHeader, [], onduSpanPunteos, {
      factura_id: 49305,
      accounting: {
        requested: true,
        created: false,
        status: 'reference_only',
        technical_id: 390305,
        visible_number: null,
        date: null,
        concept: 'FRA. ONDUSPAN, S.A',
        balanced: null,
        total_debit: null,
        total_credit: null,
      },
      entries: [],
    });

    expect(factura.id).toBe('erp:49305');
    expect(factura.base_imponible).toBe(42341.52);
    expect(factura.iva_importe).toBe(8891.72);
    expect(factura.total).toBe(51233.24);
    expect(factura.ejercicio).toBe(25);
    expect(factura.fr_sufa).toBe('OT');
    expect(factura.tipo_iva_codigo).toBe('2110');
    expect(factura.asiento_tecnico).toBe(390305);
    expect(factura.asiento_numero).toBeNull();
    expect(factura.asiento_estado).toBe('reference_only');
    expect(factura.accounting?.created).toBe(false);
    expect(factura.asiento_lineas).toHaveLength(0);
    expect(factura.ctb_lineas).toHaveLength(0);
    expect(factura.facturas_recibidas_lineas).toEqual([
      expect.objectContaining({ descripcion: '60200000001', importe: 42341.52 }),
    ]);
    expect(factura.punteos).toHaveLength(17);
    expect(factura.punteos?.reduce((sum, item) => sum + Number(item.line_count ?? 0), 0)).toBe(21);
    expect(factura.punteos?.reduce((sum, item) => sum + Number(item.importe_factura ?? 0), 0)).toBe(42341.52);
    expect(factura.punteos?.[0]?.lines_loaded).toBe(true);
    expect(factura.punteos?.[0]?.lines?.[0]).toMatchObject({
      descripcion: 'Material 1.1',
    });
    expect(isERPReadOnlyFactura(factura)).toBe(true);
  });

  it('presenta vacíos los huecos IVA a cero y conserva un 0 % realmente usado', () => {
    const factura = mapRemoteFacturaToUi({
      ...onduSpanHeader,
      FRR_base2: 0,
      FRR_iva2: 0,
      FRR_cuota2: 0,
      FRR_base3: 0,
      FRR_iva3: 0,
      FRR_cuota3: 0,
      FRR_base4: 0,
      FRR_iva4: 0,
      FRR_cuota4: 0,
      FRR_base5: 50,
      FRR_iva5: 0,
      FRR_cuota5: 0,
    });

    expect(factura.iva_tramos?.[1]).toEqual({
      posicion: 2,
      base: null,
      porcentaje: null,
      cuota: null,
    });
    expect(factura.iva_tramos?.[2]).toEqual({
      posicion: 3,
      base: null,
      porcentaje: null,
      cuota: null,
    });
    expect(factura.iva_tramos?.[4]).toEqual({
      posicion: 5,
      base: 50,
      porcentaje: 0,
      cuota: 0,
    });
  });

  it('usa la identidad canónica del agricultor y conserva la evidencia del albarán GE', () => {
    const factura = mapRemoteFacturaToUi(
      {
        ...onduSpanHeader,
        FRR_id: 49489,
        FRR_tipofactura: 'GE',
        FRR_idproveedor: 1957,
        proveedor_tipo: 'agricultor',
        proveedor_nombre: 'ALMERITERRA-BIO S.L.',
        proveedor_nif: 'B13702956',
        acreedor_nombre: 'EVENTOS DEL SUR S.L.',
        acreedor_nif: 'B00000000',
        agricultor_nombre: 'ALMERITERRA-BIO S.L.',
        agricultor_nif: 'B13702956',
      },
      [],
      [{
        id_interno_estable: 'AEH:211790',
        source_table: 'albentrada_his',
        source_id: 211790,
        albaran_id: 82548,
        Origen: 'GE',
        Importe: 129.2,
        importe_origen: 136,
        importe_factura: 129.2,
        importe_metodo: 'prorrateo_base_factura',
        lines: [{
          line_id: 87097,
          description: 'Genero 161100',
          package_id: 701,
        }],
      }],
      null,
    );

    expect(factura.proveedor_nombre).toBe('ALMERITERRA-BIO S.L.');
    expect(factura.proveedor_nif).toBe('B13702956');
    expect(factura.punteos?.[0]).toMatchObject({
      remote_id: 'AEH:211790',
      source_table: 'albentrada_his',
      albaran_id: 82548,
      origen: 'GE',
      importe: 129.2,
      importe_factura: 129.2,
    });
    expect(factura.punteos?.[0]?.raw).toMatchObject({
      importe_origen: 136,
      importe_metodo: 'prorrateo_base_factura',
    });
    expect(factura.punteos?.[0]?.lines?.[0]?.raw).toMatchObject({
      package_id: 701,
    });
  });

  it('no infiere la fecha CTB desde la fecha de factura al leer ni al guardar', () => {
    const { FRR_fechactb: _fechaCtb, ...headerWithoutCtb } = onduSpanHeader;
    const factura = mapRemoteFacturaToUi(headerWithoutCtb, [], [], null);
    const payload = buildFacturaPayload(
      {
        fecha_factura: '2026-06-30',
        fecha_ctb: null,
      },
      null,
      [],
    );

    expect(factura.fecha_factura).toBe('2026-06-30');
    expect(factura.fecha_ctb).toBeNull();
    expect(payload.FRR_fechafactura).toBe('2026-06-30');
    expect(payload.FRR_fechactb).toBeNull();
    expect(payload.FRR_Contabilizar).toBe('N');
  });

  it('fuerza contabilizar a N aunque el formulario indique S', () => {
    const payload = buildFacturaPayload(
      { contabilizar: 'S' },
      null,
      [],
    );

    expect(payload.FRR_Contabilizar).toBe('N');
  });

  it('mantiene los candidatos de punteo sin seleccionar para N o valor ausente', () => {
    const factura = mapRemoteFacturaToUi(
      onduSpanHeader,
      [],
      [
        { remote_id: 'MA:1', S: 'N', Importe: 10 },
        { remote_id: 'MA:2', Importe: 20 },
      ],
      null,
    );

    expect(factura.punteos?.map((punteo) => punteo.seleccionado)).toEqual([false, false]);
  });

  it('conserva la liquidacion de agricultor con la cuenta exacta de la API, sin fabricar CTB ni asiento', () => {
    const proveedor = mapProveedorERPDetail({
      ACR_Codigo: 2095,
      ACR_CuentaGasto: '60000000010',
    });
    expect(proveedor?.cuentaGasto).toBe('60000000010');

    const gastos: FacturaRecibidaLinea[] = [
      { posicion: 1, descripcion: '40090002095', importe: 79278.36 },
      { posicion: 2, descripcion: proveedor?.cuentaGasto ?? '', importe: -3171.13 },
    ];
    const payload = buildFacturaPayload({ base_imponible: 76107.23, ctb_lineas: [] }, null, gastos);

    expect(gastos.reduce((sum, linea) => sum + linea.importe, 0)).toBeCloseTo(76107.23, 2);
    expect(payload).toMatchObject({
      FRR_ctagasto1: '40090002095',
      FRR_igasto1: 79278.36,
      FRR_ctagasto2: '60000000010',
      FRR_igasto2: -3171.13,
    });
    expect(buildCtbPayload([])).toEqual([]);
    expect(payload).not.toHaveProperty('FRR_IdAsientoNet');
    expect(Object.keys(payload).some((key) => key.startsWith('FRC_'))).toBe(false);
  });

  it('no corrige automaticamente la cantidad de ceros de la cuenta de gasto ERP', () => {
    expect(mapProveedorERPDetail({ ACR_Codigo: 2095, ACR_CuentaGasto: '6000000010' })?.cuentaGasto)
      .toBe('6000000010');
    expect(mapProveedorERPDetail({ ACR_Codigo: 2095, ACR_CuentaGasto: '60000000010' })?.cuentaGasto)
      .toBe('60000000010');
  });

  it('permite limpiar decisiones manuales, gastos y vencimientos heredados', () => {
    const current = {
      ...onduSpanHeader,
      FRR_ejercicio: 26,
      FRR_idregimen: 9999,
      FRR_tipofactura: 'MA',
      FRR_fechactb: '2026-07-01',
      FRR_CtaCartera: '41000000999',
      FRR_IdBanco: 8,
      FRR_IdFormaPago: 9,
      FRR_igasto1: 123,
      FRR_ctagasto1: '60000000999',
      FechaVto: '2026-08-01',
      ImporteVto: 100,
      FRR_FechaVto1: '2026-09-01',
      FRR_ImporteVto1: 200,
    } as never;
    const payload = buildFacturaPayload(
      {
        ejercicio: null,
        tipo_iva_codigo: null,
        fr_sufa: null,
        fecha_ctb: null,
        cta_cartera: null,
        banco: null,
        forma_pago: null,
        vencimientos: [],
      },
      current,
      [],
    );

    expect(payload).toMatchObject({
      FRR_ejercicio: null,
      FRR_idregimen: null,
      FRR_tipofactura: null,
      FRR_fechactb: null,
      FRR_CtaCartera: null,
      FRR_IdBanco: null,
      FRR_IdFormaPago: null,
      FRR_igasto1: 0,
      FRR_ctagasto1: null,
      FechaVto: null,
      ImporteVto: null,
      FRR_FechaVto1: null,
      FRR_ImporteVto1: null,
    });
  });

  it('convierte un borrador nuevo revisado en payload ERP sin copiar identidad ni inventar relaciones', () => {
    const cabecera = buildFacturaPayload(
      {
        fr_alm: '1',
        ejercicio: 25,
        proveedor_codigo: '17',
        proveedor_cuenta: '41000000017',
        numero_factura: 'A-PDF-NUEVA-0001',
        fecha_factura: '2026-07-23',
        fecha_ctb: '2026-07-23',
        tipo_iva_codigo: '2110',
        fr_sufa: 'OT',
        base_imponible: 42341.52,
        iva_porcentaje: 21,
        iva_importe: 8891.72,
        total: 51233.24,
        contabilizar: 'N',
        genera_cartera: 'N',
        ctb_lineas: [],
        punteos: [],
      },
      null,
      [{
        posicion: 1,
        descripcion: '60200000001',
        importe: 42341.52,
      }],
    );
    expect(cabecera).toMatchObject({
      FRR_Idempresa: 1,
      FRR_ejercicio: 25,
      FRR_idproveedor: 17,
      FRR_idcuenta: '41000000017',
      FRR_numerofactura: 'A-PDF-NUEVA-0001',
      FRR_fechafactura: '2026-07-23',
      FRR_fechactb: '2026-07-23',
      FRR_idregimen: 2110,
      FRR_tipofactura: 'OT',
      FRR_base1: 42341.52,
      FRR_iva1: 21,
      FRR_cuota1: 8891.72,
      FRR_totalfac: 51233.24,
      FRR_ctagasto1: '60200000001',
      FRR_igasto1: 42341.52,
      FRR_Contabilizar: 'N',
      FRR_GeneraCartera: 'N',
    });
    expect(cabecera).not.toHaveProperty('FRR_id');
    expect(cabecera.FRR_numero).toBeNull();
    expect(cabecera).not.toHaveProperty('FRR_IdAsientoNet');
  });

  it('conserva cinco tramos de IVA, cuatro gastos y cuatro vencimientos al volver al contrato ERP', () => {
    const factura = mapRemoteFacturaToUi(
      {
        ...onduSpanHeader,
        FRR_base1: 100,
        FRR_iva1: 21,
        FRR_cuota1: 21,
        FRR_base2: 50,
        FRR_iva2: 10,
        FRR_cuota2: 5,
        FRR_base3: 25,
        FRR_iva3: 4,
        FRR_cuota3: 1,
        FRR_base4: 10,
        FRR_iva4: 5,
        FRR_cuota4: 0.5,
        FRR_base5: 5,
        FRR_iva5: 0,
        FRR_cuota5: 0,
        FechaVto: '2026-07-31',
        ImporteVto: 50,
        FRR_FechaVto1: '2026-08-31',
        FRR_ImporteVto1: 50,
        FRR_FechaVto2: '2026-09-30',
        FRR_ImporteVto2: 50,
        FRR_FechaVto3: '2026-10-31',
        FRR_ImporteVto3: 66.5,
      },
      [],
      [],
      { accounting: { status: 'pending' }, entries: [] },
    );
    const gastos: FacturaRecibidaLinea[] = [1, 2, 3, 4].map((posicion) => ({
      posicion,
      descripcion: `6000000000${posicion}`,
      importe: posicion * 10,
    }));
    const payload = buildFacturaPayload(factura, null, gastos);

    for (let slot = 1; slot <= 5; slot += 1) {
      expect(payload[`FRR_base${slot}`]).toBe(factura.iva_tramos?.[slot - 1]?.base);
      expect(payload[`FRR_iva${slot}`]).toBe(factura.iva_tramos?.[slot - 1]?.porcentaje);
      expect(payload[`FRR_cuota${slot}`]).toBe(factura.iva_tramos?.[slot - 1]?.cuota);
    }
    for (let slot = 1; slot <= 4; slot += 1) {
      expect(payload[`FRR_ctagasto${slot}`]).toBe(`6000000000${slot}`);
      expect(payload[`FRR_igasto${slot}`]).toBe(slot * 10);
    }
    expect(payload.FechaVto).toBe('2026-07-31');
    expect(payload.FRR_FechaVto1).toBe('2026-08-31');
    expect(payload.FRR_FechaVto2).toBe('2026-09-30');
    expect(payload.FRR_FechaVto3).toBe('2026-10-31');
  });

  it('no pierde dimensiones CTB ni claves estables de albmaterial', () => {
    const ctb = buildCtbPayload([
      {
        posicion: 1,
        descripcion: '60200000001',
        importe: 42341.52,
        FRC_id: 7,
        FRC_idfacturarecibida: 49305,
        FRC_IdActividad: 10,
        FRC_Idseccion: 20,
        FRC_Iddepartamento: 30,
        FRC_Idsubdepartamento: 40,
      },
    ]);
    const punteos = buildPunteosPayload([
      {
        posicion: 1,
        remote_id: 'MA:9999',
        source_table: 'albmaterial',
        source_id: 9999,
        importe_factura: 10,
        origen: 'MA',
        serie: 'A26',
        albaran: 9999,
        ref: 'NO-SELECCIONADO',
        fecha: '2026-06-23',
        importe_punteado: 0,
        importe: 10,
        seleccionado: false,
        ver: false,
        line_count: 1,
        lines: [{ id: 1 }],
      },
      {
        posicion: 2,
        remote_id: 'MA:2058',
        source_table: 'albmaterial',
        source_id: 2058,
        importe_factura: 1351.79,
        origen: 'MA',
        serie: 'A26',
        albaran: 2058,
        ref: '478897',
        fecha: '2026-06-23',
        importe_punteado: 1351.79,
        importe: 1351.79,
        seleccionado: true,
        ver: false,
        line_count: 2,
        lines: [{ id: 1 }, { id: 2 }],
      },
    ]);

    expect(ctb[0]).toMatchObject({
      FRC_IdActividad: 10,
      FRC_Idseccion: 20,
      FRC_Iddepartamento: 30,
      FRC_Idsubdepartamento: 40,
    });
    expect(punteos[0]).toMatchObject({
      source_table: 'albmaterial',
      source_id: 2058,
      importe_factura: 1351.79,
      line_count: 2,
    });
    expect(punteos).toHaveLength(1);
    expect(punteos[0]).not.toHaveProperty('source_lines');
    expect(punteos[0]).not.toHaveProperty('raw');
  });

  it('conserva la referencia de cabecera GE sin persistir sus líneas', () => {
    const [punteo] = buildPunteosPayload([{
      posicion: 1,
      remote_id: 'AEH:212162',
      source_table: 'albentrada_his',
      source_id: 212162,
      albaran_id: 82548,
      importe_factura: 129.2,
      origen: 'GE',
      serie: 'A26',
      albaran: 8436,
      ref: null,
      fecha: '2026-07-27',
      importe_punteado: 0,
      importe: 129.2,
      seleccionado: true,
      ver: true,
      line_count: 1,
      lines_loaded: true,
      lines: [{ id: 87097, posicion: 1 }],
    }]);

    expect(punteo).toMatchObject({
      source_table: 'albentrada_his',
      source_id: 212162,
      albaran_id: 82548,
      line_count: 1,
    });
    expect(punteo).not.toHaveProperty('lines');
    expect(punteo).not.toHaveProperty('source_lines');
  });

  it('bloquea también estados de envío indeterminados aunque aún no exista FRR_id', () => {
    expect(isERPReadOnlyFactura({ sync_status: 'unknown' })).toBe(true);
    expect(isERPReadOnlyFactura({ sync_status: 'reconciling' })).toBe(true);
    expect(isERPReadOnlyFactura({ sync_status: 'error', erp_factura_id: null })).toBe(false);
  });

  it('distingue una referencia ERP de una factura entrante real ya enviada', () => {
    expect(isERPReferenceFactura({ source_kind: 'erp_reference', is_readonly_reference: true })).toBe(true);
    expect(isERPReferenceFactura({ source_kind: 'email_draft', sync_status: 'sent', remote_frr_id: 49399 })).toBe(false);
    expect(isERPReadOnlyFactura({ source_kind: 'email_draft', sync_status: 'sent', remote_frr_id: 49399 })).toBe(true);
  });

  it('limita la bandeja a PDFs procesados y excluye referencias o fixtures manuales', () => {
    expect(isFacturaRecibidaInboxSourceKind('ocr_draft')).toBe(true);
    expect(isFacturaRecibidaInboxSourceKind('email_draft')).toBe(true);
    expect(isFacturaRecibidaInboxSourceKind('front_draft')).toBe(true);
    expect(isFacturaRecibidaInboxSourceKind('erp_reference')).toBe(false);
    expect(isFacturaRecibidaInboxSourceKind('manual_draft')).toBe(false);
  });
});

describe('validacion ERP autoritativa', () => {
  const facturaPreflight = {
    proveedor_codigo: '17',
    proveedor_cuenta: '41000000017',
    fr_alm: '1',
    ejercicio: 25,
    numero_factura: 'A-00748886',
    fr_sufa: 'OT',
  };

  it('solo acepta una coincidencia exacta y unica por NIF normalizado', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: true,
        data: {
          total: 2,
          items: [
            { codigo: 99, nombre: 'Proveedor parcial', nif: 'A041192930', cuenta_id: '41000000099' },
            { codigo: 17, nombre: 'ONDUSPAN, S.A.', nif: 'A-04 119 293', cuenta_id: '41000000017' },
          ],
        },
      },
      error: null,
    } as never);

    const result = await localizarProveedorERP({ nif: 'A04119293', nombre: 'ONDUSPAN' });
    const datos = result.erp_response?.datos as Record<string, unknown>;
    const invocation = invokeMock.mock.calls[0]?.[1] as { body?: { consulta?: string } } | undefined;

    expect(result.ok).toBe(true);
    expect(result.erp_response?.resultado).toBe('ok');
    expect(datos.codigo).toBe(17);
    expect(invocation?.body?.consulta).toContain('nif=A04119293&activo=true&limit=25');
  });

  it('busca las facturas GE en agricultores y no en acreedores con el mismo ID', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: true,
        data: {
          total: 1,
          items: [{
            codigo: 1957,
            nombre: 'ALMERITERRA-BIO S.L.',
            nif: 'B13702956',
            cuenta_id: '40090001957',
            activo: 'S',
            bloqueado: 'N',
          }],
        },
      },
      error: null,
    } as never);

    const result = await localizarProveedorERP({
      nif: 'B13702956',
      nombre: 'ALMERITERRA-BIO S.L.',
      tipoFactura: 'GE',
    });
    const invocation = invokeMock.mock.calls[0]?.[1] as { body?: { consulta?: string } } | undefined;

    expect(result.erp_response?.resultado).toBe('ok');
    expect(result.erp_response?.datos).toMatchObject({
      codigo: 1957,
      nombre: 'ALMERITERRA-BIO S.L.',
      cuenta: '40090001957',
    });
    expect(invocation?.body?.consulta).toBe(
      'agricultores?nif=B13702956&activo=true&limit=25',
    );
  });

  it('usa el circuito confirmado de match_evidence solo cuando falta tipo explicito', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: true,
        data: {
          total: 1,
          items: [{
            codigo: 1957,
            nombre: 'ALMERITERRA-BIO S.L.',
            nif: 'B13702956',
            cuenta_id: '40090001957',
          }],
        },
      },
      error: null,
    } as never);

    const matchEvidence = {
      proveedor: {
        matched: true,
        provider_id: 1957,
        entity_type: 'agricultor',
      },
      erp_accounting: {
        proveedor_tipo: {
          source: 'erp_provider_detail',
          status: 'confirmed',
          provider_id: 1957,
          provider_type: 'agricultor',
        },
      },
    };
    await localizarProveedorERP({
      nif: 'B13702956',
      tipoFactura: null,
      matchEvidence,
    });
    const invocation = invokeMock.mock.calls[0]?.[1] as
      | { body?: { consulta?: string } }
      | undefined;

    expect(invocation?.body?.consulta).toBe(
      'agricultores?nif=B13702956&activo=true&limit=25',
    );

    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: true,
        data: { total: 0, items: [] },
      },
      error: null,
    } as never);
    await localizarProveedorERP({
      nif: 'B13702956',
      tipoFactura: null,
      matchEvidence,
      expectedProviderId: 17,
    });
    const mismatchedInvocation = invokeMock.mock.calls[1]?.[1] as
      | { body?: { consulta?: string } }
      | undefined;
    expect(mismatchedInvocation?.body?.consulta).toBe(
      'acreedores?nif=B13702956&activo=true&limit=25',
    );

    expect(facturaProveedorERPKind(null, matchEvidence)).toBe('agricultor');
    expect(facturaProveedorERPKind('OT', matchEvidence)).toBe('acreedor');
    expect(facturaProveedorERPKind(null, {
      proveedor: { matched: false, entity_type: 'agricultor' },
    })).toBe('acreedor');
    expect(facturaProveedorERPKind(null, {
      proveedor: { matched: true, provider_id: 1957, entity_type: 'agricultor' },
    }, 1957)).toBe('acreedor');
    expect(facturaProveedorERPKind(null, matchEvidence, 17)).toBe('acreedor');
  });

  it('no resuelve automaticamente un acreedor bloqueado aunque coincida el NIF', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: true,
        data: {
          total: 1,
          items: [{
            codigo: 17,
            nombre: 'ONDUSPAN, S.A.',
            nif: 'A04119293',
            cuenta_id: '41000000017',
            bloqueado: 'S',
            inactivo_rgpd: 'N',
          }],
        },
      },
      error: null,
    } as never);

    const result = await localizarProveedorERP({ nif: 'A04119293' });

    expect(result.ok).toBe(true);
    expect(result.erp_response?.resultado).toBe('manual_selection_required');
  });

  it('fuerza sin seleccionar los candidatos punteables aunque la API devuelva S', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: true,
        data: {
          items: [{
            source_table: 'albmaterial',
            source_id: 49305,
            S: 'S',
            Importe: 100,
          }],
        },
      },
      error: null,
    } as never);

    const result = await fetchFacturaPunteables({ empresaId: 1, proveedorId: 17 });

    expect(result).toHaveLength(1);
    expect(result[0]?.seleccionado).toBe(false);
    expect((invokeMock.mock.calls[0]?.[1] as { body?: { consulta?: string } })?.body?.consulta).toContain(
      'include_lines=false',
    );
  });

  it('recupera las referencias vivas sin solicitar ni persistir sus líneas', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: true,
        data: {
          items: [{
            id_interno_estable: 'AMA:23210',
            source_table: 'albmaterial',
            source_id: 23210,
            albaran_id: 23210,
            Origen: 'MA',
            Serie: 'A26',
            Albaran: 2108,
          }],
        },
      },
      error: null,
    } as never);

    const result = await fetchFacturaPunteosLive(49305);

    expect(result[0]).toMatchObject({
      source_table: 'albmaterial',
      source_id: 23210,
      lines_loaded: false,
    });
    expect(result[0]?.lines).toEqual([]);
    expect((invokeMock.mock.calls[0]?.[1] as { body?: { consulta?: string } })?.body?.consulta).toBe(
      'facturasrecibidas/49305/punteos?include_lines=false',
    );
  });

  it('consulta las líneas MA bajo demanda por su identidad técnica', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: true,
        data: {
          items: [{
            line_id: 53384,
            position: 1,
            article_id: 370,
            description: 'CC60x40x18',
            reference: 'MONTADA',
            quantity: '100.0000',
            unit_price: '0.901000',
            amount: '87.40',
          }],
        },
      },
      error: null,
    } as never);

    const result = await fetchAlbaranMaterialLineas(23210);

    expect(result).toEqual([expect.objectContaining({
      id: 53384,
      posicion: 1,
      articulo_id: 370,
      descripcion: 'CC60x40x18',
      cantidad: 100,
      precio: 0.901,
      importe: 87.4,
    })]);
    expect((invokeMock.mock.calls[0]?.[1] as { body?: { consulta?: string } })?.body?.consulta).toBe(
      'albaranes/material/23210/lineas',
    );
  });

  it('mantiene compatibilidad MA en facturas enlazadas mientras se promueve la nueva ruta', async () => {
    invokeMock
      .mockResolvedValueOnce({
        data: null,
        error: new Error('Ruta todavía no desplegada'),
      } as never)
      .mockResolvedValueOnce({
        data: {
          contract_version: 2,
          ok: true,
          data: {
            items: [{
              source_table: 'albmaterial',
              source_id: 23210,
              lines: [{
                line_id: 53384,
                position: 1,
                article_id: 370,
                description: 'CC60x40x18',
                quantity: '100.0000',
                unit_price: '0.901000',
                amount: '87.40',
              }],
            }],
          },
        },
        error: null,
      } as never);

    const result = await fetchAlbaranMaterialLineas(23210, 49305);

    expect(result[0]).toMatchObject({
      id: 53384,
      descripcion: 'CC60x40x18',
      importe: 87.4,
    });
    expect(invokeMock.mock.calls.map((call) =>
      (call[1] as { body?: { consulta?: string } })?.body?.consulta)).toEqual([
      'albaranes/material/23210/lineas',
      'facturasrecibidas/49305/punteos?include_lines=true',
    ]);
  });

  it('consulta y tipa las líneas vivas del albarán de entrada por su ID de cabecera', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: true,
        data: {
          items: [{
            id: 87097,
            albaran_id: 82548,
            linea: 0,
            partida: 10843601,
            genero_id: 161100,
            genero_nombre: 'SANDIA MINI',
            categoria_id: 0,
            categoria_nombre: null,
            categoria_calibre: null,
            categoria_calibre_nombre: null,
            envase_id: 701,
            envase_nombre: 'BOX PEQUEÑO',
            cultivo_id: 3966,
            tipo_cultivo_id: 1,
            tipo_cultivo_abreviatura: 'BIO',
            tipo_cultivo_nombre: 'ECOLOGICO',
            calidad_codigo: null,
            kilos_brutos: '24225.00',
            kilos_netos: '21194.00',
            palets: 0,
            bultos: 88,
            piezas: 0,
            precio: '0.00000',
            importe: '0.00',
          }],
        },
      },
      error: null,
    } as never);

    const result = await fetchAlbaranEntradaLineas(82548);

    expect(result).toEqual([expect.objectContaining({
      id: 87097,
      albaran_id: 82548,
      partida: 10843601,
      genero_nombre: 'SANDIA MINI',
      tipo_cultivo_abreviatura: 'BIO',
      tipo_cultivo_nombre: 'ECOLOGICO',
      kilos_netos: 21194,
      importe: 0,
    })]);
    expect(invokeMock).toHaveBeenCalledWith('facturas-recibidas-erp-read', {
      body: expect.objectContaining({
        contract_version: 2,
        consulta: 'albaranes/entrada/82548/lineas',
      }),
    });
  });

  it('rechaza un ID técnico de albarán inválido sin llamar a la API', async () => {
    await expect(fetchAlbaranEntradaLineas(0)).rejects.toThrow(
      'El albarán no tiene una identidad ERP válida.',
    );
    await expect(fetchAlbaranMaterialLineas(0)).rejects.toThrow(
      'El albarán de material no tiene una identidad ERP válida.',
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('exige seleccion manual cuando el nombre exacto normalizado es ambiguo', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: true,
        data: {
          total: 2,
          items: [
            { codigo: 17, nombre: 'ONDUSPAN, S.A.', nif: 'A04119293' },
            { codigo: 18, nombre: 'Onduspan S A', nif: 'B04119293' },
          ],
        },
      },
      error: null,
    } as never);

    const result = await localizarProveedorERP({ nombre: 'ONDUSPAN S.A.' });

    expect(result.ok).toBe(true);
    expect(result.erp_response?.resultado).toBe('manual_selection_required');
    expect(result.erp_response?.datos).toContain('Selecciona el proveedor manualmente');
  });

  it('mantiene warnings como avisos no bloqueantes en lista y preview', () => {
    const validation = partitionFacturaValidationIssues([
      { code: 'fecha_ctb_revisar', field: 'FRR_fechactb', message: 'Revisa fecha CTB.', severity: 'warning' },
    ]);

    expect(validation.errors).toEqual([]);
    expect(validation.warnings).toHaveLength(1);
    expect(validation.issues[0]?.severity).toBe('warning');
  });

  it('no confirma un envio con readback reference_only o estado desconocido', () => {
    expect(getFacturaERPSendConfirmation({
      estado: 'enviada_erp',
      remote_frr_id: 49305,
      accounting_status: 'reference_only',
    })).toBe('reference_only');
    expect(getFacturaERPSendConfirmation({
      estado: 'enviada_erp',
      remote_frr_id: 49305,
      sync_status: 'unknown',
    })).toBe('reconciling');
    expect(getFacturaERPSendConfirmation({ estado: 'enviada_erp', remote_frr_id: null })).toBe('unconfirmed');
    expect(getFacturaERPSendConfirmation({
      estado: 'enviada_erp',
      sync_status: 'sent',
      remote_frr_id: 49305,
      erp_reference_status: 'valid',
      erp_target_id: 'netagro-test-write',
      erp_dataset_epoch: 'epoch-actual',
      erp_verified_at: '2026-07-30T12:00:00Z',
    })).toBe('confirmed');
  });

  it('solo reutiliza un request_id valido en estados de reconciliacion', () => {
    const requestId = 'c2caa09c-3574-46f7-9b47-11c6651b8e55';
    expect(getFacturaERPReconciliationRequestId({ sync_status: 'unknown', last_request_id: requestId })).toBe(requestId);
    expect(getFacturaERPReconciliationRequestId({ sync_status: 'reconciling', last_request_id: requestId })).toBe(requestId);
    expect(getFacturaERPReconciliationRequestId({ sync_status: 'sent', last_request_id: requestId })).toBeNull();
    expect(getFacturaERPReconciliationRequestId({ sync_status: 'unknown', last_request_id: 'nuevo-id' })).toBeNull();
  });

  it('deduplica por campo y conserva la severidad mas bloqueante', () => {
    const issues = normalizeFacturaValidationIssues([
      { field: 'FRR_fechactb', message: 'Revisa la fecha CTB.', severity: 'warning' },
      { field: 'FRR_fechactb', message: 'Falta fecha CTB.', severity: 'error' },
      { code: 'regimen_requerido', field: 'FRR_idregimen', message: 'Falta regimen.', severity: 'warning' },
      { code: 'regla_regimen_ausente', field: 'FRR_idregimen', message: 'Falta regla de regimen.', severity: 'warning' },
    ]);

    expect(issues).toHaveLength(2);
    expect(issues.find((issue) => issue.field === 'FRR_fechactb')?.severity).toBe('error');
    expect(issues.find((issue) => issue.code === 'regimen_requerido')?.severity).toBe('warning');
  });

  it('conserva avisos globales de causas distintas y elimina duplicados textuales', () => {
    const issues = normalizeFacturaValidationIssues([
      {
        field: 'metadata.warnings',
        message: 'El OCR no pudo leer una referencia visible.',
        severity: 'warning',
      },
      {
        field: 'metadata.warnings',
        message: 'No se pudo consultar /acreedores. La resolucion queda pendiente.',
        severity: 'warning',
      },
      {
        field: 'metadata.warnings',
        message: '  NO SE PUDO CONSULTAR /ACREEDORES. LA RESOLUCION QUEDA PENDIENTE.  ',
        severity: 'warning',
      },
    ]);

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.message)).toEqual([
      'El OCR no pudo leer una referencia visible.',
      'No se pudo consultar /acreedores. La resolucion queda pendiente.',
    ]);
  });

  it('construye el duplicado con ejercicio ERP 25 y no lo deriva como 26', () => {
    const query25 = buildFacturaDuplicateConsulta({
      empresaId: 1,
      ejercicio: 25,
      proveedorId: 17,
      numeroFactura: 'A-00748886',
      tipoFactura: 'ot',
    });
    const query26 = buildFacturaDuplicateConsulta({
      empresaId: 1,
      ejercicio: 26,
      proveedorId: 17,
      numeroFactura: 'A-00748886',
      tipoFactura: 'OT',
    });

    expect(query25).toBe(
      'facturasrecibidas/buscar?empresa_id=1&ejercicio=25&proveedor_id=17&numero_factura=A-00748886&tipo_factura=OT',
    );
    expect(query26).toContain('ejercicio=26');
    expect(query25).not.toBe(query26);
  });

  it('prioriza el importe asignado a factura al total bruto del punteo', () => {
    expect(getPunteoImporte({
      importe_factura: 87.4,
      importe: 999,
      importe_punteado: 888,
    })).toBe(87.4);
    expect(getPunteoImporte({
      importe_factura: 0,
      importe: 999,
    })).toBe(0);
    expect(getPunteoImporte({
      importe_factura: null,
      importe: 12.5,
      importe_punteado: 11,
    })).toBe(12.5);
  });

  it('distingue proveedor inexistente de API no disponible', async () => {
    invokeMock
      .mockResolvedValueOnce({
        data: { contract_version: 2, ok: true, data: {} },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: { contract_version: 2, ok: true, data: { items: [] } },
        error: null,
      } as never);

    const notFound = await preflightFacturaRecibidaERP(facturaPreflight);
    expect(notFound.issues.map((issue) => issue.code)).toContain('proveedor_no_encontrado');
    expect(notFound.issues.map((issue) => issue.code)).not.toContain('proveedor_api_no_disponible');

    invokeMock.mockReset();
    invokeMock.mockResolvedValueOnce({ data: null, error: new Error('Conexion rechazada') } as never);

    const unavailable = await preflightFacturaRecibidaERP(facturaPreflight);
    expect(unavailable.issues.map((issue) => issue.code)).toContain('proveedor_api_no_disponible');
    expect(unavailable.issues.map((issue) => issue.code)).not.toContain('proveedor_no_encontrado');
  });

  it('prevalida GE contra el detalle de agricultores', async () => {
    invokeMock
      .mockResolvedValueOnce({
        data: {
          contract_version: 2,
          ok: true,
          data: {
            codigo: 1957,
            nombre: 'ALMERITERRA-BIO S.L.',
            nif: 'B13702956',
            cuenta_id: '40090001957',
          },
        },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: { contract_version: 2, ok: true, data: { items: [] } },
        error: null,
      } as never);

    const result = await preflightFacturaRecibidaERP({
      ...facturaPreflight,
      fr_sufa: 'GE',
      proveedor_codigo: '1957',
      proveedor_cuenta: '40090001957',
      numero_factura: 'FTV26/217',
    });
    const providerInvocation = invokeMock.mock.calls[0]?.[1] as {
      body?: { consulta?: string };
    } | undefined;

    expect(providerInvocation?.body?.consulta).toBe('agricultores/1957');
    expect(result.provider).toMatchObject({
      codigo: 1957,
      nombre: 'ALMERITERRA-BIO S.L.',
      cuenta: '40090001957',
    });
    expect(result.issues).toEqual([]);
  });

  it('prevalida el circuito GE confirmado aunque la cabecera aun no tenga tipo', async () => {
    invokeMock
      .mockResolvedValueOnce({
        data: {
          contract_version: 2,
          ok: true,
          data: {
            codigo: 1957,
            nombre: 'ALMERITERRA-BIO S.L.',
            nif: 'B13702956',
            cuenta_id: '40090001957',
          },
        },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: { contract_version: 2, ok: true, data: { items: [] } },
        error: null,
      } as never);

    const result = await preflightFacturaRecibidaERP({
      ...facturaPreflight,
      fr_sufa: null,
      proveedor_codigo: '1957',
      proveedor_cuenta: '40090001957',
      numero_factura: 'FTV26/217',
      match_evidence: {
        proveedor: {
          matched: true,
          provider_id: 1957,
          entity_type: 'agricultor',
        },
        erp_accounting: {
          proveedor_tipo: {
            source: 'erp_provider_detail',
            status: 'confirmed',
            provider_id: 1957,
            provider_type: 'agricultor',
          },
        },
      },
    });
    const providerConsulta = (
      invokeMock.mock.calls[0]?.[1] as { body?: { consulta?: string } }
    )?.body?.consulta;
    const duplicateConsulta = (
      invokeMock.mock.calls[1]?.[1] as { body?: { consulta?: string } }
    )?.body?.consulta;

    expect(providerConsulta).toBe('agricultores/1957');
    expect(duplicateConsulta).toContain('tipo_factura=GE');
    expect(result.issues).toEqual([]);
  });

  it('bloquea una cuenta distinta de la maestra y muestra el candidato duplicado', async () => {
    invokeMock
      .mockResolvedValueOnce({
        data: {
          contract_version: 2,
          ok: true,
          data: {
            codigo: 17,
            nombre: 'ONDUSPAN, S.A.',
            cuenta_id: '41000000999',
          },
        },
        error: null,
      } as never)
      .mockResolvedValueOnce({
        data: {
          contract_version: 2,
          ok: true,
          data: {
            items: [{
              FRR_id: 49305,
              FRR_Idempresa: 1,
              FRR_ejercicio: 25,
              FRR_idproveedor: 17,
              FRR_numerofactura: 'A-00748886',
            }],
          },
        },
        error: null,
      } as never);

    const result = await preflightFacturaRecibidaERP(facturaPreflight);

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['cuenta_proveedor_no_coincide', 'factura_duplicada_erp']),
    );
    expect(result.duplicate).toMatchObject({
      frrId: 49305,
      empresaId: 1,
      ejercicio: 25,
      proveedorId: 17,
      numeroFactura: 'A-00748886',
    });
  });
});

describe('labelTipoFactura', () => {
  it('usa el texto literal confirmado por Campojoyma', () => {
    expect(labelTipoFactura('OT')).toBe('OT — OTROS');
    expect(labelTipoFactura('GE')).toBe('GE — COMPRAS GENERO');
    expect(labelTipoFactura('FZ')).toBe('FZ — FIANZA');
  });

  it('deja el codigo pelado cuando el cliente no dio descripcion', () => {
    // FI, CE y GM aparecen sin descripcion incluso en la lista oficial.
    expect(labelTipoFactura('FI')).toBe('FI');
    expect(labelTipoFactura('CE')).toBe('CE');
    expect(labelTipoFactura('GM')).toBe('GM');
  });

  it('no inventa descripciones para codigos desconocidos', () => {
    expect(labelTipoFactura('ZZ')).toBe('ZZ');
  });
});

describe('tipoFacturaRadioValue', () => {
  it('mapea el selector binario a compras de genero o acreedores', () => {
    expect(tipoFacturaRadioValue('GE')).toBe('GE');
    expect(tipoFacturaRadioValue('OT')).toBe('OT');
    expect(tipoFacturaRadioValue('MA')).toBe('OT');
    expect(tipoFacturaRadioValue('GV')).toBe('OT');
    expect(tipoFacturaRadioValue(null)).toBe('');
  });

  it('usa una evidencia confirmada solo como fallback si falta cabecera', () => {
    const agricultorMatch = {
      proveedor: { matched: true, provider_id: 1957, entity_type: 'agricultor' },
      erp_accounting: {
        proveedor_tipo: {
          source: 'erp_provider_detail',
          status: 'confirmed',
          provider_id: 1957,
          provider_type: 'agricultor',
        },
      },
    };
    const acreedorMatch = {
      proveedor: { matched: true, provider_id: 17, entity_type: 'acreedor' },
      erp_accounting: {
        proveedor_tipo: {
          source: 'erp_provider_detail',
          status: 'confirmed',
          provider_id: 17,
          provider_type: 'acreedor',
        },
      },
    };

    expect(tipoFacturaRadioValue(null, agricultorMatch, 1957)).toBe('GE');
    expect(tipoFacturaRadioValue(null, acreedorMatch, 17)).toBe('OT');
    expect(tipoFacturaRadioValue('OT', agricultorMatch, 1957)).toBe('OT');
    expect(tipoFacturaRadioValue(null, agricultorMatch, 17)).toBe('');
    expect(tipoFacturaRadioValue(null, {
      proveedor: { matched: false, entity_type: 'agricultor' },
    })).toBe('');
    expect(tipoFacturaRadioValue(null, {
      proveedor: { matched: true, provider_id: 1957, entity_type: 'agricultor' },
    }, 1957)).toBe('');
  });
});

describe('catálogos y líneas contables de facturas', () => {
  it('normaliza y ordena los porcentajes IVA, incluyendo siempre el 0 %', () => {
    expect(
      normalizeFacturaTiposIva({
        items: [
          { id: 2, nombre: 'General', iva: '21.00' },
          { id: 1, nombre: 'SuperReducido', iva: '4.00' },
          { id: 3, nombre: 'Reducido', iva: '10.00' },
          { id: 20, nombre: 'General duplicado', iva: '21.00' },
        ],
      }),
    ).toMatchObject([
      { porcentaje: 0 },
      { porcentaje: 4 },
      { porcentaje: 10 },
      { porcentaje: 21 },
    ]);
  });

  it('garantiza 0, 4, 10 y 21 aunque el catálogo no los devuelva', () => {
    expect(
      normalizeFacturaTiposIva({
        items: [{ nombre: 'Histórico especial', iva: '5.5' }],
      }).map((option) => option.porcentaje),
    ).toEqual([0, 4, 5.5, 10, 21]);
  });

  it('filtra las filas CTB completamente vacías del payload', () => {
    expect(
      buildCtbPayload([
        { posicion: 1, descripcion: '', importe: 0 },
        { posicion: 2, descripcion: '60200000001', importe: 50 },
      ]),
    ).toEqual([
      expect.objectContaining({
        posicion: 1,
        FRC_Cuenta: '60200000001',
        FRC_Importe: 50,
      }),
    ]);
  });

  it('bloquea pares incompletos de cuenta e importe en gastos y CTB', () => {
    const issues = validateFacturaAccountPairs({
      gastos: [{ posicion: 1, descripcion: '', importe: 15 }],
      ctb: [
        { posicion: 1, descripcion: '60200000001', importe: 0 },
        {
          posicion: 2,
          descripcion: '',
          importe: 0,
          FRC_IdActividad: 7,
        },
      ],
    });

    expect(issues.map((issue) => issue.code)).toEqual([
      'gasto_cuenta_requerida',
      'ctb_importe_requerido',
      'ctb_cuenta_requerida',
    ]);
  });
});

describe('runtime ERP de facturas', () => {
  it('usa la capacidad autenticada del Edge sin inferir contabilidad', async () => {
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 3,
        ok: true,
        runtime: {
          target_id: 'netagro-test-write',
          dataset_epoch: 'epoch-actual',
          snapshot_at: '2026-07-30T12:00:00Z',
          write_mode: 'management',
          accounting_mode: 'unavailable',
          ready_for_commit: true,
          capabilities: {
            validate: true,
            management_commit: true,
            accounting_commit: false,
          },
        },
      },
      error: null,
    } as never);

    await expect(fetchFacturasRecibidasERPRuntime()).resolves.toMatchObject({
      target_id: 'netagro-test-write',
      dataset_epoch: 'epoch-actual',
      accounting_mode: 'unavailable',
      capabilities: {
        accounting_commit: false,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'facturas-recibidas-erp-runtime',
      expect.objectContaining({
        body: expect.objectContaining({
          contract_version: 3,
          request_id: expect.any(String),
        }),
      }),
    );
  });
});
