import { describe, expect, it, vi } from 'vitest';

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
  buildFacturaPayload,
  buildPunteosPayload,
  isERPReadOnlyFactura,
  mapFacturaToUi,
  mapRemoteFacturaToUi,
} from '@/services/facturas';
import type { FacturaRecibidaLinea } from '@/services/apiContracts';

const onduSpanHeader = {
  FRR_id: 49305,
  FRR_numero: 5052,
  FRR_ejercicio: 2026,
  FRR_idproveedor: 17,
  FRR_idcuenta: '41000000017',
  FRR_numerofactura: 'A-00748886',
  FRR_fechafactura: '2026-06-30',
  FRR_fechactb: '2026-06-30',
  FRR_Idempresa: 1,
  FRR_idregimen: 2110,
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
    expect(factura.asiento_tecnico).toBe(390305);
    expect(factura.asiento_numero).toBeNull();
    expect(factura.asiento_estado).toBe('reference_only');
    expect(factura.asiento_lineas).toHaveLength(0);
    expect(factura.punteos).toHaveLength(17);
    expect(factura.punteos?.reduce((sum, item) => sum + Number(item.line_count ?? 0), 0)).toBe(21);
    expect(factura.punteos?.reduce((sum, item) => sum + Number(item.importe_factura ?? 0), 0)).toBe(42341.52);
    expect(isERPReadOnlyFactura(factura)).toBe(true);
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
});
