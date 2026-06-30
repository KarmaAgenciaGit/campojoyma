export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

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
      acreedores_cache: {
        Row: {
          ACR_Codigo: number
          ACR_Cuenta: string | null
          ACR_Nif: string | null
          ACR_Nombre: string | null
          activo: boolean
          created_at: string
          raw: Json
          synced_at: string
          updated_at: string
        }
        Insert: {
          ACR_Codigo: number
          ACR_Cuenta?: string | null
          ACR_Nif?: string | null
          ACR_Nombre?: string | null
          activo?: boolean
          created_at?: string
          raw?: Json
          synced_at?: string
          updated_at?: string
        }
        Update: {
          ACR_Codigo?: number
          ACR_Cuenta?: string | null
          ACR_Nif?: string | null
          ACR_Nombre?: string | null
          activo?: boolean
          created_at?: string
          raw?: Json
          synced_at?: string
          updated_at?: string
        }
        Relationships: []
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
    Views: {}
    Functions: {
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
    Enums: {}
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
