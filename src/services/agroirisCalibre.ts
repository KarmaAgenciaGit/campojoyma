/**
 * =====================================================
 * Servicio: AgroIris Calibre API
 * =====================================================
 * 
 * Gestiona las peticiones a la API de Calibres de AgroIris
 * Endpoint base: http://46.24.40.100:7000/api/calibre
 * 
 * @author AgroIris Team
 * @date 2025-11-06
 */

import { agroirisAuth } from './agroirisAuth';

export interface Calibre {
  calibreid: number;
  categoriaid: number;
  nombre_calibre: string;
  calibregrupoid: number;
  imp_muestreo: boolean;
  nombre_impresion: string;
  activo: boolean;
}

class AgroirisCalibreService {
  private cacheByCatalogo = new Map<number, { data: Calibre[]; timestamp: number }>();
  private cacheGeneral: { data: Calibre[]; timestamp: number } | null = null;
  private static CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

  /**
   * Obtiene todos los calibres
   */
  async getAllCalibres(): Promise<Calibre[]> {
    try {
      if (this.cacheGeneral && Date.now() - this.cacheGeneral.timestamp < AgroirisCalibreService.CACHE_DURATION) {
        return this.cacheGeneral.data;
      }
      const data = await agroirisAuth.authenticatedFetch<Calibre[]>('/calibre');
      this.cacheGeneral = { data, timestamp: Date.now() };
      return data;
    } catch (error) {
      console.error('Error obteniendo calibres:', error);
      throw error;
    }
  }

  /**
   * Obtiene calibres filtrados por catálogo de confección
   */
  async getCalibresByCatalogo(catalogoconfecid: number, forceRefresh: boolean = false): Promise<Calibre[]> {
    if (!catalogoconfecid) return [];

    const cached = this.cacheByCatalogo.get(catalogoconfecid);
    if (cached && !forceRefresh && Date.now() - cached.timestamp < AgroirisCalibreService.CACHE_DURATION) {
      return cached.data;
    }

    try {
      const response = await agroirisAuth.authenticatedFetch<Calibre | Calibre[]>(
        `/calibre/catalogoconfec/${catalogoconfecid}`
      );
      const list = Array.isArray(response) ? response : (response ? [response] : []);
      this.cacheByCatalogo.set(catalogoconfecid, { data: list, timestamp: Date.now() });
      return list;
    } catch (error) {
      console.error(`Error obteniendo calibres por catálogo ${catalogoconfecid}:`, error);
      return [];
    }
  }

  /**
   * Obtiene un calibre por ID
   */
  async getCalibreById(id: number): Promise<Calibre | null> {
    try {
      return await agroirisAuth.authenticatedFetch<Calibre>(`/calibre/${id}`);
    } catch (error) {
      console.error(`Error obteniendo calibre ${id}:`, error);
      return null;
    }
  }

  /**
   * Obtiene solo calibres activos
   */
  async getCalibresActivos(): Promise<Calibre[]> {
    const calibres = await this.getAllCalibres();
    return calibres.filter(c => c.activo);
  }

  clearCache(): void {
    this.cacheGeneral = null;
    this.cacheByCatalogo.clear();
  }
}

export const agroirisCalibre = new AgroirisCalibreService();
