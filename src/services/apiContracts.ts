export type AppUserRole = 'admin' | 'user';

export type FacturaRecibidaEstado =
  | 'borrador'
  | 'pendiente_revision'
  | 'validada'
  | 'enviada_gsbase'
  | 'error_gsbase'
  | 'descartada';

export interface FacturaRecibidaLinea {
  id?: string;
  factura_recibida_id?: string;
  posicion: number;
  descripcion: string;
  iva: number;
  importe: number;
  created_at?: string;
  updated_at?: string;
}

export interface FacturaRecibida {
  id: string;
  documento_codigo?: string | null;
  estado: FacturaRecibidaEstado;
  proveedor_nombre: string | null;
  proveedor_nif: string | null;
  proveedor_codigo: string | null;
  numero_factura: string | null;
  referencia: string | null;
  fr_alm: string | null;
  fr_sufa: string | null;
  fecha_factura: string | null;
  base_imponible: number | null;
  iva_importe: number | null;
  retencion_porcentaje: number | null;
  retencion_importe: number | null;
  descuento_general: number | null;
  descuento_pronto_pago: number | null;
  total: number | null;
  pendiente_pago: number | null;
  albaranes: string | null;
  email_remitente: string | null;
  asunto_email: string | null;
  pdf_path: string | null;
  pdf_nombre: string | null;
  pdf_mime_type: string | null;
  pdf_size: number | null;
  validation_errors: string[] | null;
  gsbase_last_attempt_at: string | null;
  gsbase_sent_at: string | null;
  gsbase_response: Record<string, unknown> | null;
  gsbase_error: string | null;
  gsbase_payload: Record<string, unknown> | null;
  gsbase_factura_id: string | null;
  created_at: string;
  updated_at: string;
  facturas_recibidas_lineas?: FacturaRecibidaLinea[];
}
