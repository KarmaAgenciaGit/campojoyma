import { describe, expect, it } from 'vitest';

import { getFacturaAccountingStatusText } from '@/lib/facturasAccountingStatus';

describe('estado contable independiente', () => {
  const unavailableRuntime = {
    accounting_mode: 'unavailable',
    capabilities: { accounting_commit: false },
  } as const;

  it('muestra No disponible cuando lo declara la capacidad global', () => {
    expect(
      getFacturaAccountingStatusText(
        { accounting_status: 'not_requested' },
        unavailableRuntime,
      ),
    ).toBe('No disponible');
  });

  it('conserva los estados reales de cada factura sobre la capacidad global', () => {
    expect(
      getFacturaAccountingStatusText(
        { accounting_status: 'pending' },
        unavailableRuntime,
      ),
    ).toBe('Pendiente');
    expect(
      getFacturaAccountingStatusText(
        { accounting_status: 'created' },
        unavailableRuntime,
      ),
    ).toBe('Contabilizada');
    expect(
      getFacturaAccountingStatusText(
        { accounting_status: 'reference_unverified' },
        unavailableRuntime,
      ),
    ).toBe('Pendiente de comprobar');
  });

  it('prioriza el estado del snapshot contable sobre la referencia heredada', () => {
    expect(
      getFacturaAccountingStatusText(
        {
          accounting_status: 'reference_unverified',
          asiento_estado: 'error',
        },
        unavailableRuntime,
      ),
    ).toBe('Error');

    expect(
      getFacturaAccountingStatusText(
        {
          accounting_status: 'reference_unverified',
          asiento_estado: 'created',
        },
        unavailableRuntime,
      ),
    ).toBe('Contabilizada');
  });

  it.each([
    ['pending', 'Pendiente'],
    ['unknown', 'Resultado incierto'],
    ['error', 'Error'],
    ['stale', 'Caducada'],
  ])(
    'mantiene el estado explicito %s aunque exista un snapshot creado',
    (accountingStatus, expectedText) => {
      expect(
        getFacturaAccountingStatusText(
          {
            accounting_status: accountingStatus,
            asiento_estado: 'created',
            accounting: { status: 'created' },
          },
          unavailableRuntime,
        ),
      ).toBe(expectedText);
    },
  );

  it('usa el snapshot cuando no existe un estado contable explicito', () => {
    expect(
      getFacturaAccountingStatusText(
        { asiento_estado: 'created' },
        unavailableRuntime,
      ),
    ).toBe('Contabilizada');
  });
});
