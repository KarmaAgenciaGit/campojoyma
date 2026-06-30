/**
 * =====================================================
 * Servicio: AgroIris Cliente Plataformas
 * =====================================================
 *
 * Propósito: Obtener datos de plataformas asociadas a domicilios de cliente
 *
 * @author AgroIris Team
 * @date 2026-01-30
 */

import { agroirisAuth } from './agroirisAuth';

export interface ClientePlataforma {
  clienteplataformaid: number;
  nombre_plataforma: string;
  descripcion: string;
  domicilio_plataforma: string;
  cp_plataforma: string;
  poblacion_plataforma: string;
  provincia_plataforma: string;
  paisid: number;
}

class AgroirisClientePlataformasService {
  private cache = new Map<number, ClientePlataforma>();

  async getPlataformaById(plataformaId: number): Promise<ClientePlataforma | null> {
    if (!plataformaId || plataformaId <= 0) return null;
    if (this.cache.has(plataformaId)) {
      return this.cache.get(plataformaId) ?? null;
    }
    try {
      const data = await agroirisAuth.authenticatedFetch<ClientePlataforma>(
        `/clienteplataforma/${plataformaId}`
      );
      if (data) {
        this.cache.set(plataformaId, data);
      }
      return data ?? null;
    } catch (error) {
      console.error('Error en getPlataformaById:', error);
      return null;
    }
  }
}

export const agroirisClientePlataformas = new AgroirisClientePlataformasService();
