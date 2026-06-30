import { agroirisAuth } from './agroirisAuth';

type AgroIrisPaisApi = {
  paisid?: number;
  nombre_pais?: string;
  nombre?: string;
  descripcion?: string;
};

class AgroIrisPaisesService {
  private cache = new Map<number, string>();

  async getPaisNombreById(paisId: number | null | undefined): Promise<string | null> {
    if (!paisId || paisId <= 0) return null;
    if (this.cache.has(paisId)) {
      return this.cache.get(paisId) ?? null;
    }

    try {
      const token = await agroirisAuth.getToken();
      const response = await fetch(`/agroiris-config/pais/${paisId}`, {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`No se pudo obtener pais ${paisId}: ${response.status}`);
      }

      const data = (await response.json()) as AgroIrisPaisApi;
      const nombre =
        data?.nombre_pais?.trim() ||
        data?.nombre?.trim() ||
        data?.descripcion?.trim() ||
        null;

      if (nombre) {
        this.cache.set(paisId, nombre);
      }

      return nombre;
    } catch (error) {
      console.error('Error cargando pais:', error);
      return null;
    }
  }
}

export const agroirisPaises = new AgroIrisPaisesService();
