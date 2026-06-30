/**
 * AgroIris API Confeccion Palet Service
 * Gestiona la obtención y caché de confecciones palet
 */

import { agroirisAuth } from './agroirisAuth';

export interface AgroIrisConfeccionPalet {
  confeccionpaletid: number;
  materialid: number;
  nombre_confeccionpalet: string;
  abreviatura_confeccionpalet: string;
  activo: boolean;
  foto_confeccionpalet: string;
  carton: boolean;
}

export interface ConfeccionPaletSelectOption {
  value: number;
  label: string;
  searchText: string;
  confeccionPalet: AgroIrisConfeccionPalet;
}

const CACHE_KEY = 'agroiris_confeccionpalet_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

interface ConfeccionPaletCache {
  data: AgroIrisConfeccionPalet[];
  timestamp: number;
}

class AgroIrisConfeccionPaletService {
  private confeccionesPromise: Promise<AgroIrisConfeccionPalet[]> | null = null;

  /**
   * Obtiene las confecciones del caché si son válidas
   */
  private getCachedConfecciones(): AgroIrisConfeccionPalet[] | null {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    try {
      const cacheData: ConfeccionPaletCache = JSON.parse(cached);
      const isValid = Date.now() - cacheData.timestamp < CACHE_DURATION;

      if (isValid) {
        return cacheData.data;
      }

      // Caché expirado, eliminarlo
      localStorage.removeItem(CACHE_KEY);
      return null;
    } catch {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
  }

  /**
   * Guarda las confecciones en el caché
   */
  private cacheConfecciones(confecciones: AgroIrisConfeccionPalet[]): void {
    const cacheData: ConfeccionPaletCache = {
      data: confecciones,
      timestamp: Date.now(),
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  }

  /**
   * Obtiene la lista de confecciones de la API
   */
  private async fetchConfecciones(): Promise<AgroIrisConfeccionPalet[]> {
    const confecciones = await agroirisAuth.authenticatedFetch<AgroIrisConfeccionPalet[]>(
      '/confeccionpalet/'
    );
    this.cacheConfecciones(confecciones);
    return confecciones;
  }

  /**
   * Obtiene todas las confecciones (usa caché si está disponible)
   */
  async getConfecciones(forceRefresh: boolean = false): Promise<AgroIrisConfeccionPalet[]> {
    // Si hay una petición en progreso, esperarla
    if (this.confeccionesPromise) {
      return this.confeccionesPromise;
    }

    // Si no se fuerza refresh y hay caché válido, usarlo
    if (!forceRefresh) {
      const cached = this.getCachedConfecciones();
      if (cached) {
        return cached;
      }
    }

    // Hacer petición a la API
    this.confeccionesPromise = this.fetchConfecciones()
      .finally(() => {
        this.confeccionesPromise = null;
      });

    return this.confeccionesPromise;
  }

  /**
   * Busca una confección por su ID
   */
  async getConfeccionById(confeccionpaletid: number): Promise<AgroIrisConfeccionPalet | null> {
    try {
      // Intentar obtener del listado cacheado primero
      const confecciones = await this.getConfecciones();
      const confeccionFromCache = confecciones.find(c => c.confeccionpaletid === confeccionpaletid);
      
      if (confeccionFromCache) {
        return confeccionFromCache;
      }

      // Si no está en caché, hacer petición directa
      const confeccion = await agroirisAuth.authenticatedFetch<AgroIrisConfeccionPalet>(
        `/confeccionpalet/${confeccionpaletid}`
      );
      return confeccion;
    } catch (error) {
      console.error(`Error obteniendo confección palet ${confeccionpaletid}:`, error);
      return null;
    }
  }

  /**
   * Formatea las confecciones para usar en el componente de selección
   */
  formatConfeccionesForSelect(confecciones: AgroIrisConfeccionPalet[]): ConfeccionPaletSelectOption[] {
    return confecciones
      .filter(confeccion => confeccion.activo) // Solo confecciones activas
      .map(confeccion => {
        const label = `${confeccion.nombre_confeccionpalet} (${confeccion.abreviatura_confeccionpalet}) · ID: ${confeccion.confeccionpaletid}`;
        const searchText = `${confeccion.nombre_confeccionpalet} ${confeccion.abreviatura_confeccionpalet} ${confeccion.confeccionpaletid}`.toLowerCase();

        return {
          value: confeccion.confeccionpaletid,
          label,
          searchText,
          confeccionPalet: confeccion,
        };
      })
      .sort((a, b) => a.confeccionPalet.nombre_confeccionpalet.localeCompare(
        b.confeccionPalet.nombre_confeccionpalet
      ));
  }

  /**
   * Busca confecciones por texto
   */
  async searchConfecciones(query: string): Promise<ConfeccionPaletSelectOption[]> {
    const confecciones = await this.getConfecciones();
    const options = this.formatConfeccionesForSelect(confecciones);

    if (!query) return options;

    const searchQuery = query.toLowerCase();
    return options.filter(option => option.searchText.includes(searchQuery));
  }

  /**
   * Invalida el caché de confecciones
   */
  invalidateCache(): void {
    localStorage.removeItem(CACHE_KEY);
    this.confeccionesPromise = null;
  }
}

// Exportar instancia singleton
export const agroirisConfeccionPalet = new AgroIrisConfeccionPaletService();
