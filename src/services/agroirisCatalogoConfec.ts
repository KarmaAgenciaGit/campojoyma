/**
 * AgroIris API Catalogo Confeccion Service
 * Gestiona la obtención y caché de catálogos de confección
 */

import { agroirisAuth } from './agroirisAuth';
import { agroirisConfeccionSalida } from './agroirisConfeccionSalida';

export interface AgroIrisCatalogoConfec {
  catalogoconfecid: number;
  generoid: number;
  confeccionsalidaid: number;
  activo_catalogoconfeccion: boolean;
  nombre_catalogoconfeccion: string;
  confeccion_propia: boolean;
  pesonormalizado: boolean;
  merma_catalogoconfeccion: number;
  inc_gasto_confeccion: number;
  img_etiquetacaja_catalogoconfeccion: string;
  img_etiquetatarrina_catalogoconfeccion: string;
  img_catalogo_catalogoconfeccion: string;
  observacion_catalogoconfeccion: string;
  obsetiqueta1_catalogoconfeccion: string;
  obsetiqueta2_catalogoconfeccion: string;
  tag_generosalida: string;
  foto_generosalida: string;
  coste_semiconfeccionada: number;
  marcaid_defecto_envase: number;
  marcaid_defecto_material: number;
  marcaid_defecto_etiqueta: number;
  activo_confeccionentrada: boolean;
  tipo_grupo_confeccion: string;
  materialmarcaid: number;
}

export interface CatalogoConfecSelectOption {
  value: number;
  label: string;
  searchText: string;
  catalogoId: number;
  nombreCatalogo: string;
  confeccionSalidaId: number | null;
  nombreConfeccionSalida: string;
  grupoConfeccionId: number | null;
  observacion: string | null;
  catalogoConfec: AgroIrisCatalogoConfec;
}

const normalizeSearchValue = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const CACHE_KEY = 'agroiris_catalogoconfec_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

interface CatalogoConfecCache {
  data: AgroIrisCatalogoConfec[];
  timestamp: number;
}

class AgroIrisCatalogoConfecService {
  private catalogosPromise: Promise<AgroIrisCatalogoConfec[]> | null = null;
  private cacheByGenero = new Map<number, CatalogoConfecSelectOption[]>();

