


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."app_role" AS ENUM (
    'admin',
    'user'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."change_line_action" AS ENUM (
    'upsert',
    'cancel'
);


ALTER TYPE "public"."change_line_action" OWNER TO "postgres";


CREATE TYPE "public"."change_status" AS ENUM (
    'pending',
    'accepted',
    'rejected',
    'ignored'
);


ALTER TYPE "public"."change_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cast_int_or_null"("j" "jsonb", "key" "text") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
BEGIN
  IF j ? key THEN
    RETURN (j ->> key)::integer;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."cast_int_or_null"("j" "jsonb", "key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cast_numeric_or_null"("j" "jsonb", "key" "text", "scale" integer) RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
BEGIN
  IF j ? key THEN
    RETURN (j ->> key)::numeric;
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."cast_numeric_or_null"("j" "jsonb", "key" "text", "scale" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_api_token"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
    characters text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    token_length integer := 16;
    token text := '';
    i integer;
BEGIN
    FOR i IN 1..token_length LOOP
        token := token || substr(characters, floor(random() * length(characters) + 1)::integer, 1);
    END LOOP;
    RETURN token;
END;
$_$;


ALTER FUNCTION "public"."generate_api_token"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_from_token"("token_value" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  user_uuid UUID;
BEGIN
  SELECT user_id INTO user_uuid 
  FROM public.api_tokens 
  WHERE token = token_value AND is_active = true;
  
  -- Update last_used_at
  IF user_uuid IS NOT NULL THEN
    UPDATE public.api_tokens 
    SET last_used_at = now() 
    WHERE token = token_value;
  END IF;
  
  RETURN user_uuid;
END;
$$;


ALTER FUNCTION "public"."get_user_from_token"("token_value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user_role"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT exists (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;


ALTER FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT public.has_role(auth.uid(), 'admin')
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."migrar_pdfs_existentes"() RETURNS json
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  total_pedidos INTEGER := 0;
  pedidos_con_pdf INTEGER := 0;
  archivos_creados INTEGER := 0;
  archivos_deduplicados INTEGER := 0;
  pedidos_actualizados INTEGER := 0;
  pedido_record RECORD;
  pdf_hash TEXT;
  pdf_size INTEGER;
  archivo_id BIGINT;
BEGIN
  -- Contar total de pedidos
  SELECT COUNT(*) INTO total_pedidos FROM pedidos;
  
  -- Contar pedidos con PDF
  SELECT COUNT(*) INTO pedidos_con_pdf 
  FROM pedidos 
  WHERE b64_pedido IS NOT NULL AND b64_pedido != '';
  
  -- Procesar cada pedido con PDF
  FOR pedido_record IN 
    SELECT id, b64_pedido, referencia_cliente
    FROM pedidos 
    WHERE b64_pedido IS NOT NULL AND b64_pedido != ''
    ORDER BY id
  LOOP
    -- Calcular hash SHA-256 del contenido base64
    pdf_hash := encode(digest(pedido_record.b64_pedido, 'sha256'), 'hex');
    
    -- Calcular tamaño del PDF decodificado (aproximado)
    pdf_size := (length(pedido_record.b64_pedido) * 3 / 4)::INTEGER;
    
    -- Buscar si ya existe un archivo con este hash
    SELECT id INTO archivo_id
    FROM archivos_pdf
    WHERE hash_sha256 = pdf_hash;
    
    IF archivo_id IS NULL THEN
      -- No existe, crear nuevo archivo
      INSERT INTO archivos_pdf (
        hash_sha256,
        b64_contenido,
        nombre_archivo,
        tamanio_bytes,
        mime_type
      ) VALUES (
        pdf_hash,
        pedido_record.b64_pedido,
        COALESCE(pedido_record.referencia_cliente, 'pedido_' || pedido_record.id) || '.pdf',
        pdf_size,
        'application/pdf'
      )
      RETURNING id INTO archivo_id;
      
      archivos_creados := archivos_creados + 1;
    ELSE
      -- Ya existe, se reutiliza (deduplicación)
      archivos_deduplicados := archivos_deduplicados + 1;
    END IF;
    
    -- Actualizar pedido con la referencia al archivo
    UPDATE pedidos
    SET archivo_pdf_id = archivo_id
    WHERE id = pedido_record.id;
    
    pedidos_actualizados := pedidos_actualizados + 1;
  END LOOP;
  
  -- Retornar estadísticas
  RETURN json_build_object(
    'total_pedidos', total_pedidos,
    'pedidos_con_pdf', pedidos_con_pdf,
    'archivos_creados', archivos_creados,
    'archivos_deduplicados', archivos_deduplicados,
    'pedidos_actualizados', pedidos_actualizados,
    'ahorro_porcentaje', CASE 
      WHEN pedidos_con_pdf > 0 
      THEN ROUND((archivos_deduplicados::NUMERIC / pedidos_con_pdf * 100), 2)
      ELSE 0 
    END
  );
END;
$$;


ALTER FUNCTION "public"."migrar_pdfs_existentes"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."migrar_pdfs_existentes"() IS 'Migra PDFs desde b64_pedido a archivos_pdf con deduplicación automática. Retorna estadísticas de la operación.';



CREATE OR REPLACE FUNCTION "public"."register_cambio"("p_source" "text", "p_external_ref" "text", "p_clienteid" bigint, "p_clienteid_envio" bigint, "p_sujetodomicilioid_destino" bigint, "p_sujetodomicilioid_envio" bigint, "p_fecha_carga" "date", "p_fecha_pedido" "date", "p_tipo_pedido" "text", "p_serieid" integer, "p_referencia_cliente" "text", "p_comercialid" bigint, "p_acreedorid_porte" bigint, "p_matricula_tractora" "text", "p_matricula_remolque" "text", "p_pedidoclienteid" "text", "p_payload" "jsonb", "p_payload_normalized" "jsonb", "p_lines" "jsonb") RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_cambio_id bigint;
  v_item jsonb;
  v_idx int := 0;
BEGIN
  INSERT INTO public.cambios (
    source, external_ref, clienteid, clienteid_envio, sujetodomicilioid_destino, sujetodomicilioid_envio,
    fecha_carga, fecha_pedido, tipo_pedido, serieid, referencia_cliente, comercialid, acreedorid_porte,
    matricula_tractora, matricula_remolque, pedidoclienteid, payload, payload_normalized
  )
  VALUES (
    p_source, p_external_ref, p_clienteid, p_clienteid_envio, p_sujetodomicilioid_destino, p_sujetodomicilioid_envio,
    p_fecha_carga, p_fecha_pedido, p_tipo_pedido, p_serieid, p_referencia_cliente, p_comercialid, p_acreedorid_porte,
    p_matricula_tractora, p_matricula_remolque, p_pedidoclienteid, p_payload, p_payload_normalized
  )
  RETURNING id INTO v_cambio_id;

  IF p_lines IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.cambio_lineas (
        cambio_id, line_number, match_key,
        confeccionpaletid, catalogoconfecid, confeccionsalidaid, grupoconfeccionid,
        generoid, tipocultivoid, origenid, calibreid,
        bultos, descripcion_salida, bultosxpalet, numero_palet, piezasxbulto, total_piezas,
        catconfecpiezaid, kilosxbulto, kilos_cliente, catconfeckilosbultoid,
        matched_pedidodetid, pedidoid, idpedidodet_orizon
      )
      VALUES (
        v_cambio_id,
        COALESCE((v_item->>'line_number')::int, v_idx),
        v_item->>'match_key',
        (v_item->>'confeccionpaletid')::int,
        (v_item->>'catalogoconfecid')::int,
        (v_item->>'confeccionsalidaid')::int,
        (v_item->>'grupoconfeccionid')::int,
        (v_item->>'generoid')::int,
        (v_item->>'tipocultivoid')::int,
        (v_item->>'origenid')::int,
        (v_item->>'calibreid')::int,
        (v_item->>'bultos')::int,
        v_item->>'descripcion_salida',
        (v_item->>'bultosxpalet')::int,
        (v_item->>'numero_palet')::numeric(12,3),
        (v_item->>'piezasxbulto')::int,
        (v_item->>'total_piezas')::int,
        (v_item->>'catconfecpiezaid')::int,
        CASE WHEN v_item ? 'kilosxbulto' THEN (v_item->>'kilosxbulto')::numeric(12,3) END,
        CASE WHEN v_item ? 'kilos_cliente' THEN (v_item->>'kilos_cliente')::numeric(14,3) END,
        (v_item->>'catconfeckilosbultoid')::int,
        (v_item->>'matched_pedidodetid')::bigint,
        (v_item->>'pedidoid')::bigint,
        (v_item->>'idpedidodet_orizon')::bigint
      );
    END LOOP;
  END IF;

  RETURN v_cambio_id;
END;
$$;


ALTER FUNCTION "public"."register_cambio"("p_source" "text", "p_external_ref" "text", "p_clienteid" bigint, "p_clienteid_envio" bigint, "p_sujetodomicilioid_destino" bigint, "p_sujetodomicilioid_envio" bigint, "p_fecha_carga" "date", "p_fecha_pedido" "date", "p_tipo_pedido" "text", "p_serieid" integer, "p_referencia_cliente" "text", "p_comercialid" bigint, "p_acreedorid_porte" bigint, "p_matricula_tractora" "text", "p_matricula_remolque" "text", "p_pedidoclienteid" "text", "p_payload" "jsonb", "p_payload_normalized" "jsonb", "p_lines" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_cambio_pedido"("p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_items jsonb;
  v_item jsonb;
  v_line jsonb;
  v_center jsonb;
  v_cambio_id bigint;
  v_line_id bigint;
  res jsonb := jsonb_build_object('cambios_created',0,'results',jsonb_build_array(),'errors',jsonb_build_array());
BEGIN
  IF jsonb_typeof(p_payload) = 'array' THEN
    v_items := p_payload;
  ELSIF jsonb_typeof(p_payload) = 'object' AND p_payload ? 'pedidos' THEN
    v_items := p_payload->'pedidos';
  ELSE
    RETURN jsonb_build_object('error','Invalid payload: expected array or object with pedidos');
  END IF;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN jsonb_build_object('error','Invalid payload: empty pedidos');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    BEGIN
      INSERT INTO public.cambios_pedidos (
        serieid, tipo_pedido, fecha_pedido, fecha_carga, clienteid, clienteid_envio, divisa_cliente,
        sujetodomicilioid_destino, sujetodomicilioid_envio, referencia_cliente, comercialid, acreedorid_porte,
        matricula_tractora, matricula_remolque, archivo_pdf_id, pedidoclienteid, idpedido_orizon, needs_sync, enviado
      ) VALUES (
        cast_int_or_null(v_item,'serieid'),
        v_item->>'tipo_pedido',
        (v_item->>'fecha_pedido')::date,
        (v_item->>'fecha_carga')::date,
        cast_int_or_null(v_item,'clienteid'),
        cast_int_or_null(v_item,'clienteid_envio'),
        cast_int_or_null(v_item,'divisa_cliente'),
        cast_int_or_null(v_item,'sujetodomicilioid_destino'),
        cast_int_or_null(v_item,'sujetodomicilioid_envio'),
        v_item->>'referencia_cliente',
        cast_int_or_null(v_item,'comercialid'),
        cast_int_or_null(v_item,'acreedorid_porte'),
        v_item->>'matricula_tractora',
        v_item->>'matricula_remolque',
        cast_int_or_null(v_item,'archivo_pdf_id'),
        v_item->>'pedidoclienteid',
        cast_int_or_null(v_item,'idpedido_orizon'),
        COALESCE((v_item->>'needs_sync')::boolean, false),
        COALESCE((v_item->>'enviado')::boolean, false)
      ) RETURNING id INTO v_cambio_id;

      -- Líneas
      IF v_item ? 'lineas' THEN
        FOR v_line IN SELECT * FROM jsonb_array_elements(v_item->'lineas')
        LOOP
          INSERT INTO public.cambios_pedido_linea (
            pedidoid, confeccionpaletid, catalogoconfecid, confeccionsalidaid, grupoconfeccionid,
            generoid, tipocultivoid, origenid, calibreid, bultos, descripcion_salida, bultosxpalet,
            numero_palet, piezasxbulto, total_piezas, catconfecpiezaid, kilosxbulto, kilos_cliente,
            catconfeckilosbultoid, idpedidodet_orizon, accion, cancel_reason
          ) VALUES (
            v_cambio_id,
            cast_int_or_null(v_line,'confeccionpaletid'),
            cast_int_or_null(v_line,'catalogoconfecid'),
            cast_int_or_null(v_line,'confeccionsalidaid'),
            cast_int_or_null(v_line,'grupoconfeccionid'),
            cast_int_or_null(v_line,'generoid'),
            cast_int_or_null(v_line,'tipocultivoid'),
            cast_int_or_null(v_line,'origenid'),
            cast_int_or_null(v_line,'calibreid'),
            cast_int_or_null(v_line,'bultos'),
            v_line->>'descripcion_salida',
            cast_int_or_null(v_line,'bultosxpalet'),
            cast_numeric_or_null(v_line,'numero_palet',3),
            cast_int_or_null(v_line,'piezasxbulto'),
            cast_int_or_null(v_line,'total_piezas'),
            cast_int_or_null(v_line,'catconfecpiezaid'),
            cast_numeric_or_null(v_line,'kilosxbulto',3),
            cast_numeric_or_null(v_line,'kilos_cliente',3),
            cast_int_or_null(v_line,'catconfeckilosbultoid'),
            (v_line->>'idpedidodet_orizon')::bigint,
            COALESCE(NULLIF(v_line->>'accion',''), 'upsert')::change_line_action,
            NULLIF(v_line->>'cancel_reason','')
          ) RETURNING pedidodetid INTO v_line_id;

          -- Centros
          IF v_line ? 'centros' THEN
            FOR v_center IN SELECT * FROM jsonb_array_elements(v_line->'centros')
            LOOP
              INSERT INTO public.cambios_pedido_linea_centro (
                pedidodetid, asignacion, numero_palets, subprov, pedidocentroid_orizon
              ) VALUES (
                v_line_id,
                v_center->>'asignacion',
                cast_numeric_or_null(v_center,'numero_palets',3),
                cast_int_or_null(v_center,'subprov'),
                cast_int_or_null(v_center,'pedidocentroid_orizon')
              );
            END LOOP;
          END IF;

        END LOOP;
      END IF;

      res := res || jsonb_build_object(
        'cambios_created', (res->>'cambios_created')::int + 1,
        'results', (res->'results') || jsonb_build_array(jsonb_build_object(
          'cambio_id', v_cambio_id,
          'referencia_cliente', v_item->>'referencia_cliente'
        ))
      );

    EXCEPTION WHEN OTHERS THEN
      res := res || jsonb_build_object(
        'errors', (res->'errors') || jsonb_build_array(jsonb_build_object(
          'referencia_cliente', COALESCE(v_item->>'referencia_cliente','unknown'),
          'message', SQLERRM
        ))
      );
    END;
  END LOOP;

  RETURN res;
END;
$$;


ALTER FUNCTION "public"."register_cambio_pedido"("p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_archivos_pdf_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_archivos_pdf_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."archivos_pdf" (
    "id" bigint NOT NULL,
    "hash_sha256" "text" NOT NULL,
    "b64_contenido" "text" NOT NULL,
    "nombre_archivo" "text",
    "tamanio_bytes" integer NOT NULL,
    "mime_type" "text" DEFAULT 'application/pdf'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "valid_size" CHECK (("tamanio_bytes" > 0))
);


ALTER TABLE "public"."archivos_pdf" OWNER TO "postgres";


COMMENT ON TABLE "public"."archivos_pdf" IS 'Almacena archivos PDF con deduplicación por hash SHA-256. Múltiples pedidos pueden compartir el mismo archivo.';



COMMENT ON COLUMN "public"."archivos_pdf"."hash_sha256" IS 'Hash SHA-256 del contenido base64 para identificación única y deduplicación';



COMMENT ON COLUMN "public"."archivos_pdf"."b64_contenido" IS 'Contenido del PDF codificado en base64';



COMMENT ON COLUMN "public"."archivos_pdf"."tamanio_bytes" IS 'Tamaño del archivo PDF original en bytes (antes de base64)';



COMMENT ON COLUMN "public"."archivos_pdf"."mime_type" IS 'Tipo MIME del archivo (application/pdf por defecto)';



CREATE SEQUENCE IF NOT EXISTS "public"."archivos_pdf_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."archivos_pdf_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."archivos_pdf_id_seq" OWNED BY "public"."archivos_pdf"."id";



CREATE TABLE IF NOT EXISTS "public"."cambio_lineas" (
    "id" bigint NOT NULL,
    "cambio_id" bigint NOT NULL,
    "line_number" integer,
    "match_key" "text",
    "confeccionpaletid" integer,
    "catalogoconfecid" integer,
    "confeccionsalidaid" integer,
    "grupoconfeccionid" integer,
    "generoid" integer,
    "tipocultivoid" integer,
    "origenid" integer,
    "calibreid" integer,
    "bultos" integer,
    "descripcion_salida" "text",
    "bultosxpalet" integer,
    "numero_palet" numeric(12,3),
    "piezasxbulto" integer,
    "total_piezas" integer,
    "catconfecpiezaid" integer,
    "kilosxbulto" numeric(12,3),
    "kilos_cliente" numeric(14,3),
    "catconfeckilosbultoid" integer,
    "matched_pedidodetid" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "pedidoid" bigint,
    "idpedidodet_orizon" bigint,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."cambio_lineas" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cambio_lineas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cambio_lineas_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cambio_lineas_id_seq" OWNED BY "public"."cambio_lineas"."id";



CREATE TABLE IF NOT EXISTS "public"."cambios" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text",
    "external_ref" "text",
    "clienteid" bigint,
    "clienteid_envio" bigint,
    "sujetodomicilioid_destino" bigint,
    "sujetodomicilioid_envio" bigint,
    "fecha_carga" "date",
    "fecha_pedido" "date",
    "tipo_pedido" "text",
    "serieid" integer,
    "referencia_cliente" "text",
    "comercialid" bigint,
    "acreedorid_porte" bigint,
    "matricula_tractora" "text",
    "matricula_remolque" "text",
    "pedidoclienteid" "text",
    "idpedido_orizon" bigint,
    "needs_sync" boolean DEFAULT false,
    "enviado" boolean DEFAULT false,
    "divisa_cliente" integer,
    "archivo_pdf_id" bigint,
    "payload" "jsonb",
    "payload_normalized" "jsonb",
    "status" "public"."change_status" DEFAULT 'pending'::"public"."change_status",
    "matched_pedido_id" bigint,
    "matched_prevision_id" bigint,
    "matched_at" timestamp with time zone,
    "resolved_at" timestamp with time zone,
    "resolved_by" "uuid",
    "notes" "text"
);


ALTER TABLE "public"."cambios" OWNER TO "postgres";


ALTER TABLE "public"."cambios" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."cambios_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cambios_pedido_linea" (
    "pedidodetid" bigint NOT NULL,
    "pedidoid" bigint NOT NULL,
    "confeccionpaletid" integer NOT NULL,
    "catalogoconfecid" integer NOT NULL,
    "confeccionsalidaid" integer NOT NULL,
    "grupoconfeccionid" integer NOT NULL,
    "generoid" integer NOT NULL,
    "tipocultivoid" integer NOT NULL,
    "origenid" integer NOT NULL,
    "calibreid" integer NOT NULL,
    "bultos" integer NOT NULL,
    "descripcion_salida" "text" NOT NULL,
    "bultosxpalet" integer NOT NULL,
    "numero_palet" numeric(12,3) NOT NULL,
    "piezasxbulto" integer,
    "total_piezas" integer,
    "catconfecpiezaid" integer,
    "kilosxbulto" numeric(12,3),
    "kilos_cliente" numeric(14,3),
    "catconfeckilosbultoid" integer,
    "ean" "text",
    "nlote_cliente" "text",
    "ean_caja" "text",
    "precio_venta" numeric(14,4),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "idpedidodet_orizon" bigint,
    "accion" "public"."change_line_action" DEFAULT 'upsert'::"public"."change_line_action",
    "cancel_reason" "text"
);


ALTER TABLE "public"."cambios_pedido_linea" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cambios_pedido_linea_centro" (
    "pedcentroid" bigint NOT NULL,
    "pedidodetid" bigint NOT NULL,
    "asignacion" "text",
    "numero_palets" numeric(12,3),
    "subprov" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "pedidocentroid_orizon" bigint
);


ALTER TABLE "public"."cambios_pedido_linea_centro" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cambios_pedido_linea_centro_pedcentroid_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cambios_pedido_linea_centro_pedcentroid_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cambios_pedido_linea_centro_pedcentroid_seq" OWNED BY "public"."cambios_pedido_linea_centro"."pedcentroid";



CREATE SEQUENCE IF NOT EXISTS "public"."cambios_pedido_linea_pedidodetid_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cambios_pedido_linea_pedidodetid_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cambios_pedido_linea_pedidodetid_seq" OWNED BY "public"."cambios_pedido_linea"."pedidodetid";



CREATE TABLE IF NOT EXISTS "public"."cambios_pedidos" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "serieid" integer DEFAULT 78,
    "tipo_pedido" "text" DEFAULT 'Venta'::"text",
    "fecha_pedido" "date",
    "fecha_carga" "date",
    "clienteid" bigint,
    "clienteid_envio" bigint,
    "divisa_cliente" integer,
    "sujetodomicilioid_destino" bigint,
    "sujetodomicilioid_envio" bigint,
    "referencia_cliente" "text",
    "comercialid" bigint,
    "acreedorid_porte" bigint,
    "matricula_tractora" "text",
    "matricula_remolque" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "archivo_pdf_id" bigint,
    "pedidoclienteid" "text",
    "enviado" boolean DEFAULT false,
    "idpedido_orizon" bigint,
    "needs_sync" boolean DEFAULT false,
    "revisado" boolean DEFAULT false NOT NULL,
    "revisado_por" "uuid",
    "revisado_en" timestamp with time zone
);


ALTER TABLE "public"."cambios_pedidos" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cambios_pedidos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cambios_pedidos_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cambios_pedidos_id_seq" OWNED BY "public"."cambios_pedidos"."id";



CREATE TABLE IF NOT EXISTS "public"."errores_app" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text",
    "subject" "text",
    "error" "text",
    "revisado" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."errores_app" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pedido_linea" (
    "pedidodetid" bigint NOT NULL,
    "pedidoid" bigint NOT NULL,
    "confeccionpaletid" integer NOT NULL,
    "catalogoconfecid" integer NOT NULL,
    "confeccionsalidaid" integer NOT NULL,
    "grupoconfeccionid" integer NOT NULL,
    "generoid" integer NOT NULL,
    "tipocultivoid" integer NOT NULL,
    "origenid" integer NOT NULL,
    "calibreid" integer NOT NULL,
    "bultos" integer NOT NULL,
    "descripcion_salida" "text" NOT NULL,
    "bultosxpalet" integer NOT NULL,
    "numero_palet" numeric(12,3) NOT NULL,
    "piezasxbulto" integer,
    "total_piezas" integer,
    "catconfecpiezaid" integer,
    "kilosxbulto" numeric(12,3),
    "kilos_cliente" numeric(14,3),
    "catconfeckilosbultoid" integer,
    "ean" "text",
    "nlote_cliente" "text",
    "ean_caja" "text",
    "precio_venta" numeric(14,4),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "idpedidodet_orizon" bigint
);


ALTER TABLE "public"."pedido_linea" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pedido_linea_centro" (
    "pedcentroid" bigint NOT NULL,
    "pedidodetid" bigint NOT NULL,
    "asignacion" "text" NOT NULL,
    "numero_palets" numeric(12,3) NOT NULL,
    "subprov" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "pedidocentroid_orizon" bigint
);


ALTER TABLE "public"."pedido_linea_centro" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."pedido_linea_centro_pedcentroid_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pedido_linea_centro_pedcentroid_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pedido_linea_centro_pedcentroid_seq" OWNED BY "public"."pedido_linea_centro"."pedcentroid";



CREATE SEQUENCE IF NOT EXISTS "public"."pedido_linea_pedidodetid_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."pedido_linea_pedidodetid_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."pedido_linea_pedidodetid_seq" OWNED BY "public"."pedido_linea"."pedidodetid";



CREATE TABLE IF NOT EXISTS "public"."pedidos" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "serieid" integer DEFAULT 78 NOT NULL,
    "tipo_pedido" "text" DEFAULT 'Venta'::"text" NOT NULL,
    "fecha_pedido" "date",
    "fecha_carga" "date",
    "clienteid" bigint,
    "clienteid_envio" bigint,
    "divisa_cliente" integer,
    "sujetodomicilioid_destino" bigint,
    "sujetodomicilioid_envio" bigint,
    "referencia_cliente" "text",
    "comercialid" bigint,
    "acreedorid_porte" bigint,
    "matricula_tractora" "text",
    "matricula_remolque" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "archivo_pdf_id" bigint,
    "pedidoclienteid" "text",
    "enviado" boolean DEFAULT false NOT NULL,
    "enviado_por" "uuid",
    "enviado_en" timestamp with time zone,
    "idpedido_orizon" bigint,
    "needs_sync" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."pedidos" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pedidos"."archivo_pdf_id" IS 'Foreign key to archivos_pdf table. PDFs are deduplicated using SHA-256 hash.';



COMMENT ON COLUMN "public"."pedidos"."pedidoclienteid" IS 'Identificador del pedido en el sistema del cliente (puede estar vacío)';



COMMENT ON COLUMN "public"."pedidos"."enviado" IS 'Indica si el pedido ha sido enviado a AgroIris';



ALTER TABLE "public"."pedidos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."pedidos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."previsiones" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fecha" timestamp with time zone DEFAULT "now"() NOT NULL,
    "serieid" integer DEFAULT 78,
    "tipo_pedido" "text" DEFAULT 'Propuesta'::"text",
    "fecha_pedido" "date",
    "fecha_carga" "date",
    "clienteid" integer,
    "divisa_cliente" integer,
    "comercialid" integer DEFAULT 0,
    "sujetodomicilioid_destino" integer,
    "sujetodomicilioid_envio" integer,
    "fecha_llegada" "date",
    "acreedorid_porte" integer DEFAULT 0,
    "matricula_tractora" "text",
    "nombre_transportista" "text",
    "list_linea_ped" "jsonb",
    "estado" "text" DEFAULT 'pendiente'::"text",
    "updated_at" timestamp with time zone
);


ALTER TABLE "public"."previsiones" OWNER TO "postgres";


ALTER TABLE "public"."previsiones" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."previsiones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE IF NOT EXISTS "public"."user_access_logs" (
    "id" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "action" "text" NOT NULL,
    "metadata" "jsonb"
);


