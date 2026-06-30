import { useState, useEffect, useCallback } from 'react';

/**
 * Hook para persistir estado en sessionStorage
 * El estado sobrevive a recargas de página pero se pierde al cerrar la pestaña
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  storage: Storage = sessionStorage
): [T, (value: T | ((prev: T) => T)) => void] {
  // Intentar cargar el valor guardado
  const [state, setState] = useState<T>(() => {
    try {
      const item = storage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
      console.warn(`Error loading persisted state for key "${key}":`, error);
      return defaultValue;
    }
  });

  // Guardar en storage cuando cambie el estado
  useEffect(() => {
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn(`Error persisting state for key "${key}":`, error);
    }
  }, [key, state, storage]);

  return [state, setState];
}

/**
 * Hook para detectar cuando la página se está descargando
 * Útil para guardar estado antes de que el navegador descarte la pestaña
 */
export function usePageUnload(callback: () => void) {
  useEffect(() => {
    const handleBeforeUnload = () => {
      callback();
    };

    // Guardar estado antes de que el navegador descarte la página
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // También en visibilitychange para cuando la pestaña se oculta
    const handleVisibilityChange = () => {
      if (document.hidden) {
        callback();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [callback]);
}
