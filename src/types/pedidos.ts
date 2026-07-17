import type { Database } from '@/integrations/supabase/types';

export type Pedido = Database['public']['Tables']['pedidos']['Row'];
export type PedidoLinea = Database['public']['Tables']['pedido_linea']['Row'];
export type PedidoLineaCentro = Database['public']['Tables']['pedido_linea_centro']['Row'];
export type Prevision = Database['public']['Tables']['previsiones']['Row'];

// Extiende pedido con información de matching de previsión (P22E)
export type PedidoWithMatch = Pedido & {
  matching_prevision_id?: number | null;
  matching_prevision_uploaded?: boolean;
  matching_cambio_id?: number | null;
  matching_cambio_archivo_pdf_id?: number | null;
  matching_cambio_reference?: string | null;
  matching_cambio_created_at?: string | null;
  matching_cambio_revisado?: boolean | null;
  lineas_count?: number;
};

export interface PedidoWithDetails extends Pedido {
  lineas?: (PedidoLinea & { centros?: PedidoLineaCentro[] })[];
  matching_cambio_id?: number | null;
  matching_cambio_revisado?: boolean | null;
}

export interface PrevisionWithDetails extends Prevision {
  lineas?: (PedidoLinea & { centros?: PedidoLineaCentro[] })[];
}

export type TipoPedido = 'P220' | 'P22E';
export type PedidoSortBy = 'business_date' | 'email_arrival';
export type CeoxStatusFilter = 'all' | 'in_ceox' | 'not_in_ceox' | 'in_ceox_outdated';

export interface PedidoFilters {
  referencia: string;
  clienteId?: number;
  domicilioDestinoId?: number;
  fechaPedidoRango: {
    from: string;
    to: string;
  };
  fechaCargaDesde: string;
  fechaCargaHasta: string;
  fechaCargaRango: {
    from: string;
    to: string;
  };
  estado?: string;
  ceoxStatus: CeoxStatusFilter;
  tieneMatricula: boolean;
  tieneCambio: boolean;
  tienePrevision: boolean;
  sortBy: PedidoSortBy;
  order: 'asc' | 'desc';
}

export interface PedidoNombres {
  clienteNombre: string;
  clienteEnvioNombre: string;
  divisaNombre: string;
  clienteDivisaId: number | null;
  clienteDivisaNombre: string;
  serieDescripcion: string;
  comercialNombre: string;
  acreedorNombre: string;
  domicilioDestinoNombre: string;
  domicilioEnvioNombre: string;
  generoNombres: Record<number, string>;
  calibreNombres: Record<number, string>;
  origenNombres: Record<number, string>;
  tipoCultivoNombres: Record<number, string>;
  catalogoConfecNombres: Record<number, string>;
  grupoConfeccionNombres: Record<number, string>;
  confeccionPaletNombres: Record<number, string>;
  confeccionSalidaNombres: Record<number, string>;
}

export interface PedidoEditState {
  isEditing: boolean;
  editedPedido: Partial<Pedido>;
  editedLineas: Record<number, Partial<PedidoLinea>>;
  editedCentros: Record<number, Partial<PedidoLineaCentro>>;
  editingLineaId: number | null;
}

export interface NewPedidoLineaDraft {
  tempId: string;
  generoid: number | null;
  tipocultivoid: number | null;
  catalogoconfecid: number | null;
  grupoconfeccionid: number | null;
  confeccionpaletid: number | null;
  confeccionsalidaid: number | null;
  origenid: number | null;
  calibreid: number | null;
  bultos: number | null;
  bultosxpalet: number | null;
  numero_palet: number | null;
  piezasxbulto: number | null;
  total_piezas: number | null;
  kilosxbulto: number | null;
  kilos_cliente: number | null;
  descripcion_salida: string;
  catconfecpiezaid: number | null;
  catconfeckilosbultoid: number | null;
  ean?: string | null;
  ean_pieza?: string | null;
  ean_bulto?: string | null;
  ean_caja?: string | null;
  nlote_cliente?: string | null;
  precio_venta?: number | null;
}

export interface PedidoLineaClipboard {
  payload: Omit<NewPedidoLineaDraft, 'tempId'>;
  sourcePedidoId: number | null;
  sourceLineaId: number | string | null;
  label: string;
  createdAt: number;
}