ALTER TABLE "public"."user_access_logs" OWNER TO "postgres";


ALTER TABLE "public"."user_access_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_access_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()),
    "updated_at" timestamp with time zone,
    "username" "text",
    "full_name" "text",
    "avatar_url" "text",
    "website" "text"
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."archivos_pdf" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."archivos_pdf_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cambio_lineas" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cambio_lineas_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."cambios_pedido_linea" ALTER COLUMN "pedidodetid" SET DEFAULT "nextval"('"public"."cambios_pedido_linea_pedidodetid_seq"'::"regclass");



ALTER TABLE ONLY "public"."cambios_pedido_linea_centro" ALTER COLUMN "pedcentroid" SET DEFAULT "nextval"('"public"."cambios_pedido_linea_centro_pedcentroid_seq"'::"regclass");



ALTER TABLE ONLY "public"."cambios_pedidos" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cambios_pedidos_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."pedido_linea" ALTER COLUMN "pedidodetid" SET DEFAULT "nextval"('"public"."pedido_linea_pedidodetid_seq"'::"regclass");



ALTER TABLE ONLY "public"."pedido_linea_centro" ALTER COLUMN "pedcentroid" SET DEFAULT "nextval"('"public"."pedido_linea_centro_pedcentroid_seq"'::"regclass");