  /**
   * Obtiene los catálogos del caché si son válidos
   */
  private getCachedCatalogos(): AgroIrisCatalogoConfec[] | null {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    try {
      const cacheData: CatalogoConfecCache = JSON.parse(cached);
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
   * Guarda los catálogos en el caché
   */
  private cacheCatalogos(catalogos: AgroIrisCatalogoConfec[]): void {
    const cacheData: CatalogoConfecCache = {
      data: catalogos,
      timestamp: Date.now(),
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  }

  /**
   * Obtiene la lista de catálogos de la API
   */
  private async fetchCatalogos(): Promise<AgroIrisCatalogoConfec[]> {
    const catalogos = await agroirisAuth.authenticatedFetch<AgroIrisCatalogoConfec[]>(
      '/catalogoconfec'
    );
    this.cacheCatalogos(catalogos);
    return catalogos;
  }

  /**
   * Obtiene todos los catálogos (usa caché si está disponible)
   */
  async getCatalogos(forceRefresh: boolean = false): Promise<AgroIrisCatalogoConfec[]> {
    // Si hay una petición en progreso, esperarla
    if (this.catalogosPromise) {
      return this.catalogosPromise;
    }

    // Si no se fuerza refresh y hay caché válido, usarlo
    if (!forceRefresh) {
      const cached = this.getCachedCatalogos();
      if (cached) {
        return cached;
      }
    }

    // Hacer petición a la API
    this.catalogosPromise = this.fetchCatalogos()
      .finally(() => {
        this.catalogosPromise = null;
      });

    return this.catalogosPromise;
  }

  /**
   * Busca un catálogo por su ID
   */
  async getCatalogoById(catalogoconfecid: number): Promise<AgroIrisCatalogoConfec | null> {
    try {
      // Intentar obtener del listado cacheado primero
      const catalogos = await this.getCatalogos();
      const catalogoFromCache = catalogos.find(c => c.catalogoconfecid === catalogoconfecid);
      
      if (catalogoFromCache) {
        return catalogoFromCache;
      }

      // Si no está en caché, hacer petición directa
      const catalogo = await agroirisAuth.authenticatedFetch<AgroIrisCatalogoConfec>(
        `/catalogoconfec/${catalogoconfecid}`
      );
      return catalogo;
    } catch (error) {
      console.error(`Error obteniendo catálogo ${catalogoconfecid}:`, error);
      return null;
    }
  }

  /**
   * Formatea los catálogos para usar en el componente de selección
   */
  async formatCatalogosForSelect(catalogos: AgroIrisCatalogoConfec[]): Promise<CatalogoConfecSelectOption[]> {
    const confecciones = await agroirisConfeccionSalida.getConfecciones();
    const confeccionesMap = new Map(
      confecciones.map((confeccion) => [confeccion.confeccionsalidaid, confeccion])
    );

    return catalogos
      .filter(catalogo => catalogo.activo_catalogoconfeccion) // Solo catálogos activos
      .map(catalogo => {
        const catalogoId = catalogo.catalogoconfecid;
        const nombreCatalogo =
          catalogo.nombre_catalogoconfeccion?.trim() || `Catálogo #${catalogoId}`;
        const confeccionSalidaId =
          Number.isFinite(catalogo.confeccionsalidaid) && catalogo.confeccionsalidaid > 0
            ? catalogo.confeccionsalidaid
            : null;
        const confeccionSalida = confeccionSalidaId
          ? confeccionesMap.get(confeccionSalidaId)
          : null;
        const nombreConfeccionSalida =
          confeccionSalida?.nombre_confeccionsalida?.trim() ||
          (confeccionSalidaId ? `Salida #${confeccionSalidaId}` : 'Sin confección salida');
        const grupoConfeccionId =
          confeccionSalida && Number.isFinite(confeccionSalida.grupoconfeccionid) && confeccionSalida.grupoconfeccionid > 0
            ? confeccionSalida.grupoconfeccionid
            : null;
        const observacion = catalogo.observacion_catalogoconfeccion?.trim() || null;
        const label = `${nombreCatalogo} · ID ${catalogoId}`;
        const searchText = normalizeSearchValue(
          [
            nombreCatalogo,
            catalogoId,
            nombreConfeccionSalida,
            confeccionSalidaId ?? '',
            observacion ?? '',
            catalogo.generoid,
          ].join(' ')
        );

        return {
          value: catalogoId,
          label,
          searchText,
          catalogoId,
          nombreCatalogo,
          confeccionSalidaId,
          nombreConfeccionSalida,
          grupoConfeccionId,
          observacion,
          catalogoConfec: catalogo,
        };
      })
      .sort((a, b) => a.catalogoConfec.nombre_catalogoconfeccion.localeCompare(
        b.catalogoConfec.nombre_catalogoconfeccion
      ));
  }

  /**
   * Busca catálogos por texto
   */
  async searchCatalogos(query: string): Promise<CatalogoConfecSelectOption[]> {
    const catalogos = await this.getCatalogos();
    const options = await this.formatCatalogosForSelect(catalogos);

    if (!query) return options;

    const searchQuery = normalizeSearchValue(query);
    return options.filter(option => option.searchText.includes(searchQuery));
  }

  /**
   * Busca catálogos filtrando por género (vía API específica) y aplicando búsqueda local
   */
  async searchCatalogosByGenero(generoid: number, query: string): Promise<CatalogoConfecSelectOption[]> {
    if (!generoid) return [];

    const cached = this.cacheByGenero.get(generoid);
    if (!cached) {
      const catalogos = await agroirisAuth.authenticatedFetch<AgroIrisCatalogoConfec[]>(
        `/catalogoconfec/genero/${generoid}`
      );
      const formatted = await this.formatCatalogosForSelect(catalogos);
      this.cacheByGenero.set(generoid, formatted);
      const searchQuery = normalizeSearchValue(query);
      return formatted.filter((option) => option.searchText.includes(searchQuery));
    }

    const searchQuery = normalizeSearchValue(query);
    return cached.filter((option) => option.searchText.includes(searchQuery));
  }

  /**
   * Invalida el caché de catálogos
   */
  invalidateCache(): void {
    localStorage.removeItem(CACHE_KEY);
    this.catalogosPromise = null;
    this.cacheByGenero.clear();
  }
}

// Exportar instancia singleton
export const agroirisCatalogoConfec = new AgroIrisCatalogoConfecService();
