import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

import { supabase } from '@/integrations/supabase/client';
import {
  FacturaERPServiceError,
  facturasRecibidas,
  mapPunteo,
} from '@/services/facturasRecibidas';
import type { FacturaRecibida } from '@/types/facturasRecibidas';

const invokeMock = vi.mocked(supabase.functions.invoke);
const fromMock = vi.mocked(supabase.from);

beforeEach(() => {
  invokeMock.mockReset();
  fromMock.mockReset();
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

describe('FacturasRecibidasService ERP v3', () => {
  it('valida con contrato v3 sin ejecutar un commit', async () => {
    const persisted = {
      id: 'factura-validate',
      row_version: 5,
      erp_validation_status: 'valid',
      erp_validation_request_id: '857a3a94-35ca-4d23-a52c-822f22b450ab',
      ctb: [],
      punteos: [],
      asientos: [],
    } as FacturaRecibida;
    vi.spyOn(facturasRecibidas, 'getById').mockResolvedValue(persisted);
    invokeMock.mockResolvedValueOnce({ data: { ok: true }, error: null } as never);

    await facturasRecibidas.validateERP(
      'factura-validate',
      4,
      '857a3a94-35ca-4d23-a52c-822f22b450ab',
    );

    expect(invokeMock).toHaveBeenCalledWith('factura-recibida-send-erp', {
      body: {
        contract_version: 3,
        operation: 'validate',
        request_id: '857a3a94-35ca-4d23-a52c-822f22b450ab',
        factura_id: 'factura-validate',
        expected_version: 4,
      },
    });
  });

  it('muestra solo user_message y nunca technical_details o webhooks', async () => {
    const getByIdSpy = vi.spyOn(facturasRecibidas, 'getById');
    invokeMock.mockResolvedValueOnce({
      data: {
        detail: {
          code: 'writer_disabled',
          category: 'environment',
          user_message: 'El envío al ERP está deshabilitado temporalmente.',
          retryable: false,
          reconciliation_required: false,
          request_id: 'request-error-server',
          target_id: 'netagro-test-write',
          dataset_epoch: 'epoch-actual',
          technical_details: {
            webhook: 'POST apiCampojoyma-facturas-write-v2',
            endpoint: '/internal/facturasrecibidas',
          },
        },
      },
      error: new Error('FunctionsHttpError'),
    } as never);

    let caught: unknown;
    try {
      await facturasRecibidas.validateERP('factura-error', 4, 'request-error');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FacturaERPServiceError);
    expect(caught).toMatchObject({
      code: 'writer_disabled',
      category: 'environment',
      retryable: false,
      reconciliationRequired: false,
      requestId: 'request-error-server',
      targetId: 'netagro-test-write',
      datasetEpoch: 'epoch-actual',
    });
    const visibleMessage =
      caught instanceof Error ? caught.message : String(caught);
    expect(visibleMessage).toBe(
      'El envío al ERP está deshabilitado temporalmente. Solicitud: request-error-server.',
    );
    expect(visibleMessage).not.toContain('technical_details');
    expect(visibleMessage.toLowerCase()).not.toContain('webhook');
    expect(visibleMessage).not.toContain('/internal/');
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

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

    const result = await facturasRecibidas.commitERP('factura-202', 7);

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

    const operation = facturasRecibidas.commitERP(
      'factura-terminal',
      4,
      'request-terminal',
    );
    await expect(operation).rejects.toMatchObject({
      name: 'FacturaERPServiceError',
      code: 'upstream_unavailable',
      category: 'transport',
      retryable: false,
      reconciliationRequired: false,
      requestId: 'request-terminal',
    } satisfies Partial<FacturaERPServiceError>);
    await expect(operation).rejects.toThrow(
      'El proveedor no supera la validacion ERP. Solicitud: request-terminal.',
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

    await facturasRecibidas.reconcileERP('factura-reconcile', 8, 'c2caa09c-3574-46f7-9b47-11c6651b8e55');

    expect(invokeMock).toHaveBeenCalledWith('factura-recibida-send-erp', {
      body: {
        contract_version: 3,
        operation: 'reconcile',
        request_id: 'c2caa09c-3574-46f7-9b47-11c6651b8e55',
        factura_id: 'factura-reconcile',
        expected_version: 8,
      },
    });
  });
});

const createListQueryMock = () => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  [
    'select',
    'not',
    'eq',
    'filter',
    'or',
    'neq',
    'is',
    'ilike',
    'gte',
    'lte',
    'order',
  ].forEach((method) => {
    query[method] = vi.fn(() => query);
  });
  query.range = vi.fn().mockResolvedValue({
    data: [],
    count: 0,
    error: null,
  });
  return query;
};

describe('filtros de registro ERP', () => {
  it('solo cuenta como enviada una referencia validada y con sync sent', async () => {
    const query = createListQueryMock();
    fromMock.mockReturnValue(query as never);

    await facturasRecibidas.list({
      page: 1,
      pageSize: 25,
      erpStatus: 'sent',
    });

    expect(query.filter).toHaveBeenCalledWith(
      'erp_reference_status',
      'eq',
      'valid',
    );
    expect(query.eq).toHaveBeenCalledWith('sync_status', 'sent');
    expect(query.not).toHaveBeenCalledWith('erp_target_id', 'is', null);
    expect(query.not).toHaveBeenCalledWith(
      'erp_dataset_epoch',
      'is',
      null,
    );
    expect(query.not).toHaveBeenCalledWith('remote_frr_id', 'is', null);
    expect(query.not).toHaveBeenCalledWith('erp_verified_at', 'is', null);
  });

  it('incluye stale y legacy dentro de no confirmado', async () => {
    const query = createListQueryMock();
    fromMock.mockReturnValue(query as never);

    await facturasRecibidas.list({
      page: 1,
      pageSize: 25,
      erpStatus: 'not_sent',
    });

    expect(query.or).toHaveBeenCalledWith(
      'sync_status.neq.sent,sync_status.is.null,erp_reference_status.neq.valid,erp_reference_status.is.null,erp_target_id.is.null,erp_dataset_epoch.is.null,remote_frr_id.is.null,erp_verified_at.is.null',
    );
  });
});