ALTER TABLE ONLY "public"."archivos_pdf"
    ADD CONSTRAINT "archivos_pdf_hash_sha256_key" UNIQUE ("hash_sha256");



ALTER TABLE ONLY "public"."archivos_pdf"
    ADD CONSTRAINT "archivos_pdf_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cambio_lineas"
    ADD CONSTRAINT "cambio_lineas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cambios_pedido_linea_centro"
    ADD CONSTRAINT "cambios_pedido_linea_centro_pkey" PRIMARY KEY ("pedcentroid");



ALTER TABLE ONLY "public"."cambios_pedido_linea"
    ADD CONSTRAINT "cambios_pedido_linea_pkey" PRIMARY KEY ("pedidodetid");



ALTER TABLE ONLY "public"."cambios_pedidos"
    ADD CONSTRAINT "cambios_pedidos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cambios"
    ADD CONSTRAINT "cambios_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."user_access_logs"
    ADD CONSTRAINT "user_access_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."errores_app"
    ADD CONSTRAINT "errores_app_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedido_linea_centro"
    ADD CONSTRAINT "pedido_linea_centro_pkey" PRIMARY KEY ("pedcentroid");



ALTER TABLE ONLY "public"."pedido_linea"
    ADD CONSTRAINT "pedido_linea_pkey" PRIMARY KEY ("pedidodetid");



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."previsiones"
    ADD CONSTRAINT "previsiones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pedido_linea_centro"
    ADD CONSTRAINT "uq_linea_asignacion" UNIQUE ("pedidodetid", "asignacion");



