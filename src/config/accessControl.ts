import { resolveAccessPath, ROUTE_BASES } from '@/utils/entityRoutes';

export type UserRole = 'admin' | 'user';
export type UserAccess = {
  role: UserRole;
  allowedRoutes?: string[] | null;
};

export const ADMIN_USER_IDS: string[] = [
  '5f4f41f3-f8ff-4527-bc5c-dfa5f5a1e671',
];

export const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  '/': ['admin', 'user'],
  '/dashboard': ['admin', 'user'],
  [ROUTE_BASES.facturasRecibidas]: ['admin', 'user'],
  '/albaranes': ['admin', 'user'],
  '/usuarios': ['admin'],
};

const normalizePath = (path: string) => resolveAccessPath(path);

export const getUserRole = (userId?: string | null): UserRole =>
  userId && ADMIN_USER_IDS.includes(userId) ? 'admin' : 'user';

export const canAccessPath = (path: string, access: UserAccess) => {
  const normalized = normalizePath(path);
  const allowedRoles = ROUTE_PERMISSIONS[normalized];
  if (!allowedRoles || !allowedRoles.includes(access.role)) return false;

  const normalizedAllowed = access.allowedRoutes?.map(normalizePath);
  if (!normalizedAllowed) return true;
  if (access.role === 'admin') return true;
  if (
    normalized === '/albaranes' &&
    normalizedAllowed.includes(ROUTE_BASES.facturasRecibidas)
  ) {
    return true;
  }
  return normalizedAllowed.includes(normalized);
};

export const getFirstAllowedPath = (access: UserAccess): string | null => {
  if (access.role === 'admin') return '/dashboard';

  const normalizedAllowed = access.allowedRoutes?.map(normalizePath);
  const order = ['/dashboard', ROUTE_BASES.facturasRecibidas, '/albaranes', '/usuarios'];

  if (normalizedAllowed && Array.isArray(normalizedAllowed)) {
    for (const path of order) {
      if (normalizedAllowed.includes(path)) return path;
    }
    return null;
  }

  for (const path of order) {
    if (canAccessPath(path, access)) return path;
  }

  return null;
};
