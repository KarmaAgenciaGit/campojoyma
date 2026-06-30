/**
 * AgroIris API Comercial Service
 * Gestiona la obtención de comerciales
 */

import { agroirisAuth } from './agroirisAuth';

export interface AgroIrisComercial {
  comercialid: number;
  sujetoid: number;
  nombre_sujeto: string;
  apellido1_sujeto: string;
  apellido2_sujeto: string;
  nombre_comercial: string;
  tipo_documento: string;
  identificador_fiscal: string;
  idiomaid: number;
  divisaid: number;
  imagen_sujeto: string;
  usuarioid: number;
  agenteadqcampo: boolean;
}

export interface ComercialSelectOption {
  value: number;
  label: string;
  searchText: string;
  comercial: AgroIrisComercial;
}

class AgroIrisComercialService {
  private comercialesPromise: Promise<AgroIrisComercial[]> | null = null;

  /**
   * Obtiene la lista de comerciales de la API
   */
  private async fetchComerciales(): Promise<AgroIrisComercial[]> {
    const comerciales = await agroirisAuth.authenticatedFetch<AgroIrisComercial[]>('/comercial/');
    return comerciales;
  }

  /**
   * Obtiene todos los comerciales
   */
  async getComerciales(): Promise<AgroIrisComercial[]> {
    // Si hay una petición en progreso, esperarla
    if (this.comercialesPromise) {
      return this.comercialesPromise;
    }

    // Hacer petición a la API
    this.comercialesPromise = this.fetchComerciales()
      .finally(() => {
        this.comercialesPromise = null;
      });

    return this.comercialesPromise;
  }

  /**
   * Busca un comercial por su ID
   */
  async getComercialById(comercialid: number): Promise<AgroIrisComercial | null> {
    try {
      const comercial = await agroirisAuth.authenticatedFetch<AgroIrisComercial>(`/comercial/${comercialid}`);
      return comercial;
    } catch (error) {
      console.error(`Error obteniendo comercial ${comercialid}:`, error);
      return null;
    }
  }

  /**
   * Formatea los comerciales para usar en el componente de selección
   */
  formatComercialesForSelect(comerciales: AgroIrisComercial[]): ComercialSelectOption[] {
    return comerciales
      .map(comercial => {
        const label = comercial.nombre_comercial;
        const searchText = `${comercial.nombre_comercial} ${comercial.identificador_fiscal} ${comercial.comercialid}`.toLowerCase();

        return {
          value: comercial.comercialid,
          label,
          searchText,
          comercial,
        };
      })
      .sort((a, b) => a.comercial.nombre_comercial.localeCompare(b.comercial.nombre_comercial));
  }
}

export const agroirisComerciales = new AgroIrisComercialService();
