import { useAuth } from '@/hooks/useAuth';
import { Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AppLayout } from '@/components/app-layout';
import FacturasRecibidas from './FacturasRecibidas';
import { canAccessPath, getFirstAllowedPath } from '@/config/accessControl';
import { normalizeRoutePath, resolveAccessPath, ROUTE_BASES } from '@/utils/entityRoutes';
import AdminUsers from './AdminUsers';

const Index = () => {
  const { user, loading, role, allowedRoutes } = useAuth();
  
  const location = useLocation();

  useEffect(() => {
    console.log('🏠 Index component mounted/updated. Path:', location.pathname);
  }, [location.pathname]);

  if (loading) {
    // Mostrar un loader más discreto y rápido
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-xs text-muted-foreground">Restaurando sesión...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  const path = normalizeRoutePath(location.pathname);
  const resolvedPath = resolveAccessPath(path);
  const access = { role, allowedRoutes };
  const isAllowed = canAccessPath(path, access);

  if (!isAllowed) {
    const fallback = getFirstAllowedPath(access);
    if (fallback && canAccessPath(fallback, access)) {
      return <Navigate to={fallback} replace />;
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-2">
          <p className="text-lg font-semibold">No tienes permisos para ver esta página.</p>
          <p className="text-sm text-muted-foreground">
            Pide a un administrador que te asigne rutas en el panel de administración.
          </p>
        </div>
      </div>
    );
  }

  const renderPage = () => {
    switch (resolvedPath) {
      case '/':
        return getFirstAllowedPath(access) ? <Navigate to={getFirstAllowedPath(access)!} replace /> : null;
      case ROUTE_BASES.facturasRecibidas:
        return <FacturasRecibidas />;
      case '/usuarios':
        return <AdminUsers />;
      default:
        return null;
    }
  };

  return (
    <AppLayout>
      {renderPage()}
    </AppLayout>
  );
};

export default Index;
