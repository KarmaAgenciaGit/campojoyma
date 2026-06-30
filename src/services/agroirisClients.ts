/**
 * AgroIris API Client Service
 * Gestiona la obtención y caché de clientes
 */

import { agroirisAuth } from './agroirisAuth';

export interface AgroIrisClient {
  clienteid: number;
  sujetoid: number;
  perfilclienteid: number;
  fecha_bloqueo_cliente: string;
  motivo_bloqueo: string;
  fecha_alta_cliente: string;
  tipo_liquidacion_cliente: string;
  precio_cliente: string;
  valorar_envases: boolean;
  nofacturar_cliente: boolean;
  cliente_factura_id: number;
  cliente_saldo_env_id: number;
  cliente_envases_id: number;
  empresaid: number;
  comercialid: number;
  formadecobroid: number;
  tags_cliente: string;
  subgrupoanalisisid: number;
  activo_cliente: boolean;
  ean_cliente: string | null;
  edi_plataforma: string | null;
  edi_formato: string | null;
  edi_cliente: string;
  edi_pagador: string;
  edi_comprador: string;
  edi_contrato: string;
  observaciones: string;
  referencia: string;
  nombre_sujeto: string;
  apellido1_sujeto: string;
  apellido2_sujeto: string;
  tipo_documento: string;
  identificador_fiscal: string;
  idiomaid: number;
  divisaid: number;
  imagen_sujeto: string;
  web_sujeto: string;
  nombre_comercial: string;
  empresabancoid: number;
  tarifamaid: number;
}

export interface ClientSelectOption {
  value: number;
  label: string;
  searchText: string;
  client: AgroIrisClient;
}

const CACHE_KEY = 'agroiris_clients_cache';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos

interface ClientCache {
  data: AgroIrisClient[];
  timestamp: number;
}

class AgroIrisClientService {
  private clientsPromise: Promise<AgroIrisClient[]> | null = null;

  /**
   * Obtiene los clientes del caché si son válidos
   */
  private getCachedClients(): AgroIrisClient[] | null {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    try {
      const cacheData: ClientCache = JSON.parse(cached);
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
   * Guarda los clientes en el caché
   */
  private cacheClients(clients: AgroIrisClient[]): void {
    const cacheData: ClientCache = {
      data: clients,
      timestamp: Date.now(),
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
  }

  /**
   * Obtiene la lista de clientes de la API
   */
  private async fetchClients(): Promise<AgroIrisClient[]> {
    const clients = await agroirisAuth.authenticatedFetch<AgroIrisClient[]>('/cliente/');
    this.cacheClients(clients);
    return clients;
  }

  /**
   * Obtiene todos los clientes (usa caché si está disponible)
   */
  async getClients(forceRefresh: boolean = false): Promise<AgroIrisClient[]> {
    // Si hay una petición en progreso, esperarla
    if (this.clientsPromise) {
      return this.clientsPromise;
    }

    // Si no se fuerza refresh y hay caché válido, usarlo
    if (!forceRefresh) {
      const cached = this.getCachedClients();
      if (cached) {
        return cached;
      }
    }

    // Hacer petición a la API
    this.clientsPromise = this.fetchClients()
      .finally(() => {
        this.clientsPromise = null;
      });

    return this.clientsPromise;
  }

  /**
   * Busca un cliente por su ID
   */
  async getClientById(clienteid: number): Promise<AgroIrisClient | null> {
    const clients = await this.getClients();
    return clients.find(c => c.clienteid === clienteid) || null;
  }

  /**
   * Formatea los clientes para usar en el componente de selección
   */
  formatClientsForSelect(
    clients: AgroIrisClient[],
    { includeInactive = false }: { includeInactive?: boolean } = {}
  ): ClientSelectOption[] {
    return clients
      .filter(client => includeInactive || client.activo_cliente) // Solo clientes activos (por defecto)
      .map(client => {
        const nif = client.identificador_fiscal ? ` (${client.identificador_fiscal})` : '';
        const label = `${client.nombre_sujeto}${nif}`;
        const searchText = `${client.nombre_sujeto} ${client.identificador_fiscal} ${client.nombre_comercial}`.toLowerCase();

        return {
          value: client.clienteid,
          label,
          searchText,
          client,
        };
      })
      .sort((a, b) => a.client.nombre_sujeto.localeCompare(b.client.nombre_sujeto));
  }

  /**
   * Busca clientes por texto
   */
  async searchClients(query: string): Promise<ClientSelectOption[]> {
    const clients = await this.getClients();
    const options = this.formatClientsForSelect(clients);

    if (!query) return options;

    const searchQuery = query.toLowerCase();
    return options.filter(option => option.searchText.includes(searchQuery));
  }

  /**
   * Invalida el caché de clientes
   */
  invalidateCache(): void {
    localStorage.removeItem(CACHE_KEY);
    this.clientsPromise = null;
  }
}

// Exportar instancia singleton
export const agroirisClients = new AgroIrisClientService();
