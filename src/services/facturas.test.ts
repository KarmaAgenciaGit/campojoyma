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
  buildERPWebhookPayloadPreview,
  buildFacturaDuplicateConsulta,
  buildFacturaPayload,
  buildPunteosPayload,
  fetchFacturaPunteables,
  getFacturaERPSendConfirmation,
  getFacturaERPReconciliationRequestId,
  mapProveedorERPDetail,
  getFunctionInvokeErrorMessage,
  isERPReferenceFactura,
  isERPReadOnlyFactura,
  localizarProveedorERP,
  mapFacturaToUi,
  mapRemoteFacturaToUi,
  normalizeFacturaValidationIssues,
  partitionFacturaValidationIssues,
  preflightFacturaRecibidaERP,
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

  it('recupera la identidad ERP confirmada de FRR_id para registros finalizados antiguos', () => {
    const factura = mapFacturaToUi({
      id: 'factura-finalizada-antigua',
      estado: 'enviada_erp',
      sync_status: 'sent',
      FRR_id: 49305,
      remote_frr_id: null,
      validation_errors: [],
      asientos: [],
      ctb: [],
      punteos: [],
    } as never);

    expect(factura.remote_frr_id).toBe(49305);
    expect(getFacturaERPSendConfirmation(factura)).toBe('confirmed');
  });
});

describe('modelo reversible de facturas recibidas', () => {
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
    expect(isERPReadOnlyFactura(factura)).toBe(true);
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

  it('previsualiza el contrato estricto con solo punteos seleccionados', () => {
    const preview = buildERPWebhookPayloadPreview({
      ...onduSpanHeader,
      id: 'factura-preview',
      ctb: [{
        FRC_id: 91,
        FRC_idfacturarecibida: 49305,
        FRC_Cuenta: '60200000001',
        FRC_Importe: 42341.52,
        FRC_IdUsuarioLog: 7,
        FRC_FechaLog: '2026-07-22',
        FRC_HoraLog: '10:00:00',
      }],
      punteos: [
        {
          S: false,
          source_table: 'albmaterial',
          source_id: 1,
          importe_factura: 10,
          Origen: 'MA',
        },
        {
          S: true,
          source_table: 'ALBMATERIAL',
          source_id: 2,
          importe_factura: null,
          Origen: 'MA',
          Ref: 'no-enviar',
        },
      ],
    } as never);

    expect(preview).not.toHaveProperty('factura');
    expect(preview).not.toHaveProperty('operation');
    expect(preview.cabecera).not.toHaveProperty('FRR_id');
    expect(preview.cabecera).not.toHaveProperty('FRR_numero');
    expect(preview.cabecera).not.toHaveProperty('FRR_IdAsientoNet');
    expect(preview.cabecera).not.toHaveProperty('FRR_IdUsuarioLog');
    expect(preview.ctb[0]).toEqual({
      FRC_Cuenta: '60200000001',
      FRC_Importe: 42341.52,
      FRC_IdActividad: null,
      FRC_Idseccion: null,
      FRC_Iddepartamento: null,
      FRC_Idsubdepartamento: null,
    });
    expect(preview.punteos).toEqual([{
      source_table: 'albmaterial',
      source_id: 2,
    }]);
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
    const preview = buildERPWebhookPayloadPreview({
      ...cabecera,
      id: 'pdf-nuevo-revisado',
      ctb: [],
      punteos: [],
    } as never);

    expect(preview).toEqual(expect.objectContaining({
      contract_version: 2,
      request_id: 'pdf-nuevo-revisado',
      dry_run: true,
      ctb: [],
      punteos: [],
    }));
    expect(preview.cabecera).toMatchObject({
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
    expect(preview.cabecera).not.toHaveProperty('FRR_id');
    expect(preview.cabecera).not.toHaveProperty('FRR_numero');
    expect(preview.cabecera).not.toHaveProperty('FRR_IdAsientoNet');
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
        lines: [],
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
  });

  it('bloquea también estados de envío indeterminados aunque aún no exista FRR_id', () => {
    expect(isERPReadOnlyFactura({ sync_status: 'unknown' })).toBe(true);
    expect(isERPReadOnlyFactura({ sync_status: 'reconciling' })).toBe(true);
    expect(isERPReadOnlyFactura({ sync_status: 'error', erp_factura_id: null })).toBe(false);
  });

  it('distingue una referencia ERP de una factura entrante real ya enviada', () => {
    expect(isERPReferenceFactura({ source_kind: 'erp_reference', is_readonly_reference: true })).toBe(true);
    expect(isERPReferenceFactura({ source_kind: 'n8n_draft', sync_status: 'sent', remote_frr_id: 49399 })).toBe(false);
    expect(isERPReadOnlyFactura({ source_kind: 'n8n_draft', sync_status: 'sent', remote_frr_id: 49399 })).toBe(true);
  });

  it('limita la bandeja a PDFs procesados y excluye referencias o fixtures manuales', () => {
    expect(isFacturaRecibidaInboxSourceKind('n8n_draft')).toBe(true);
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
    expect(getFacturaERPSendConfirmation({ estado: 'enviada_erp', remote_frr_id: 49305 })).toBe('confirmed');
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
    });
    const query26 = buildFacturaDuplicateConsulta({
      empresaId: 1,
      ejercicio: 26,
      proveedorId: 17,
      numeroFactura: 'A-00748886',
    });

    expect(query25).toBe(
      'facturasrecibidas/buscar?empresa_id=1&ejercicio=25&proveedor_id=17&numero_factura=A-00748886',
    );
    expect(query26).toContain('ejercicio=26');
    expect(query25).not.toBe(query26);
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
