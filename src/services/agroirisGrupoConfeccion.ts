/**
 * AgroIris API Grupo Confeccion Service
 * Gestiona la obtención y caché de grupos de confección
 */

import { agroirisAuth } from './agroirisAuth';

export interface AgroIrisGrupoConfeccion {
  grupoconfeccionid: number;
  nombre_grupo_confeccion: string;
  abreviatura: string;
  tipo: string;
}

export interface GrupoConfeccionSelectOption {
  value: number;
  label: string;
  searchText: string;
  grupoConfeccion: AgroIrisGrupoConfeccion;
}

const CACHE_KEY = 'agroiris_grupoconfeccion_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

interface GrupoConfeccionCache {
  data: AgroIrisGrupoConfeccion[];
  timestamp: number;
}

class AgroIrisGrupoConfeccionService {
  private gruposPromise: Promise<AgroIrisGrupoConfeccion[]> | null = null;
  private cacheByCatalogo = new Map<number, { data: AgroIrisGrupoConfeccion[]; timestamp: number }>();

  /**
   * Obtiene los grupos del caché si son válidos
   */
  private getCachedGrupos(): AgroIrisGrupoConfeccion[] | null {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    try {
      const cacheData: GrupoConfeccionCache = JSON.parse(cached);
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
   * Guarda los grupos en el caché
   */
  private cacheGrupos(grupos: AgroIrisGrupoConfeccion[]): void {
    const cacheData: GrupoConfeccionCache = {
      data: grupos,
      timestamp: Date.now(),
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  }

  /**
   * Obtiene la lista de grupos de la API
   */
  private async fetchGrupos(): Promise<AgroIrisGrupoConfeccion[]> {
    const grupos = await agroirisAuth.authenticatedFetch<AgroIrisGrupoConfeccion[]>(
      '/grupoconfeccion'
    );
    this.cacheGrupos(grupos);
    return grupos;
  }

  /**
   * Obtiene todos los grupos (usa caché si está disponible)
   */
  async getGrupos(forceRefresh: boolean = false): Promise<AgroIrisGrupoConfeccion[]> {
    // Si hay una petición en progreso, esperarla
    if (this.gruposPromise) {
      return this.gruposPromise;
    }

    // Si no se fuerza refresh y hay caché válido, usarlo
    if (!forceRefresh) {
      const cached = this.getCachedGrupos();
      if (cached) {
        return cached;
      }
    }

    // Hacer petición a la API
    this.gruposPromise = this.fetchGrupos()
      .finally(() => {
        this.gruposPromise = null;
      });

    return this.gruposPromise;
  }

  /**
   * Obtiene grupos filtrados por catálogo de confección (endpoint específico)
   */
  async getGruposByCatalogo(catalogoconfecid: number, forceRefresh: boolean = false): Promise<AgroIrisGrupoConfeccion[]> {
    if (!catalogoconfecid) return [];

    const cached = this.cacheByCatalogo.get(catalogoconfecid);
    if (cached && !forceRefresh && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    try {
      const response = await agroirisAuth.authenticatedFetch<AgroIrisGrupoConfeccion | AgroIrisGrupoConfeccion[]>(
        `/grupoconfeccion/catalogoconfecid/${catalogoconfecid}`
      );
      const list = Array.isArray(response) ? response : (response ? [response] : []);
      this.cacheByCatalogo.set(catalogoconfecid, { data: list, timestamp: Date.now() });
      return list;
    } catch (error) {
      console.error(`Error obteniendo grupos por catálogo ${catalogoconfecid}:`, error);
      return [];
    }
  }

  /**
   * Busca un grupo por su ID
   */
  async getGrupoById(grupoconfeccionid: number): Promise<AgroIrisGrupoConfeccion | null> {
    try {
      // Intentar obtener del listado cacheado primero
      const grupos = await this.getGrupos();
      const grupoFromCache = grupos.find(g => g.grupoconfeccionid === grupoconfeccionid);
      
      if (grupoFromCache) {
        return grupoFromCache;
      }

      // Si no está en caché, hacer petición directa
      const grupo = await agroirisAuth.authenticatedFetch<AgroIrisGrupoConfeccion>(
        `/grupoconfeccion/${grupoconfeccionid}`
      );
      return grupo;
    } catch (error) {
      console.error(`Error obteniendo grupo confección ${grupoconfeccionid}:`, error);
      return null;
    }
  }

  /**
   * Formatea los grupos para usar en el componente de selección
   */
  formatGruposForSelect(grupos: AgroIrisGrupoConfeccion[]): GrupoConfeccionSelectOption[] {
    return grupos
      .map(grupo => {
        const label = `${grupo.nombre_grupo_confeccion} (${grupo.abreviatura}) · ID: ${grupo.grupoconfeccionid}`;
        const searchText = `${grupo.nombre_grupo_confeccion} ${grupo.abreviatura} ${grupo.tipo} ${grupo.grupoconfeccionid}`.toLowerCase();

        return {
          value: grupo.grupoconfeccionid,
          label,
          searchText,
          grupoConfeccion: grupo,
        };
      })
      .sort((a, b) => a.grupoConfeccion.nombre_grupo_confeccion.localeCompare(
        b.grupoConfeccion.nombre_grupo_confeccion
      ));
  }

  /**
   * Busca grupos por texto
   */
  async searchGrupos(query: string): Promise<GrupoConfeccionSelectOption[]> {
    const grupos = await this.getGrupos();
    const options = this.formatGruposForSelect(grupos);

    if (!query) return options;

    const searchQuery = query.toLowerCase();
    return options.filter(option => option.searchText.includes(searchQuery));
  }

  /**
   * Busca grupos por catálogo y texto
   */
  async searchGruposByCatalogo(catalogoconfecid: number, query: string): Promise<GrupoConfeccionSelectOption[]> {
    if (!catalogoconfecid) return [];
    const grupos = await this.getGruposByCatalogo(catalogoconfecid);
    const options = this.formatGruposForSelect(grupos);

    if (!query) return options;

    const searchQuery = query.toLowerCase();
    return options.filter(option => option.searchText.includes(searchQuery));
  }

  /**
   * Invalida el caché de grupos
   */
  invalidateCache(): void {
    localStorage.removeItem(CACHE_KEY);
    this.gruposPromise = null;
    this.cacheByCatalogo.clear();
  }
}

// Exportar instancia singleton
export const agroirisGrupoConfeccion = new AgroIrisGrupoConfeccionService();