CREATE INDEX "idx_archivos_pdf_created" ON "public"."archivos_pdf" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_archivos_pdf_hash" ON "public"."archivos_pdf" USING "btree" ("hash_sha256");



CREATE INDEX "idx_archivos_pdf_size" ON "public"."archivos_pdf" USING "btree" ("tamanio_bytes");



CREATE INDEX "idx_cambio_lineas_cambio" ON "public"."cambio_lineas" USING "btree" ("cambio_id");



CREATE INDEX "idx_cambios_match" ON "public"."cambios" USING "btree" ("clienteid", "sujetodomicilioid_destino", "fecha_carga");



CREATE INDEX "idx_cambios_pedidos_match" ON "public"."cambios_pedidos" USING "btree" ("clienteid", "sujetodomicilioid_destino", "fecha_carga");



CREATE INDEX "idx_cambios_status" ON "public"."cambios" USING "btree" ("status");
CREATE INDEX "user_access_logs_created_at_idx" ON "public"."user_access_logs" USING "btree" ("created_at" DESC);
CREATE INDEX "user_access_logs_user_id_idx" ON "public"."user_access_logs" USING "btree" ("user_id");



CREATE INDEX "idx_centro_linea" ON "public"."pedido_linea_centro" USING "btree" ("pedidodetid");



