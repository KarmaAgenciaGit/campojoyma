import type { TipoPedido } from '@/types/pedidos';

export const ROUTE_BASES = {
  dashboard: '/dashboard',
  previsiones: '/previsiones',
  pedidos: '/pedidos',
  cambios: '/cambios',
  cuentas: '/cuentas',
  facturasRecibidas: '/facturas',
  albaranes: '/albaranes',
} as const;

export const LEGACY_ROUTE_BASES = {
  facturasRecibidas: '/facturas-recibidas',
} as const;

const DETAIL_ROUTE_BASES = [
  ROUTE_BASES.previsiones,
  ROUTE_BASES.pedidos,
  ROUTE_BASES.cambios,
  ROUTE_BASES.cuentas,
  ROUTE_BASES.facturasRecibidas,
  ROUTE_BASES.albaranes,
] as const;

export const normalizeRoutePath = (path: string) => {
  const clean = path.split('?')[0].replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
};

export const resolveAccessPath = (path: string) => {
  const normalizedPath = normalizeRoutePath(path);
  const legacyFacturasPath = LEGACY_ROUTE_BASES.facturasRecibidas;
  const normalized =
    normalizedPath === legacyFacturasPath || normalizedPath.startsWith(`${legacyFacturasPath}/`)
      ? `${ROUTE_BASES.facturasRecibidas}${normalizedPath.slice(legacyFacturasPath.length)}`
      : normalizedPath;
  const matchedBase = DETAIL_ROUTE_BASES.find(
    (basePath) => normalized === basePath || normalized.startsWith(`${basePath}/`),
  );
  return matchedBase ?? normalized;
};

export const getPedidoBasePath = (tipoPedido?: TipoPedido | null) =>
  tipoPedido === 'P22E' ? ROUTE_BASES.previsiones : ROUTE_BASES.pedidos;

export const buildPedidoDetailPath = (pedidoId: number | string, tipoPedido?: TipoPedido | null) =>
  `${getPedidoBasePath(tipoPedido)}/${pedidoId}`;

export const buildCambioDetailPath = (cambioId: number | string) =>
  `${ROUTE_BASES.cambios}/${cambioId}`;

export const buildCuentaDetailPath = (cuentaId: number | string) =>
  `${ROUTE_BASES.cuentas}/${cuentaId}`;

export const buildFacturaRecibidaDetailPath = (facturaId: number | string) =>
  `${ROUTE_BASES.facturasRecibidas}/${facturaId}`;

export const buildAlbaranEntradaDetailPath = (albaranId: number | string) =>
  `${ROUTE_BASES.albaranes}/${albaranId}`;
