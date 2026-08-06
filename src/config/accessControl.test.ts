import { describe, expect, it } from 'vitest';

import { canAccessPath, getFirstAllowedPath } from './accessControl';
import {
  buildAlbaranEntradaDetailPath,
  buildFacturaRecibidaDetailPath,
  resolveAccessPath,
} from '@/utils/entityRoutes';

describe('ruta de Facturas', () => {
  it('usa /facturas como ruta publica para listado y detalle', () => {
    expect(buildFacturaRecibidaDetailPath('factura-1')).toBe('/facturas/factura-1');
    expect(resolveAccessPath('/facturas/factura-1')).toBe('/facturas');
  });

  it('mantiene compatibles los permisos y enlaces antiguos', () => {
    const access = {
      role: 'user' as const,
      allowedRoutes: ['/facturas-recibidas'],
    };

    expect(resolveAccessPath('/facturas-recibidas/factura-1')).toBe('/facturas');
    expect(canAccessPath('/facturas/factura-1', access)).toBe(true);
    expect(canAccessPath('/facturas-recibidas/factura-1', access)).toBe(true);
    expect(getFirstAllowedPath(access)).toBe('/facturas');
  });
});

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
