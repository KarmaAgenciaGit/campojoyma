export type AppUserRole = 'admin' | 'user';

export type FacturaRecibidaEstado =
  | 'borrador'
  | 'pendiente_revision'
  | 'validada'
  | 'enviada_erp'
  | 'error_erp'
  | 'descartada';

export interface FacturaRecibidaLinea {
  id?: string;
  factura_recibida_id?: string;
  posicion: number;
  descripcion: string;
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
  proveedor_cuenta: string | null;
  numero_factura: string | null;
  referencia: string | null;
  fr_alm: string | null;
  fr_sufa: string | null;
  fecha_factura: string | null;
  base_imponible: number | null;
  iva_porcentaje: number | null;
  iva_importe: number | null;
  retencion_porcentaje: number | null;
  retencion_importe: number | null;
  total: number | null;
  asunto_email: string | null;
  pdf_path: string | null;
  pdf_nombre: string | null;
  pdf_mime_type: string | null;
  pdf_size: number | null;
  validation_errors: string[] | null;
  erp_last_attempt_at: string | null;
  erp_sent_at: string | null;
  erp_response: Record<string, unknown> | null;
  erp_error: string | null;
  erp_payload: Record<string, unknown> | null;
  erp_factura_id: string | null;
  created_at: string;
  updated_at: string;
  facturas_recibidas_lineas?: FacturaRecibidaLinea[];
}
