// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: invokeMock },
  },
}));

import { fetchFacturaCuentaIvaHistorica } from './facturas';

const filtros = {
  empresa_id: 1,
  ejercicio: 25,
  regimen_id: 2110,
  tipo_factura: 'OT',
  porcentaje: 21,
  proveedor_id: null,
};

const criterio = {
  min_facturas: 3,
  min_confianza: 0.98,
  requiere_lider_unico: true,
  origen: 'asientos_reales_enlazados_FR',
  coincidencia_importe: 'apunte_472_unico_coincide_con_cuota_iva',
};

beforeEach(() => {
  invokeMock.mockReset();
  vi.stubGlobal('crypto', { randomUUID: () => 'request-cuenta-iva' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchFacturaCuentaIvaHistorica', () => {
  it('consulta el contexto contable completo y normaliza una cuenta resuelta', async () => {
    invokeMock.mockResolvedValue({
      data: {
        contract_version: 2,
        ok: true,
        data: {
          estado: 'resuelta',
          cuenta: '47200000008',
          descripcion: 'IVA SOPORTADO 21%',
          usos_facturas: 28335,
          total_facturas: 28335,
          confianza: 1,
          criterio,
          alternativas: [],
          filtros,
        },
      },
      error: null,
    });

    const result = await fetchFacturaCuentaIvaHistorica({
      empresaId: 1,
      ejercicio: 25,
      regimenId: 2110,
      tipoFactura: 'ot',
      porcentaje: 21,
    });

    expect(invokeMock).toHaveBeenCalledWith('facturas-recibidas-erp-read', {
      body: {
        contract_version: 2,
        request_id: 'request-cuenta-iva',
        consulta:
          'facturasrecibidas/cuentas-iva-historicas?empresa_id=1&ejercicio=25&regimen_id=2110&tipo_factura=OT&porcentaje=21',
      },
    });
    expect(result).toMatchObject({
      estado: 'resuelta',
      cuenta: '47200000008',
      descripcion: 'IVA SOPORTADO 21%',
      usosFacturas: 28335,
      totalFacturas: 28335,
      confianza: 1,
      filtros: {
        empresaId: 1,
        ejercicio: 25,
        regimenId: 2110,
        tipoFactura: 'OT',
        porcentaje: 21,
        proveedorId: null,
      },
      criterio: {
        minFacturas: 3,
        minConfianza: 0.98,
        requiereLiderUnico: true,
        origen: 'asientos_reales_enlazados_FR',
        coincidenciaImporte: 'apunte_472_unico_coincide_con_cuota_iva',
      },
    });
  });

  it('conserva la evidencia ambigua pero no expone una candidata como cuenta resuelta', async () => {
    invokeMock.mockResolvedValue({
      data: {
        estado: 'ambiguo',
        cuenta: '47200000008',
        descripcion: 'candidata dominante',
        usos_facturas: 8,
        total_facturas: 10,
        confianza: 0.8,
        criterio,
        alternativas: [
          {
            cuenta: '47200000010',
            descripcion: 'IVA INTRACOMUNITARIO',
            usos_facturas: 2,
            confianza: 0.2,
          },
        ],
        filtros,
      },
      error: null,
    });

    const result = await fetchFacturaCuentaIvaHistorica({
      empresaId: 1,
      ejercicio: 25,
      regimenId: 2110,
      tipoFactura: 'OT',
      porcentaje: 21,
    });

    expect(result.cuenta).toBeNull();
    expect(result.descripcion).toBeNull();
    expect(result.alternativas).toEqual([
      {
        cuenta: '47200000010',
        descripcion: 'IVA INTRACOMUNITARIO',
        usosFacturas: 2,
        confianza: 0.2,
      },
    ]);
  });

  it('rechaza una respuesta que pertenezca a otro contexto', async () => {
    invokeMock.mockResolvedValue({
      data: {
        estado: 'sin_historial',
        cuenta: null,
        descripcion: null,
        usos_facturas: 0,
        total_facturas: 0,
        confianza: null,
        criterio,
        alternativas: [],
        filtros: { ...filtros, regimen_id: 2113 },
      },
      error: null,
    });

    await expect(
      fetchFacturaCuentaIvaHistorica({
        empresaId: 1,
        ejercicio: 25,
        regimenId: 2110,
        tipoFactura: 'OT',
        porcentaje: 21,
      }),
    ).rejects.toThrow('no corresponde a los filtros solicitados');
  });
});
