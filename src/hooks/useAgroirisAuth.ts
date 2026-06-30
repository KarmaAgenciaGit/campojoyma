/**
 * Hook para inicializar y gestionar la autenticación de AgroIris
 */

import { useEffect, useState, useRef } from 'react';
import { agroirisAuth } from '@/services/agroirisAuth';

export function useAgroirisAuth() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Solo ejecutar una vez
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    const initAuth = async () => {
      try {
        // Intentar obtener el token (si existe en caché o hacer login)
        await agroirisAuth.getToken();
        setIsInitialized(true);
      } catch (err) {
        console.error('Error inicializando autenticación AgroIris:', err);
        setError(err instanceof Error ? err : new Error('Error desconocido'));
        setIsInitialized(true); // Marcar como inicializado aunque haya error
      }
    };

    initAuth();
  }, []);

  return { isInitialized, error };
}
