import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { useAgroirisAuth } from "@/hooks/useAgroirisAuth";
import { ROUTE_BASES } from "@/utils/entityRoutes";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// Limpiar cache corrupto de versión anterior (solo una vez)
const CACHE_VERSION = 'v2';
const CACHE_VERSION_KEY = 'AGROIRIS_CACHE_VERSION';
if (window.localStorage.getItem(CACHE_VERSION_KEY) !== CACHE_VERSION) {
  window.localStorage.removeItem('AGROIRIS_QUERY_CACHE');
  window.localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
  console.log('🧹 Cache limpiado - migración a nueva estructura serializable');
}

// Crear persister para localStorage
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'AGROIRIS_QUERY_CACHE',
  throttleTime: 1000, // Guardar máximo cada 1 segundo
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutos - después de esto se revalida
      gcTime: 30 * 60 * 1000, // 30 minutos - mantener en caché aunque esté stale
      refetchOnWindowFocus: false, // NO refetch al volver a la pestaña
      refetchOnMount: false, // NO refetch al montar si hay datos en caché
      refetchOnReconnect: false, // NO refetch al reconectar
      retry: 1, // Solo 1 reintento en caso de error
    },
  },
});

const routerFutureConfig = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;

const AppContent = () => {
  // Inicializar autenticación de AgroIris al cargar la app
  useAgroirisAuth();

  // Debug: detectar recargas
  useEffect(() => {
    const timestamp = new Date().toISOString();
    console.log('🔄 APP LOADED/RELOADED at:', timestamp);
    console.log('📊 Performance timing:', {
      navigation: performance.getEntriesByType('navigation')[0],
      isReload: performance.navigation?.type === 1,
    });

    // Detectar antes de descargar
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      console.log('⚠️ Page is about to unload');
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  return (
    <BrowserRouter future={routerFutureConfig}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path={ROUTE_BASES.facturasRecibidas} element={<Index />} />
        <Route path={`${ROUTE_BASES.facturasRecibidas}/:facturaId`} element={<Index />} />
        <Route path="/usuarios" element={<Index />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
};

const App = () => (
  <PersistQueryClientProvider 
    client={queryClient} 
    persistOptions={{ persister, maxAge: 30 * 60 * 1000 }} // 30 minutos
  >
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AppContent />
      </TooltipProvider>
    </AuthProvider>
  </PersistQueryClientProvider>
);

export default App;
