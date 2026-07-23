import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

import { supabase } from '@/integrations/supabase/client';
import { facturasRecibidas, mapPunteo } from '@/services/facturasRecibidas';
import type { FacturaRecibida } from '@/types/facturasRecibidas';

const invokeMock = vi.mocked(supabase.functions.invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mapeo de punteos', () => {
  it('mantiene sin seleccionar una fila legacy cuyo indicador S sea nulo', () => {
    expect(mapPunteo({
      id: 'punteo-legacy',
      factura_id: 'factura-legacy',
      posicion: 1,
      S: null,
    } as never).S).toBe(false);
  });
});

describe('FacturasRecibidasService.sendToERP', () => {
  it('recarga y devuelve el estado persistido ante un 202 de reconciliacion', async () => {
    const persisted = {
      id: 'factura-202',
      row_version: 8,
      sync_status: 'reconciling',
      accounting_status: 'reference_only',
      ctb: [],
      punteos: [],
      asientos: [],
    } as FacturaRecibida;
    const getByIdSpy = vi.spyOn(facturasRecibidas, 'getById').mockResolvedValue(persisted);
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        request_id: 'request-202',
        ok: false,
        reconciliation_required: true,
        error: 'La factura fue escrita, pero su lectura completa no esta confirmada.',
      },
      error: null,
    } as never);

    const result = await facturasRecibidas.sendToERP('factura-202', 7);

    expect(getByIdSpy).toHaveBeenCalledOnce();
    expect(getByIdSpy).toHaveBeenCalledWith('factura-202');
    expect(result).toBe(persisted);
    expect(result.sync_status).toBe('reconciling');
    expect(result.accounting_status).toBe('reference_only');
  });

  it('lanza el error terminal sin recargar la factura', async () => {
    const getByIdSpy = vi.spyOn(facturasRecibidas, 'getById');
    invokeMock.mockResolvedValueOnce({
      data: {
        contract_version: 2,
        ok: false,
        reconciliation_required: false,
        error: 'El proveedor no supera la validacion ERP.',
      },
      error: null,
    } as never);

    await expect(facturasRecibidas.sendToERP('factura-terminal', 4)).rejects.toThrow(
      'El proveedor no supera la validacion ERP.',
    );
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it('reutiliza el request_id original al reconciliar sin crear otro intento de escritura', async () => {
    const persisted = {
      id: 'factura-reconcile',
      row_version: 9,
      sync_status: 'sent',
      remote_frr_id: 49305,
      ctb: [],
      punteos: [],
      asientos: [],
    } as FacturaRecibida;
    vi.spyOn(facturasRecibidas, 'getById').mockResolvedValue(persisted);
    invokeMock.mockResolvedValueOnce({ data: { ok: true }, error: null } as never);

    await facturasRecibidas.sendToERP('factura-reconcile', 8, 'c2caa09c-3574-46f7-9b47-11c6651b8e55');

    expect(invokeMock).toHaveBeenCalledWith('factura-recibida-send-erp', {
      body: {
        contract_version: 2,
        request_id: 'c2caa09c-3574-46f7-9b47-11c6651b8e55',
        factura_id: 'factura-reconcile',
        expected_version: 8,
      },
    });
  });
});
