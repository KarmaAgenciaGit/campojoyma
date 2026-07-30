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
    ).toBe('Creada');
    expect(
      getFacturaAccountingStatusText(
        { accounting_status: 'reference_unverified' },
        unavailableRuntime,
      ),
    ).toBe('Referencia sin verificar');
  });
});
