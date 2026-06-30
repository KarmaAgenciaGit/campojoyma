import { agroirisAuth } from './agroirisAuth';

export interface TipoCultivo {
  tipocultivoid: number;
  nombre_tipocultivo: string;
  abreviatura_tipocultivo: string;
  inc_gasto_estructura: number;
  inc_gasto_confeccion: number;
  incluir_en_balance: boolean;
  tipocultivo_predeterminado: boolean;
  activo: boolean;
}

/**
 * Realiza una petición autenticada a la API de configuración (puerto 7001)
 */
async function configApiFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const token = await agroirisAuth.getToken();
  
  if (!token) {
    throw new Error('No hay token de autenticación disponible');
  }

  const baseUrl = '/agroiris-config'; // Proxy configurado en vite.config.ts para puerto 7001
  const url = `${baseUrl}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Error en la petición: ${response.status} ${response.statusText}`);
  }

  return response;
}

/**
 * Obtiene todos los tipos de cultivo
 */
export async function getAllTipoCultivos(): Promise<TipoCultivo[]> {
  const response = await configApiFetch('/tipocultivo');
  return response.json();
}

/**
 * Obtiene un tipo de cultivo por su ID
 */
export async function getTipoCultivoById(id: number): Promise<TipoCultivo | null> {
  try {
    const response = await configApiFetch(`/tipocultivo/${id}`);
    return response.json();
  } catch (error) {
    console.error(`Error obteniendo tipo cultivo ${id}:`, error);
    return null;
  }
}

/**
 * Obtiene solo los tipos de cultivo activos
 */
export async function getTipoCultivosActivos(): Promise<TipoCultivo[]> {
  const all = await getAllTipoCultivos();
  return all.filter(tc => tc.activo);
}

/**
 * Obtiene el tipo de cultivo predeterminado
 */
export async function getTipoCultivoPredeterminado(): Promise<TipoCultivo | null> {
  const all = await getAllTipoCultivos();
  return all.find(tc => tc.tipocultivo_predeterminado) || null;
}

export const agroirisTipoCultivo = {
  getAllTipoCultivos,
  getTipoCultivoById,
  getTipoCultivosActivos,
  getTipoCultivoPredeterminado,
};
