import { agroirisAuth } from './agroirisAuth';

export interface Genero {
  generoid: number;
  nombre_genero: string;
  abreviatura_genero: string;
  especieid: number;
  subfamiliageneroid: number;
  unidadmedidaid: number;
  envaseid: number;
  paletid: number;
  gasto_confeccion: number;
  porcentajeid: number;
  observacion: string;
  foto_genero: string;
  activo: boolean;
  generoapiid: number;
  minimo_rectificacion_produc: number;
  maximo_rectificacion_produc: number;
  genero_cultivo: boolean;
  permitir_entrada: boolean;
  genero_color: string;
  subcentroid_confeccion: number;
}

class AgroirisGenerosService {
  async getGeneros(): Promise<Genero[]> {
    return await agroirisAuth.authenticatedFetch<Genero[]>('/genero');
  }

  async getGeneroById(id: number): Promise<Genero | null> {
    try {
      return await agroirisAuth.authenticatedFetch<Genero>(`/genero/${id}`);
    } catch (error: any) {
      if (error?.status === 404) {
        return null;
      }
      console.error('Error in getGeneroById:', error);
      throw error;
    }
  }
}

export const agroirisGeneros = new AgroirisGenerosService();
