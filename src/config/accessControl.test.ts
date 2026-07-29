import { describe, expect, it } from 'vitest';

import { canAccessPath } from './accessControl';
import { buildAlbaranEntradaDetailPath } from '@/utils/entityRoutes';

describe('acceso a Albaranes', () => {
  it('reutiliza el permiso existente de Facturas para usuarios ya configurados', () => {
    expect(
      canAccessPath('/albaranes', {
        role: 'user',
        allowedRoutes: ['/dashboard', '/facturas-recibidas'],
      }),
    ).toBe(true);
  });

  it('no abre Albaranes a usuarios sin permiso documental', () => {
    expect(
      canAccessPath('/albaranes', {
        role: 'user',
        allowedRoutes: ['/dashboard'],
      }),
    ).toBe(false);
  });

  it('admite también el permiso explícito de la ruta nueva', () => {
    expect(
      canAccessPath('/albaranes', {
        role: 'user',
        allowedRoutes: ['/albaranes'],
      }),
    ).toBe(true);
  });

  it('mantiene el permiso y construye la ruta del detalle', () => {
    const detailPath = buildAlbaranEntradaDetailPath(82548);

    expect(detailPath).toBe('/albaranes/82548');
    expect(
      canAccessPath(detailPath, {
        role: 'user',
        allowedRoutes: ['/facturas-recibidas'],
      }),
    ).toBe(true);
  });
});
