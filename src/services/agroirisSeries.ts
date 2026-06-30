import { agroirisAuth } from './agroirisAuth';

interface Serie {
  serieid: number;
  tipo: string;
  por_defecto: boolean;
  serie: string;
  empresaid: number;
  ejercicioid: number;
  subcentroid: number;
  descripcion: string;
  entradagenero: boolean;
  entradaconfecc: boolean;
}

export const agroirisSeries = {
  /**
   * Obtiene todas las series
   */
  getAllSeries: async (): Promise<Serie[]> => {
    try {
      const token = await agroirisAuth.getToken();
      const response = await fetch('/agroiris-serie', {
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Error obteniendo series: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error fetching series:', error);
      throw error;
    }
  },

  /**
   * Obtiene una serie por ID
   */
  getSerieById: async (id: number): Promise<Serie | null> => {
    try {
      const token = await agroirisAuth.getToken();
      const response = await fetch(`/agroiris-serie/${id}`, {
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error(`Error obteniendo serie ${id}: ${response.status} ${response.statusText}`);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error(`Error fetching serie with id ${id}:`, error);
      return null;
    }
  },
};
