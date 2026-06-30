import type { Database } from '@/integrations/supabase/types';

export type CambioPedido = {
  id: number;
  created_at: string;
  llegada_correo?: string | null;
  fecha_carga: string | null;
  fecha_pedido: string | null;
  clienteid: number | null;
  referencia_cliente: string | null;
  referencia2_cliente?: string | null;
  archivo_pdf_id: number | null;
  tipo_pedido: string | null;
  sujetodomicilioid_destino: number | null;
  idpedido_orizon: number | null;
  revisado: boolean;
  revisado_por?: string | null;
  revisado_en?: string | null;
  enviado_por?: string | null;
  enviado_en?: string | null;
  acreedorid_porte?: number | null;
  matricula_tractora?: string | null;
  matricula_remolque?: string | null;
  change_meta?: Record<string, unknown> | null;
};

export type ChangeMeta = {
  action: 'update' | 'add' | 'cancel';
  color: 'yellow' | 'orange';
  scope: 'cell' | 'row';
  columns: string[];
  cancel_reason?: string | null;
  confidence?: number;
};

export type ChangeMetaContainer = {
  _change?: ChangeMeta;
  raw?: string | null;
  note?: string | null;
  observaciones?: string | null;
  [key: string]: unknown;
};

export type CambioLinea = {
  pedidodetid: number;
  accion: 'upsert' | 'cancel';
  cancel_reason: string | null;
  descripcion_salida: string;
  bultos: number | null;
  bultosxpalet?: number | null;
  numero_palet?: string | number | null;
  piezasxbulto?: number | null;
  total_piezas?: number | null;
  kilosxbulto?: number | string | null;
  kilos_cliente: number | null;
  generoid: number | null;
  tipocultivoid?: number | null;
  origenid?: number | null;
  calibreid?: number | null;
  catalogoconfecid: number | null;
  grupoconfeccionid?: number | null;
  confeccionpaletid?: number | null;
  confeccionsalidaid?: number | null;
  catconfeckilosbultoid: number | null;
  catconfecpiezaid?: number | null;
  idpedidodet_orizon: number | null;
  ean?: string | null;
  ean_pieza?: string | null;
  ean_bulto?: string | null;
  ean_caja?: string | null;
  nlote_cliente?: string | null;
  precio_venta?: number | null;
  change_meta?: ChangeMetaContainer | null;
  _change?: ChangeMeta | null;
  observaciones?: string | null;
};

export type CambioDetalle = {
  header: CambioPedido;
  lineas: CambioLinea[];
  pedidoOriginal: Database['public']['Tables']['pedidos']['Row'] | null;
  lineasOriginales: Database['public']['Tables']['pedido_linea']['Row'][];
};
