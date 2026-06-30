/**
 * AgroIris API Divisa Service
 * Gestiona la obtención y caché de divisas
 */

import { agroirisAuth } from './agroirisAuth';

export interface AgroIrisDivisa {
  divisaid: number;
  nombre_divisa: string;
  simbolo_divisa: string;
  simbolo_cambio: string;
  activo: boolean;
}

export interface DivisaSelectOption {
  value: number;
  label: string;
  searchText: string;
  divisa: AgroIrisDivisa;
}

const CACHE_KEY = 'agroiris_divisas_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

interface DivisaCache {
  data: AgroIrisDivisa[];
  timestamp: number;
}

class AgroIrisDivisaService {
  private divisasPromise: Promise<AgroIrisDivisa[]> | null = null;

  /**
   * Obtiene las divisas del caché si son válidas
   */
  private getCachedDivisas(): AgroIrisDivisa[] | null {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    try {
      const cacheData: DivisaCache = JSON.parse(cached);
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
   * Guarda las divisas en el caché
   */
  private cacheDivisas(divisas: AgroIrisDivisa[]): void {
    const cacheData: DivisaCache = {
      data: divisas,
      timestamp: Date.now(),
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  }

  /**
   * Obtiene la lista de divisas de la API
   */
  private async fetchDivisas(): Promise<AgroIrisDivisa[]> {
    // Las divisas están en el servidor de login (puerto 7001), no en el de clientes
    const token = await agroirisAuth.getToken();
    const response = await fetch('/agroiris-divisa/', {
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error obteniendo divisas: ${response.status} ${response.statusText}`);
    }

    const divisas = await response.json();
    this.cacheDivisas(divisas);
    return divisas;
  }

  /**
   * Obtiene todas las divisas (usa caché si está disponible)
   */
  async getDivisas(forceRefresh: boolean = false): Promise<AgroIrisDivisa[]> {
    // Si hay una petición en progreso, esperarla
    if (this.divisasPromise) {
      return this.divisasPromise;
    }

    // Si no se fuerza refresh y hay caché válido, usarlo
    if (!forceRefresh) {
      const cached = this.getCachedDivisas();
      if (cached) {
        return cached;
      }
    }

    // Hacer petición a la API
    this.divisasPromise = this.fetchDivisas()
      .finally(() => {
        this.divisasPromise = null;
      });

    return this.divisasPromise;
  }

  /**
   * Busca una divisa por su ID
   */
  async getDivisaById(divisaid: number): Promise<AgroIrisDivisa | null> {
    const divisas = await this.getDivisas();
    return divisas.find(d => d.divisaid === divisaid) || null;
  }

  /**
   * Formatea las divisas para usar en el componente de selección
   */
  formatDivisasForSelect(divisas: AgroIrisDivisa[]): DivisaSelectOption[] {
    return divisas
      // Mostrar todas las divisas, no solo las activas (algunas divisas en uso pueden tener activo=false)
      .map(divisa => {
        const label = `${divisa.nombre_divisa} (${divisa.simbolo_cambio})`;
        const searchText = `${divisa.nombre_divisa} ${divisa.simbolo_cambio} ${divisa.simbolo_divisa}`.toLowerCase();

        return {
          value: divisa.divisaid,
          label,
          searchText,
          divisa,
        };
      })
      .sort((a, b) => a.divisa.nombre_divisa.localeCompare(b.divisa.nombre_divisa));
  }

  /**
   * Busca divisas por texto
   */
  async searchDivisas(query: string): Promise<DivisaSelectOption[]> {
    const divisas = await this.getDivisas();
    const options = this.formatDivisasForSelect(divisas);

    if (!query) return options;

    const searchQuery = query.toLowerCase();
    return options.filter(option => option.searchText.includes(searchQuery));
  }

  /**
   * Invalida el caché de divisas
   */
  invalidateCache(): void {
    localStorage.removeItem(CACHE_KEY);
    this.divisasPromise = null;
  }
}

// Exportar instancia singleton
export const agroirisDivisas = new AgroIrisDivisaService();
