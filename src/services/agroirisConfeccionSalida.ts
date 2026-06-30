/**
 * Servicio para gestionar las confecciones de salida desde la API de AgroIris.
 * Incluye caché general, caché por catálogo de confección y utilidades de búsqueda/formateo.
 */

import { agroirisAuth } from './agroirisAuth';

// ===========================
// INTERFAZ
// ===========================

export interface AgroIrisConfeccionSalida {
  confeccionsalidaid: number;
  materialid: number;
  nombre_confeccionsalida: string;
  abreviatura_confeccionsalida: string;
  activo: boolean;
  grupoconfeccionid: number;
  foto_confeccionsalida: string;
}

// ===========================
// CACHE
// ===========================

interface ConfeccionSalidaCache {
  data: AgroIrisConfeccionSalida[];
  timestamp: number;
}

const CACHE_KEY = 'agroiris_confecciones_salida_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

// ===========================
// SERVICIO PRINCIPAL
// ===========================

class AgroirisConfeccionSalidaService {
  private confeccionesPromise: Promise<AgroIrisConfeccionSalida[]> | null = null;
  private cacheByCatalogo = new Map<number, { data: AgroIrisConfeccionSalida[]; timestamp: number }>();

  /**
   * Obtiene las confecciones desde el caché si está disponible
   */
  private getCachedConfecciones(): AgroIrisConfeccionSalida[] | null {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      const cacheData: ConfeccionSalidaCache = JSON.parse(cached);
      const age = Date.now() - cacheData.timestamp;

      if (age > CACHE_DURATION) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }

      return cacheData.data;
    } catch {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
  }

  /**
   * Guarda las confecciones en el caché
   */
  private cacheConfecciones(confecciones: AgroIrisConfeccionSalida[]): void {
    const cacheData: ConfeccionSalidaCache = {
      data: confecciones,
      timestamp: Date.now(),
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  }

  /**
   * Obtiene la lista de confecciones de la API
   */
  private async fetchConfecciones(): Promise<AgroIrisConfeccionSalida[]> {
    const confecciones = await agroirisAuth.authenticatedFetch<AgroIrisConfeccionSalida[]>(
      '/confeccionsalida/'
    );
    this.cacheConfecciones(confecciones);
    return confecciones;
  }

  /**
   * Obtiene todas las confecciones (desde caché o API)
   */
  async getConfecciones(forceRefresh: boolean = false): Promise<AgroIrisConfeccionSalida[]> {
    if (this.confeccionesPromise) {
      return this.confeccionesPromise;
    }

    if (!forceRefresh) {
      const cached = this.getCachedConfecciones();
      if (cached) {
        return cached;
      }
    }

    this.confeccionesPromise = this.fetchConfecciones().finally(() => {
      this.confeccionesPromise = null;
    });

    return this.confeccionesPromise;
  }

  /**
   * Obtiene confecciones filtradas por catálogo de confección (endpoint específico)
   */
  async getConfeccionesByCatalogo(catalogoconfecid: number, forceRefresh: boolean = false): Promise<AgroIrisConfeccionSalida[]> {
    if (!catalogoconfecid) return [];

    const cached = this.cacheByCatalogo.get(catalogoconfecid);
    if (cached && !forceRefresh && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    try {
      const confecciones = await agroirisAuth.authenticatedFetch<AgroIrisConfeccionSalida | AgroIrisConfeccionSalida[]>(
        `/confeccionsalida/catalogoconfeccion/${catalogoconfecid}`
      );
      const list = Array.isArray(confecciones) ? confecciones : (confecciones ? [confecciones] : []);
      this.cacheByCatalogo.set(catalogoconfecid, { data: list, timestamp: Date.now() });
      return list;
    } catch (error) {
      console.error(`Error obteniendo confecciones salida para catálogo ${catalogoconfecid}:`, error);
      return [];
    }
  }

  /**
   * Busca una confección por su ID
   */
  async getConfeccionById(confeccionsalidaid: number): Promise<AgroIrisConfeccionSalida | null> {
    try {
      const confecciones = await this.getConfecciones();
      const confeccion = confecciones.find((c) => c.confeccionsalidaid === confeccionsalidaid);

      if (confeccion) {
        return confeccion;
      }

      return await agroirisAuth.authenticatedFetch<AgroIrisConfeccionSalida>(
        `/confeccionsalida/${confeccionsalidaid}`
      );
    } catch (error) {
      console.error(`Error al obtener confección salida ${confeccionsalidaid}:`, error);
      return null;
    }
  }

  /**
   * Busca confecciones por texto (nombre, abreviatura o id)
   */
  async searchConfecciones(searchText: string): Promise<AgroIrisConfeccionSalida[]> {
    const confecciones = await this.getConfecciones();
    
    if (!searchText || searchText.trim() === '') {
      return confecciones.filter(c => c.activo);
    }

    const searchLower = searchText.toLowerCase().trim();
    return confecciones.filter(c => 
      c.activo && (
        c.nombre_confeccionsalida.toLowerCase().includes(searchLower) ||
        c.abreviatura_confeccionsalida.toLowerCase().includes(searchLower) ||
        c.confeccionsalidaid.toString().includes(searchLower)
      )
    );
  }

  /**
   * Busca confecciones filtradas por catálogo y texto
   */
  async searchConfeccionesByCatalogo(catalogoconfecid: number, searchText: string): Promise<AgroIrisConfeccionSalida[]> {
    if (!catalogoconfecid) return [];
    const confecciones = await this.getConfeccionesByCatalogo(catalogoconfecid);

    if (!searchText || searchText.trim() === '') {
      return confecciones.filter(c => c.activo);
    }

    const searchLower = searchText.toLowerCase().trim();
    return confecciones.filter(c =>
      c.activo && (
        c.nombre_confeccionsalida.toLowerCase().includes(searchLower) ||
        c.abreviatura_confeccionsalida.toLowerCase().includes(searchLower) ||
        c.confeccionsalidaid.toString().includes(searchLower)
      )
    );
  }

  /**
   * Formatea las confecciones para usar en un combobox
   */
  async formatConfeccionesForSelect(): Promise<Array<{ value: number; label: string }>> {
    const confecciones = await this.getConfecciones();
    
    return confecciones
      .filter(c => c.activo)
      .sort((a, b) => a.nombre_confeccionsalida.localeCompare(b.nombre_confeccionsalida))
      .map(c => ({
        value: c.confeccionsalidaid,
        label: `${c.nombre_confeccionsalida} (${c.abreviatura_confeccionsalida}) · ID: ${c.confeccionsalidaid}`
      }));
  }

  /**
   * Limpia el caché
   */
  clearCache(): void {
    localStorage.removeItem(CACHE_KEY);
    this.cacheByCatalogo.clear();
  }

  /**
   * Fuerza la recarga de datos desde la API
   */
  async forceReload(): Promise<AgroIrisConfeccionSalida[]> {
    this.clearCache();
    return this.getConfecciones(true);
  }
}

// Exportar instancia singleton
export const agroirisConfeccionSalida = new AgroirisConfeccionSalidaService();