CREATE INDEX "idx_linea_pedido" ON "public"."pedido_linea" USING "btree" ("pedidoid");



CREATE INDEX "idx_pedidos_archivo_pdf_id" ON "public"."pedidos" USING "btree" ("archivo_pdf_id");



CREATE INDEX "idx_pedidos_cliente" ON "public"."pedidos" USING "btree" ("clienteid");



CREATE INDEX "idx_pedidos_fecha_carga" ON "public"."pedidos" USING "btree" ("fecha_carga");



CREATE INDEX "idx_pedidos_pdf_fecha" ON "public"."pedidos" USING "btree" ("archivo_pdf_id", "created_at" DESC) WHERE ("archivo_pdf_id" IS NOT NULL);



CREATE UNIQUE INDEX "pedidos_referencia_unique_p220" ON "public"."pedidos" USING "btree" ("referencia_cliente") WHERE (("tipo_pedido" = 'P220'::"text") AND ("referencia_cliente" IS NOT NULL) AND ("referencia_cliente" <> ''::"text") AND ("clienteid" IS DISTINCT FROM 1873::bigint));



CREATE OR REPLACE TRIGGER "trigger_archivos_pdf_updated_at" BEFORE UPDATE ON "public"."archivos_pdf" FOR EACH ROW EXECUTE FUNCTION "public"."update_archivos_pdf_updated_at"();



