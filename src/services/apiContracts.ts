export type AppUserRole = 'admin' | 'user';

export type FacturaRecibidaEstado =
  | 'borrador'
  | 'pendiente_revision'
  | 'validada'
  | 'enviada_erp'
  | 'error_erp'
  | 'descartada';

export type FacturaRecibidaIvaPosicion = 1 | 2 | 3 | 4 | 5;
export type FacturaRecibidaVencimientoPosicion = 1 | 2 | 3 | 4;
export type FacturaRecibidaAccountingStatus =
  | 'not_requested'
  | 'pending'
  | 'created'
  | 'not_found'
  | 'unbalanced'
  | 'error'
  | string;

export interface FacturaRecibidaIvaTramo {
  posicion: FacturaRecibidaIvaPosicion;
  base: number | null;
  porcentaje: number | null;
  cuota: number | null;
}

export interface FacturaRecibidaVencimiento {
  posicion: FacturaRecibidaVencimientoPosicion;
  fecha: string | null;
  importe: number | null;
}

export interface FacturaRecibidaLinea {
  id?: string;
  factura_recibida_id?: string;
  posicion: number;
  descripcion: string;
  importe: number;
  FRC_id?: number | null;
  FRC_idfacturarecibida?: number | null;
  FRC_IdActividad?: number | null;
  FRC_Idseccion?: number | null;
  FRC_Iddepartamento?: number | null;
  FRC_Idsubdepartamento?: number | null;
  FRC_IdUsuarioLog?: number | null;
  FRC_FechaLog?: string | null;
  FRC_HoraLog?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface FacturaRecibidaPunteoLinea {
  id?: string | number | null;
  posicion?: number | null;
  articulo_id?: string | number | null;
  descripcion?: string | null;
  referencia?: string | null;
  cantidad?: number | null;
  precio?: number | null;
  importe?: number | null;
  observaciones?: string | null;
  unidad_id?: string | number | null;
  raw?: Record<string, unknown> | null;
}

export interface FacturaRecibidaPunteo {
  id?: string;
  posicion: number;
  remote_id?: string | null;
  source_table?: string | null;
  source_id?: number | null;
  importe_factura?: number | null;
  origen: string | null;
  serie: string | null;
  albaran: number | null;
  ref: string | null;
  fecha: string | null;
  importe_punteado: number | null;
  importe: number | null;
  seleccionado: boolean;
  ver: boolean;
  empresa_id?: number | null;
  proveedor_id?: number | null;
  cuenta_gasto?: string | null;
  line_count?: number | null;
  lines?: FacturaRecibidaPunteoLinea[];
  raw?: Record<string, unknown> | null;
}

export interface FacturaRecibidaAsientoLinea {
  id?: string | number | null;
  posicion: number;
  cuenta: string | null;
  descripcion: string | null;
  debe: number;
  haber: number;
  actividad_id?: number | null;
  seccion_id?: number | null;
  departamento_id?: number | null;
  subdepartamento_id?: number | null;
  raw?: Record<string, unknown> | null;
}

export interface FacturaRecibidaAccounting {
  requested: boolean;
  created: boolean;
  status: FacturaRecibidaAccountingStatus;
  technical_id: number | null;
  visible_number: string | null;
  fecha: string | null;
  concepto: string | null;
  balanced: boolean | null;
  total_debe: number | null;
  total_haber: number | null;
  lines: FacturaRecibidaAsientoLinea[];
  error?: string | null;
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
  ejercicio: number | null;
  fecha_ctb: string | null;
  tipo_iva_codigo: string | null;
  /** @deprecated Es el identificador técnico. Usa asiento_tecnico para mostrarlo explícitamente. */
  asiento: number | null;
  asiento_tecnico?: number | null;
  asiento_numero?: string | null;
  asiento_fecha?: string | null;
  asiento_estado?: FacturaRecibidaAccountingStatus | null;
  asiento_cuadrado?: boolean | null;
  asiento_total_debe?: number | null;
  asiento_total_haber?: number | null;
  asiento_lineas?: FacturaRecibidaAsientoLinea[];
  accounting?: FacturaRecibidaAccounting | null;
  fr_alm: string | null;
  fr_sufa: string | null;
  fecha_factura: string | null;
  iva_tramos?: FacturaRecibidaIvaTramo[];
  base_imponible: number | null;
  iva_porcentaje: number | null;
  iva_importe: number | null;
  base_retencion?: number | null;
  retencion_porcentaje: number | null;
  retencion_importe: number | null;
  clave_irpf?: string | null;
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
  source_kind?: string | null;
  remote_frr_id?: number | null;
  is_readonly_reference?: boolean;
  match_status?: string | null;
  match_evidence?: Record<string, unknown> | null;
  concepto_asiento?: string | null;
  obs_aeat?: string | null;
  observaciones?: string | null;
  cuota_no_deducible?: number | null;
  cuenta_suplido?: string | null;
  importe_suplido?: number | null;
  contabilizar?: string | null;
  genera_cartera?: string | null;
  forma_pago?: string | null;
  cta_cartera?: string | null;
  banco?: string | null;
  tipo_doc?: string | null;
  fecha_vto?: string | null;
  importe_vto?: number | null;
  vencimientos?: FacturaRecibidaVencimiento[];
  version?: number | null;
  sync_status?: string | null;
  accounting_status?: string | null;
  erp_last_read_at?: string | null;
  created_at: string;
  updated_at: string;
  ctb_lineas?: FacturaRecibidaLinea[];
  punteos?: FacturaRecibidaPunteo[];
  facturas_recibidas_lineas?: FacturaRecibidaLinea[];
}
