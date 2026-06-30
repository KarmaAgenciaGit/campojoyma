/**
 * =====================================================
 * Servicio: AgroIris Origen API
 * =====================================================
 * 
 * Gestiona las peticiones a la API de Orígenes de AgroIris
 * Endpoint base: http://46.24.40.100:7001/api/origen
 * 
 * @author AgroIris Team
 * @date 2025-11-06
 */

import { agroirisAuth } from './agroirisAuth';

export interface Origen {
  origenid: number;
  nombre_origen: string;
  origen_predeterminado: boolean;
  activo: boolean;
  codigo_origen_iso: string;
}

class AgroirisOrigenService {
  /**
   * Realizar fetch autenticado específico para la API de configuración (puerto 7001)
   */
  private async configApiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    // El proxy de Vite redirige /agroiris-config/* a http://46.24.40.100:7001/api/*
    // Obtener token primero
    const token = await agroirisAuth.getToken();
    
    const url = `/agroiris-config${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'accept': 'text/plain',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error: any = new Error(`Error en petición: ${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * Obtiene todos los orígenes
   */
  async getAllOrigenes(): Promise<Origen[]> {
    try {
      return await this.configApiFetch<Origen[]>('/origen');
    } catch (error) {
      console.error('Error obteniendo orígenes:', error);
      throw error;
    }
  }

  /**
   * Obtiene un origen por ID
   */
  async getOrigenById(id: number): Promise<Origen | null> {
    try {
      return await this.configApiFetch<Origen>(`/origen/${id}`);
    } catch (error) {
      console.error(`Error obteniendo origen ${id}:`, error);
      return null;
    }
  }

  /**
   * Obtiene solo orígenes activos
   */
  async getOrigenesActivos(): Promise<Origen[]> {
    const origenes = await this.getAllOrigenes();
    return origenes.filter(o => o.activo);
  }

  /**
   * Obtiene el origen predeterminado
   */
  async getOrigenPredeterminado(): Promise<Origen | null> {
    const origenes = await this.getAllOrigenes();
    return origenes.find(o => o.origen_predeterminado) || null;
  }
}

export const agroirisOrigenes = new AgroirisOrigenService();