ALTER TABLE ONLY "public"."cambio_lineas"
    ADD CONSTRAINT "cambio_lineas_cambio_id_fkey" FOREIGN KEY ("cambio_id") REFERENCES "public"."cambios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cambios_pedido_linea_centro"
    ADD CONSTRAINT "cambios_pedido_linea_centro_pedidodetid_fkey" FOREIGN KEY ("pedidodetid") REFERENCES "public"."cambios_pedido_linea"("pedidodetid") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cambios_pedido_linea"
    ADD CONSTRAINT "cambios_pedido_linea_pedidoid_fkey" FOREIGN KEY ("pedidoid") REFERENCES "public"."cambios_pedidos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedido_linea_centro"
    ADD CONSTRAINT "pedido_linea_centro_pedidodetid_fkey" FOREIGN KEY ("pedidodetid") REFERENCES "public"."pedido_linea"("pedidodetid") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedido_linea"
    ADD CONSTRAINT "pedido_linea_pedidoid_fkey" FOREIGN KEY ("pedidoid") REFERENCES "public"."pedidos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pedidos"
    ADD CONSTRAINT "pedidos_archivo_pdf_id_fkey" FOREIGN KEY ("archivo_pdf_id") REFERENCES "public"."archivos_pdf"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Profiles - select own" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Profiles - update own" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Public insert pedidos" ON "public"."pedidos" FOR INSERT WITH CHECK (true);



