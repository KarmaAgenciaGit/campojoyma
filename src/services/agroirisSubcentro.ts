import { agroirisAuth } from './agroirisAuth';

export interface Subcentro {
  subcentroid: number;
  centroid: number;
  nombre_subcentro: string;
  domicilio_subcentro: string;
  cp_subcentro: string;
  poblacion_subcentro: string;
  provincia_subcentro: string;
  subcentro_contabilizacionid: number;
  color: string;
  almacenmaterialid: number;
  tipolector: string;
  tipouso: string;
}

// Usamos el mismo proxy de configuración que el resto de servicios en 7001
const SUBCENTRO_BASE = '/agroiris-config';
const CACHE_DURATION = 30 * 60 * 1000; // 30 min

class AgroirisSubcentroService {
  private cacheAll: { data: Subcentro[]; timestamp: number } | null = null;

  private async fetchFromConfig<T>(path: string): Promise<T> {
    const token = await agroirisAuth.getToken();
    if (!token) {
      throw new Error('No hay token de autenticación disponible');
    }

    const response = await fetch(`${SUBCENTRO_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      const error: any = new Error(
        `Error en petición de subcentros: ${response.status} ${response.statusText}`
      );
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  async getAll(): Promise<Subcentro[]> {
    if (this.cacheAll && Date.now() - this.cacheAll.timestamp < CACHE_DURATION) {
      return this.cacheAll.data;
    }
    const data = await this.fetchFromConfig<Subcentro[]>('/subcentro');
    this.cacheAll = { data, timestamp: Date.now() };
    return data;
  }

  async getById(id: number): Promise<Subcentro | null> {
    try {
      return await this.fetchFromConfig<Subcentro>(`/subcentro/${id}`);
    } catch (error) {
      console.error(`Error obteniendo subcentro ${id}:`, error);
      return null;
    }
  }

  clearCache(): void {
    this.cacheAll = null;
  }
}

export const agroirisSubcentro = new AgroirisSubcentroService();
