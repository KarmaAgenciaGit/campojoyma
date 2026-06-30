/**
 * =====================================================
 * Servicio: AgroIris Domicilios
 * =====================================================
 * 
 * Propósito: Gestión de domicilios de sujetos (clientes)
 * Features:
 * - Obtener domicilio por ID
 * - Obtener todos los domicilios de un sujeto
 * - Soporte para domicilios de destino y envío
 * 
 * @author AgroIris Team
 * @date 2025-11-05
 */

import { agroirisAuth } from './agroirisAuth';

export interface SujetoDomicilio {
  sujetodomicilioid: number;
  sujetoid: number;
  tipo_domicilio: string; // 'D' = Destino, 'C' = Correspondencia, etc.
  nombre_identificador_domicilio_sujeto: string;
  tipoviaid: number;
  domicilio_sujeto: string;
  cp_domicilio_sujeto: string;
  poblacion_domicilio_sujeto: string;
  provincia_domicilio_sujeto: string;
  paisid: number;
  origenid: number;
  confeccionpaletid: number;
  observacion_domicilio_sujeto: string;
  registro_sanitario: string;
  ria: string;
  condicionentregaid: number;
  tarifaporteid: number;
  obs_albaran: string;
  obs_facturas: string;
  activo: boolean;
  edi_receptor: string;
  codigo_fianza: string;
  calidad: string | null;
  dia_max_producto: string;
  observaciones_alb_1: string;
  observaciones_alb_2: string;
  observaciones_alb_3: string;
  observaciones_alb_4: string;
  observaciones_alb_5: string;
  observaciones_alb_6: string;
  observaciones_fac_1: string;
  observaciones_fac_2: string;
  observaciones_fac_3: string;
  observaciones_fac_4: string;
  observaciones_fac_5: string;
  observaciones_fac_6: string;
  observaciones_prof_1: string | null;
  observaciones_prof_2: string | null;
  observaciones_prof_3: string | null;
  observaciones_prof_4: string | null;
  observaciones_prof_5: string | null;
  observaciones_prof_6: string | null;
  clienteplataformaid: number;
  impresionCMR: string | null;
  impresionSalida: string | null;
  impresionPaletEmpresa: string | null;
}

class AgroirisDomiciliosService {
  /**
   * Realizar fetch autenticado específico para la API de configuración (puerto 7001)
   */
  private async configApiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await agroirisAuth.getToken();
    if (!token) {
      throw new Error('No hay token de autenticación disponible');
    }

    const url = `/agroiris-config${endpoint}`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`Error en petición: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Obtener un domicilio por su ID
   */
  async getDomicilioById(domicilioId: number): Promise<SujetoDomicilio | null> {
    try {
      const data = await this.configApiFetch<SujetoDomicilio>(
        `/sujetodomicilio/${domicilioId}`
      );
      return data;
    } catch (error) {
      console.error('Error en getDomicilioById:', error);
      return null;
    }
  }

  /**
   * Obtener todos los domicilios de un sujeto
   */
  async getDomiciliosBySujetoId(sujetoId: number): Promise<SujetoDomicilio[]> {
    try {
      const data = await this.configApiFetch<SujetoDomicilio[]>(
        `/sujetodomicilio/sujetoid/${sujetoId}`
      );
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error en getDomiciliosBySujetoId:', error);
      return [];
    }
  }

  /**
   * Obtener el nombre descriptivo de un domicilio
   * Devuelve: "Nombre - Población, Provincia"
   */
  getDomicilioDisplayName(domicilio: SujetoDomicilio): string {
    const parts = [
      domicilio.nombre_identificador_domicilio_sujeto,
      domicilio.poblacion_domicilio_sujeto,
      domicilio.provincia_domicilio_sujeto
    ].filter(Boolean);

    return parts.join(', ') || 'Domicilio sin nombre';
  }

  /**
   * Obtener la dirección completa de un domicilio
   */
  getDomicilioFullAddress(domicilio: SujetoDomicilio): string {
    const parts = [
      domicilio.domicilio_sujeto,
      domicilio.cp_domicilio_sujeto,
      domicilio.poblacion_domicilio_sujeto,
      domicilio.provincia_domicilio_sujeto
    ].filter(Boolean);

    return parts.join(', ') || 'Dirección no disponible';
  }
}

export const agroirisDomicilios = new AgroirisDomiciliosService();