CREATE POLICY "Public read pedidos" ON "public"."pedidos" FOR SELECT USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."cast_int_or_null"("j" "jsonb", "key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cast_int_or_null"("j" "jsonb", "key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cast_int_or_null"("j" "jsonb", "key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cast_numeric_or_null"("j" "jsonb", "key" "text", "scale" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cast_numeric_or_null"("j" "jsonb", "key" "text", "scale" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cast_numeric_or_null"("j" "jsonb", "key" "text", "scale" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_api_token"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_api_token"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_api_token"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_from_token"("token_value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_from_token"("token_value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_from_token"("token_value" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "anon";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_role"("_user_id" "uuid", "_role" "public"."app_role") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."migrar_pdfs_existentes"() TO "anon";
GRANT ALL ON FUNCTION "public"."migrar_pdfs_existentes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."migrar_pdfs_existentes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."register_cambio"("p_source" "text", "p_external_ref" "text", "p_clienteid" bigint, "p_clienteid_envio" bigint, "p_sujetodomicilioid_destino" bigint, "p_sujetodomicilioid_envio" bigint, "p_fecha_carga" "date", "p_fecha_pedido" "date", "p_tipo_pedido" "text", "p_serieid" integer, "p_referencia_cliente" "text", "p_comercialid" bigint, "p_acreedorid_porte" bigint, "p_matricula_tractora" "text", "p_matricula_remolque" "text", "p_pedidoclienteid" "text", "p_payload" "jsonb", "p_payload_normalized" "jsonb", "p_lines" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."register_cambio"("p_source" "text", "p_external_ref" "text", "p_clienteid" bigint, "p_clienteid_envio" bigint, "p_sujetodomicilioid_destino" bigint, "p_sujetodomicilioid_envio" bigint, "p_fecha_carga" "date", "p_fecha_pedido" "date", "p_tipo_pedido" "text", "p_serieid" integer, "p_referencia_cliente" "text", "p_comercialid" bigint, "p_acreedorid_porte" bigint, "p_matricula_tractora" "text", "p_matricula_remolque" "text", "p_pedidoclienteid" "text", "p_payload" "jsonb", "p_payload_normalized" "jsonb", "p_lines" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_cambio"("p_source" "text", "p_external_ref" "text", "p_clienteid" bigint, "p_clienteid_envio" bigint, "p_sujetodomicilioid_destino" bigint, "p_sujetodomicilioid_envio" bigint, "p_fecha_carga" "date", "p_fecha_pedido" "date", "p_tipo_pedido" "text", "p_serieid" integer, "p_referencia_cliente" "text", "p_comercialid" bigint, "p_acreedorid_porte" bigint, "p_matricula_tractora" "text", "p_matricula_remolque" "text", "p_pedidoclienteid" "text", "p_payload" "jsonb", "p_payload_normalized" "jsonb", "p_lines" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."register_cambio_pedido"("p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."register_cambio_pedido"("p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_cambio_pedido"("p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_archivos_pdf_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_archivos_pdf_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_archivos_pdf_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";



GRANT ALL ON TABLE "public"."archivos_pdf" TO "anon";
GRANT ALL ON TABLE "public"."archivos_pdf" TO "authenticated";
GRANT ALL ON TABLE "public"."archivos_pdf" TO "service_role";



GRANT ALL ON SEQUENCE "public"."archivos_pdf_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."archivos_pdf_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."archivos_pdf_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cambio_lineas" TO "anon";
GRANT ALL ON TABLE "public"."cambio_lineas" TO "authenticated";
GRANT ALL ON TABLE "public"."cambio_lineas" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cambio_lineas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cambio_lineas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cambio_lineas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cambios" TO "anon";
GRANT ALL ON TABLE "public"."cambios" TO "authenticated";
GRANT ALL ON TABLE "public"."cambios" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cambios_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cambios_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cambios_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cambios_pedido_linea" TO "anon";
GRANT ALL ON TABLE "public"."cambios_pedido_linea" TO "authenticated";
GRANT ALL ON TABLE "public"."cambios_pedido_linea" TO "service_role";



GRANT ALL ON TABLE "public"."cambios_pedido_linea_centro" TO "anon";
GRANT ALL ON TABLE "public"."cambios_pedido_linea_centro" TO "authenticated";
GRANT ALL ON TABLE "public"."cambios_pedido_linea_centro" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cambios_pedido_linea_centro_pedcentroid_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cambios_pedido_linea_centro_pedcentroid_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cambios_pedido_linea_centro_pedcentroid_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cambios_pedido_linea_pedidodetid_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cambios_pedido_linea_pedidodetid_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cambios_pedido_linea_pedidodetid_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cambios_pedidos" TO "anon";
GRANT ALL ON TABLE "public"."cambios_pedidos" TO "authenticated";
GRANT ALL ON TABLE "public"."cambios_pedidos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cambios_pedidos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cambios_pedidos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cambios_pedidos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_access_logs" TO "anon";
GRANT ALL ON TABLE "public"."user_access_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_access_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_access_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_access_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_access_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."errores_app" TO "anon";
GRANT ALL ON TABLE "public"."errores_app" TO "authenticated";
GRANT ALL ON TABLE "public"."errores_app" TO "service_role";



GRANT ALL ON TABLE "public"."pedido_linea" TO "anon";
GRANT ALL ON TABLE "public"."pedido_linea" TO "authenticated";
GRANT ALL ON TABLE "public"."pedido_linea" TO "service_role";



GRANT ALL ON TABLE "public"."pedido_linea_centro" TO "anon";
GRANT ALL ON TABLE "public"."pedido_linea_centro" TO "authenticated";
GRANT ALL ON TABLE "public"."pedido_linea_centro" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pedido_linea_centro_pedcentroid_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pedido_linea_centro_pedcentroid_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pedido_linea_centro_pedcentroid_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pedido_linea_pedidodetid_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pedido_linea_pedidodetid_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pedido_linea_pedidodetid_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pedidos" TO "anon";
GRANT ALL ON TABLE "public"."pedidos" TO "authenticated";
GRANT ALL ON TABLE "public"."pedidos" TO "service_role";



GRANT ALL ON SEQUENCE "public"."pedidos_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."pedidos_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."pedidos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."previsiones" TO "anon";
GRANT ALL ON TABLE "public"."previsiones" TO "authenticated";
GRANT ALL ON TABLE "public"."previsiones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."previsiones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."previsiones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."previsiones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
