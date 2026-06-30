import { agroirisAuth } from './agroirisAuth';

export interface PickingRequest {
  pedidoclienteid_origen: number | null;
  fecha_pedido_destino: string | null;
  fecha_carga_destino: string | null;
  clienteid_destino: number | null;
  sujetodomicilioid_destino: number | null;
  referencia_cliente_destino: string;
  referencia2_cliente_destino: string;
  detalles: Array<{
    pedidodetid_origen: number | null;
    palets_origen: number;
    palets_seleccionados: number;
  }>;
}

class AgroirisPickingService {
  /**
   * Envía el picking generado a la API de AgroIris (puerto 7000 a través del proxy /agroiris-api)
   */
  async generarPedidos(body: PickingRequest[]): Promise<any> {
    return agroirisAuth.authenticatedFetch(
      '/pedidodet/picking/externo/generarpedidos',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
  }
}

export const agroirisPicking = new AgroirisPickingService();
