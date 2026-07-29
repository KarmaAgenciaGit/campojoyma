export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type AlbaranesEntradaRow = {
  id: string
  estado: string
  agricultor_nombre: string | null
  source_pdf_name: string | null
  confidence: number | null
  extraction: Json
  validation_errors: Json
  AEN_idalbaran: number | null
  AEN_campa: number | null
  AEN_serie: string | null
  AEN_albaran: number | null
  AEN_fecha: string | null
  AEN_idagricultor: number | null
  AEN_idpuntoventa: number | null
  AEN_idcentro: number | null
  AEN_referencia: string | null
  AEN_IdEmpresaAgricultor: number | null
  erp_sent_at: string | null
  erp_sent_by: string | null
  erp_response: Json | null
  erp_error: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  source_kind: string
  is_readonly_reference: boolean
  match_status: string
  match_evidence: Json
  row_version: number
  sync_status: string
  erp_last_read_at: string | null
  erp_last_read_payload: Json | null
  last_request_id: string | null
}

type FacturasRecibidasRow = {
  id: string
  archivo_pdf_id: number | null
  duplicada_de: string | null
  estado: string
  proveedor_nombre: string | null
  proveedor_nif: string | null
  source_pdf_name: string | null
  source_page_number: number | null
  source_page_count: number | null
  email_from: string | null
  email_subject: string | null
  email_received_at: string | null
  confidence: number | null
  extraction: Json
  validation_errors: Json
  source_kind: string
  remote_frr_id: number | null
  is_readonly_reference: boolean
  match_status: string
  match_evidence: Json
  row_version: number
  sync_status: string
  accounting_status: string
  accounting_visible_number: string | null
  accounting_date: string | null
  erp_last_read_at: string | null
  erp_last_read_payload: Json | null
  last_request_id: string | null
  FRR_id: number | null
  FRR_numero: number | null
  FRR_fechafactura: string | null
  FRR_numerofactura: string | null
  FRR_ejercicio: number | null
  FRR_idcentro: number | null
  FRR_idproveedor: number | null
  FRR_idregimen: number | null
  FRR_fechactb: string | null
  FRR_base1: number | null
  FRR_base2: number | null
  FRR_base3: number | null
  FRR_base4: number | null
  FRR_base5: number | null
  FRR_iva1: number | null
  FRR_iva2: number | null
  FRR_iva3: number | null
  FRR_iva4: number | null
  FRR_iva5: number | null
  FRR_cuota1: number | null
  FRR_cuota2: number | null
  FRR_cuota3: number | null
  FRR_cuota4: number | null
  FRR_cuota5: number | null
  FRR_baseret: number | null
  FRR_ret: number | null
  FRR_cuotaret: number | null
  FRR_igasto1: number | null
  FRR_ctagasto1: string | null
  FRR_igasto2: number | null
  FRR_ctagasto2: string | null
  FRR_igasto3: number | null
  FRR_ctagasto3: string | null
  FRR_igasto4: number | null
  FRR_ctagasto4: string | null
  FRR_totalfac: number | null
  FRR_tipofactura: string | null
  FRR_idcuenta: string | null
  FRR_idpuntoventa: number | null
  FRR_ClaveIRPF: string | null
  FRR_IdAsientoNet: number | null
  FRR_CtaCartera: string | null
  FRR_IdBanco: number | null
  FRR_IdFormaPago: number | null
  FechaVto: string | null
  ImporteVto: number | null
  FRR_Modificable: string | null
  FRR_Idempresa: number | null
  FRR_idpago: number | null
  FRR_IdUsuarioLog: number | null
  FRR_FechaLog: string | null
  FRR_HoraLog: string | null
  FRR_Concepto: string | null
  FRR_GeneraCartera: string | null
  FRR_FechaVto1: string | null
  FRR_ImporteVto1: number | null
  FRR_FechaVto2: string | null
  FRR_ImporteVto2: number | null
  FRR_FechaVto3: string | null
  FRR_ImporteVto3: number | null
  FRR_IdTipoDoc: number | null
  FRR_IdAgricultorDto: number | null
  FRR_CtaSuplido: string | null
  FRR_ImpSuplido: number | null
  FRR_CuotaNoDeducible: number | null
  FRR_CancelarporCtb: string | null
  FRR_Observaciones: string | null
  FRR_FechaPrevPago: string | null
  FRR_BancoPrevPago: number | null
  FRR_IdSeccion: number | null
  FRR_IdActividad: number | null
  FRR_ObservacionesAEAT: string | null
  FRR_Contabilizar: string | null
  FRR_IdfacturaRec: number | null
  erp_sent_at: string | null
  erp_sent_by: string | null
  erp_response: Json | null
  erp_error: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

type FacturasRecibidasCtbRow = {
  id: string
  factura_id: string
  posicion: number
  FRC_id: number | null
  FRC_idfacturarecibida: number | null
  FRC_Importe: number | null
  FRC_Cuenta: string | null
  FRC_IdActividad: number | null
  FRC_Idseccion: number | null
  FRC_Iddepartamento: number | null
  FRC_Idsubdepartamento: number | null
  FRC_IdUsuarioLog: number | null
  FRC_FechaLog: string | null
  FRC_HoraLog: string | null
  created_at: string
  updated_at: string
}

type FacturasRecibidasPunteoRow = {
  id: string
  factura_id: string
  posicion: number
  remote_id: string | null
  source_table: string | null
  source_id: number | null
  importe_factura: number | null
  line_count: number
  source_lines: Json
  Origen: string | null
  Serie: string | null
  Albaran: number | null
  Ref: string | null
  Fecha: string | null
  "Importe P": number | null
  Importe: number | null
  S: boolean
  Ver: boolean
  empresa_id: number | null
  proveedor_id: number | null
  cuenta_gasto: string | null
  raw: Json
  created_at: string
  updated_at: string
}

type FacturasRecibidasRevisionRow = {
  id: number
  factura_id: string
  revision_number: number
  request_id: string | null
  change_type: string
  change_source: string
  reason: string | null
  changed_by: string | null
  snapshot: Json
  created_at: string
}

type FacturasRecibidasSyncAttemptRow = {
  id: string
  factura_id: string
  request_id: string
  contract_version: number
  phase: string
  dry_run: boolean
  status: string
  request_payload: Json
  response_payload: Json | null
  http_status: number | null
  error: string | null
  started_at: string
  completed_at: string | null
  created_by: string | null
  updated_at: string
}

type FacturasRecibidasAsientoRow = {
  id: string
  factura_id: string
  request_id: string
  technical_id: number | null
  visible_number: string | null
  accounting_date: string | null
  concept: string | null
  status: string
  total_debit: number
  total_credit: number
  balanced: boolean
  raw: Json
  captured_at: string
}

type FacturasRecibidasAsientoApunteRow = {
  id: string
  asiento_id: string
  posicion: number
  cuenta: string | null
  descripcion: string | null
  debe: number
  haber: number
  analytic: Json
  raw: Json
}

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      archivos_pdf: {
        Row: {
          b64_contenido: string | null
          created_at: string
          created_by: string | null
          hash_sha256: string
          id: number
          mime_type: string
          nombre_archivo: string | null
          storage_bucket: string | null
          storage_path: string | null
          storage_uploaded_at: string | null
          tamanio_bytes: number
          updated_at: string
        }
        Insert: {
          b64_contenido?: string | null
          created_at?: string
          created_by?: string | null
          hash_sha256: string
          id?: number
          mime_type?: string
          nombre_archivo?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          storage_uploaded_at?: string | null
          tamanio_bytes: number
          updated_at?: string
        }
        Update: {
          b64_contenido?: string | null
          created_at?: string
          created_by?: string | null
          hash_sha256?: string
          id?: number
          mime_type?: string
          nombre_archivo?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          storage_uploaded_at?: string | null
          tamanio_bytes?: number
          updated_at?: string
        }
        Relationships: []
      }
      facturas_recibidas_erp_rules: {
        Row: {
          activo: boolean
          approval_note: string | null
          concepto_template: string | null
          contabilizar_default: string | null
          created_at: string
          cuenta_gasto_default: string | null
          ejercicio_erp: number | null
          empresa_id: number
          fecha_ctb_policy: string | null
          id: string
          proveedor_id: number | null
          regimen_id: number | null
          tipo_factura: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          approval_note?: string | null
          concepto_template?: string | null
          contabilizar_default?: string | null
          created_at?: string
          cuenta_gasto_default?: string | null
          ejercicio_erp?: number | null
          empresa_id: number
          fecha_ctb_policy?: string | null
          id?: string
          proveedor_id?: number | null
          regimen_id?: number | null
          tipo_factura?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          approval_note?: string | null
          concepto_template?: string | null
          contabilizar_default?: string | null
          created_at?: string
          cuenta_gasto_default?: string | null
          ejercicio_erp?: number | null
          empresa_id?: number
          fecha_ctb_policy?: string | null
          id?: string
          proveedor_id?: number | null
          regimen_id?: number | null
          tipo_factura?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      albaranesentrada: {
        Row: AlbaranesEntradaRow
        Insert: Partial<AlbaranesEntradaRow>
        Update: Partial<AlbaranesEntradaRow>
        Relationships: []
      }
      facturasrecibidas: {
        Row: FacturasRecibidasRow
        Insert: Partial<FacturasRecibidasRow>
        Update: Partial<FacturasRecibidasRow>
        Relationships: [
          {
            foreignKeyName: "facturasrecibidas_archivo_pdf_id_fkey"
            columns: ["archivo_pdf_id"]
            isOneToOne: false
            referencedRelation: "archivos_pdf"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturasrecibidas_duplicada_de_fkey"
            columns: ["duplicada_de"]
            isOneToOne: false
            referencedRelation: "facturasrecibidas"
            referencedColumns: ["id"]
          },
        ]
      }
      facturasrecibidas_ctb: {
        Row: FacturasRecibidasCtbRow
        Insert: Partial<FacturasRecibidasCtbRow> & Pick<FacturasRecibidasCtbRow, "factura_id">
        Update: Partial<FacturasRecibidasCtbRow>
        Relationships: [
          {
            foreignKeyName: "facturasrecibidas_ctb_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturasrecibidas"
            referencedColumns: ["id"]
          },
        ]
      }
      facturasrecibidas_punteos: {
        Row: FacturasRecibidasPunteoRow
        Insert: Partial<FacturasRecibidasPunteoRow> & Pick<FacturasRecibidasPunteoRow, "factura_id">
        Update: Partial<FacturasRecibidasPunteoRow>
        Relationships: [
          {
            foreignKeyName: "facturasrecibidas_punteos_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturasrecibidas"
            referencedColumns: ["id"]
          },
        ]
      }
      facturasrecibidas_revisions: {
        Row: FacturasRecibidasRevisionRow
        Insert: Partial<FacturasRecibidasRevisionRow> &
          Pick<FacturasRecibidasRevisionRow, "factura_id" | "revision_number" | "change_type" | "change_source" | "snapshot">
        Update: Partial<FacturasRecibidasRevisionRow>
        Relationships: []
      }
      facturasrecibidas_sync_attempts: {
        Row: FacturasRecibidasSyncAttemptRow
        Insert: Partial<FacturasRecibidasSyncAttemptRow> &
          Pick<FacturasRecibidasSyncAttemptRow, "factura_id" | "request_id" | "phase" | "dry_run">
        Update: Partial<FacturasRecibidasSyncAttemptRow>
        Relationships: []
      }
      facturasrecibidas_asientos: {
        Row: FacturasRecibidasAsientoRow
        Insert: Partial<FacturasRecibidasAsientoRow> &
          Pick<FacturasRecibidasAsientoRow, "factura_id" | "request_id" | "status">
        Update: Partial<FacturasRecibidasAsientoRow>
        Relationships: [
          {
            foreignKeyName: "facturasrecibidas_asientos_factura_id_fkey"
            columns: ["factura_id"]
            isOneToOne: false
            referencedRelation: "facturasrecibidas"
            referencedColumns: ["id"]
          },
        ]
      }
      facturasrecibidas_asiento_apuntes: {
        Row: FacturasRecibidasAsientoApunteRow
        Insert: Partial<FacturasRecibidasAsientoApunteRow> &
          Pick<FacturasRecibidasAsientoApunteRow, "asiento_id" | "posicion">
        Update: Partial<FacturasRecibidasAsientoApunteRow>
        Relationships: [
          {
            foreignKeyName: "facturasrecibidas_asiento_apuntes_asiento_id_fkey"
            columns: ["asiento_id"]
            isOneToOne: false
            referencedRelation: "facturasrecibidas_asientos"
            referencedColumns: ["id"]
          },
        ]
      }
      cambios: {
        Row: {
          created_at: string
          fecha: string
          id: number
        }
        Insert: {
          created_at?: string
          fecha?: string
          id?: number
        }
        Update: {
          created_at?: string
          fecha?: string
          id?: number
        }
        Relationships: []
      }
      clientes_visibles: {
        Row: {
          clienteid: number
          created_at: string
          updated_at: string
        }
        Insert: {
          clienteid: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          clienteid?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      clientes_visibles_cuentaventa: {
        Row: {
          clienteid: number
          created_at: string
          updated_at: string
        }
        Insert: {
          clienteid: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          clienteid?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      cliente_behavior_rules: {
        Row: {
          allow_duplicate_reference: boolean
          allow_create_new_order_from_unmatched_change: boolean
          block_duplicate_reference_same_pdf: boolean
          clear_reference_in_orizon_payload: boolean
          clear_references_in_picking: boolean
          clienteid: number
          created_at: string
          match_reference_by_digits_fallback: boolean
          map_reference_to_nlote_in_orizon: boolean
          require_name_prefixes: string[]
          require_name_prefixes_cuentaventa: string[]
          require_name_prefixes_pedidos: string[]
          skip_name_includes: string[]
          skip_name_includes_cuentaventa: string[]
          skip_name_includes_pedidos: string[]
          updated_at: string
          use_lot_labels: boolean
        }
        Insert: {
          allow_duplicate_reference?: boolean
          allow_create_new_order_from_unmatched_change?: boolean
          block_duplicate_reference_same_pdf?: boolean
          clear_reference_in_orizon_payload?: boolean
          clear_references_in_picking?: boolean
          clienteid: number
          created_at?: string
          match_reference_by_digits_fallback?: boolean
          map_reference_to_nlote_in_orizon?: boolean
          require_name_prefixes?: string[]
          require_name_prefixes_cuentaventa?: string[]
          require_name_prefixes_pedidos?: string[]
          skip_name_includes?: string[]
          skip_name_includes_cuentaventa?: string[]
          skip_name_includes_pedidos?: string[]
          updated_at?: string
          use_lot_labels?: boolean
        }
        Update: {
          allow_duplicate_reference?: boolean
          allow_create_new_order_from_unmatched_change?: boolean
          block_duplicate_reference_same_pdf?: boolean
          clear_reference_in_orizon_payload?: boolean
          clear_references_in_picking?: boolean
          clienteid?: number
          created_at?: string
          match_reference_by_digits_fallback?: boolean
          map_reference_to_nlote_in_orizon?: boolean
          require_name_prefixes?: string[]
          require_name_prefixes_cuentaventa?: string[]
          require_name_prefixes_pedidos?: string[]
          skip_name_includes?: string[]
          skip_name_includes_cuentaventa?: string[]
          skip_name_includes_pedidos?: string[]
          updated_at?: string
          use_lot_labels?: boolean
        }
        Relationships: []
      }
      errores: {
        Row: {
          created_at: string
          detalles: string | null
          estado: string | null
          id: string
          metadata: Json | null
          motivo: string
          raw_payload: Json | null
          severidad: string | null
          source: string | null
          tipo: string | null
        }
        Insert: {
          created_at?: string
          detalles?: string | null
          estado?: string | null
          id?: string
          metadata?: Json | null
          motivo: string
          raw_payload?: Json | null
          severidad?: string | null
          source?: string | null
          tipo?: string | null
        }
        Update: {
          created_at?: string
          detalles?: string | null
          estado?: string | null
          id?: string
          metadata?: Json | null
          motivo?: string
          raw_payload?: Json | null
          severidad?: string | null
          source?: string | null
          tipo?: string | null
        }
        Relationships: []
      }
      pedido_linea: {
        Row: {
          bultos: number
          bultosxpalet: number
          calibreid: number
          catalogoconfecid: number
          catconfeckilosbultoid: number | null
          catconfecpiezaid: number | null
          confeccionpaletid: number
          confeccionsalidaid: number
          created_at: string | null
          descripcion_salida: string
          ean: string | null
          ean_caja: string | null
          generoid: number
          grupoconfeccionid: number
          idpedidodet_orizon: number | null
          kilos_cliente: number | null
          kilosxbulto: number | null
          nlote_cliente: string | null
          numero_palet: number
          origenid: number
          pedidodetid: number
          pedidoid: number
          precio_venta: number | null
          piezasxbulto: number | null
          tipocultivoid: number
          total_piezas: number | null
          updated_at: string | null
        }
        Insert: {
          bultos: number
          bultosxpalet: number
          calibreid: number
          catalogoconfecid: number
          catconfeckilosbultoid?: number | null
          catconfecpiezaid?: number | null
          confeccionpaletid: number
          confeccionsalidaid: number
          created_at?: string | null
          descripcion_salida: string
          ean?: string | null
          ean_caja?: string | null
          generoid: number
          grupoconfeccionid: number
          idpedidodet_orizon?: number | null
          kilos_cliente?: number | null
          kilosxbulto?: number | null
          nlote_cliente?: string | null
          numero_palet: number
          origenid: number
          pedidodetid?: number
          pedidoid: number
          precio_venta?: number | null
          piezasxbulto?: number | null
          tipocultivoid: number
          total_piezas?: number | null
          updated_at?: string | null
        }
        Update: {
          bultos?: number
          bultosxpalet?: number
          calibreid?: number
          catalogoconfecid?: number
          catconfeckilosbultoid?: number | null
          catconfecpiezaid?: number | null
          confeccionpaletid?: number
          confeccionsalidaid?: number
          created_at?: string | null
          descripcion_salida?: string
          ean?: string | null
          ean_caja?: string | null
          generoid?: number
          grupoconfeccionid?: number
          idpedidodet_orizon?: number | null
          kilos_cliente?: number | null
          kilosxbulto?: number | null
          nlote_cliente?: string | null
          numero_palet?: number
          origenid?: number
          pedidodetid?: number
          pedidoid?: number
          precio_venta?: number | null
          piezasxbulto?: number | null
          tipocultivoid?: number
          total_piezas?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_linea_pedidoid_fkey"
            columns: ["pedidoid"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_linea_centro: {
        Row: {
          asignacion: string
          created_at: string | null
          numero_palets: number
          pedcentroid: number
          pedidodetid: number
          pedidocentroid_orizon: number | null
          subprov: number
          updated_at: string | null
        }
        Insert: {
          asignacion: string
          created_at?: string | null
          numero_palets: number
          pedcentroid?: number
          pedidodetid: number
          pedidocentroid_orizon?: number | null
          subprov: number
          updated_at?: string | null
        }
        Update: {
          asignacion?: string
          created_at?: string | null
          numero_palets?: number
          pedcentroid?: number
          pedidodetid?: number
          pedidocentroid_orizon?: number | null
          subprov?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_linea_centro_pedidodetid_fkey"
            columns: ["pedidodetid"]
            isOneToOne: false
            referencedRelation: "pedido_linea"
            referencedColumns: ["pedidodetid"]
          },
        ]
      }
      pedidos: {
        Row: {
          acreedorid_porte: number | null
          archivo_pdf_id: number | null
          b64_pedido: string | null
          clienteid: number | null
          clienteid_envio: number | null
          comercialid: number | null
          created_at: string
          divisa_cliente: number | null
          enviado_en: string | null
          enviado_por: string | null
          fecha: string
          fecha_carga: string | null
          fecha_pedido: string | null
          id: number
          llegada_correo: string | null
          matricula_remolque: string | null
          matricula_tractora: string | null
          referencia_cliente: string | null
          referencia2_cliente: string | null
          enviado: boolean | null
          enviado_orizon: boolean
          idpedido_orizon: number | null
          needs_sync: boolean
          pedidoclienteid: string | number | null
          serieid: number
          sujetodomicilioid_destino: number | null
          sujetodomicilioid_envio: number | null
          tipo_pedido: string
          updated_at: string | null
        }
        Insert: {
          acreedorid_porte?: number | null
          archivo_pdf_id?: number | null
          b64_pedido?: string | null
          clienteid?: number | null
          clienteid_envio?: number | null
          comercialid?: number | null
          created_at?: string
          divisa_cliente?: number | null
          enviado_en?: string | null
          enviado_por?: string | null
          fecha?: string
          fecha_carga?: string | null
          fecha_pedido?: string | null
          id?: number
          llegada_correo?: string | null
          matricula_remolque?: string | null
          matricula_tractora?: string | null
          referencia_cliente?: string | null
          referencia2_cliente?: string | null
          enviado?: boolean | null
          enviado_orizon?: boolean
          idpedido_orizon?: number | null
          needs_sync?: boolean
          pedidoclienteid?: string | number | null
          serieid?: number
          sujetodomicilioid_destino?: number | null
          sujetodomicilioid_envio?: number | null
          tipo_pedido?: string
          updated_at?: string | null
        }
        Update: {
          acreedorid_porte?: number | null
          archivo_pdf_id?: number | null
          b64_pedido?: string | null
          clienteid?: number | null
          clienteid_envio?: number | null
          comercialid?: number | null
          created_at?: string
          divisa_cliente?: number | null
          enviado_en?: string | null
          enviado_por?: string | null
          fecha?: string
          fecha_carga?: string | null
          fecha_pedido?: string | null
          id?: number
          llegada_correo?: string | null
          matricula_remolque?: string | null
          matricula_tractora?: string | null
          referencia_cliente?: string | null
          referencia2_cliente?: string | null
          enviado?: boolean | null
          enviado_orizon?: boolean
          idpedido_orizon?: number | null
          needs_sync?: boolean
          pedidoclienteid?: string | number | null
          serieid?: number
          sujetodomicilioid_destino?: number | null
          sujetodomicilioid_envio?: number | null
          tipo_pedido?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_archivo_pdf_id_fkey"
            columns: ["archivo_pdf_id"]
            isOneToOne: false
            referencedRelation: "archivos_pdf"
            referencedColumns: ["id"]
          },
        ]
      }
      previsiones: {
        Row: {
          acreedorid_porte: number | null
          clienteid: number | null
          comercialid: number | null
          created_at: string
          divisa_cliente: number | null
          estado: string | null
          fecha: string
          fecha_carga: string | null
          fecha_llegada: string | null
          fecha_pedido: string | null
          id: number
          list_linea_ped: Json | null
          needs_sync: boolean
          matricula_tractora: string | null
          nombre_transportista: string | null
          pdf_base64: string | null
          serieid: number | null
          sujetodomicilioid_destino: number | null
          sujetodomicilioid_envio: number | null
          tipo_pedido: string | null
          updated_at: string | null
        }
        Insert: {
          acreedorid_porte?: number | null
          clienteid?: number | null
          comercialid?: number | null
          created_at?: string
          divisa_cliente?: number | null
          estado?: string | null
          fecha?: string
          fecha_carga?: string | null
          fecha_llegada?: string | null
          fecha_pedido?: string | null
          id?: number
          list_linea_ped?: Json | null
          needs_sync?: boolean
          matricula_tractora?: string | null
          nombre_transportista?: string | null
          pdf_base64?: string | null
          serieid?: number | null
          sujetodomicilioid_destino?: number | null
          sujetodomicilioid_envio?: number | null
          tipo_pedido?: string | null
          updated_at?: string | null
        }
        Update: {
          acreedorid_porte?: number | null
          clienteid?: number | null
          comercialid?: number | null
          created_at?: string
          divisa_cliente?: number | null
          estado?: string | null
          fecha?: string
          fecha_carga?: string | null
          fecha_llegada?: string | null
          fecha_pedido?: string | null
          id?: number
          list_linea_ped?: Json | null
          needs_sync?: boolean
          matricula_tractora?: string | null
          nombre_transportista?: string | null
          pdf_base64?: string | null
          serieid?: number | null
          sujetodomicilioid_destino?: number | null
          sujetodomicilioid_envio?: number | null
          tipo_pedido?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_access_logs: {
        Row: {
          action: string
          created_at: string
          email: string | null
          id: number
          metadata: Json | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          email?: string | null
          id?: number
          metadata?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          email?: string | null
          id?: number
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          allowed_routes: string[] | null
          created_at: string
          role: "admin" | "user"
          updated_at: string
          user_email: string | null
          user_id: string
        }
        Insert: {
          allowed_routes?: string[] | null
          created_at?: string
          role?: "admin" | "user"
          updated_at?: string
          user_email?: string | null
          user_id: string
        }
        Update: {
          allowed_routes?: string[] | null
          created_at?: string
          role?: "admin" | "user"
          updated_at?: string
          user_email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    Views: {}
    Functions: {
      begin_factura_recibida_sync_v2: {
        Args: {
          p_actor?: string | null
          p_expected_version: number
          p_factura_id: string
          p_request_id: string
          p_request_payload?: Json
        }
        Returns: Json
      }
      create_factura_recibida_v2: {
        Args: {
          p_actor?: string | null
          p_change_source?: string
          p_ctb?: Json
          p_factura: Json
          p_punteos?: Json
          p_reason?: string | null
          p_request_id?: string | null
        }
        Returns: Json
      }
      import_factura_recibida_reference_v2: {
        Args: {
          p_actor?: string | null
          p_ctb?: Json
          p_erp_readback?: Json
          p_factura: Json
          p_punteos?: Json
          p_reason?: string | null
          p_request_id?: string | null
        }
        Returns: Json
      }
      replace_factura_recibida_draft_with_reference_v2: {
        Args: {
          p_actor: string
          p_ctb: Json
          p_draft_id: string
          p_erp_readback: Json
          p_expected_version: number
          p_factura: Json
          p_punteos: Json
          p_reason: string
          p_request_id: string
        }
        Returns: Json
      }
      delete_factura_recibida_v2: {
        Args: {
          p_actor?: string | null
          p_expected_version: number
          p_factura_id: string
          p_reason?: string | null
          p_request_id?: string | null
        }
        Returns: Json
      }
      factura_recibida_snapshot_v2: {
        Args: { p_factura_id: string }
        Returns: Json
      }
      finalize_factura_recibida_sync_v2: {
        Args: {
          p_actor?: string | null
          p_factura_id: string
          p_readback: Json
          p_request_id: string
          p_write_response: Json
        }
        Returns: Json
      }
      finish_factura_recibida_sync_v2: {
        Args: {
          p_actor?: string | null
          p_error?: string | null
          p_factura_id: string
          p_http_status?: number | null
          p_phase: string
          p_request_id: string
          p_response_payload?: Json | null
          p_status: string
        }
        Returns: Json
      }
      save_factura_recibida_v2: {
        Args: {
          p_actor?: string | null
          p_change_source?: string
          p_ctb?: Json
          p_expected_version: number
          p_factura: Json
          p_factura_id: string
          p_punteos?: Json
          p_reason?: string | null
          p_request_id?: string | null
        }
        Returns: Json
      }
      verify_factura_ingest_token_hash: {
        Args: { p_token_hash: string }
        Returns: boolean
      }
      admin_delete_user: {
        Args: {
          p_user_id: string
        }
        Returns: Json
      }
      migrar_pdfs_existentes: { Args: never; Returns: Json }
      list_clienteids: {
        Args: Record<PropertyKey, never>
        Returns: {
          clienteid: number
        }[]
      }
      list_clienteids_cuentaventa: {
        Args: Record<PropertyKey, never>
        Returns: {
          clienteid: number
        }[]
      }
      list_clientes_visibles: {
        Args: Record<PropertyKey, never>
        Returns: {
          clienteid: number
        }[]
      }
      list_clientes_visibles_cuentaventa: {
        Args: Record<PropertyKey, never>
        Returns: {
          clienteid: number
        }[]
      }
      get_app_users: {
        Args: Record<PropertyKey, never>
        Returns: {
          id: string
          email: string | null
          created_at: string | null
        }[]
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    Enums: {}
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    CompositeTypes: {}
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never
